import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate, useSearchParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { useCategories, useAccounts } from "@/lib/db/finance";
import { useCreditCards } from "@/lib/db/creditCards";
import { toast } from "sonner";
import { Loader2, ArrowLeft, Trash2, Save } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

type Tx = {
  id: string;
  user_id: string;
  type: "income" | "expense" | "transfer";
  amount: number | string;
  occurred_at: string;
  description: string | null;
  category_id: string | null;
  account_id: string | null;
  credit_card_id: string | null;
  payment_method: "account" | "credit_card" | null;
  installment_number: number | null;
  installments_total: number | null;
  purchase_group_id: string | null;
  transfer_group_id: string | null;
  version: number;
  notes: string | null;
  purchase_date?: string | null;
  competence_date?: string | null;
};

export default function LancamentoDetalhe() {
  const { id } = useParams<{ id: string }>();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const { user } = useAuth();
  const qc = useQueryClient();
  const editing = params.get("edit") === "1";
  const focus = params.get("focus"); // "category", etc.

  const { data: cats = [] } = useCategories();
  const { data: accs = [] } = useAccounts();
  const { data: cards = [] } = useCreditCards();

  const [tx, setTx] = useState<Tx | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [scope, setScope] = useState<"one" | "future" | "all">("one");

  const [description, setDescription] = useState("");
  const [categoryId, setCategoryId] = useState<string | "">("");
  const [amount, setAmount] = useState("");
  const [occurredAt, setOccurredAt] = useState("");
  const [notes, setNotes] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"account" | "credit_card">("account");
  const [accountId, setAccountId] = useState<string | "">("");
  const [cardId, setCardId] = useState<string | "">("");

  useEffect(() => {
    if (!id || !user) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase.from("transactions").select("*").eq("id", id).eq("user_id", user.id).maybeSingle();
      if (cancelled) return;
      if (error || !data) { toast.error("Lançamento não encontrado"); nav("/app/lancamentos"); setLoading(false); return; }
      const t = data as unknown as Tx;
      setTx(t);
      setDescription(t.description ?? "");
      setCategoryId(t.category_id ?? "");
      setAmount(String(t.amount));
      setOccurredAt(t.occurred_at);
      setNotes(t.notes ?? "");
      setPaymentMethod((t.payment_method as "account" | "credit_card") ?? "account");
      setAccountId(t.account_id ?? "");
      setCardId(t.credit_card_id ?? "");
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [id, user, nav]);

  useEffect(() => {
    if (editing && focus === "category") {
      const el = document.getElementById("field-category");
      el?.focus?.();
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [editing, focus, tx]);

  const isTransfer = tx?.type === "transfer";
  const isCardTx = tx?.payment_method === "credit_card";
  const hasGroup = !!tx?.purchase_group_id;
  const cardName = useMemo(() => cards.find((c: any) => c.id === tx?.credit_card_id)?.name ?? "—", [cards, tx]);
  const accName = useMemo(() => accs.find((a) => a.id === tx?.account_id)?.name ?? "—", [accs, tx]);
  const catsForType = cats.filter((c: any) => tx ? (c.type === tx.type || c.type === "both") : true);

  async function save() {
    if (!tx) return;
    if (!isTransfer) {
      // Validate coherence before roundtrip
      if (paymentMethod === "account" && !accountId) {
        return toast.error("Escolha uma conta para este lançamento.");
      }
      if (paymentMethod === "credit_card" && !cardId) {
        return toast.error("Escolha um cartão para este lançamento.");
      }
      // Method-only descriptions are not allowed
      const norm = description.trim().toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
      const forbidden = new Set(["credito","debito","pix","dinheiro","cartao","boleto","transferencia","ted","doc","fatura"]);
      if (description.trim() && forbidden.has(norm)) {
        return toast.error("Descreva em quê foi o lançamento (ex.: mercado, gasolina, salário).");
      }
    }
    setSaving(true);
    const patch: Record<string, unknown> = {};
    if ((tx.description ?? "") !== description) patch.description = description || null;
    if ((tx.category_id ?? "") !== categoryId) patch.category_id = categoryId || null;
    const parsedAmount = Number(String(amount).replace(",", "."));
    if (Number.isFinite(parsedAmount) && parsedAmount > 0 && parsedAmount !== Number(tx.amount)) patch.amount = parsedAmount;
    if (occurredAt && occurredAt !== tx.occurred_at) patch.occurred_at = occurredAt;
    if ((tx.notes ?? "") !== notes) patch.notes = notes || null;

    if (!isTransfer) {
      const originalMethod = (tx.payment_method as "account" | "credit_card") ?? "account";
      if (paymentMethod !== originalMethod) {
        patch.payment_method = paymentMethod;
        if (paymentMethod === "account") {
          patch.account_id = accountId;
          patch.credit_card_id = null;
        } else {
          patch.credit_card_id = cardId;
          patch.account_id = null;
        }
      } else if (paymentMethod === "account" && accountId !== (tx.account_id ?? "")) {
        patch.account_id = accountId;
      } else if (paymentMethod === "credit_card" && cardId !== (tx.credit_card_id ?? "")) {
        patch.credit_card_id = cardId;
      }
    }

    if (Object.keys(patch).length === 0) { setSaving(false); toast.message("Nada mudou."); return; }

    const { data, error } = await supabase.rpc("transaction_update_direct" as any, {
      p_id: tx.id, p_expected_version: tx.version, p_patch: patch as any, p_scope: hasGroup ? scope : "one",
    });
    setSaving(false);
    if (error) {
      console.error("[LancamentoDetalhe] rpc error", error);
      return toast.error("Não consegui salvar agora. Tente novamente em instantes.");
    }
    const r = data as any;
    if (!r?.ok) {
      console.warn("[LancamentoDetalhe] rpc not ok", r);
      if (r?.error === "conflict") return toast.error("Este lançamento foi alterado em outro lugar. Recarregue e tente de novo.");
      if (r?.error === "not_owned") return toast.error("Lançamento não encontrado.");
      if (r?.error === "credit_card_required") return toast.error("Escolha um cartão para este lançamento.");
      if (r?.error === "account_required") return toast.error("Escolha uma conta para este lançamento.");
      if (r?.error === "invalid_payment_method") return toast.error("Método de pagamento inválido.");
      return toast.error("Não consegui salvar agora. Tente novamente em instantes.");
    }
    toast.success("Lançamento atualizado ✅");
    qc.invalidateQueries({ queryKey: ["transactions"] });
    qc.invalidateQueries({ queryKey: ["assistant-tip"] });
    nav("/app/lancamentos");
  }

  async function del() {
    if (!tx) return;
    if (!confirm(isTransfer ? "Excluir esta transferência (par completo)?" : `Excluir (${scope === "one" ? "esta parcela" : scope === "future" ? "esta e futuras" : "todas as parcelas"})?`)) return;
    setSaving(true);
    const { data, error } = await supabase.rpc("transaction_delete_direct" as any, {
      p_id: tx.id, p_expected_version: tx.version, p_scope: hasGroup ? scope : "one",
    });
    setSaving(false);
    if (error) return toast.error("Falha ao excluir", { description: error.message });
    const r = data as any;
    if (!r?.ok) {
      if (r?.error === "conflict") return toast.error("Este lançamento foi alterado em outro lugar. Recarregue.");
      return toast.error("Falha ao excluir", { description: r?.error ?? "erro" });
    }
    toast.success("Lançamento excluído");
    qc.invalidateQueries({ queryKey: ["transactions"] });
    qc.invalidateQueries({ queryKey: ["assistant-tip"] });
    nav("/app/lancamentos");
  }

  if (loading) return <div className="grid place-items-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  if (!tx) return null;

  return (
    <div className="max-w-2xl mx-auto">
      <header className="mb-4 flex items-center gap-2">
        <Link to="/app/lancamentos" className="grid h-9 w-9 place-items-center rounded-full hover:bg-secondary" aria-label="Voltar"><ArrowLeft size={18} /></Link>
        <div>
          <h1 className="font-display text-xl font-bold">Detalhes do lançamento</h1>
          <p className="text-xs text-muted-foreground">
            {isCardTx ? `Cartão: ${cardName}` : isTransfer ? "Transferência" : `Conta: ${accName}`}
            {tx.installments_total && tx.installments_total > 1 ? ` · Parcela ${tx.installment_number}/${tx.installments_total}` : ""}
          </p>
        </div>
      </header>

      <section className="rounded-2xl border border-border bg-card p-4 space-y-3">
        {isTransfer && (
          <p className="rounded-lg bg-secondary p-2 text-xs text-muted-foreground">
            Transferências não podem ser editadas parcialmente. Você pode apenas excluir o par completo.
          </p>
        )}

        <div>
          <label className="text-xs font-medium text-muted-foreground">Descrição</label>
          <input className="input-base w-full" value={description} onChange={e => setDescription(e.target.value)} disabled={isTransfer} />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="min-w-0">
            <label className="text-xs font-medium text-muted-foreground">Valor (R$)</label>
            <input className="input-base w-full min-w-0" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} disabled={isTransfer} />
          </div>
          <div className="min-w-0">
            <label className="text-xs font-medium text-muted-foreground">Data</label>
            <input type="date" className="input-base w-full min-w-0" value={occurredAt} onChange={e => setOccurredAt(e.target.value)} disabled={isTransfer} />
          </div>
        </div>

        {!isTransfer && (
          <div>
            <label className="text-xs font-medium text-muted-foreground">Categoria</label>
            <select id="field-category" className="input-base w-full" value={categoryId} onChange={e => setCategoryId(e.target.value)}>
              <option value="">Sem categoria</option>
              {catsForType.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        )}

        {!isTransfer && (
          <div className="rounded-lg border border-border p-3 space-y-3">
            <div>
              <p className="text-xs font-semibold mb-2">Forma de pagamento</p>
              <div className="flex flex-wrap gap-2 text-xs">
                {(["account","credit_card"] as const).map(m => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setPaymentMethod(m)}
                    className={`rounded-full px-3 py-1.5 border ${paymentMethod === m ? "bg-primary text-primary-foreground border-primary" : "border-border bg-secondary"}`}
                    aria-pressed={paymentMethod === m}
                  >
                    {m === "account" ? "Conta" : "Cartão de crédito"}
                  </button>
                ))}
              </div>
            </div>

            {paymentMethod === "account" ? (
              <div>
                <label className="text-xs font-medium text-muted-foreground">Conta</label>
                <select
                  className="input-base w-full"
                  value={accountId}
                  onChange={e => { setAccountId(e.target.value); if (e.target.value) setCardId(""); }}
                >
                  <option value="">Selecione uma conta</option>
                  {accs.map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
            ) : (
              <div>
                <label className="text-xs font-medium text-muted-foreground">Cartão</label>
                <select
                  className="input-base w-full"
                  value={cardId}
                  onChange={e => { setCardId(e.target.value); if (e.target.value) setAccountId(""); }}
                >
                  <option value="">Selecione um cartão</option>
                  {cards.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                {hasGroup && (
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Alterar cartão em compras parceladas afeta apenas os lançamentos no escopo escolhido abaixo.
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        <div>
          <label className="text-xs font-medium text-muted-foreground">Notas</label>
          <textarea className="input-base w-full min-h-[70px]" value={notes} onChange={e => setNotes(e.target.value)} disabled={isTransfer} />
        </div>

        {hasGroup && !isTransfer && (
          <div className="rounded-lg border border-border p-3">
            <p className="text-xs font-semibold mb-2">Aplicar a</p>
            <div className="flex flex-wrap gap-2 text-xs">
              {(["one", "future", "all"] as const).map(s => (
                <button key={s} onClick={() => setScope(s)}
                  className={`rounded-full px-3 py-1.5 border ${scope === s ? "bg-primary text-primary-foreground border-primary" : "border-border bg-secondary"}`}>
                  {s === "one" ? "Só esta parcela" : s === "future" ? "Esta e futuras" : "Todas as parcelas"}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="flex gap-2 pt-2">
          {!isTransfer && (
            <button onClick={save} disabled={saving} className="btn-brand inline-flex items-center gap-1.5 disabled:opacity-50">
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save size={14} />} Salvar
            </button>
          )}
          <button onClick={del} disabled={saving} className="inline-flex items-center gap-1.5 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive hover:bg-destructive/20 disabled:opacity-50">
            <Trash2 size={14} /> Excluir
          </button>
        </div>
      </section>
    </div>
  );
}
