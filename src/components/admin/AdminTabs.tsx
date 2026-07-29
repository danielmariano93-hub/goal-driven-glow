import { useSearchParams } from "react-router-dom";

export type AdminTab = { id: string; label: string; render: () => JSX.Element };

/**
 * Agrupa telas correlatas em abas internas, reduzindo o número de itens
 * no menu lateral sem esconder conteúdo. A aba ativa vive na URL (?aba=).
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
        className="inline-flex flex-wrap gap-1 rounded-full border border-border bg-card p-1"
      >
        {tabs.map((t) => {
          const isActive = t.id === active?.id;
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
              className={`rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors ${
                isActive
                  ? "bg-gradient-brand text-white shadow-brand"
                  : "text-muted-foreground hover:bg-secondary hover:text-foreground"
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {active?.render()}
    </div>
  );
}
