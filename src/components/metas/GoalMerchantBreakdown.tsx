import { Pause, Pencil, Play, Plus, Trash2 } from "lucide-react";
import { formatBRL } from "@/lib/engine/facts";
import type { MerchantTargetEvaluation, MerchantTargetStatus } from "@/lib/engine/spendingGoals";
import type { GoalReading } from "@/lib/nino/spendingGoals";

const TARGET_STYLE: Record<MerchantTargetStatus, { label: string; pill: string; bar: string }> = {
  on_track: { label: "Dentro da meta", pill: "text-emerald-700 bg-emerald-500/15", bar: "bg-emerald-500" },
  attention: { label: "Atenção", pill: "text-amber-700 bg-amber-500/15", bar: "bg-amber-500" },
  at_risk: { label: "Em risco", pill: "text-red-700 bg-red-500/15", bar: "bg-red-500" },
  exceeded: { label: "Acima", pill: "text-red-700 bg-red-500/15", bar: "bg-red-500" },
  zero_violated: { label: "Cobrança indevida", pill: "text-red-700 bg-red-500/15", bar: "bg-red-500" },
  monitoring: { label: "Monitorando", pill: "text-slate-700 bg-slate-500/10", bar: "bg-slate-400" },
  completed_ok: { label: "Cumprida", pill: "text-emerald-700 bg-emerald-500/15", bar: "bg-emerald-500" },
  completed_over: { label: "Fechou acima", pill: "text-red-700 bg-red-500/15", bar: "bg-red-500" },
  paused: { label: "Pausada", pill: "text-slate-700 bg-slate-500/10", bar: "bg-slate-400" },
};

const pct = (ratio: number) => `${Math.round(ratio * 100)}%`;

function situation(reading: GoalReading): { label: string; tone: string } {
  if (reading.current_overage > 0) return { label: "Acima do limite", tone: "text-red-600" };
  if (reading.projected_overage > 0) return { label: "Atenção", tone: "text-amber-600" };
  return { label: "Sob controle", tone: "text-emerald-600" };
}

function limitText(t: MerchantTargetEvaluation): string {
  if (t.limit_kind === "track") return "Sem limite";
  if (t.limit_kind === "zero") return "Zero";
  return formatBRL(t.limit ?? 0);
}

type Props = {
  reading: GoalReading;
  onAdd: () => void;
  onEdit: (target: MerchantTargetEvaluation) => void;
  onToggle: (target: MerchantTargetEvaluation) => void;
  onDelete: (target: MerchantTargetEvaluation) => void;
};

