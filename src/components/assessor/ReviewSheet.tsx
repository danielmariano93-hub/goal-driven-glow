import { useEffect, useMemo, useState } from "react";
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
      setDocKind(d.document?.document_kind ?? null);
      const initial = new Set<string>(d.items.filter((i) => i.status === "needs_review").map((i) => i.id));
      setSelected(initial);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [documentId]);

  const total = useMemo(() =>
    items.filter((i) => selected.has(i.id)).reduce((s, i) => s + Number(i.amount), 0)
  , [items, selected]);

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
    setItems((xs) => xs.map((x) => (x.id === id ? { ...x, ...patch } : x)));
    const { error } = await supabase.functions.invoke("assistant-review-actions", {
      body: { action: "update", item_id: id, patch },
    });
    if (error) {
      console.error("[ReviewSheet] update", error);
      toast.error("Não consegui salvar essa alteração. Tente novamente.");
    }
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
    if (uncategorized > 0 && !confirm(`${uncategorized} lançamento(s) continuam sem categoria. Deseja confirmar mesmo assim?`)) return;
    setConfirming(true);
    try {
      const { data, error } = await supabase.functions.invoke("assistant-review-actions", {
        body: { action: "confirm", document_id: documentId, item_ids: ids },
      });
      if (error) throw error;
      const r = (data as { result: { created_count: number; errors: unknown[]; total_selected: number } }).result;
      if (r.created_count === r.total_selected) {
        toast.success(`${r.created_count} lançamento(s) registrado(s)`);
      } else {
        toast.warning(`${r.created_count} de ${r.total_selected} lançamento(s) registrado(s)`, {
          description: r.errors.length > 0 ? "Alguns itens não puderam ser gravados." : undefined,
        });
      }
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["home"] });
      qc.invalidateQueries({ queryKey: ["accounts"] });
      qc.invalidateQueries({ queryKey: ["credit_cards"] });
      onClose();
      if (r.created_count > 0) nav("/app/lancamentos");
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
    qc.invalidateQueries({ queryKey: ["account_balance_snapshots"] });
    qc.invalidateQueries({ queryKey: ["home"] });
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
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["document_imports"] }),
      qc.invalidateQueries({ queryKey: ["assessor_documents"] }),
      qc.invalidateQueries({ queryKey: ["transactions"] }),
      qc.invalidateQueries({ queryKey: ["home"] }),
    ]);
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
              <div className="space-y-2 border-b border-border bg-secondary/30 px-4 py-3 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="font-semibold">{documentInfo.statement_bank ?? "Instituição não identificada"}</p>
                    <p className="text-muted-foreground">{fragments.filter(f => f.status === "completed").length}/{fragments.length || 1} fragmento(s) concluído(s)</p>
                  </div>
                  <button type="button" onClick={copyDiagnostic} className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2.5 py-1.5 text-[11px]"><Copy size={11}/> Diagnóstico</button>
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
                {documentInfo.user_instructions && <p className="text-muted-foreground">Orientação aplicada: {documentInfo.user_instructions}</p>}
                {documentInfo.statement_closing_balance != null && (
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
                  <option value="">Escolher origem…</option>
                  {accounts.map((a) => <option key={a.id} value={`account:${a.id}`}>Conta · {a.name}</option>)}
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
                          <p className="text-[11px] text-warning">
                            ⚠ Possível duplicata de lançamento existente.
                          </p>
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
                            <select
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
                            </select>
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
                          {(it.installments_total ?? 0) > 1 && (
                            <div className="col-span-2 text-[11px] text-muted-foreground">
                              Parcela {it.installment_number}/{it.installments_total}
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
            <footer className="sticky bottom-0 flex items-center gap-2 border-t border-border bg-card p-3">
              <button
                onClick={cancelImport}
                disabled={confirming}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-2 text-xs hover:bg-secondary"
              >
                <Ban size={12} /> Cancelar
              </button>
              <button
                onClick={confirmSelection}
                disabled={confirming || selected.size === 0}
                className="btn-brand ml-auto inline-flex items-center gap-1.5 disabled:opacity-50"
              >
                {confirming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check size={14} />}
                Confirmar {selected.size} lançamento(s)
              </button>
            </footer>
          </>
        )}
      </div>
    </div>
  );

  return typeof document !== "undefined" ? createPortal(panel, document.body) : panel;
}
