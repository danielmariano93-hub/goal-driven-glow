import { useState } from "react";
import { Plus, Trash2, Loader2, Pencil, TrendingUp, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { useInvestments, useSaveInvestment, useDeleteInvestment, useGoals, useAccounts, type InvestmentRow } from "@/lib/db/finance";
import { investmentSchema } from "@/lib/validation/finance";
import { computeInvestedPrincipal, computeInvestmentsTotal, formatBRL, todayISO } from "@/lib/engine/facts";
import { supabase } from "@/integrations/supabase/client";

const CATEGORIES = ["Renda Fixa", "Tesouro Direto", "Ações", "FIIs", "ETF", "Cripto", "Fundos", "Outros"];
type InvestmentWithReserve = InvestmentRow & { reserve_role?: "unspecified" | "emergency_reserve" | "long_term" | null };

export default function Investimentos() {
  const { data: items, isLoading } = useInvestments();
  const { data: goals } = useGoals();
  const save = useSaveInvestment();
  const del = useDeleteInvestment();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<InvestmentRow | null>(null);
  const [reserveBusy, setReserveBusy] = useState<string | null>(null);

  // Fonte única (finance_contract.v2): helpers puros do core.
  const total = computeInvestmentsTotal(items ?? []);
  const invested = computeInvestedPrincipal(items ?? []);

  async function toggleReserve(item: InvestmentWithReserve) {
    setReserveBusy(item.id);
    try {
      const next = item.reserve_role === "emergency_reserve" ? "unspecified" : "emergency_reserve";
      const { error } = await (supabase.from("investments") as any).update({ reserve_role: next }).eq("id", item.id);
      if (error) throw error;
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["investments"] }),
        qc.invalidateQueries({ queryKey: ["behavioral-dashboard"] }),
      ]);
      toast.success(next === "emergency_reserve" ? "Incluído na reserva de emergência." : "Removido da reserva de emergência.");
    } catch (error) {
      toast.error("Não foi possível atualizar a reserva.", { description: String((error as Error).message ?? error) });
    } finally {
      setReserveBusy(null);
    }
  }

  return (
    <div>
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">Investimentos</h1>
          <p className="text-sm text-muted-foreground">Portfólio informado por você.</p>
        </div>
        <button
          onClick={() => {
            setEditing(null);
            setOpen(true);
          }}
          className="btn-brand inline-flex items-center gap-2"
        >
          <Plus size={14} /> Novo
        </button>
      </header>

      {isLoading ? (
        <div className="grid place-items-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : !items || items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card p-10 text-center">
          <TrendingUp className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 text-sm font-medium">Ainda não há dados suficientes</p>
          <p className="mt-1 text-xs text-muted-foreground">Registre seus investimentos para acompanhar o patrimônio.</p>
        </div>
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3">
            <div className="rounded-2xl border border-border bg-card p-4">
              <p className="text-xs text-muted-foreground">Valor atual</p>
              <p className="mt-1 text-xl font-semibold tabular-nums">{formatBRL(total)}</p>
            </div>
            <div className="rounded-2xl border border-border bg-card p-4">
              <p className="text-xs text-muted-foreground">Total aportado</p>
              <p className="mt-1 text-xl font-semibold tabular-nums">{formatBRL(invested)}</p>
            </div>
          </div>
          <div className="mb-4 rounded-2xl border border-border bg-secondary/25 p-3 text-xs leading-relaxed text-muted-foreground">
            <strong className="text-foreground">Reserva de emergência:</strong> marque apenas investimentos que você realmente considera líquidos e disponíveis para imprevistos. O Nino usa essa marcação na leitura de Segurança Financeira.
          </div>
          <ul className="space-y-2">
            {items.map((raw) => {
              const i = raw as InvestmentWithReserve;
              const goal = goals?.find((g) => g.id === i.goal_id);
              const isReserve = i.reserve_role === "emergency_reserve";
              return (
                <li key={i.id} className="rounded-2xl border border-border bg-card p-4 shadow-card">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{i.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {i.category}
                        {i.institution ? ` · ${i.institution}` : ""}
                        {goal ? ` · meta: ${goal.name}` : ""}
                      </p>
                      <p className="mt-1 text-xs">
                        Investido {formatBRL(Number(i.invested_amount))} · Atual{" "}
                        <span className="font-semibold">{formatBRL(Number(i.current_value))}</span>
                      </p>
                      {Number((i as Record<string, unknown>).employer_match_total ?? 0) > 0 && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          Sua parte {formatBRL(Number(i.current_value) - Number((i as Record<string, unknown>).employer_match_total))}
                          {" + "}contrapartida da empresa {formatBRL(Number((i as Record<string, unknown>).employer_match_total))}
                          {Number((i as Record<string, unknown>).employer_vested_pct ?? 100) < 100
                            ? ` (você tem direito a ${Number((i as Record<string, unknown>).employer_vested_pct)}% dela no resgate antecipado)`
                            : ""}
                        </p>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          setEditing(i);
                          setOpen(true);
                        }}
                        className="rounded-full border border-border p-2 text-muted-foreground hover:text-foreground"
                        aria-label={`Editar ${i.name}`}
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        onClick={() => {
                          if (confirm("Excluir este investimento?")) del.mutate(i.id, { onSuccess: () => toast.success("Excluído") });
                        }}
                        className="rounded-full border border-border p-2 text-muted-foreground hover:text-destructive"
                        aria-label={`Excluir ${i.name}`}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={reserveBusy === i.id}
                    onClick={() => toggleReserve(i)}
                    className={`mt-3 inline-flex min-h-9 items-center gap-2 rounded-full border px-3 text-xs font-semibold ${isReserve ? "border-success/25 bg-success/10 text-success" : "border-border text-muted-foreground"}`}
                  >
                    {reserveBusy === i.id ? <Loader2 size={13} className="animate-spin" /> : <ShieldCheck size={13} />}
                    {isReserve ? "Conta como reserva de emergência" : "Marcar como reserva de emergência"}
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {open && (
        <InvestmentModal
          initial={editing}
          goals={goals ?? []}
          saving={save.isPending}
          onClose={() => setOpen(false)}
          onSubmit={(v) =>
            save.mutate(
              { ...v, id: editing?.id },
              {
                onSuccess: () => {
                  toast.success("Salvo");
                  setOpen(false);
                },
                onError: (e: unknown) => toast.error("Erro", { description: String((e as Error).message) }),
              }
            )
          }
        />
      )}
    </div>
  );
}

function InvestmentModal({
  initial,
  goals,
  saving,
  onClose,
  onSubmit,
}: {
  initial: InvestmentRow | null;
  goals: { id: string; name: string }[];
  saving: boolean;
  onClose: () => void;
  onSubmit: (v: ReturnType<typeof investmentSchema.parse>) => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [category, setCategory] = useState(initial?.category ?? CATEGORIES[0]);
  const [institution, setInstitution] = useState(initial?.institution ?? "");
  const [invested, setInvested] = useState(initial ? String(initial.invested_amount) : "");
  const [current, setCurrent] = useState(initial ? String(initial.current_value) : "");
  const [refDate, setRefDate] = useState(initial?.reference_date ?? todayISO());
  const [goalId, setGoalId] = useState<string>(initial?.goal_id ?? "");
  const { data: accounts } = useAccounts();
  const init = initial as (InvestmentRow & Record<string, unknown>) | null;
  const [payrollOn, setPayrollOn] = useState(Number(init?.payroll_contribution_amount ?? 0) > 0);
  const [payrollAmount, setPayrollAmount] = useState(init?.payroll_contribution_amount != null ? String(init.payroll_contribution_amount) : "");
  const [payrollDay, setPayrollDay] = useState(init?.payroll_day != null ? String(init.payroll_day) : "");
  const [payrollAccount, setPayrollAccount] = useState<string>(String(init?.payroll_account_id ?? ""));
  const [matchPct, setMatchPct] = useState(init?.employer_match_ratio != null ? String(Number(init.employer_match_ratio) * 100) : "0");
  const [vestedPct, setVestedPct] = useState(init?.employer_vested_pct != null ? String(init.employer_vested_pct) : "100");
  const [error, setError] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = investmentSchema.safeParse({
      name,
      category,
      institution,
      invested_amount: Number(invested.replace(",", ".")) || 0,
      current_value: Number(current.replace(",", ".")) || 0,
      reference_date: refDate,
      goal_id: goalId || null,
      // Aporte em folha: ao desligar, zera o agendamento (undefined mantém o que já existe).
      ...(payrollOn
        ? {
            payroll_contribution_amount: Number(payrollAmount.replace(",", ".")) || null,
            payroll_day: Number(payrollDay) || null,
            payroll_account_id: payrollAccount || null,
            employer_match_ratio: (Number(matchPct.replace(",", ".")) || 0) / 100,
            employer_vested_pct: Number(vestedPct.replace(",", ".")) || 0,
          }
        : initial ? { payroll_contribution_amount: null, payroll_day: null, payroll_account_id: null } : {}),
    });
    if (payrollOn && (!Number(payrollAmount.replace(",", ".")) || !Number(payrollDay) || !payrollAccount)) {
      setError("Informe valor, dia e conta do desconto em folha.");
      return;
    }
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Dados inválidos");
      return;
    }
    onSubmit(parsed.data);
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={onClose}>
      <form onClick={(e) => e.stopPropagation()} onSubmit={submit} className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-card">
        <h2 className="font-display text-lg font-bold">{initial ? "Editar" : "Novo"} investimento</h2>
        <div className="mt-4 space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium">Nome</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className="input-base" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-xs font-medium">Categoria</label>
              <select value={category} onChange={(e) => setCategory(e.target.value)} className="input-base">
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Instituição</label>
              <input value={institution ?? ""} onChange={(e) => setInstitution(e.target.value)} className="input-base" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-xs font-medium">Valor aportado</label>
              <input inputMode="decimal" value={invested} onChange={(e) => setInvested(e.target.value)} className="input-base" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Valor atual</label>
              <input inputMode="decimal" value={current} onChange={(e) => setCurrent(e.target.value)} className="input-base" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-xs font-medium">Data de referência</label>
              <input type="date" value={refDate} onChange={(e) => setRefDate(e.target.value)} className="input-base" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Meta ligada</label>
              <select value={goalId} onChange={(e) => setGoalId(e.target.value)} className="input-base">
                <option value="">—</option>
                {goals.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="rounded-xl border border-border p-3">
            <label className="flex items-center gap-2 text-xs font-medium">
              <input type="checkbox" checked={payrollOn} onChange={(e) => setPayrollOn(e.target.checked)} />
              Aporte descontado em folha (com contrapartida da empresa)
            </label>
            {payrollOn && (
              <div className="mt-3 space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="mb-1 block text-xs font-medium">Valor mensal</label>
                    <input inputMode="decimal" value={payrollAmount} onChange={(e) => setPayrollAmount(e.target.value)} className="input-base" />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium">Dia do desconto</label>
                    <input inputMode="numeric" value={payrollDay} onChange={(e) => setPayrollDay(e.target.value)} className="input-base" />
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium">Conta onde o salário cai</label>
                  <select value={payrollAccount} onChange={(e) => setPayrollAccount(e.target.value)} className="input-base">
                    <option value="">—</option>
                    {(accounts ?? []).map((a) => (
                      <option key={a.id} value={a.id}>{a.name}</option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="mb-1 block text-xs font-medium">Contrapartida (% do aporte)</label>
                    <input inputMode="decimal" value={matchPct} onChange={(e) => setMatchPct(e.target.value)} className="input-base" />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium">Direito no resgate (%)</label>
                    <input inputMode="decimal" value={vestedPct} onChange={(e) => setVestedPct(e.target.value)} className="input-base" />
                  </div>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Todo mês o Nino lança o aporte no dia indicado, ligado à entrada do salário, e soma a contrapartida à posição. A contrapartida não conta como sua poupança.
                </p>
              </div>
            )}
          </div>
        </div>
        {error && <p className="mt-3 text-xs text-destructive">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-full border border-border bg-card px-4 py-2 text-sm">
            Cancelar
          </button>
          <button type="submit" disabled={saving} className="btn-brand inline-flex items-center gap-2">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Salvar"}
          </button>
        </div>
      </form>
    </div>
  );
}
