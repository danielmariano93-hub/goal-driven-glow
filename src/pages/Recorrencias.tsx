import { useEffect, useState } from "react";
import { Plus, Play, Pause, Trash2, Loader2, RotateCw } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { formatBRL } from "@/lib/split/math";
import { nextOccurrences } from "@/lib/recurring/schedule";

export default function Recorrencias() {
  const [rules, setRules] = useState<any[] | null>(null);
  const [occs, setOccs] = useState<any[]>([]);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [cats, setCats] = useState<any[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    name: "", amount: "", kind: "expense" as "expense" | "income",
    account_id: "", category_id: "", frequency: "monthly" as any,
    day_of_month: 1, weekday: 1, start_date: new Date().toISOString().slice(0, 10),
    end_date: "",
  });

  const load = async () => {
    const [{ data: r }, { data: o }, { data: a }, { data: c }] = await Promise.all([
      supabase.from("recurring_rules" as any).select("*").order("created_at", { ascending: false }),
      supabase.from("recurring_occurrences" as any).select("*,recurring_rules(name,kind,amount)").eq("status", "planned").order("due_date").limit(30),
      supabase.from("accounts").select("id,name"),
      supabase.from("categories").select("id,name"),
    ]);
    setRules((r as any) ?? []); setOccs((o as any) ?? []); setAccounts(a ?? []); setCats(c ?? []);
  };
  useEffect(() => { load(); }, []);

  const create = async () => {
    if (!form.name || !form.amount || !form.account_id) return toast.error("Preencha nome, valor e conta");
    setBusy(true);
    try {
      const { error } = await supabase.from("recurring_rules" as any).insert({
        name: form.name, amount: Number(form.amount.replace(",", ".")),
        kind: form.kind, account_id: form.account_id, category_id: form.category_id || null,
        frequency: form.frequency,
        day_of_month: form.frequency === "monthly" ? form.day_of_month : null,
        weekday: form.frequency === "weekly" ? form.weekday : null,
        start_date: form.start_date, end_date: form.end_date || null,
        user_id: (await supabase.auth.getUser()).data.user!.id,
      });
      if (error) throw error;
      toast.success("Recorrência criada");
      setShowForm(false);
      await generate();
      await load();
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };

  const generate = async () => {
    const { error } = await supabase.rpc("recurring_generate_due" as any, { p_horizon_days: 60 });
    if (error) toast.error(error.message);
  };

  const confirm = async (oid: string) => {
    setBusy(true);
    try {
      const { error } = await supabase.rpc("recurring_confirm" as any, { p_occurrence_id: oid });
      if (error) throw error;
      toast.success("Lançamento confirmado");
      await load();
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };

  const skip = async (oid: string) => {
    setBusy(true);
    try {
      const { error } = await supabase.rpc("recurring_skip" as any, { p_occurrence_id: oid });
      if (error) throw error;
      await load();
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };

  const toggle = async (rid: string, current: string) => {
    const next = current === "active" ? "paused" : "active";
    const { error } = await supabase.from("recurring_rules" as any).update({ status: next }).eq("id", rid);
    if (error) return toast.error(error.message);
    await load();
  };

  const remove = async (rid: string) => {
    if (!confirm("Excluir a regra? Ocorrências planejadas serão removidas; confirmadas permanecem.")) return;
    const { error } = await supabase.from("recurring_rules" as any).delete().eq("id", rid);
    if (error) return toast.error(error.message);
    await load();
  };

  return (
    <div className="space-y-5 pt-2">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">Contas que se repetem</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Fixos que entram e saem todo mês, no automático</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => { generate().then(load); toast.success("Gerando ocorrências…"); }} className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1.5 text-xs">
            <RotateCw size={12} /> Processar
          </button>
          <button onClick={() => setShowForm(true)} className="inline-flex items-center gap-1 rounded-full bg-primary text-primary-foreground px-3 py-1.5 text-xs">
            <Plus size={12} /> Nova regra
          </button>
        </div>
      </div>

      {showForm && (
        <div className="surface-card p-4 space-y-3">
          <div className="flex gap-2">
            <button onClick={() => setForm({...form, kind: "expense"})} className={`text-xs px-3 py-1 rounded-full border ${form.kind==="expense"?"bg-destructive/15 text-destructive border-destructive/30":"bg-card border-border"}`}>Despesa</button>
            <button onClick={() => setForm({...form, kind: "income"})} className={`text-xs px-3 py-1 rounded-full border ${form.kind==="income"?"bg-success/15 text-success border-success/30":"bg-card border-border"}`}>Receita</button>
          </div>
          <input placeholder="Nome (ex: Aluguel)" value={form.name} onChange={e => setForm({...form, name: e.target.value})} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" />
          <input placeholder="Valor" inputMode="decimal" value={form.amount} onChange={e => setForm({...form, amount: e.target.value})} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" />
          <select value={form.account_id} onChange={e => setForm({...form, account_id: e.target.value})} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm">
            <option value="">Selecione a conta</option>
            {accounts.map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <select value={form.category_id} onChange={e => setForm({...form, category_id: e.target.value})} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm">
            <option value="">Sem categoria</option>
            {cats.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <div className="flex gap-2">
            {(["daily","weekly","monthly","yearly"] as const).map(f => (
              <button key={f} onClick={() => setForm({...form, frequency: f})} className={`text-xs px-3 py-1 rounded-full border ${form.frequency===f?"bg-primary text-primary-foreground border-primary":"bg-card border-border"}`}>
                {f==="daily"?"Diária":f==="weekly"?"Semanal":f==="monthly"?"Mensal":"Anual"}
              </button>
            ))}
          </div>
          {form.frequency === "monthly" && (
            <input type="number" min={1} max={31} value={form.day_of_month} onChange={e => setForm({...form, day_of_month: Number(e.target.value)})} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" placeholder="Dia do mês (1–31)" />
          )}
          {form.frequency === "weekly" && (
            <select value={form.weekday} onChange={e => setForm({...form, weekday: Number(e.target.value)})} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm">
              {["Domingo","Segunda","Terça","Quarta","Quinta","Sexta","Sábado"].map((d, i) => <option key={i} value={i}>{d}</option>)}
            </select>
          )}
          <input type="date" value={form.start_date} onChange={e => setForm({...form, start_date: e.target.value})} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" />
          <input type="date" value={form.end_date} onChange={e => setForm({...form, end_date: e.target.value})} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" placeholder="Fim (opcional)" />
          <p className="text-[11px] text-muted-foreground">Próximas ocorrências: {nextOccurrences(
            { frequency: form.frequency, start_date: form.start_date, end_date: form.end_date || null, day_of_month: form.day_of_month, weekday: form.weekday },
            form.start_date, 3
          ).map(d => new Date(d).toLocaleDateString("pt-BR")).join(", ") || "—"}</p>
          <div className="flex gap-2">
            <button disabled={busy} onClick={create} className="rounded-full bg-primary text-primary-foreground px-4 py-2 text-sm disabled:opacity-50">Criar</button>
            <button onClick={() => setShowForm(false)} className="rounded-full border border-border px-4 py-2 text-sm">Cancelar</button>
          </div>
        </div>
      )}

      <div>
        <h2 className="text-sm font-semibold mb-2">Próximas planejadas</h2>
        {occs.length === 0 ? (
          <p className="text-xs text-muted-foreground surface-card p-4">Nenhuma ocorrência planejada.</p>
        ) : (
          <div className="surface-card divide-y divide-border overflow-hidden">
            {occs.map((o: any) => (
              <div key={o.id} className="px-4 py-3 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">{o.recurring_rules?.name}</p>
                  <p className="text-[11px] text-muted-foreground">{new Date(o.due_date).toLocaleDateString("pt-BR")} · {formatBRL(Number(o.recurring_rules?.amount || 0))}</p>
                </div>
                <div className="flex gap-1">
                  <button disabled={busy} onClick={() => confirm(o.id)} className="text-[11px] rounded-full bg-success/15 text-success px-2 py-1">Confirmar</button>
                  <button disabled={busy} onClick={() => skip(o.id)} className="text-[11px] rounded-full border border-border px-2 py-1">Pular</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <h2 className="text-sm font-semibold mb-2">Regras</h2>
        {rules === null ? <Loader2 className="animate-spin" /> :
         rules.length === 0 ? <p className="text-xs text-muted-foreground surface-card p-4">Nenhuma regra ainda.</p> :
        (
          <div className="surface-card divide-y divide-border overflow-hidden">
            {rules.map((r: any) => (
              <div key={r.id} className="px-4 py-3 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">{r.name}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {r.kind === "income" ? "Receita" : "Despesa"} · {formatBRL(Number(r.amount))} · {r.frequency} · {r.status}
                  </p>
                </div>
                <div className="flex gap-1">
                  <button onClick={() => toggle(r.id, r.status)} className="p-2 text-muted-foreground">
                    {r.status === "active" ? <Pause size={14} /> : <Play size={14} />}
                  </button>
                  <button onClick={() => remove(r.id)} className="p-2 text-destructive"><Trash2 size={14} /></button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