/** Visão da categoria (executiva) + detalhamento por estabelecimento (a causa). */
export function GoalMerchantBreakdown({ reading, onAdd, onEdit, onToggle, onDelete }: Props) {
  const b = reading.breakdown;
  const sit = situation(reading);
  const projectedOver = reading.projected > reading.limit;

  return (
    <section className="mt-5 rounded-2xl border border-border bg-card p-4" aria-label="Detalhamento por estabelecimento">
      <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-[12px] sm:grid-cols-4">
        <div>
          <p className="text-muted-foreground">Consumido</p>
          <p className="text-[15px] font-bold tabular-nums">{pct(b.consumed_share)} da meta</p>
        </div>
        <div>
          <p className="text-muted-foreground">Período transcorrido</p>
          <p className="text-[15px] font-bold tabular-nums">{pct(b.elapsed_share)}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Projeção</p>
          <p className={`text-[15px] font-bold tabular-nums ${projectedOver ? "text-red-600" : ""}`}>{formatBRL(reading.projected)}</p>
          <p className="text-[11px] text-muted-foreground">{projectedOver ? "fechamento acima do limite" : "fechamento dentro do limite"}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Situação</p>
          <p className={`text-[15px] font-bold ${sit.tone}`}>{sit.label}</p>
        </div>
      </div>

      {b.main_driver && (reading.projected_overage > 0 || reading.current_overage > 0) ? (
        <p className="mt-3 rounded-xl bg-amber-500/10 px-3 py-2 text-[12px] text-foreground">
          O principal responsável é <strong>{b.main_driver.label}</strong> ({formatBRL(b.main_driver.amount)}, {pct(b.main_driver.share)} da categoria)
          {b.main_driver.reason === "over_target" ? ", acima do limite da submeta." : "."}
        </p>
      ) : null}

      <div className="mt-4 flex items-center justify-between">
        <p className="text-sm font-semibold">Por estabelecimento</p>
        <button type="button" onClick={onAdd} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium">
          <Plus size={12} /> Submeta
        </button>
      </div>
      <p className="mt-0.5 text-[11px] text-muted-foreground">Tudo o que é gasto numa submeta também conta na meta de {reading.category_name}.</p>

      <ul className="mt-3 divide-y divide-border">
        {b.targets.map((t) => {
          const style = TARGET_STYLE[t.status];
          const barPct = t.limit && t.limit > 0 ? Math.min(1, t.actual / t.limit) : t.limit === 0 && t.actual > 0 ? 1 : 0;
          return (
            <li key={t.id} className="py-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-[14px] font-semibold">{t.label}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {t.limit_kind === "percent_reduction" && t.baseline ? `Reduzir para ${limitText(t)} (antes ~${formatBRL(t.baseline)})` : `Meta: ${limitText(t)}`}
                  </p>
                </div>
                <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${style.pill}`}>{style.label}</span>
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2 text-[12px]">
                <div><p className="text-muted-foreground">Consumo</p><p className="font-semibold tabular-nums">{formatBRL(t.actual)}</p></div>
                <div><p className="text-muted-foreground">Projeção</p><p className={`font-semibold tabular-nums ${t.projected_overage > 0 ? "text-red-600" : ""}`}>{formatBRL(t.projected)}</p></div>
                <div><p className="text-muted-foreground">Da categoria</p><p className="font-semibold tabular-nums">{pct(t.share_of_category)}</p></div>
              </div>
              {t.limit != null ? (
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-secondary">
                  <div className={`h-full ${style.bar}`} style={{ width: `${Math.round(barPct * 100)}%` }} />
                </div>
              ) : null}
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                {t.remaining != null && t.remaining > 0 && t.limit !== 0 ? `Saldo ${formatBRL(t.remaining)} · ` : ""}
                {t.savings != null ? (t.savings >= 0 ? `Economia de ${formatBRL(t.savings)} frente à referência` : `${formatBRL(-t.savings)} acima da referência`) : t.message}
              </p>
              {t.status === "zero_violated" || t.status === "at_risk" || t.status === "exceeded" ? (
                <p className="mt-1 text-[11px] font-medium text-red-600">{t.message}</p>
              ) : null}
              <div className="mt-2 flex gap-2">
                <button type="button" onClick={() => onEdit(t)} className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-[11px]"><Pencil size={11} /> Editar</button>
                <button type="button" onClick={() => onToggle(t)} className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-[11px]">
                  {t.status === "paused" ? <><Play size={11} /> Reativar</> : <><Pause size={11} /> Pausar</>}
                </button>
                <button type="button" onClick={() => onDelete(t)} className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-[11px] text-destructive"><Trash2 size={11} /> Excluir</button>
              </div>
            </li>
          );
        })}

        <li className="py-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[14px] font-semibold">Outros</p>
              <p className="text-[11px] text-muted-foreground">
                {b.others.top.length ? b.others.top.map((o) => o.label).join(", ") : "Nenhum gasto fora das submetas"}
              </p>
            </div>
            <span className="shrink-0 rounded-full bg-slate-500/10 px-2.5 py-1 text-[11px] font-semibold text-slate-700">
              {b.targets.length ? "Sem submeta" : "Monitoramento"}
            </span>
          </div>
          <div className="mt-2 grid grid-cols-3 gap-2 text-[12px]">
            <div><p className="text-muted-foreground">Consumo</p><p className="font-semibold tabular-nums">{formatBRL(b.others.actual)}</p></div>
            <div><p className="text-muted-foreground">Disponível</p><p className="font-semibold tabular-nums">{b.others.budget != null ? formatBRL(b.others.budget) : "—"}</p></div>
            <div><p className="text-muted-foreground">Da categoria</p><p className="font-semibold tabular-nums">{pct(b.others.share)}</p></div>
          </div>
        </li>
      </ul>

      {!b.targets.length && b.contributors.length ? (
        <div className="mt-2 rounded-xl border border-dashed border-border p-3">
          <p className="text-[12px] font-medium">Quem mais pesou neste período</p>
          <ul className="mt-1 space-y-0.5 text-[12px] text-muted-foreground">
            {b.contributors.slice(0, 4).map((c) => (
              <li key={c.key} className="flex justify-between gap-2"><span className="truncate">{c.label}</span><span className="tabular-nums">{formatBRL(c.amount)} · {pct(c.share)}</span></li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] text-muted-foreground">Crie uma submeta para limitar, reduzir ou zerar um desses estabelecimentos.</p>
        </div>
      ) : null}
    </section>
  );
}
