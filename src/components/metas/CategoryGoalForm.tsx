import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import type { CategoryRow } from "@/lib/db/finance";
import type { TransactionRow } from "@/lib/engine/facts";
import {
  computeCategoryBaseline,
  evaluateCategoryGoal,
  type CategoryGoalMode,
  type CategoryGoalBaselineKind,
  type CategoryGoalPeriodType,
  type CategorySpendingGoalRow,
} from "@/lib/engine/metrics";
import { formatBRL, round2, todayISO } from "@/lib/engine/facts";

export type CategoryGoalFormValues = {
  id?: string;
  category_id: string;
  mode: CategoryGoalMode;
  reduction_pct: number | null;
  fixed_limit: number | null;
  baseline_kind: CategoryGoalBaselineKind;
  baseline_value: number;
  computed_limit: number;
  frequency: "monthly" | "once" | "custom";
  period_type: CategoryGoalPeriodType;
  start_date: string;
  end_date: string;
};

type Props = {
  initial?: Partial<CategorySpendingGoalRow> | null;
  categories: CategoryRow[];
  txs: TransactionRow[];
  saving?: boolean;
  onClose: () => void;
  onSubmit: (v: CategoryGoalFormValues) => void;
};

function firstOfMonth(d: Date) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function lastOfMonth(d: Date) { return new Date(d.getFullYear(), d.getMonth() + 1, 0); }
function addDays(d: Date, n: number) { const c = new Date(d); c.setDate(c.getDate() + n); return c; }

function computePeriod(type: CategoryGoalPeriodType, startCustom: string, endCustom: string): { start: string; end: string } {
  const today = new Date();
  switch (type) {
    case "this_month":
      return { start: todayISO(firstOfMonth(today)), end: todayISO(lastOfMonth(today)) };
    case "next_month": {
      const nm = new Date(today.getFullYear(), today.getMonth() + 1, 1);
      return { start: todayISO(nm), end: todayISO(lastOfMonth(nm)) };
    }
    case "next_30_days":
      return { start: todayISO(today), end: todayISO(addDays(today, 29)) };
    case "monthly_recurring":
      return { start: todayISO(firstOfMonth(today)), end: todayISO(lastOfMonth(today)) };
    case "custom":
      return { start: startCustom || todayISO(today), end: endCustom || todayISO(lastOfMonth(today)) };
  }
}

