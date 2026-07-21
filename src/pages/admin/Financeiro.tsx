import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileScan, Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/admin/PageHeader";
import { Section } from "@/components/admin/Section";
import { StatCard, StatGrid } from "@/components/admin/StatCard";
import { EmptyState } from "@/components/admin/EmptyState";
import { SkeletonStats, SkeletonTable } from "@/components/admin/AdminSkeleton";
import { DataTable, type Column } from "@/components/admin/DataTable";
import { adminToast } from "@/components/admin/adminToast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type CompanyTx = {
  id: string;
  type: "income" | "expense";
  amount: number;
  occurred_at: string;
  description: string | null;
};

type DocumentMetrics = {
  total: number; succeeded: number; failed: number; pending: number;
  success_rate: number; tokens_in: number; tokens_out: number; avg_latency_ms: number;
};

const brl = (n: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n);

export default function Financeiro() {
  const qc = useQueryClient();
  const [form, setForm] = useState({ type: "expense" as "income" | "expense", amount: "", description: "", occurred_at: new Date().toISOString().slice(0, 10) });
  const [saving, setSaving] = useState(false);

  const q = useQuery({
    queryKey: ["company_transactions"],
    queryFn: async () => {
      const { data, error } = await supabase.from("company_transactions" as never).select("*").order("occurred_at", { ascending: false }).limit(200);
      if (error) throw error;
      return (data as unknown as CompanyTx[]) ?? [];
    },
  });

  const documents = useQuery({
    queryKey: ["admin_document_metrics", 30],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_document_metrics" as never, { p_days: 30 } as never);
      if (error) throw error;
      return ((data as unknown as DocumentMetrics[] | null)?.[0] ?? null);
    },
  });

  const totals = (q.data ?? []).reduce(
    (acc, t) => {
      if (t.type === "income") acc.income += Number(t.amount);
      else acc.expense += Number(t.amount);
      return acc;
    },
    { income: 0, expense: 0 },
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const amount = Number(form.amount);
    if (!Number.isFinite(amount) || amount <= 0) { adminToast.warn("Valor inválido"); return; }
    setSaving(true);
    const { error } = await supabase.from("company_transactions" as never).insert({
      type: form.type,
      amount,
      occurred_at: form.occurred_at,
      description: form.description || null,
    } as never);
    setSaving(false);
    if (error) { adminToast.fromError(error, "Não foi possível salvar o lançamento"); return; }
    adminToast.success("Lançamento salvo");
    setForm({ ...form, amount: "", description: "" });
    qc.invalidateQueries({ queryKey: ["company_transactions"] });
  }

  const cols: Column<CompanyTx>[] = [
    { key: "date", header: "Data", cell: (t) => <span className="text-muted-foreground">{new Date(t.occurred_at).toLocaleDateString("pt-BR")}</span> },
    {
      key: "type",
      header: "Tipo",
      cell: (t) => t.type === "income"
        ? <Badge className="bg-success/15 text-success border-success/30">Receita</Badge>
        : <Badge className="bg-destructive/15 text-destructive border-destructive/30">Despesa</Badge>,
    },
    { key: "desc", header: "Descrição", cell: (t) => t.description ?? "—" },
    { key: "amount", header: "Valor", align: "right", cell: (t) => <span className="font-medium font-numeric tabular-nums">{brl(Number(t.amount))}</span> },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Finanças da NoControle.ia"
        description="Gestão financeira do negócio. Este módulo é totalmente separado das finanças pessoais dos usuários."
      />

      <StatGrid cols={3}>
        <StatCard label="Receitas" value={brl(totals.income)} tone="success" />
        <StatCard label="Despesas" value={brl(totals.expense)} tone="destructive" />
        <StatCard label="Saldo" value={brl(totals.income - totals.expense)} tone="primary" />
      </StatGrid>

      <Section title="Leitura de documentos por IA" icon={FileScan} description="Últimos 30 dias — sem expor dados financeiros dos usuários.">
        {documents.isLoading ? (
          <SkeletonStats count={4} />
        ) : documents.isError ? (
          <EmptyState title="Não foi possível carregar" />
        ) : (
          <div className="space-y-3">
            <StatGrid cols={4}>
              <StatCard label="Documentos" value={documents.data?.total ?? 0} />
              <StatCard label="Sucesso" value={`${documents.data?.success_rate ?? 0}%`} tone="success" />
              <StatCard label="Falhas" value={documents.data?.failed ?? 0} tone="destructive" />
              <StatCard label="Latência média" value={`${documents.data?.avg_latency_ms ?? 0} ms`} />
            </StatGrid>
            <div className="rounded-xl border border-border bg-secondary/30 p-3 text-xs text-muted-foreground">
              Tokens processados: {Number(documents.data?.tokens_in ?? 0).toLocaleString("pt-BR")} entrada · {Number(documents.data?.tokens_out ?? 0).toLocaleString("pt-BR")} saída · {documents.data?.pending ?? 0} pendente(s)
            </div>
          </div>
        )}
      </Section>

      <Section title="Novo lançamento" icon={Plus}>
        <form onSubmit={submit} className="surface-card p-5 grid gap-3 md:grid-cols-4">
          <div className="space-y-1.5">
            <Label htmlFor="fin-type">Tipo</Label>
            <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v as "income" | "expense" })}>
              <SelectTrigger id="fin-type"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="expense">Despesa</SelectItem>
                <SelectItem value="income">Receita</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="fin-date">Data</Label>
            <Input id="fin-date" type="date" value={form.occurred_at} onChange={(e) => setForm({ ...form, occurred_at: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="fin-amount">Valor</Label>
            <Input id="fin-amount" inputMode="decimal" placeholder="0,00" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value.replace(",", ".") })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="fin-desc">Descrição</Label>
            <Input id="fin-desc" placeholder="Opcional" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
          <Button type="submit" disabled={saving} className="md:col-span-4">
            {saving ? "Salvando…" : "Registrar"}
          </Button>
        </form>
      </Section>

      <Section title="Lançamentos recentes">
        {q.isLoading ? (
          <SkeletonTable />
        ) : !q.data || q.data.length === 0 ? (
          <EmptyState title="Nenhum lançamento empresarial ainda" />
        ) : (
          <DataTable rows={q.data} columns={cols} rowKey={(r) => r.id} ariaLabel="Lançamentos empresariais" />
        )}
      </Section>

      <Section title="MRR / ARR">
        <EmptyState title="Não configurado" description="Depende do módulo de assinaturas." compact />
      </Section>
    </div>
  );
}
