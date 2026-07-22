import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import type { CategoryRow } from "@/lib/db/finance";
import type { TransactionRow } from "@/lib/engine/facts";
import { computeCategoryBaseline, type CategoryGoalMode, type CategoryGoalBaselineKind, type CategorySpendingGoalRow } from "@/lib/engine/metrics";
import { formatBRL, round2 } from "@/lib/engine/facts";

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
};

type Props = {
  initial?: CategorySpendingGoalRow | null;
  categories: CategoryRow[];
  txs: TransactionRow[];
  saving?: boolean;
  onClose: () => void;
  onSubmit: (v: CategoryGoalFormValues) => void;
};

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

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!categoryId) { setError("Escolha uma categoria"); return; }
    if (!(finalLimit > 0)) { setError("Limite deve ser maior que zero"); return; }
    onSubmit({
      id: initial?.id,
      category_id: categoryId,
      mode,
      reduction_pct: mode === "percent_reduction" ? Number(reductionPct.replace(",", ".")) || 0 : null,
      fixed_limit: mode === "fixed_limit" ? Number(fixedLimit.replace(",", ".")) || 0 : null,
      baseline_kind: baselineKind,
      baseline_value: autoBaseline,
      computed_limit: round2(finalLimit),
      frequency: "monthly",
    });
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={onClose}>
      <form onClick={(e) => e.stopPropagation()} onSubmit={submit} className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-card">
        <h2 className="font-display text-lg font-bold">{initial ? "Editar meta de categoria" : "Nova meta de categoria"}</h2>
        <p className="mt-1 text-xs text-muted-foreground">Defina um teto de gasto para uma categoria e acompanhe seu ritmo.</p>

        <div className="mt-4 space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium">Categoria</label>
            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="input-base">
              <option value="">Selecione…</option>
              {expenseCats.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium">Tipo de meta</label>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setMode("percent_reduction")} className={`rounded-full border px-3 py-2 text-xs font-medium ${mode === "percent_reduction" ? "border-primary bg-primary/10 text-primary" : "border-border"}`}>Reduzir %</button>
              <button type="button" onClick={() => setMode("fixed_limit")} className={`rounded-full border px-3 py-2 text-xs font-medium ${mode === "fixed_limit" ? "border-primary bg-primary/10 text-primary" : "border-border"}`}>Limite fixo</button>
            </div>
          </div>

          {mode === "percent_reduction" && (
            <>
              <div>
                <label className="mb-1 block text-xs font-medium">Base de comparação</label>
                <select value={baselineKind} onChange={(e) => setBaselineKind(e.target.value as CategoryGoalBaselineKind)} className="input-base">
                  <option value="avg_3m">Média dos últimos 3 meses</option>
                  <option value="prev_month">Mês anterior</option>
                  <option value="custom">Valor personalizado</option>
                </select>
              </div>
              {baselineKind === "custom" && (
                <div>
                  <label className="mb-1 block text-xs font-medium">Base (R$)</label>
                  <input inputMode="decimal" value={customBaseline} onChange={(e) => setCustomBaseline(e.target.value)} className="input-base" />
                </div>
              )}
              <div>
                <label className="mb-1 block text-xs font-medium">Reduzir em (%)</label>
                <input inputMode="decimal" value={reductionPct} onChange={(e) => setReductionPct(e.target.value)} className="input-base" />
              </div>
              <p className="text-xs text-muted-foreground">Base: <span className="font-medium tabular-nums text-foreground">{formatBRL(autoBaseline)}</span></p>
            </>
          )}

          {mode === "fixed_limit" && (
            <div>
              <label className="mb-1 block text-xs font-medium">Limite mensal (R$)</label>
              <input inputMode="decimal" value={fixedLimit} onChange={(e) => setFixedLimit(e.target.value)} className="input-base" />
            </div>
          )}

          <div>
            <label className="mb-1 block text-xs font-medium">Limite calculado (editável)</label>
            <input inputMode="decimal" value={manualLimit} onChange={(e) => setManualLimit(e.target.value)} placeholder={String(suggestedLimit.toFixed(2))} className="input-base" />
            <p className="mt-1 text-[11px] text-muted-foreground">Sugestão: {formatBRL(suggestedLimit)}. Deixe em branco para usar a sugestão.</p>
          </div>
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
