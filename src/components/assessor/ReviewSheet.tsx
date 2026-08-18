import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, Check, Loader2, AlertTriangle, Ban, Trash2, RotateCcw, Copy, FileWarning } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAccounts, useCategories } from "@/lib/db/finance";
import { useCreditCards } from "@/lib/db/creditCards";
import { formatBRL } from "@/lib/engine/facts";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { usePrivacyMode } from "@/context/PrivacyModeContext";
import { CategorySelect } from "@/components/CategorySelect";
import { BLOCK_MESSAGES, isCardDocument } from "@/lib/ledger/canonical";
import { invoiceReconciliation, summarizeInvoiceLines, type StatementItemKind } from "@/lib/finance/invoice";
import { invokeEdge, failureDescription } from "@/lib/edge/invoke";
import { invalidateFinancialQueries } from "@/lib/db/invalidation";

type Item = {
  id: string;
  document_id: string;
  idx: number;
  status: string;
  type: "income" | "expense";
  amount: number | string;
  occurred_at: string;
  description: string | null;
  payment_method: "account" | "credit_card" | null;
  account_id: string | null;
  credit_card_id: string | null;
  category_id: string | null;
  account_hint: string | null;
  card_hint: string | null;
  category_hint: string | null;
  installments_total: number | null;
  installment_number: number | null;
  purchase_date: string | null;
  competence_date: string | null;
  duplicate_of: string | null;
  transaction_id: string | null;
  raw_description?: string | null;
  bank_description?: string | null;
  friendly_description?: string | null;
  normalized_description?: string | null;
  duplicate_reason?: string | null;
  category_source?: string | null;
  category_confidence?: number | null;
  movement_kind?: string | null;
  historical_installments_paid_assumption?: boolean | null;
  statement_item_kind?: StatementItemKind | null;
  installment_inferred?: boolean;
};

type DocumentInfo = {
  document_kind: string | null;
  statement_opening_balance: number | null;
  statement_closing_balance: number | null;
  statement_balance_date: string | null;
  period_start: string | null;
  period_end: string | null;
  statement_bank: string | null;
  counters: Record<string, number> | null;
  user_instructions: string | null;
  status: string;
  source_account_id?: string | null;
  source_credit_card_id?: string | null;
  source_context_method?: string | null;
  invoice_total?: number | null;
  invoice_previous_balance?: number | null;
  invoice_due_date?: string | null;
  invoice_closing_date?: string | null;
  invoice_competence_month?: string | null;
  invoice_card_last4?: string | null;
  invoice_coverage?: {
    sections?: Array<{ section: string; official_total: number | null; extracted_total: number; difference: number | null; covered: boolean }>;
  } | null;
};

const SECTION_LABELS: Record<string, string> = {
  payments: "Pagamentos",
  domestic: "Compras nacionais",
  international: "Compras internacionais",
  taxes: "IOF e encargos",
  credits: "Estornos",
  future_installments: "Parcelas futuras",
  other: "Lançamentos do ciclo",
};

type Fragment = {
  fragment_index: number;
  total_fragments: number;
  page_start: number;
  page_end: number;
  status: string;
  attempts: number;
  items_found: number;
  duplicates_found: number;
  error_code: string | null;
};

type Rejection = {
  id: string;
  item_index: number;
  reason_code: string;
  description_excerpt: string | null;
};