export function CategoryGoalForm({ initial, categories, txs, saving, onClose, onSubmit }: Props) {
  const expenseCats = useMemo(() => categories.filter((c) => c.type === "expense"), [categories]);
  const [categoryId, setCategoryId] = useState(initial?.category_id ?? expenseCats[0]?.id ?? "");
  const [mode, setMode] = useState<CategoryGoalMode>(initial?.mode as CategoryGoalMode ?? "percent_reduction");
  const [baselineKind, setBaselineKind] = useState<CategoryGoalBaselineKind>(initial?.baseline_kind as CategoryGoalBaselineKind ?? "avg_3m");
  const [reductionPct, setReductionPct] = useState<string>(initial?.reduction_pct ? String(initial.reduction_pct) : "20");
  const [fixedLimit, setFixedLimit] = useState<string>(initial?.fixed_limit ? String(initial.fixed_limit) : "");
  const [customBaseline, setCustomBaseline] = useState<string>(
    initial?.baseline_value && initial.baseline_kind === "custom" ? String(initial.baseline_value) : "",
  );
  const [manualLimit, setManualLimit] = useState<string>(initial ? String(initial.computed_limit) : "");
  const [periodType, setPeriodType] = useState<CategoryGoalPeriodType>(
    (initial?.period_type as CategoryGoalPeriodType | undefined) ?? "this_month",
  );
  const [customStart, setCustomStart] = useState<string>(initial?.start_date ?? todayISO(firstOfMonth(new Date())));
  const [customEnd, setCustomEnd] = useState<string>(initial?.end_date ?? todayISO(lastOfMonth(new Date())));
  const [error, setError] = useState<string | null>(null);

  const autoBaseline = useMemo(() => {
    if (!categoryId) return 0;
    if (baselineKind === "custom") return Number(customBaseline.replace(",", ".")) || 0;
    return computeCategoryBaseline(txs, categoryId, baselineKind, new Date());
  }, [txs, categoryId, baselineKind, customBaseline]);

  const suggestedLimit = useMemo(() => {
    if (mode === "fixed_limit") return Number(fixedLimit.replace(",", ".")) || 0;
    const pct = Math.max(0, Math.min(100, Number(reductionPct.replace(",", ".")) || 0));
    return round2(autoBaseline * (1 - pct / 100));
  }, [mode, fixedLimit, reductionPct, autoBaseline]);

  const finalLimit = manualLimit.trim() ? Number(manualLimit.replace(",", ".")) : suggestedLimit;
  const period = useMemo(() => computePeriod(periodType, customStart, customEnd), [periodType, customStart, customEnd]);

  const preview = useMemo(() => {
    if (!categoryId || !(finalLimit > 0)) return null;
    return evaluateCategoryGoal(
      {
        id: initial?.id ?? "preview",
        user_id: "preview",
        category_id: categoryId,
        mode,
        reduction_pct: mode === "percent_reduction" ? Number(reductionPct.replace(",", ".")) || 0 : null,
        fixed_limit: mode === "fixed_limit" ? Number(fixedLimit.replace(",", ".")) || 0 : null,
        baseline_kind: baselineKind,
        baseline_value: autoBaseline,
        computed_limit: round2(finalLimit),
        frequency: "monthly",
        start_date: period.start,
        end_date: period.end,
        status: "active",
        period_type: periodType,
      },
      txs,
      new Date(),
      undefined,
    );
  }, [categoryId, finalLimit, mode, reductionPct, fixedLimit, baselineKind, autoBaseline, period.start, period.end, periodType, txs, initial?.id]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!categoryId) { setError("Escolha uma categoria"); return; }
    if (!(finalLimit > 0)) { setError("Limite deve ser maior que zero"); return; }
    if (periodType === "custom" && (!customStart || !customEnd || customEnd < customStart)) {
      setError("Datas de início e fim inválidas"); return;
    }
    onSubmit({
      id: initial?.id,
      category_id: categoryId,
      mode,
      reduction_pct: mode === "percent_reduction" ? Number(reductionPct.replace(",", ".")) || 0 : null,
      fixed_limit: mode === "fixed_limit" ? Number(fixedLimit.replace(",", ".")) || 0 : null,
      baseline_kind: baselineKind,
      baseline_value: autoBaseline,
      computed_limit: round2(finalLimit),
      frequency: periodType === "monthly_recurring" ? "monthly" : "once",
      period_type: periodType,
      start_date: period.start,
      end_date: period.end,
    });
  }

  const periodOptions: { value: CategoryGoalPeriodType; label: string }[] = [
    { value: "this_month", label: "Este mês" },
    { value: "next_month", label: "Próximo mês" },
    { value: "next_30_days", label: "Próximos 30 dias" },
    { value: "custom", label: "Personalizado" },
    { value: "monthly_recurring", label: "Mensal recorrente" },
  ];

  return (
    <div className="fixed inset-0 z-50 grid place-items-end sm:place-items-center bg-black/40" onClick={onClose}>
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        className="w-full max-w-[640px] max-h-[90dvh] overflow-y-auto rounded-t-[20px] sm:rounded-[20px] border border-border bg-card p-5 sm:p-6 shadow-card"
        style={{ paddingBottom: "calc(1.25rem + env(safe-area-inset-bottom, 0px))" }}
      >
        <h2 className="font-display text-lg font-bold">{initial ? "Editar meta de categoria" : "Nova meta de categoria"}</h2>
        <p className="mt-1 text-xs text-muted-foreground">Defina um teto de gasto e acompanhe seu ritmo em tempo real.</p>

        <div className="mt-4 space-y-3">
          {/* 1. Categoria */}
          <div>
            <label className="mb-1 block text-xs font-medium">Categoria</label>
            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="input-base" style={{ fontSize: 16 }}>
              <option value="">Selecione…</option>
              {expenseCats.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
            </select>
          </div>

          {/* 2. Como definir a meta */}
          <div>
            <label className="mb-1 block text-xs font-medium">Como definir a meta</label>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setMode("percent_reduction")} className={`rounded-full border px-3 py-2 text-xs font-medium ${mode === "percent_reduction" ? "border-primary bg-primary/10 text-primary" : "border-border"}`}>Reduzir %</button>
              <button type="button" onClick={() => setMode("fixed_limit")} className={`rounded-full border px-3 py-2 text-xs font-medium ${mode === "fixed_limit" ? "border-primary bg-primary/10 text-primary" : "border-border"}`}>Limite fixo</button>
            </div>
          </div>

          {mode === "percent_reduction" && (
            <>
              <div>
                <label className="mb-1 block text-xs font-medium">Base de comparação</label>
                <select value={baselineKind} onChange={(e) => setBaselineKind(e.target.value as CategoryGoalBaselineKind)} className="input-base" style={{ fontSize: 16 }}>
                  <option value="avg_3m">Média dos últimos 3 meses</option>
                  <option value="prev_month">Mês anterior</option>
                  <option value="custom">Valor personalizado</option>
                </select>
              </div>
              {baselineKind === "custom" && (
                <div>
                  <label className="mb-1 block text-xs font-medium">Base (R$)</label>
                  <input inputMode="decimal" value={customBaseline} onChange={(e) => setCustomBaseline(e.target.value)} className="input-base" style={{ fontSize: 16 }} />
                </div>
              )}
              <div>
                <label className="mb-1 block text-xs font-medium">Reduzir em (%)</label>
                <input inputMode="decimal" value={reductionPct} onChange={(e) => setReductionPct(e.target.value)} className="input-base" style={{ fontSize: 16 }} />
              </div>
              <p className="text-xs text-muted-foreground">Base: <span className="font-medium tabular-nums text-foreground">{formatBRL(autoBaseline)}</span></p>
            </>
          )}

          {mode === "fixed_limit" && (
            <div>
              <label className="mb-1 block text-xs font-medium">Limite (R$)</label>
              <input inputMode="decimal" value={fixedLimit} onChange={(e) => setFixedLimit(e.target.value)} className="input-base" style={{ fontSize: 16 }} />
            </div>
          )}

          <div>
            <label className="mb-1 block text-xs font-medium">Limite calculado (editável)</label>
            <input inputMode="decimal" value={manualLimit} onChange={(e) => setManualLimit(e.target.value)} placeholder={String(suggestedLimit.toFixed(2))} className="input-base" style={{ fontSize: 16 }} />
            <p className="mt-1 text-[11px] text-muted-foreground">Sugestão: {formatBRL(suggestedLimit)}.</p>
          </div>

          {/* 7. Período da meta */}
          <div>
            <label className="mb-1 block text-xs font-medium">Período da meta</label>
            <div className="flex flex-wrap gap-1.5">
              {periodOptions.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setPeriodType(opt.value)}
                  className={`rounded-full border px-3 py-1.5 text-[11px] font-medium ${periodType === opt.value ? "border-primary bg-primary/10 text-primary" : "border-border"}`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            {periodType === "custom" ? (
              <div className="mt-2 grid grid-cols-2 gap-2">
                <div>
                  <label className="mb-1 block text-[11px] text-muted-foreground">Início</label>
                  <input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} className="input-base" style={{ fontSize: 16 }} />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] text-muted-foreground">Fim</label>
                  <input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} className="input-base" style={{ fontSize: 16 }} />
                </div>
              </div>
            ) : (
              <p className="mt-2 text-[11px] text-muted-foreground">
                Período: {new Date(period.start + "T00:00:00").toLocaleDateString("pt-BR")} até{" "}
                {new Date(period.end + "T00:00:00").toLocaleDateString("pt-BR")}
                {periodType === "this_month" && (
                  <> · serão considerados <strong>todos os gastos desde o 1º do mês</strong>.</>
                )}
              </p>
            )}
          </div>

          {/* 9. Prévia */}
          {preview && (
            <div className="rounded-[14px] border border-border bg-[color:var(--home-surface-soft,#F3F1F7)] p-3">
              <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Prévia da meta</p>
              <p className="mt-1 text-[13px]">
                Limite <span className="font-semibold tabular-nums">{formatBRL(preview.targetAmount)}</span> · já gasto{" "}
                <span className="font-semibold tabular-nums">{formatBRL(preview.actualSpend)}</span>
              </p>
              <p className={`mt-1 text-[12px] font-medium ${preview.actualSpend > preview.targetAmount ? "text-red-600" : "text-foreground"}`}>
                {preview.message}
              </p>
            </div>
          )}
        </div>

        {error && <p className="mt-3 text-xs text-destructive">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-full border border-border bg-card px-4 py-2 text-sm">Cancelar</button>
          <button type="submit" disabled={saving} className="btn-brand inline-flex items-center gap-2">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Salvar"}
          </button>
        </div>
      </form>
    </div>
  );
}
