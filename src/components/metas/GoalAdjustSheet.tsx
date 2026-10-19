import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import type { CategoryGoalBaselineKind, CategoryGoalEvaluation } from "@/lib/engine/metrics";
import { computeCategoryBaseline } from "@/lib/engine/metrics";
import { formatBRL, round2 } from "@/lib/engine/facts";
import type { TransactionRow } from "@/lib/engine/facts";
import type { CategorySpendingGoalInput } from "@/lib/db/finance";

const REASONS = ["Estava irreal", "Mudou minha renda", "Mês fora do normal", "Quero ser mais firme"];

type Props = {
  evaluation: CategoryGoalEvaluation;
  txs: TransactionRow[];
  saving?: boolean;
  onClose: () => void;
  onSubmit: (input: CategorySpendingGoalInput, reason: string | null) => void;
};

/** Ajuste rápido de uma meta que já existe: novo limite ou nova forma de medir, com o contexto à vista. */
export function GoalAdjustSheet({ evaluation, txs, saving, onClose, onSubmit }: Props) {
  const goal = evaluation.goal;
  const [mode, setMode] = useState<"fixed_limit" | "percent_reduction">(goal.mode as "fixed_limit" | "percent_reduction");
  const [limit, setLimit] = useState(String(round2(goal.computed_limit)).replace(".", ","));
  const [baselineKind, setBaselineKind] = useState<Exclude<CategoryGoalBaselineKind, "custom">>(goal.baseline_kind === "prev_month" ? "prev_month" : "avg_3m");
  const [pct, setPct] = useState(String(Number(goal.reduction_pct ?? 10)));
  const [reason, setReason] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const today = useMemo(() => new Date(), []);
  const avg3 = useMemo(() => computeCategoryBaseline(txs, goal.category_id, "avg_3m", today), [txs, goal.category_id, today]);
  const prev = useMemo(() => computeCategoryBaseline(txs, goal.category_id, "prev_month", today), [txs, goal.category_id, today]);
  const baseline = baselineKind === "avg_3m" ? avg3 : prev;

  const num = (v: string) => Number(v.replace(",", "."));
  const newLimit = mode === "fixed_limit"
    ? round2(num(limit) || 0)
    : round2(baseline * (1 - Math.max(0, Math.min(100, num(pct) || 0)) / 100));
  const projected = evaluation.projectedFinalSpend;
  const changed = round2(newLimit - goal.computed_limit) !== 0 || mode !== goal.mode || (mode === "percent_reduction" && baselineKind !== goal.baseline_kind);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!(newLimit > 0)) { setError("O limite precisa ser maior que zero."); return; }
    if (!changed) { setError("Nada mudou ainda. Altere o valor ou a forma de medir."); return; }
    onSubmit({
      id: goal.id,
      category_id: goal.category_id,
      mode,
      reduction_pct: mode === "percent_reduction" ? num(pct) || 0 : null,
      fixed_limit: mode === "fixed_limit" ? newLimit : null,
      baseline_kind: mode === "percent_reduction" ? baselineKind : (goal.baseline_kind as CategoryGoalBaselineKind),
      baseline_value: mode === "percent_reduction" ? baseline : (goal.baseline_value ?? null),
      computed_limit: newLimit,
      frequency: goal.frequency as CategorySpendingGoalInput["frequency"],
      period_type: goal.period_type as CategorySpendingGoalInput["period_type"],
      start_date: goal.start_date,
      end_date: goal.end_date ?? null,
      status: goal.status as CategorySpendingGoalInput["status"],
    }, reason);
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-end bg-black/40 sm:place-items-center" onClick={onClose}>
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        className="max-h-[90dvh] w-full max-w-[560px] overflow-y-auto rounded-t-[20px] border border-border bg-card p-5 shadow-card sm:rounded-[20px]"
        style={{ paddingBottom: "calc(1.25rem + env(safe-area-inset-bottom, 0px))" }}
      >
        <h2 className="font-display text-lg font-bold">Ajustar meta de {evaluation.categoryName ?? "categoria"}</h2>
        <p className="mt-1 text-xs text-muted-foreground">O Nino registra o ajuste e, quando o período fechar, avalia se ele fez sentido.</p>

        <div className="mt-3 grid grid-cols-3 gap-2 rounded-xl bg-secondary/40 p-3 text-center">
          <div><p className="text-[10px] text-muted-foreground">Limite atual</p><p className="text-[13px] font-semibold tabular-nums">{formatBRL(goal.computed_limit)}</p></div>
          <div><p className="text-[10px] text-muted-foreground">Gasto até agora</p><p className="text-[13px] font-semibold tabular-nums">{formatBRL(evaluation.actualSpend)}</p></div>
          <div><p className="text-[10px] text-muted-foreground">No ritmo, fecha em</p><p className="text-[13px] font-semibold tabular-nums">{formatBRL(projected)}</p></div>
        </div>

        <div className="mt-4">
          <label className="mb-1 block text-xs font-medium">Como medir</label>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setMode("fixed_limit")} className={`rounded-full border px-3 py-2 text-xs font-medium ${mode === "fixed_limit" ? "border-primary bg-primary/10 text-primary" : "border-border"}`}>Valor do mês</button>
            <button type="button" onClick={() => setMode("percent_reduction")} className={`rounded-full border px-3 py-2 text-xs font-medium ${mode === "percent_reduction" ? "border-primary bg-primary/10 text-primary" : "border-border"}`}>Reduzir % da média</button>
          </div>
        </div>

        {mode === "fixed_limit" ? (
          <div className="mt-3">
            <label className="mb-1 block text-xs font-medium">Novo limite (R$)</label>
            <input inputMode="decimal" value={limit} onChange={(e) => setLimit(e.target.value)} className="input-base" style={{ fontSize: 16 }} />
            <div className="mt-2 flex flex-wrap gap-1.5">
              {avg3 > 0 ? <button type="button" onClick={() => setLimit(String(round2(avg3)).replace(".", ","))} className="rounded-full border border-border px-3 py-1 text-[11px]">Média 3 meses {formatBRL(avg3)}</button> : null}
              {prev > 0 ? <button type="button" onClick={() => setLimit(String(round2(prev)).replace(".", ","))} className="rounded-full border border-border px-3 py-1 text-[11px]">Mês passado {formatBRL(prev)}</button> : null}
              {projected > 0 ? <button type="button" onClick={() => setLimit(String(Math.ceil(projected)).replace(".", ","))} className="rounded-full border border-border px-3 py-1 text-[11px]">Ritmo atual {formatBRL(Math.ceil(projected))}</button> : null}
            </div>
          </div>
        ) : (
          <div className="mt-3 grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-xs font-medium">Base</label>
              <select value={baselineKind} onChange={(e) => setBaselineKind(e.target.value as typeof baselineKind)} className="input-base" style={{ fontSize: 16 }}>
                <option value="avg_3m">Média de 3 meses ({formatBRL(avg3)})</option>
                <option value="prev_month">Mês anterior ({formatBRL(prev)})</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Reduzir em (%)</label>
              <input inputMode="decimal" value={pct} onChange={(e) => setPct(e.target.value)} className="input-base" style={{ fontSize: 16 }} />
            </div>
          </div>
        )}

        <p className={`mt-3 text-[12px] ${projected > newLimit ? "text-red-600" : "text-foreground"}`} data-testid="adjust-preview">
          Novo limite <strong className="tabular-nums">{formatBRL(newLimit)}</strong>.{" "}
          {projected > newLimit
            ? `No ritmo atual ainda passa ${formatBRL(projected - newLimit)}.`
            : "No ritmo atual você fecha dentro dele."}
        </p>

        <div className="mt-4">
          <label className="mb-1 block text-xs font-medium">Por que ajustar? (opcional)</label>
          <div className="flex flex-wrap gap-1.5">
            {REASONS.map((r) => (
              <button key={r} type="button" onClick={() => setReason(reason === r ? null : r)}
                className={`rounded-full border px-3 py-1.5 text-[11px] font-medium ${reason === r ? "border-primary bg-primary/10 text-primary" : "border-border"}`}>{r}</button>
            ))}
          </div>
        </div>

        {error ? <p className="mt-3 text-xs text-destructive">{error}</p> : null}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-full border border-border bg-card px-4 py-2 text-sm">Cancelar</button>
          <button type="submit" disabled={saving} className="btn-brand inline-flex items-center gap-2">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Salvar ajuste"}
          </button>
        </div>
      </form>
    </div>
  );
}