function parseBRLInput(raw: string): number | null {
  const clean = raw.trim().replace(/R\$|\s/g, "");
  const comma = clean.lastIndexOf(",");
  const dot = clean.lastIndexOf(".");
  const normalized = comma > dot
    ? clean.replace(/\./g, "").replace(",", ".")
    : clean.replace(/,/g, "");
  const value = Number(normalized);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function parseBRLSignedInput(raw: string): number | null {
  const clean = raw.trim().replace(/R\$|\s/g, "");
  if (!clean) return null;
  const comma = clean.lastIndexOf(",");
  const dot = clean.lastIndexOf(".");
  const normalized = comma > dot
    ? clean.replace(/\./g, "").replace(",", ".")
    : clean.replace(/,/g, "");
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

export function ReviewSheet({
  documentId,
  onClose,
}: {
  documentId: string;
  onClose: () => void;
}) {
  const nav = useNavigate();
  const { valuesHidden } = usePrivacyMode();
  const qc = useQueryClient();
  const { data: accounts = [] } = useAccounts();
  const { data: categories = [] } = useCategories();
  const { data: cards = [] } = useCreditCards();
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [docKind, setDocKind] = useState<string | null>(null);
  const [documentInfo, setDocumentInfo] = useState<DocumentInfo | null>(null);
  const [reconcileAccount, setReconcileAccount] = useState("");
  const [reconciling, setReconciling] = useState(false);
  const [bulkTarget, setBulkTarget] = useState("");
  const [bulkSaving, setBulkSaving] = useState(false);
  const [fragments, setFragments] = useState<Fragment[]>([]);
  const [rejections, setRejections] = useState<Rejection[]>([]);
  const [recovering, setRecovering] = useState(false);
  const [invoiceTotalInput, setInvoiceTotalInput] = useState("");
  const [invoicePreviousBalanceInput, setInvoicePreviousBalanceInput] = useState("");
  const [invoiceDueDateInput, setInvoiceDueDateInput] = useState("");
  const [summaryOpen, setSummaryOpen] = useState(false);

  const [pendingWrites, setPendingWrites] = useState(0);
  const [resolvingDup, setResolvingDup] = useState<string | null>(null);

  // Duplicidade nunca é decidida em silêncio: o usuário diz se é cobrança real
  // ou repetição, e a decisão fica auditada em `document_import_audit`.
  const resolveDuplicate = async (
    itemId: string,
    resolution: "keep_as_legitimate" | "link_to_existing" | "supersede",
    linkedTransactionId: string | null = null,
  ) => {
    setResolvingDup(itemId);
    try {
      const { error } = await supabase.rpc("resolve_duplicate_item" as never, {
        p_item_id: itemId,
        p_resolution: resolution,
        p_linked_transaction_id: linkedTransactionId,
      } as never);
      if (error) throw error;
      setItems((xs) => xs.map((x) => x.id === itemId
        ? { ...x, status: resolution === "keep_as_legitimate" ? "needs_review" : "ignored" }
        : x));
      if (resolution !== "keep_as_legitimate") {
        setSelected((s) => { const n = new Set(s); n.delete(itemId); return n; });
      }
      toast.success(resolution === "keep_as_legitimate" ? "Marcado como cobrança real." : "Duplicidade descartada.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não consegui registrar a decisão.");
    } finally {
      setResolvingDup(null);
    }
  };



  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase.functions.invoke("assistant-review-actions", {
        body: { action: "list", document_id: documentId },
      });
      if (cancelled) return;
      if (error) {
        console.error("[ReviewSheet] list", error);
        toast.error("Não consegui abrir a revisão agora. Tente novamente.");
        setLoading(false);
        return;
      }
      const d = data as { document: DocumentInfo; items: Item[]; fragments?: Fragment[]; rejections?: Rejection[] };
      setItems(d.items);
      setFragments(d.fragments ?? []);
      setRejections(d.rejections ?? []);
      setDocumentInfo(d.document);
      setInvoiceTotalInput(d.document?.invoice_total == null ? "" : Number(d.document.invoice_total).toLocaleString("pt-BR", { minimumFractionDigits: 2 }));
      setInvoicePreviousBalanceInput(d.document?.invoice_previous_balance == null ? "" : Number(d.document.invoice_previous_balance).toLocaleString("pt-BR", { minimumFractionDigits: 2 }));
      setInvoiceDueDateInput(d.document?.invoice_due_date ? String(d.document.invoice_due_date).slice(0, 10) : "");

      setDocKind(d.document?.document_kind ?? null);
      // Also select rows confirmed by the legacy two-step flow when the
      // document itself never finalized. The new RPC will treat them as
      // idempotent and complete the statement without duplicate transactions.
      const recoverLegacyPartial = d.document?.document_kind === "invoice" && d.document?.status !== "confirmed";
      const initial = new Set<string>(d.items.filter((i) =>
        i.status === "needs_review" || i.status === "failed" ||
        (recoverLegacyPartial && i.status === "confirmed")
      ).map((i) => i.id));
      setSelected(initial);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [documentId]);

  const selectedItems = useMemo(() => items.filter((i) => selected.has(i.id)), [items, selected]);
  const invoiceSummary = useMemo(() => summarizeInvoiceLines(selectedItems.map((item) => ({
    ...item,
    amount: Number(item.amount),
  }))), [selectedItems]);
  const total = useMemo(() => docKind === "invoice"
    ? invoiceSummary.net
    : selectedItems.reduce((sum, item) => sum + Number(item.amount), 0),
  [docKind, invoiceSummary.net, selectedItems]);
  const reconciliation = useMemo(() => invoiceReconciliation(
    documentInfo?.invoice_total,
    invoiceSummary.net,
    Number(documentInfo?.invoice_previous_balance ?? 0),
  ), [documentInfo?.invoice_total, documentInfo?.invoice_previous_balance, invoiceSummary.net]);

  // Conferência por bloco: só mostramos seções com subtotal oficial conhecido.
  const coverageRows = useMemo(
    () => (documentInfo?.invoice_coverage?.sections ?? []).filter((row) => row.official_total != null),
    [documentInfo?.invoice_coverage],
  );

  // Bloqueios de confirmação: nunca confirmar item sem destino contábil válido.
  const blockers = useMemo(() => {
    const chosen = items.filter((i) => selected.has(i.id));
    const reasons = new Set<string>();
    for (const it of chosen) {
      const card = isCardDocument(docKind) || it.payment_method === "credit_card" || !!it.credit_card_id;
      if (card && !it.credit_card_id) reasons.add("missing_credit_card");
      if (!card && !it.account_id) reasons.add("missing_account");
      if ((it.installments_total ?? 1) > 1 && (
        !it.installment_number || it.installment_number > Number(it.installments_total)
      )) reasons.add("Parcelamento inválido: informe a parcela atual e o total.");
    }
    if (docKind === "invoice" && documentInfo?.invoice_total == null) {
      reasons.add("Informe o total oficial da fatura.");
    } else if (docKind === "invoice" && !reconciliation.reconciled) {
      reasons.add(`A fatura não fecha: diferença de ${formatBRL(Math.abs(reconciliation.difference ?? 0))}. Corrija ou ignore linhas indevidas.`);
    }
    return [...reasons].map((r) => BLOCK_MESSAGES[r] ?? r);
  }, [items, selected, docKind, documentInfo?.invoice_total, reconciliation]);


  function toggle(id: string) {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }

  function toggleAll() {
    if (selected.size === items.filter((i) => i.status !== "confirmed" && i.status !== "ignored").length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(items.filter((i) => i.status !== "confirmed" && i.status !== "ignored").map((i) => i.id)));
    }
  }

  async function patchItem(id: string, patch: Partial<Item>) {
    const previous = items.find((item) => item.id === id);
    setItems((xs) => xs.map((x) => (x.id === id ? { ...x, ...patch } : x)));
    setPendingWrites((count) => count + 1);
    try {
      const { error } = await supabase.functions.invoke("assistant-review-actions", {
        body: { action: "update", item_id: id, patch },
      });
      if (error) throw error;
    } catch (error) {
      if (previous) setItems((xs) => xs.map((x) => (x.id === id ? previous : x)));
      console.error("[ReviewSheet] update", error);
      toast.error("A alteração não foi salva", { description: "O valor anterior foi restaurado para você não confirmar dados incorretos." });
    } finally {
      setPendingWrites((count) => Math.max(0, count - 1));
    }
  }

  async function saveInvoiceTotal() {
    const value = parseBRLInput(invoiceTotalInput);
    if (value == null) return toast.error("Informe um total de fatura válido.");
    const { error } = await supabase.functions.invoke("assistant-review-actions", {
      body: { action: "update-document", document_id: documentId, patch: { invoice_total: value } },
    });
    if (error) return toast.error("Não consegui salvar o total da fatura.");
    setDocumentInfo((current) => current ? { ...current, invoice_total: value } : current);
  }

  async function saveInvoicePreviousBalance() {
    const value = parseBRLSignedInput(invoicePreviousBalanceInput);
    if (value == null) return toast.error("Informe um saldo anterior válido.");
    const { error } = await supabase.functions.invoke("assistant-review-actions", {
      body: { action: "update-document", document_id: documentId, patch: { invoice_previous_balance: value } },
    });
    if (error) return toast.error("Não consegui salvar o saldo anterior da fatura.");
    setDocumentInfo((current) => current ? { ...current, invoice_previous_balance: value } : current);
  }

  // Vencimento manda na competência da fatura: sem ele o motor deriva pelo
  // ciclo do cartão. Informar aqui resolve o caso de duas faturas no mesmo mês.
  async function saveInvoiceDueDate() {
    const raw = invoiceDueDateInput.trim();
    const current = documentInfo?.invoice_due_date ? String(documentInfo.invoice_due_date).slice(0, 10) : "";
    if (raw === current) return;
    if (raw && !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return toast.error("Informe uma data de vencimento válida.");
    const value = raw || null;
    const { error } = await supabase.functions.invoke("assistant-review-actions", {
      body: {
        action: "update-document",
        document_id: documentId,
        patch: { invoice_due_date: value, invoice_competence_month: value ? `${value.slice(0, 7)}-01` : null },
      },
    });
    if (error) return toast.error("Não consegui salvar o vencimento da fatura.");
    setDocumentInfo((prev) => prev
      ? { ...prev, invoice_due_date: value, invoice_competence_month: value ? `${value.slice(0, 7)}-01` : null }
      : prev);
    toast.success(value ? "Vencimento salvo." : "Vencimento removido: vou calcular pelo ciclo do cartão.");
  }



  async function applyBulkTarget() {
    if (!bulkTarget || selected.size === 0) {
      toast.error("Selecione os lançamentos e escolha a origem.");
      return;
    }
    const [method, resourceId] = bulkTarget.split(":");
    const patch: Partial<Item> = method === "account"
      ? { payment_method: "account", account_id: resourceId, credit_card_id: null }
      : { payment_method: "credit_card", credit_card_id: resourceId, account_id: null };
    setBulkSaving(true);
    try {
      const ids = [...selected];
      const results = await Promise.all(ids.map((id) => supabase.functions.invoke("assistant-review-actions", {
        body: { action: "update", item_id: id, patch },
      })));
      const failed = results.some((result) => result.error);
      if (failed) throw new Error("bulk_update_failed");
      setItems((xs) => xs.map((x) => selected.has(x.id) ? { ...x, ...patch } : x));
      const label = method === "account"
        ? accounts.find((a) => a.id === resourceId)?.name
        : cards.find((c: { id: string; name: string }) => c.id === resourceId)?.name;
      toast.success(`Origem aplicada: ${label ?? "seleção"}`);
    } catch (error) {
      console.error("[ReviewSheet] bulk update", error);
      toast.error("Não consegui aplicar a origem a todos. Tente novamente.");
    } finally {
      setBulkSaving(false);
    }
  }

  async function ignoreItem(id: string) {
    setItems((xs) => xs.map((x) => (x.id === id ? { ...x, status: "ignored" } : x)));
    setSelected((s) => { const n = new Set(s); n.delete(id); return n; });
    const { error } = await supabase.functions.invoke("assistant-review-actions", {
      body: { action: "ignore", item_id: id },
    });
    if (error) toast.error("Falha", { description: error.message });
  }

  async function recoverRejected() {
    if (rejections.length === 0) return;
    setRecovering(true);
    try {
      const { error } = await supabase.functions.invoke("assistant-review-actions", {
        body: { action: "reprocess-rejected", document_id: documentId },
      });
      if (error) throw error;
      const { data } = await supabase.functions.invoke("assistant-review-actions", { body: { action: "list", document_id: documentId } });
      const refreshed = data as { items?: Item[]; rejections?: Rejection[] };
      setItems(refreshed.items ?? []);
      setRejections(refreshed.rejections ?? []);
      toast.success("Itens recuperáveis voltaram para revisão.");
    } catch (error) {
      console.error("[ReviewSheet] recover rejected", error);
      toast.error("Não consegui recuperar os itens rejeitados.");
    } finally { setRecovering(false); }
  }

  async function copyDiagnostic() {
    const completed = fragments.filter((fragment) => fragment.status === "completed").length;
    await navigator.clipboard.writeText([
      `document_id=${documentId}`,
      `status=${documentInfo?.status ?? "unknown"}`,
      `fragments=${completed}/${fragments.length}`,
      `rejections=${rejections.length}`,
    ].join("\n"));
    toast.success("Diagnóstico copiado.");
  }

  async function confirmSelection() {
    const ids = [...selected];
    if (ids.length === 0) return;
    if (pendingWrites > 0 || bulkSaving) {
      toast.info("Salvando suas últimas edições", { description: "A confirmação será liberada assim que tudo estiver seguro." });
      return;
    }
    // Client-side pre-flight: every item must have a valid target (account or card)
    const notReady = items.filter((i) => selected.has(i.id) && (
      (i.payment_method === "account" && !i.account_id) ||
      (i.payment_method === "credit_card" && !i.credit_card_id) ||
      (!i.payment_method && !i.account_id && !i.credit_card_id)
    ));
    if (notReady.length > 0) {
      toast.error("Faltam informações", { description: `${notReady.length} item(ns) precisam de conta ou cartão.` });
      return;
    }
    const uncategorized = items.filter((i) => selected.has(i.id) && !i.category_id && i.movement_kind === "transaction").length;
    const historyPending = items.filter((i) =>
      selected.has(i.id)
      && docKind === "invoice"
      && (i.installment_number ?? 1) > 1
      && i.historical_installments_paid_assumption == null
    ).length;
    if (historyPending > 0) {
      toast.error("Confirme o histórico das parcelas", {
        description: `${historyPending} compra(s) começaram antes desta fatura.`,
      });
      return;
    }
    if (uncategorized > 0 && !confirm(`${uncategorized} lançamento(s) continuam sem categoria. Deseja confirmar mesmo assim?`)) return;
    setConfirming(true);
    try {
      const { data, failure } = await invokeEdge<{ ok?: boolean; result?: { created_count: number; accounted_count?: number; non_ledger_count?: number; errors: unknown[]; total_selected: number } }>(
        "assistant-review-actions",
        { action: "confirm", document_id: documentId, item_ids: ids },
      );
      if (failure) {
        toast.error("A fatura não foi registrada", {
          description: `${failureDescription(failure)} Suas edições foram preservadas.`,
        });
        return;
      }
      const payload = data ?? {};
      if (!payload.result) {
        toast.error("A fatura não foi registrada", { description: "Suas edições foram preservadas. Revise a conciliação e tente novamente." });
        return;
      }
      const r = payload.result;
      const accounted = r.accounted_count ?? r.created_count;
      if (accounted === r.total_selected && r.errors.length === 0) {
        toast.success(`${r.created_count} lançamento(s) registrado(s)`, {
          description: r.non_ledger_count ? `${r.non_ledger_count} linha(s) conciliatória(s) não viraram nova despesa.` : undefined,
        });
      } else {
        const firstError = (r.errors[0] as { error?: string } | undefined)?.error;
        toast.error(`${accounted} de ${r.total_selected} item(ns) contabilizado(s)`, {
          description: firstError ? `Falha: ${firstError}. Corrija e tente novamente; suas edições foram preservadas.` : "Revise os itens pendentes e tente novamente.",
        });
        const { data: refreshed } = await supabase.functions.invoke("assistant-review-actions", {
          body: { action: "list", document_id: documentId },
        });
        const next = refreshed as { items?: Item[] };
        if (next.items) {
          setItems(next.items);
          setSelected(new Set(next.items.filter((item) => item.status === "needs_review" || item.status === "failed").map((item) => item.id)));
        }
      }
      await (supabase as any).rpc("reconcile_imported_installment_history", {
        p_document_id: documentId,
      });
      await invalidateFinancialQueries(qc);
      if (accounted === r.total_selected && r.errors.length === 0) {
        onClose();
        if (r.created_count > 0) nav("/app/lancamentos");
      }
    } catch (e) {
      console.error("[ReviewSheet] confirm", e);
      toast.error("Não consegui confirmar agora. Seus itens continuam salvos para revisão.");
    } finally {
      setConfirming(false);
    }
  }

  async function reconcileBalance() {
    if (!reconcileAccount) return toast.error("Escolha a conta do extrato.");
    setReconciling(true);
    const { data, error } = await supabase.functions.invoke("assistant-review-actions", {
      body: { action: "reconcile", document_id: documentId, account_id: reconcileAccount },
    });
    setReconciling(false);
    if (error) return toast.error("Não consegui conciliar o saldo.");
    const result = (data as { result?: { difference?: number } })?.result;
    await invalidateFinancialQueries(qc);
    toast.success("Saldo do banco conciliado", { description: result?.difference ? `Diferença auditada: ${formatBRL(Number(result.difference))}` : "O cálculo fechou com o extrato." });
  }

  async function cancelImport() {
    if (!confirm("Cancelar essa importação? Nada será registrado.")) return;
    const { data, error } = await supabase.functions.invoke("assistant-review-actions", {
      body: { action: "cancel", document_id: documentId },
    });
    if (error) return toast.error("Falha ao cancelar", { description: error.message });
    const payload = data as { ok?: boolean; error?: string; result?: { ok?: boolean; error?: string; discarded_items?: number } } | null;
    if (!payload?.ok || !payload.result?.ok) {
      return toast.error("Não consegui cancelar esta importação", {
        description: payload?.result?.error ?? payload?.error ?? "Tente novamente em instantes.",
      });
    }
    await invalidateFinancialQueries(qc);
    toast.message("Importação cancelada.");
    onClose();
  }

  void categories; // Preservado apenas para invalidação/cache; opções vêm do CategorySelect.

  const panel = (
    <div className="fixed inset-0 z-[140] flex flex-col bg-background md:items-center md:justify-center md:bg-black/50" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex h-full w-full flex-col bg-card md:h-[90vh] md:max-h-[800px] md:w-[720px] md:rounded-2xl md:shadow-brand"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <p className="font-display text-base font-bold">Revisar lançamentos</p>
            <p className="text-[11px] text-muted-foreground">
              {docKind ? `${docKind} · ` : ""}
              {items.length} item(ns) encontrados
            </p>
          </div>
          <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-full hover:bg-secondary" aria-label="Fechar">
            <X size={16} />
          </button>
        </header>

        {loading ? (
          <div className="grid flex-1 place-items-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : items.length === 0 ? (
          <div className="grid flex-1 place-items-center p-8 text-center">
            <div>
              <AlertTriangle className="mx-auto mb-2 h-8 w-8 text-warning" />
              <p className="text-sm font-medium">Nenhum lançamento identificado</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {docKind === "illegible" && "Imagem ilegível. Tente outra foto mais nítida."}
                {docKind === "non_financial" && "Isso não parece ser um documento financeiro."}
                {(!docKind || docKind === "unknown") && "Não consegui identificar itens nesta imagem."}
              </p>
            </div>
          </div>
        ) : (
          <>
            {documentInfo && (
              <div className={`space-y-2 border-b border-border bg-secondary/30 px-4 py-2 text-xs transition-[max-height] ${summaryOpen ? "max-h-[65vh] overflow-y-auto" : "max-h-[92px] overflow-hidden"}`}>
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="font-semibold">
                      {isCardDocument(documentInfo.document_kind)
                        ? `Fatura de cartão${documentInfo.statement_bank ? ` · ${documentInfo.statement_bank}` : ""}`
                        : documentInfo.document_kind === "statement"
                          ? `Extrato bancário${documentInfo.statement_bank ? ` · ${documentInfo.statement_bank}` : ""}`
                          : documentInfo.statement_bank ?? "Documento financeiro"}
                    </p>
                    <p className="text-muted-foreground">
                      {isCardDocument(documentInfo.document_kind)
                        ? "Compras de cartão não saem do saldo agora: entram na fatura."
                        : `${fragments.filter(f => f.status === "completed").length}/${fragments.length || 1} fragmento(s) concluído(s)`}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <button type="button" onClick={() => setSummaryOpen((value) => !value)} className="rounded-full border border-border bg-card px-2.5 py-1.5 text-[11px]">
                      {summaryOpen ? "Recolher" : "Ver resumo"}
                    </button>
                    <button type="button" onClick={copyDiagnostic} className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2.5 py-1.5 text-[11px]"><Copy size={11}/> Diagnóstico</button>
                  </div>
                </div>
                {fragments.length > 0 && (

                  <div className="flex gap-2 overflow-x-auto pb-1">
                    {fragments.map((fragment) => <span key={fragment.fragment_index} className={`whitespace-nowrap rounded-full border px-2 py-1 text-[10px] ${fragment.status === "completed" ? "border-success/40 bg-success/10" : fragment.status === "failed" ? "border-destructive/40 bg-destructive/10" : "border-border bg-card"}`}>p. {fragment.page_start}-{fragment.page_end}: {fragment.status}</span>)}
                  </div>
                )}
                {rejections.length > 0 && (
                  <div className="rounded-xl border border-warning/40 bg-warning/5 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="inline-flex items-center gap-1 font-semibold"><FileWarning size={12}/> {rejections.length} rejeitado(s)</p>
                      <button type="button" onClick={recoverRejected} disabled={recovering} className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2.5 py-1.5 disabled:opacity-50">{recovering ? <Loader2 className="h-3 w-3 animate-spin"/> : <RotateCcw size={11}/>} Recuperar</button>
                    </div>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <span>Período<br/><strong>{documentInfo.period_start ?? "—"} a {documentInfo.period_end ?? "—"}</strong></span>
                  <span>Duplicatas<br/><strong>{documentInfo.counters?.duplicate_strong ?? 0} fortes · {documentInfo.counters?.duplicate_ambiguous ?? 0} possíveis</strong></span>
                  <span>Categorizados<br/><strong>{documentInfo.counters?.categorized_auto ?? 0}</strong></span>
                  <span>Sem categoria<br/><strong>{documentInfo.counters?.uncategorized ?? items.filter(i => !i.category_id).length}</strong></span>
                </div>
                {isCardDocument(documentInfo.document_kind) && (
                  <div className={`rounded-xl border p-3 ${reconciliation.reconciled ? "border-success/40 bg-success/5" : "border-warning/50 bg-warning/5"}`}>
                    <div className="flex flex-wrap items-end gap-3">
                      <div className="grid min-w-[220px] flex-1 grid-cols-2 gap-2">
                        <div>
                        <label className="mb-1 block text-[10px] font-medium text-muted-foreground">Total oficial da fatura</label>
                        <input
                          inputMode="decimal"
                          value={invoiceTotalInput}
                          onChange={(event) => setInvoiceTotalInput(event.target.value)}
                          onBlur={saveInvoiceTotal}
                          className="input-base text-sm font-semibold"
                          placeholder="0,00"
                        />
                        </div>
                        <div>
                          <label className="mb-1 block text-[10px] font-medium text-muted-foreground">Saldo anterior</label>
                          <input
                            inputMode="decimal"
                            value={invoicePreviousBalanceInput}
                            onChange={(event) => setInvoicePreviousBalanceInput(event.target.value)}
                            onBlur={saveInvoicePreviousBalance}
                            className="input-base text-sm font-semibold"
                            placeholder="0,00"
                          />
                        </div>
                        <div className="col-span-2">
                          <label htmlFor="invoice-due-date" className="mb-1 block text-[10px] font-medium text-muted-foreground">Vencimento desta fatura</label>
                          <input
                            id="invoice-due-date"
                            type="date"
                            value={invoiceDueDateInput}
                            onChange={(event) => setInvoiceDueDateInput(event.target.value)}
                            onBlur={saveInvoiceDueDate}
                            className="input-base text-sm"
                          />
                          <p className="mt-1 text-[10px] text-muted-foreground">
                            Em branco, eu calculo pelo ciclo do cartão. Informe quando duas faturas caírem no mesmo mês.
                          </p>
                        </div>
                      </div>

                      <div className="grid flex-[2] grid-cols-2 gap-x-4 gap-y-1 text-[11px] sm:grid-cols-4">
                        <span>Compras/encargos<br/><strong>{formatBRL(invoiceSummary.charges)}</strong></span>
                        <span>Estornos/créditos<br/><strong>−{formatBRL(invoiceSummary.credits)}</strong></span>
                        <span>Pagamentos<br/><strong>−{formatBRL(invoiceSummary.payments)}</strong></span>
                        <span>Calculado<br/><strong>{formatBRL(reconciliation.calculatedTotal)}</strong></span>
                      </div>
                    </div>
                    <p className={`mt-2 text-[11px] ${reconciliation.reconciled ? "text-success" : "text-warning"}`}>
                      {documentInfo.invoice_total == null
                        ? "Confira na capa da fatura e informe o total a pagar."
                        : reconciliation.reconciled
                          ? "Fatura conciliada. O total calculado fecha com o total informado."
                          : documentInfo.invoice_previous_balance == null
                            ? `Diferença de ${formatBRL(Math.abs(reconciliation.difference ?? 0))}. Confira se esse é o saldo anterior exibido na fatura; ele não será lançado como nova despesa.`
                            : `Diferença de ${formatBRL(Math.abs(reconciliation.difference ?? 0))}. Nenhum lançamento será gravado até a conciliação.`}
                    </p>
                    {coverageRows.length > 0 && (
                      <div className="mt-2 space-y-1 border-t border-border/60 pt-2">
                        <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Conferência por bloco da fatura</p>
                        {coverageRows.map((row) => (
                          <div key={row.section} className="flex items-center justify-between gap-2 text-[11px]">
                            <span className="truncate">{SECTION_LABELS[row.section] ?? row.section}</span>
                            <span className={row.covered ? "text-success" : "text-warning"}>
                              {formatBRL(row.extracted_total)} de {formatBRL(row.official_total ?? 0)}
                              {row.covered ? " ✓" : ` · faltam ${formatBRL(Math.abs(row.difference ?? 0))}`}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                  </div>
                )}
                {documentInfo.user_instructions && <p className="text-muted-foreground">Orientação aplicada: {documentInfo.user_instructions}</p>}
                {documentInfo.statement_closing_balance != null && !isCardDocument(documentInfo.document_kind) && (
                  <div className="rounded-xl border border-border bg-card p-3">
                    <p className="font-semibold">Saldo informado pelo banco: {formatBRL(Number(documentInfo.statement_closing_balance))}</p>
                    <p className="text-muted-foreground">Data: {documentInfo.statement_balance_date ?? "—"}. Esse saldo vira um marco auditável; lançamentos posteriores continuam sendo somados normalmente.</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <select value={reconcileAccount} onChange={(e) => setReconcileAccount(e.target.value)} className="input-base max-w-[230px] text-xs">
                        <option value="">Escolha a conta…</option>
                        {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                      </select>
                      <button onClick={reconcileBalance} disabled={reconciling || !reconcileAccount} className="rounded-full bg-primary px-3 py-2 text-primary-foreground disabled:opacity-50">
                        {reconciling ? "Conciliando…" : "Usar saldo do extrato"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2 text-xs">
              <button onClick={toggleAll} className="text-primary hover:underline">
                {selected.size > 0 ? "Desmarcar todos" : "Selecionar todos"}
              </button>
              <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2">
                <label htmlFor="bulk-payment-target" className="sr-only">Origem para os selecionados</label>
                <select id="bulk-payment-target" value={bulkTarget} onChange={(e) => setBulkTarget(e.target.value)} className="min-w-0 max-w-[180px] rounded-full border border-border bg-card px-2.5 py-1 text-[11px]">
                  <option value="">{docKind === "invoice" ? "Escolher cartão…" : "Escolher origem…"}</option>
                  {docKind !== "invoice" && accounts.map((a) => <option key={a.id} value={`account:${a.id}`}>Conta · {a.name}</option>)}
                  {cards.map((c: { id: string; name: string }) => <option key={c.id} value={`credit_card:${c.id}`}>Cartão · {c.name}</option>)}
                </select>
                <button type="button" onClick={applyBulkTarget} disabled={!bulkTarget || selected.size === 0 || bulkSaving} className="rounded-full border border-border bg-secondary px-2.5 py-1 text-[11px] hover:bg-muted disabled:opacity-50">
                  {bulkSaving ? "Aplicando…" : "Aplicar aos selecionados"}
                </button>
                <span className="text-muted-foreground">
                  {selected.size} · <strong className="text-foreground">{formatBRL(total)}</strong>
                </span>
              </div>
            </div>
            <div className="flex-1 space-y-3 overflow-y-auto p-4">
              {items.map((it) => {
                const isConfirmed = it.status === "confirmed";
                const isIgnored = it.status === "ignored";
                const isDup = it.status === "duplicate_suspect";
                const disabled = isConfirmed || isIgnored;
                return (
                  <div
                    key={it.id}
                    className={`rounded-2xl border p-3 ${isConfirmed ? "border-success/40 bg-success/5 opacity-70" : isIgnored ? "border-border bg-secondary/30 opacity-60" : isDup ? "border-warning/40 bg-warning/5" : "border-border bg-card"}`}
                  >
                    <div className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        checked={selected.has(it.id)}
                        disabled={disabled}
                        onChange={() => toggle(it.id)}
                        className="mt-1 h-4 w-4 accent-primary"
                        aria-label={`Selecionar ${it.description ?? "item"}`}
                      />
                      <div className="min-w-0 flex-1 space-y-2">
                        {isDup && <p className="rounded-lg bg-warning/10 px-2 py-1 text-[11px] text-warning">Possível duplicata: {it.duplicate_reason ?? "há um lançamento semelhante"}. Vem desmarcada por segurança.</p>}
                        {it.movement_kind && it.movement_kind !== "transaction" && <p className="text-[11px] text-muted-foreground">Movimento interno: {it.movement_kind.replace(/_/g, " ")}. Afeta o saldo, mas não será tratado como renda ou consumo.</p>}
                        {(it.bank_description ?? it.raw_description) && (it.bank_description ?? it.raw_description) !== (it.friendly_description ?? it.description) && <p className="text-[10px] text-muted-foreground">No banco: {it.bank_description ?? it.raw_description}</p>}
                        <div className="flex items-center justify-between gap-2">
                          <input
                            value={it.description ?? ""}
                            onChange={(e) => setItems((xs) => xs.map((x) => x.id === it.id ? { ...x, description: e.target.value } : x))}
                            onBlur={(e) => patchItem(it.id, { description: e.target.value })}
                            disabled={disabled}
                            className="input-base text-sm font-medium"
                            placeholder="Descrição"
                          />
                          <span className={`whitespace-nowrap text-sm font-semibold tabular-nums ${it.type === "expense" ? "text-destructive" : "text-success"}`}>
                            {it.type === "expense" ? "−" : "+"}{formatBRL(Number(it.amount))}
                          </span>
                        </div>
                        {isDup && (
                          <div className="space-y-1">
                            <p className="text-[11px] text-warning">
                              ⚠ Possível duplicata de lançamento existente.
                            </p>
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={() => resolveDuplicate(it.id, "keep_as_legitimate")}
                                disabled={resolvingDup === it.id}
                                className="rounded-full border border-border bg-card px-2.5 py-1 text-[11px] hover:bg-muted disabled:opacity-50"
                              >
                                É cobrança real, manter
                              </button>
                              <button
                                type="button"
                                onClick={() => resolveDuplicate(it.id, it.duplicate_of ? "link_to_existing" : "supersede", it.duplicate_of ?? null)}
                                disabled={resolvingDup === it.id}
                                className="rounded-full border border-warning/40 bg-warning/10 px-2.5 py-1 text-[11px] text-warning hover:bg-warning/20 disabled:opacity-50"
                              >
                                É a mesma, não registrar
                              </button>
                            </div>
                          </div>
                        )}

                        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                          <div>
                            <label className="text-[10px] text-muted-foreground">Valor</label>
                            <input
                              inputMode={valuesHidden ? undefined : "decimal"}
                              type={valuesHidden ? "password" : "text"}
                              defaultValue={Number(it.amount).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              onBlur={(e) => {
                                const v = parseBRLInput(e.target.value);
                                if (v != null) patchItem(it.id, { amount: v });
                              }}
                              disabled={disabled}
                              className="input-base text-xs"
                            />
                          </div>
                          <div>
                            <label className="text-[10px] text-muted-foreground">Data</label>
                            <input
                              type="date"
                              defaultValue={it.occurred_at}
                              onBlur={(e) => patchItem(it.id, { occurred_at: e.target.value })}
                              disabled={disabled}
                              className="input-base text-xs"
                            />
                          </div>
                          <div>
                            <label className="text-[10px] text-muted-foreground">Método</label>
                            {docKind === "invoice" ? (
                              <div className="input-base flex items-center text-xs">Cartão de crédito</div>
                            ) : <select
                              value={it.payment_method ?? ""}
                              onChange={(e) => {
                                const pm = (e.target.value || null) as Item["payment_method"];
                                patchItem(it.id, {
                                  payment_method: pm,
                                  account_id: pm === "account" ? it.account_id : null,
                                  credit_card_id: pm === "credit_card" ? it.credit_card_id : null,
                                });
                              }}
                              disabled={disabled}
                              className="input-base text-xs"
                            >
                              <option value="">—</option>
                              <option value="account">Conta</option>
                              <option value="credit_card">Cartão</option>
                            </select>}
                          </div>
                          <div>
                            <label className="text-[10px] text-muted-foreground">Categoria</label>
                            <CategorySelect
                              value={it.category_id}
                              onChange={(id) => patchItem(it.id, { category_id: id })}
                              type={it.type}
                              disabled={disabled}
                              className="input-base text-xs"
                              showManageLink={false}
                            />
                            {it.category_id && it.category_source && it.category_source !== "user" ? (
                              <p className="mt-1 text-[10px] text-muted-foreground">
                                Identificado pelo Nino{it.category_confidence != null ? ` · ${Math.round(Number(it.category_confidence) * 100)}%` : ""}
                              </p>
                            ) : !it.category_id ? (
                              <p className="mt-1 text-[10px] text-warning">Precisa da sua validação</p>
                            ) : null}
                          </div>
                          {it.payment_method === "account" && (
                            <div className="col-span-2">
                              <label className="text-[10px] text-muted-foreground">Conta {it.account_hint ? `(sugerida: ${it.account_hint})` : ""}</label>
                              <select
                                value={it.account_id ?? ""}
                                onChange={(e) => patchItem(it.id, { account_id: e.target.value || null })}
                                disabled={disabled}
                                className="input-base text-xs"
                              >
                                <option value="">Selecione…</option>
                                {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                              </select>
                            </div>
                          )}
                          {it.payment_method === "credit_card" && (
                            <div className="col-span-2">
                              <label className="text-[10px] text-muted-foreground">Cartão {it.card_hint ? `(sugerido: ${it.card_hint})` : ""}</label>
                              <select
                                value={it.credit_card_id ?? ""}
                                onChange={(e) => patchItem(it.id, { credit_card_id: e.target.value || null })}
                                disabled={disabled}
                                className="input-base text-xs"
                              >
                                <option value="">Selecione…</option>
                                {cards.map((c: { id: string; name: string }) => <option key={c.id} value={c.id}>{c.name}</option>)}
                              </select>
                            </div>
                          )}
                          {docKind === "invoice" && (
                            <div className="col-span-2">
                              <label className="text-[10px] text-muted-foreground">Tipo na fatura</label>
                              <select
                                value={it.statement_item_kind ?? "purchase"}
                                onChange={(event) => patchItem(it.id, { statement_item_kind: event.target.value as StatementItemKind })}
                                disabled={disabled}
                                className="input-base text-xs"
                              >
                                <option value="purchase">Compra à vista</option>
                                <option value="installment">Compra parcelada</option>
                                <option value="refund">Estorno/crédito</option>
                                <option value="interest">Juros/encargos</option>
                                <option value="fee">Tarifa/anuidade</option>
                                <option value="payment">Pagamento da fatura</option>
                                <option value="adjustment">Ajuste</option>
                                <option value="informational">Linha informativa (não lançar)</option>
                              </select>
                            </div>
                          )}
                          {(docKind === "invoice" || (it.installments_total ?? 0) > 1) && (
                            <div className="col-span-2 space-y-2 text-[11px] text-muted-foreground">
                              <div className="grid grid-cols-2 gap-2">
                                <div>
                                  <label className="text-[10px]">Parcela nesta fatura</label>
                                  <input
                                    type="number" min={1} max={48}
                                    value={it.installment_number ?? 1}
                                    onChange={(event) => {
                                      const current = Number(event.target.value);
                                      patchItem(it.id, {
                                        installment_number: current,
                                        installments_total: Math.max(current, it.installments_total ?? 1),
                                        statement_item_kind: Math.max(current, it.installments_total ?? 1) > 1 ? "installment" : "purchase",
                                      });
                                    }}
                                    disabled={disabled}
                                    className="input-base text-xs"
                                  />
                                </div>
                                <div>
                                  <label className="text-[10px]">Total de parcelas</label>
                                  <input
                                    type="number" min={1} max={48}
                                    value={it.installments_total ?? 1}
                                    onChange={(event) => {
                                      const installmentsTotal = Number(event.target.value);
                                      patchItem(it.id, {
                                        installments_total: installmentsTotal,
                                        installment_number: Math.min(it.installment_number ?? 1, installmentsTotal),
                                        statement_item_kind: installmentsTotal > 1 ? "installment" : "purchase",
                                      });
                                    }}
                                    disabled={disabled}
                                    className="input-base text-xs"
                                  />
                                </div>
                              </div>
                              <p>
                                {Number(it.installments_total ?? 1) > 1
                                  ? `${Math.max(0, Number(it.installment_number ?? 1) - 1)} anterior(es) · esta é a ${it.installment_number ?? 1}ª · ${Math.max(0, Number(it.installments_total ?? 1) - Number(it.installment_number ?? 1))} restante(s)`
                                  : "Compra à vista"}
                                {it.installment_inferred ? " · inferido do texto" : ""}
                              </p>
                              {docKind === "invoice" && (it.installment_number ?? 1) > 1 && !disabled && (
                                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-900">
                                  <p className="font-medium">As {Number(it.installment_number) - 1} parcelas anteriores já foram pagas?</p>
                                  <p className="mt-1 text-[10px]">Não presumimos pagamento apenas porque esta fatura mostra uma parcela avançada.</p>
                                  <div className="mt-2 flex gap-2">
                                    <button type="button" onClick={() => patchItem(it.id, { historical_installments_paid_assumption: true })} className={`rounded-full border px-3 py-1 ${it.historical_installments_paid_assumption === true ? "border-success bg-success/10 text-success" : "border-border bg-card"}`}>Sim, foram pagas</button>
                                    <button type="button" onClick={() => patchItem(it.id, { historical_installments_paid_assumption: false })} className={`rounded-full border px-3 py-1 ${it.historical_installments_paid_assumption === false ? "border-warning bg-warning/10 text-warning" : "border-border bg-card"}`}>Não / quero revisar</button>
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                        {!disabled && (
                          <div className="flex justify-end pt-1">
                            <button
                              onClick={() => ignoreItem(it.id)}
                              className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-destructive"
                            >
                              <Trash2 size={11} /> Ignorar
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <footer className="sticky bottom-0 space-y-2 border-t border-border bg-card p-3">
              {blockers.length > 0 && (
                <ul className="space-y-1 rounded-xl border border-warning/40 bg-warning/5 p-2 text-[11px]">
                  {blockers.map((b) => <li key={b} className="flex items-start gap-1"><AlertTriangle size={11} className="mt-0.5 shrink-0" /> {b}</li>)}
                </ul>
              )}
              <div className="flex items-center gap-2">
                {pendingWrites > 0 && (
                  <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" /> Salvando {pendingWrites} edição(ões)…
                  </span>
                )}
                <button
                  onClick={cancelImport}
                  disabled={confirming}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-2 text-xs hover:bg-secondary"
                >
                  <Ban size={12} /> Cancelar
                </button>
                <button
                  onClick={confirmSelection}
                  disabled={confirming || pendingWrites > 0 || bulkSaving || selected.size === 0 || blockers.length > 0}
                  className="btn-brand ml-auto inline-flex items-center gap-1.5 disabled:opacity-50"
                >
                  {confirming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check size={14} />}
                  Confirmar {selected.size} lançamento(s)
                </button>
              </div>
            </footer>

          </>
        )}
      </div>
    </div>
  );

  return typeof document !== "undefined" ? createPortal(panel, document.body) : panel;
}
