import { useEffect, useState } from "react";
import { Plus, Play, Pause, Trash2, Loader2, RotateCw, CreditCard, Sparkles, Landmark } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { formatBRL } from "@/lib/split/math";
import { nextOccurrences } from "@/lib/recurring/schedule";
import { CategorySelect } from "@/components/CategorySelect";
import { todayISO } from "@/lib/engine/facts";
import { fetchAllPages } from "@/lib/db/pagedSelect";
import { detectRecurringSuggestions, type DetectionTx, type RecurringSuggestion } from "@/lib/engine/recurringDetection";
import { detectSubscriptions } from "@/lib/engine/subscriptions";
import { SubscriptionsSummary } from "@/components/recurring/SubscriptionsSummary";
import { buildDebtSchedule, type DebtScheduleRow } from "@/lib/engine/debtStatus";

export default function Recorrencias() {
  const [rules, setRules] = useState<any[] | null>(null);
  const [occs, setOccs] = useState<any[]>([]);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [cats, setCats] = useState<any[]>([]);
  const [cardInstallments, setCardInstallments] = useState<any[]>([]);
  const [txs, setTxs] = useState<DetectionTx[]>([]);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [income, setIncome] = useState<number | null>(null);
  const [debts, setDebts] = useState<any[]>([]);
  const [debtPayments, setDebtPayments] = useState<any[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    name: "", amount: "", kind: "expense" as "expense" | "income",
    account_id: "", category_id: "", frequency: "monthly" as any,
    day_of_month: 1, weekday: 1, start_date: todayISO(),
    end_date: "",
  });

  const load = async () => {
    const since = new Date(Date.now() - 270 * 86_400_000).toISOString().slice(0, 10);
    const [{ data: r }, { data: o }, { data: a }, { data: c }, { data: installments }, { data: txRows }, { data: dis }, { data: settings }, { data: debtRows }, { data: payRows }] = await Promise.all([
      supabase.from("recurring_rules" as any).select("*").order("created_at", { ascending: false }),
      supabase.from("recurring_occurrences" as any).select("*,recurring_rules(name,kind,amount)").eq("status", "planned").order("due_date").limit(30),
      supabase.from("accounts").select("id,name"),
      supabase.from("categories").select("id,name"),
      supabase.from("credit_card_installments" as any)
        .select("id,amount,due_date,competence_month,installment_number,status,credit_cards(name)")
        .gte("due_date", todayISO()).in("status", ["scheduled", "billed", "historical_unconfirmed"])
        .order("due_date").limit(60),
      fetchAllPages<DetectionTx>((from, to) =>
        supabase.from("transactions")
          .select("id,description,merchant_name,normalized_description,amount,occurred_at,type,account_id,category_id,status,movement_kind,transfer_group_id,settles_card_id,superseded_by,credit_card_id,payment_method")
          .eq("status", "confirmed").gte("occurred_at", since).order("occurred_at", { ascending: false }).range(from, to) as any,
        { source: "transactions" },
      ).then((data) => ({ data })).catch(() => ({ data: [] as DetectionTx[] })),
      supabase.from("recurring_suggestion_dismissals" as any).select("key"),
      supabase.from("user_financial_settings" as any).select("approximate_monthly_income").maybeSingle(),
      supabase.from("debts").select("*").eq("status", "active"),
      supabase.from("debt_payments").select("debt_id,paid_at,amount,amount_applied,installments_covered"),
    ]);
    setIncome(Number((settings as any)?.approximate_monthly_income) > 0 ? Number((settings as any).approximate_monthly_income) : null);
    setTxs((txRows as any) ?? []); setDismissed(((dis as any) ?? []).map((d: any) => d.key));
    setDebts((debtRows as any) ?? []); setDebtPayments((payRows as any) ?? []);
    setRules((r as any) ?? []); setOccs((o as any) ?? []); setAccounts(a ?? []); setCats(c ?? []); setCardInstallments((installments as any) ?? []);
  };
  useEffect(() => { load(); }, []);

  const suggestions = detectRecurringSuggestions({
    txs, today: todayISO(), existingRules: (rules ?? []).map((r: any) => ({ name: r.name })), dismissedKeys: dismissed,
  });

  const subs = detectSubscriptions({ txs, today: todayISO() });

  const acceptSuggestion = async (sg: RecurringSuggestion) => {
    const account = sg.account_id ?? accounts[0]?.id ?? null;
    if (!account) return toast.error("Cadastre uma conta antes de criar a regra");
    setBusy(true);
    try {
      const { error } = await supabase.from("recurring_rules" as any).insert({
        name: sg.name, amount: sg.amount, kind: sg.kind, account_id: account, category_id: sg.category_id,
        frequency: "monthly", day_of_month: sg.day_of_month, weekday: null, start_date: sg.next_date, end_date: null,
        user_id: (await supabase.auth.getUser()).data.user!.id,
      });
      if (error) throw error;
      toast.success("Regra criada", { description: `${sg.name} entra todo dia ${sg.day_of_month}.` });
      await generate();
      await load();
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };

  const adjustSuggestion = (sg: RecurringSuggestion) => {
    setForm({
      name: sg.name, amount: String(sg.amount).replace(".", ","), kind: sg.kind, account_id: sg.account_id ?? "",
      category_id: sg.category_id ?? "", frequency: "monthly", day_of_month: sg.day_of_month, weekday: 1,
      start_date: sg.next_date, end_date: "",
    });
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const dismissSuggestion = async (sg: RecurringSuggestion) => {
    setDismissed((d) => [...d, sg.key]);
    const uid = (await supabase.auth.getUser()).data.user!.id;
    const { error } = await supabase.from("recurring_suggestion_dismissals" as any).insert({ user_id: uid, key: sg.key });
    if (error && !/duplicate|unique/i.test(error.message)) toast.error(error.message);
  };

  const debtInstallments = debts.map((d: any) => {
    const sched = buildDebtSchedule(d as DebtScheduleRow, debtPayments.filter((p: any) => p.debt_id === d.id).map((p: any) => ({
      debt_id: p.debt_id, paid_at: String(p.paid_at).slice(0, 10), amount: Number(p.amount ?? 0),
      amount_applied: Number(p.amount_applied ?? p.amount ?? 0), installments_covered: p.installments_covered ?? null,
    })), todayISO());
    const next = sched.installments.find((i) => i.state !== "paga");
    return next ? { id: d.id, name: d.name, creditor: d.creditor, next, paid: sched.installments_paid, total: sched.installments_total } : null;
  }).filter(Boolean) as Array<{ id: string; name: string; creditor: string | null; next: { index: number; due_date: string; amount: number }; paid: number; total: number | null }>;

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
          <CategorySelect
            value={form.category_id || null}
            onChange={(id) => setForm({ ...form, category_id: id ?? "" })}
            type={form.kind}
          />
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

      <SubscriptionsSummary active={subs.active} possiblyEnded={subs.possibly_ended} monthlyIncome={income} today={todayISO()} lastCardDate={txs.filter((t) => t.credit_card_id).map((t) => String(t.occurred_at).slice(0, 10)).sort().pop() ?? null} />

      {suggestions.length > 0 && (
        <div>
          <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold"><Sparkles size={15} className="text-primary" /> O Nino achou estas contas que se repetem</h2>
          <p className="mb-2 text-[11px] text-muted-foreground">Vi nos seus lançamentos. Nada é criado sem a sua confirmação.</p>
          <div className="surface-card divide-y divide-border overflow-hidden">
            {suggestions.map((sg) => (
              <div key={sg.key} className="space-y-2 px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{sg.name}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {sg.kind === "income" ? "Receita" : "Despesa"} · {sg.amount_varies ? "cerca de " : ""}{formatBRL(sg.amount)} · todo dia {sg.day_of_month} · visto em {sg.months} meses
                    </p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${sg.confidence === "alta" ? "bg-emerald-50 text-emerald-700" : "bg-secondary text-muted-foreground"}`}>
                    {sg.confidence === "alta" ? "Quase certo" : "Provável"}
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button disabled={busy} onClick={() => acceptSuggestion(sg)} className="min-h-10 rounded-full bg-primary px-4 text-xs font-semibold text-primary-foreground disabled:opacity-50">Confirmar</button>
                  <button disabled={busy} onClick={() => adjustSuggestion(sg)} className="min-h-10 rounded-full border border-border px-4 text-xs font-medium">Ajustar</button>
                  <button disabled={busy} onClick={() => dismissSuggestion(sg)} className="min-h-10 px-3 text-xs text-muted-foreground">Agora não</button>
                </div>
              </div>
            ))}
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
        <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold"><CreditCard size={15} /> Parcelas já conhecidas das próximas faturas</h2>
        {cardInstallments.length === 0 ? (
          <p className="surface-card p-4 text-xs text-muted-foreground">Nenhuma parcela futura identificada.</p>
        ) : (
          <div className="surface-card divide-y divide-border overflow-hidden">
            {cardInstallments.map((installment: any) => (
              <div key={installment.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{installment.credit_cards?.name ?? "Cartão"} · parcela {installment.installment_number}</p>
                  <p className="text-[11px] text-muted-foreground">Vencimento {new Date(`${installment.due_date}T12:00:00`).toLocaleDateString("pt-BR")}</p>
                </div>
                <strong className="text-sm tabular-nums">{formatBRL(Number(installment.amount || 0))}</strong>
              </div>
            ))}
          </div>
        )}
      </div>

      {debtInstallments.length > 0 && (
        <div>
          <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold"><Landmark size={15} /> Parcelas de dívidas</h2>
          <p className="mb-2 text-[11px] text-muted-foreground">Só para você ver o que vem aí: elas já entram em Compromissos pela tela de Dívidas e não viram regra aqui, para não contar em dobro.</p>
          <div className="surface-card divide-y divide-border overflow-hidden">
            {debtInstallments.map((d) => (
              <Link key={d.id} to="/app/dividas" className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{d.name}{d.creditor ? ` · ${d.creditor}` : ""}</p>
                  <p className="text-[11px] text-muted-foreground">Parcela {d.next.index}{d.total ? `/${d.total}` : ""} · vence {new Date(`${d.next.due_date}T12:00:00`).toLocaleDateString("pt-BR")}</p>
                </div>
                <strong className="text-sm tabular-nums">{formatBRL(d.next.amount)}</strong>
              </Link>
            ))}
          </div>
        </div>
      )}

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
