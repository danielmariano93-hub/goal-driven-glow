import { useSearchParams } from "react-router-dom";

export type AdminTab = {
  id: string;
  label: string;
  render: () => JSX.Element;
  /** Contador ou selo curto exibido ao lado do rótulo (ex.: falhas na fila). */
  badge?: number | string | null;
  /** Tom do selo: neutro, atenção ou problema. */
  badgeTone?: "neutral" | "warning" | "danger";
};

const BADGE_TONE: Record<NonNullable<AdminTab["badgeTone"]>, string> = {
  neutral: "bg-secondary text-muted-foreground",
  warning: "bg-warning/20 text-foreground",
  danger: "bg-destructive/15 text-destructive",
};

/**
 * Único nível de abas do admin. A aba ativa vive na URL para permitir
 * link direto e volta do navegador.
 */
export function AdminTabs({ tabs, param = "aba" }: { tabs: AdminTab[]; param?: string }) {
  const [params, setParams] = useSearchParams();
  const current = params.get(param) ?? tabs[0]?.id;
  const active = tabs.find((t) => t.id === current) ?? tabs[0];

  return (
    <div className="space-y-5">
      <div
        role="tablist"
        aria-label="Seções"
        className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 md:flex-wrap md:overflow-visible"
      >
        {tabs.map((t) => {
          const isActive = t.id === active?.id;
          const hasBadge = t.badge !== null && t.badge !== undefined && t.badge !== 0 && t.badge !== "";
          return (
            <button
              key={t.id}
              role="tab"
              aria-selected={isActive}
              onClick={() => {
                const next = new URLSearchParams(params);
                next.set(param, t.id);
                setParams(next, { replace: true });
              }}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-4 py-2 text-xs font-semibold transition-colors ${
                isActive
                  ? "border-transparent bg-gradient-brand text-primary-foreground shadow-brand"
                  : "border-border bg-card text-muted-foreground hover:bg-secondary hover:text-foreground"
              }`}
            >
              <span className="whitespace-nowrap">{t.label}</span>
              {hasBadge && (
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums ${
                    isActive ? "bg-background/25 text-primary-foreground" : BADGE_TONE[t.badgeTone ?? "neutral"]
                  }`}
                >
                  {t.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {active?.render()}
    </div>
  );
}
