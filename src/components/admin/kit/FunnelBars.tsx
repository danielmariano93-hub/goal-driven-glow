/**
 * Funil de verdade: barras horizontais proporcionais, com a queda percentual
 * entre etapas. Usuários são a medida principal; eventos ficam como detalhe.
 */
export type FunnelStep = {
  label: string;
  users: number;
  events?: number;
};

export function FunnelBars({
  steps,
  title,
  caption,
  unit = ["cliente", "clientes"],
  eventNoun = "ações",
}: {
  steps: FunnelStep[];
  title?: string;
  caption?: string;
  /** Singular e plural da unidade contada em cada etapa. */
  unit?: [string, string];
  eventNoun?: string;
}) {
  const top = Math.max(...steps.map((s) => s.users), 1);

  return (
    <div className="space-y-2">
      {title && <p className="text-sm font-semibold text-foreground">{title}</p>}
      <ol className="space-y-2">
        {steps.map((step, index) => {
          const previous = index > 0 ? steps[index - 1].users : null;
          const drop =
            previous && previous > 0 ? Math.round(((previous - step.users) / previous) * 100) : null;
          const width = Math.max((step.users / top) * 100, step.users > 0 ? 6 : 2);
          return (
            <li key={`${step.label}-${index}`}>
              <div className="flex items-baseline justify-between gap-3 text-xs">
                <span className="truncate font-medium text-foreground">{step.label}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {step.users} {step.users === 1 ? unit[0] : unit[1]}
                  {step.events != null ? ` · ${step.events} ${eventNoun}` : ""}
                </span>
              </div>
              <div className="mt-1 h-2.5 w-full overflow-hidden rounded-full bg-secondary">
                <div
                  className="h-full rounded-full bg-primary/80"
                  style={{ width: `${width}%` }}
                  aria-hidden
                />
              </div>
              {drop != null && drop > 0 && (
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  queda de {drop}% em relação à etapa anterior
                </p>
              )}
            </li>
          );
        })}
      </ol>
      {caption && <p className="text-[11px] text-muted-foreground">{caption}</p>}
    </div>
  );
}
