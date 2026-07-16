import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

type CompanyTx = {
  id: string;
  type: "income" | "expense";
  amount: number;
  occurred_at: string;
  description: string | null;
};

const brl = (n: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n);

export default function Financeiro() {
  const qc = useQueryClient();
  const [form, setForm] = useState({ type: "expense" as "income" | "expense", amount: "", description: "", occurred_at: new Date().toISOString().slice(0, 10) });
  const [saving, setSaving] = useState(false);

  const q = useQuery({
    queryKey: ["company_transactions"],
    queryFn: async () => {
      const { data, error } = await supabase.from("company_transactions" as any).select("*").order("occurred_at", { ascending: false }).limit(200);
      if (error) throw error;
      return (data as unknown as CompanyTx[]) ?? [];
    },
  });

  const totals = (q.data ?? []).reduce(
    (acc, t) => {
      if (t.type === "income") acc.income += Number(t.amount);
      else acc.expense += Number(t.amount);
      return acc;
    },
    { income: 0, expense: 0 }
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const amount = Number(form.amount);
    if (!Number.isFinite(amount) || amount <= 0) { toast.error("Valor inválido"); return; }
    setSaving(true);
    const { error } = await supabase.from("company_transactions" as any).insert({
      type: form.type,
      amount,
      occurred_at: form.occurred_at,
      description: form.description || null,
    });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Lançamento salvo");
    setForm({ ...form, amount: "", description: "" });
    qc.invalidateQueries({ queryKey: ["company_transactions"] });
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-2xl md:text-3xl font-bold tracking-tight">Finanças da NoControle.ia</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Gestão financeira do negócio. Este módulo é totalmente separado das finanças pessoais dos usuários.
        </p>
      </header>

      <div className="grid grid-cols-3 gap-3">
        <Kpi label="Receitas" value={brl(totals.income)} tone="success" />
        <Kpi label="Despesas" value={brl(totals.expense)} tone="destructive" />
        <Kpi label="Saldo" value={brl(totals.income - totals.expense)} tone="primary" />
      </div>

      <div className="surface-card p-5 space-y-4">
        <h2 className="text-sm font-semibold flex items-center gap-2"><Plus size={14} /> Novo lançamento</h2>
        <form onSubmit={submit} className="grid gap-3 md:grid-cols-4">
          <select className="rounded-xl border border-border bg-background px-3 py-2 text-sm" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as any })}>
            <option value="expense">Despesa</option>
            <option value="income">Receita</option>
          </select>
          <input type="date" className="rounded-xl border border-border bg-background px-3 py-2 text-sm" value={form.occurred_at} onChange={(e) => setForm({ ...form, occurred_at: e.target.value })} />
          <input inputMode="decimal" placeholder="Valor" className="rounded-xl border border-border bg-background px-3 py-2 text-sm" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value.replace(",", ".") })} />
          <input placeholder="Descrição" className="rounded-xl border border-border bg-background px-3 py-2 text-sm md:col-span-1" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          <button disabled={saving} className="md:col-span-4 rounded-xl bg-primary text-primary-foreground text-sm font-medium py-2.5 disabled:opacity-60">
            {saving ? "Salvando…" : "Registrar"}
          </button>
        </form>
      </div>

      <section>
        <h2 className="mb-3 text-sm font-semibold">Lançamentos recentes</h2>
        {q.isLoading ? (
          <div className="grid place-items-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : !q.data || q.data.length === 0 ? (
          <div className="surface-card p-8 text-center">
            <p className="text-sm text-muted-foreground">Nenhum lançamento empresarial ainda.</p>
          </div>
        ) : (
          <div className="surface-card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-secondary/50 text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 text-left">Data</th>
                  <th className="px-4 py-3 text-left">Tipo</th>
                  <th className="px-4 py-3 text-left">Descrição</th>
                  <th className="px-4 py-3 text-right">Valor</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {q.data.map((t) => (
                  <tr key={t.id}>
                    <td className="px-4 py-3 text-muted-foreground">{new Date(t.occurred_at).toLocaleDateString("pt-BR")}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full text-[10px] px-2 py-0.5 ${t.type === "income" ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"}`}>
                        {t.type === "income" ? "Receita" : "Despesa"}
                      </span>
                    </td>
                    <td className="px-4 py-3">{t.description ?? "—"}</td>
                    <td className="px-4 py-3 text-right font-medium">{brl(Number(t.amount))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="surface-card p-4">
        <h3 className="text-sm font-semibold">MRR / ARR</h3>
        <p className="text-xs text-muted-foreground mt-1">Não configurado — depende de módulo de assinaturas.</p>
      </div>
    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string; tone: "success" | "destructive" | "primary" }) {
  const t = tone === "success" ? "text-success" : tone === "destructive" ? "text-destructive" : "text-primary";
  return (
    <div className="surface-card p-4">
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={`mt-1 font-display text-xl font-bold ${t}`}>{value}</p>
    </div>
  );
}
