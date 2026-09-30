import { useMemo, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { formatBRL } from "@/lib/engine/facts";
import { merchantTargetLimit, type MerchantTargetEvaluation, type MerchantTargetKind } from "@/lib/engine/spendingGoals";
import { useGoalMerchants, type MerchantTargetInput } from "@/lib/nino/spendingGoals";

type Props = {
  goalId: string;
  categoryId: string;
  categoryName: string;
  /** Chaves já usadas por outras submetas desta meta (uma chave, uma submeta). */
  takenKeys: string[];
  initial?: MerchantTargetEvaluation | null;
  saving?: boolean;
  onClose: () => void;
  onSubmit: (input: MerchantTargetInput) => void;
};

const KINDS: Array<{ value: MerchantTargetKind; label: string; hint: string }> = [
  { value: "percent_reduction", label: "Reduzir %", hint: "Ex.: reduzir pela metade" },
  { value: "amount", label: "Valor máximo", hint: "Um teto em R$ por mês" },
  { value: "zero", label: "Gasto zero", hint: "Aviso a cada nova cobrança" },
  { value: "track", label: "Só acompanhar", hint: "Sem limite, só visibilidade" },
];

const parse = (value: string) => Number(value.replace(/\./g, "").replace(",", ".")) || 0;

export function MerchantTargetForm({ goalId, categoryId, categoryName, takenKeys, initial, saving, onClose, onSubmit }: Props) {
  const { data: merchants, isLoading } = useGoalMerchants(categoryId);
  const [selected, setSelected] = useState<string[]>(initial?.merchant_keys ?? []);
  const [label, setLabel] = useState(initial?.label ?? "");
  const [kind, setKind] = useState<MerchantTargetKind>(initial?.limit_kind ?? "percent_reduction");
  const [percent, setPercent] = useState(
    initial?.limit_kind === "percent_reduction" && initial.baseline && initial.limit != null
      ? String(Math.round((1 - initial.limit / initial.baseline) * 100))
      : "30",
  );
  const [amount, setAmount] = useState(initial?.limit_kind === "amount" && initial.limit != null ? String(initial.limit).replace(".", ",") : "");
  const [error, setError] = useState<string | null>(null);

  const taken = useMemo(() => new Set(takenKeys.filter((k) => !(initial?.merchant_keys ?? []).includes(k))), [takenKeys, initial]);
  const options = useMemo(() => (merchants ?? []).filter((m) => !taken.has(m.key)), [merchants, taken]);
  const chosen = useMemo(() => options.filter((m) => selected.includes(m.key)), [options, selected]);
  const baseline = useMemo(
    () => (chosen.length ? chosen.reduce((acc, m) => acc + m.monthly_average, 0) : initial?.baseline ?? 0),
    [chosen, initial],
  );
  const autoLabel = chosen.map((m) => m.label).join(" + ");
  const limit = merchantTargetLimit(kind, { amount: parse(amount), reductionPct: parse(percent), baseline });

  function toggle(key: string) {
    setSelected((current) => (current.includes(key) ? current.filter((k) => k !== key) : [...current, key]));
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const keys = selected.length ? selected : initial?.merchant_keys ?? [];
    if (!keys.length) { setError("Escolha pelo menos um estabelecimento."); return; }
    if (kind === "percent_reduction" && !(baseline > 0)) { setError("Sem gasto recente para calcular a redução. Use um valor máximo."); return; }
    if (kind === "percent_reduction" && !(parse(percent) > 0 && parse(percent) <= 100)) { setError("Informe uma redução entre 1% e 100%."); return; }
    if (kind === "amount" && !(parse(amount) >= 0 && amount.trim())) { setError("Informe o valor máximo por mês."); return; }
    onSubmit({
      id: initial?.id,
      goal_id: goalId,
      label: (label.trim() || autoLabel || initial?.label || "Estabelecimento").slice(0, 80),
      merchant_keys: keys,
      limit_kind: kind,
      limit_amount: kind === "amount" ? parse(amount) : null,
      reduction_pct: kind === "percent_reduction" ? parse(percent) : null,
      baseline_amount: baseline > 0 ? Math.round(baseline * 100) / 100 : null,
      computed_limit: limit,
    });
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-end bg-black/40 sm:place-items-center" onClick={onClose}>
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        className="max-h-[90dvh] w-full max-w-[640px] overflow-y-auto rounded-t-[20px] border border-border bg-card p-5 shadow-card sm:rounded-[20px] sm:p-6"
        style={{ paddingBottom: "calc(1.25rem + env(safe-area-inset-bottom, 0px))" }}
      >
        <h2 className="font-display text-lg font-bold">{initial ? "Editar submeta" : "Nova submeta"}</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Dentro de {categoryName}. O gasto da submeta também conta na meta da categoria.
        </p>

        <div className="mt-4 space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium">Estabelecimentos (escolha um ou mais para agrupar)</label>
            {isLoading ? (
              <p className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Buscando no seu histórico…</p>
            ) : options.length ? (
              <div className="flex flex-wrap gap-1.5">
                {options.slice(0, 24).map((m) => {
                  const on = selected.includes(m.key);
                  return (
                    <button
                      key={m.key}
                      type="button"
                      onClick={() => toggle(m.key)}
                      aria-pressed={on}
                      className={`inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-[12px] ${on ? "border-primary bg-primary/10 text-primary" : "border-border"}`}
                    >
                      {on ? <Check size={12} /> : null}
                      {m.label}
                      <span className="text-muted-foreground">· {formatBRL(m.monthly_average)}/mês</span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Ainda não há gastos nesta categoria nos últimos 12 meses.</p>
            )}
            <p className="mt-1 text-[11px] text-muted-foreground">
              Variações do extrato (ex.: “PAY UBER”, “ON UBER TRIP”) já estão unidas no mesmo estabelecimento.
            </p>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium">Nome da submeta</label>
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={autoLabel || "Ex.: Apps de transporte"} className="input-base" style={{ fontSize: 16 }} />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium">Tipo de limite</label>
            <div className="grid grid-cols-2 gap-2">
              {KINDS.map((k) => (
                <button
                  key={k.value}
                  type="button"
                  onClick={() => setKind(k.value)}
                  className={`rounded-xl border px-3 py-2 text-left ${kind === k.value ? "border-primary bg-primary/10" : "border-border"}`}
                >
                  <span className={`block text-xs font-semibold ${kind === k.value ? "text-primary" : ""}`}>{k.label}</span>
                  <span className="block text-[11px] text-muted-foreground">{k.hint}</span>
                </button>
              ))}
            </div>
          </div>

          {kind === "percent_reduction" ? (
            <div>
              <label className="mb-1 block text-xs font-medium">Reduzir em (%)</label>
              <input inputMode="decimal" value={percent} onChange={(e) => setPercent(e.target.value)} className="input-base" style={{ fontSize: 16 }} />
            </div>
          ) : null}
          {kind === "amount" ? (
            <div>
              <label className="mb-1 block text-xs font-medium">Valor máximo por mês (R$)</label>
              <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="input-base" style={{ fontSize: 16 }} />
            </div>
          ) : null}

          <div className="rounded-[14px] border border-border bg-[color:var(--home-surface-soft,#F3F1F7)] p-3 text-[12px]">
            <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Prévia</p>
            <p className="mt-1">Referência (média dos últimos 6 meses): <strong className="tabular-nums">{formatBRL(baseline)}</strong> por mês</p>
            {kind === "track" ? (
              <p className="mt-0.5 text-muted-foreground">Sem limite: o Nino mostra quanto esse gasto pesa na categoria.</p>
            ) : kind === "zero" ? (
              <p className="mt-0.5">Meta zero. Economia de até <strong className="tabular-nums">{formatBRL(baseline * 12)}</strong> em 12 meses; qualquer cobrança nova gera aviso.</p>
            ) : limit != null ? (
              <p className="mt-0.5">
                Limite de <strong className="tabular-nums">{formatBRL(limit)}</strong> por mês
                {baseline > limit ? <> · economia de <strong className="tabular-nums">{formatBRL(baseline - limit)}</strong> por mês ({formatBRL((baseline - limit) * 12)} em 12 meses)</> : null}
              </p>
            ) : null}
          </div>
        </div>

        {error ? <p className="mt-3 text-xs text-destructive">{error}</p> : null}
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
