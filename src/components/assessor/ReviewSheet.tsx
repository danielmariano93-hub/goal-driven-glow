import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { X, Check, Loader2, AlertTriangle, Ban, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAccounts, useCategories } from "@/lib/db/finance";
import { useCreditCards } from "@/lib/db/creditCards";
import { formatBRL } from "@/lib/engine/facts";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";

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
};

export function ReviewSheet({
  documentId,
  onClose,
}: {
  documentId: string;
  onClose: () => void;
}) {
  const nav = useNavigate();
  const qc = useQueryClient();
  const { data: accounts = [] } = useAccounts();
  const { data: categories = [] } = useCategories();
  const { data: cards = [] } = useCreditCards();
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [docKind, setDocKind] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase.functions.invoke("assistant-review-actions", {
        body: { action: "list", document_id: documentId },
      });
      if (cancelled) return;
      if (error) {
        toast.error("Falha ao carregar itens", { description: error.message });
        setLoading(false);
        return;
      }
      const d = data as { document: { document_kind: string | null }; items: Item[] };
      setItems(d.items);
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
    if (error) toast.error("Falha ao atualizar", { description: error.message });
  }

  async function ignoreItem(id: string) {
    setItems((xs) => xs.map((x) => (x.id === id ? { ...x, status: "ignored" } : x)));
    setSelected((s) => { const n = new Set(s); n.delete(id); return n; });
    const { error } = await supabase.functions.invoke("assistant-review-actions", {
      body: { action: "ignore", item_id: id },
    });
    if (error) toast.error("Falha", { description: error.message });
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
      toast.error("Falha ao confirmar", { description: (e as Error).message });
    } finally {
      setConfirming(false);
    }
  }

  async function cancelImport() {
    if (!confirm("Cancelar essa importação? Nada será registrado.")) return;
    const { error } = await supabase.functions.invoke("assistant-review-actions", {
      body: { action: "cancel", document_id: documentId },
    });
    if (error) return toast.error("Falha ao cancelar", { description: error.message });
    toast.message("Importação cancelada.");
    onClose();
  }

  const catForType = (t: "income" | "expense") =>
    (categories as { id: string; name: string; type: string }[])
      .filter((c) => c.type === t || c.type === "both");

  const panel = (
    <div className="fixed inset-0 z-[60] flex flex-col bg-background md:items-center md:justify-center md:bg-black/50" onClick={onClose}>
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
            <div className="flex items-center justify-between border-b border-border px-4 py-2 text-xs">
              <button onClick={toggleAll} className="text-primary hover:underline">
                {selected.size > 0 ? "Desmarcar todos" : "Selecionar todos"}
              </button>
              <span className="text-muted-foreground">
                {selected.size} selecionado(s) · <strong className="text-foreground">{formatBRL(total)}</strong>
              </span>
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
                              inputMode="decimal"
                              defaultValue={String(it.amount)}
                              onBlur={(e) => {
                                const v = Number(String(e.target.value).replace(",", "."));
                                if (Number.isFinite(v) && v > 0) patchItem(it.id, { amount: v });
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
                            <select
                              value={it.category_id ?? ""}
                              onChange={(e) => patchItem(it.id, { category_id: e.target.value || null })}
                              disabled={disabled}
                              className="input-base text-xs"
                            >
                              <option value="">Sem categoria</option>
                              {catForType(it.type).map((c) => (
                                <option key={c.id} value={c.id}>{c.name}</option>
                              ))}
                            </select>
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
            <footer className="flex items-center gap-2 border-t border-border p-3">
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
