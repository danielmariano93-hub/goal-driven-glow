import { lazy, Suspense } from "react";
import { useSearchParams } from "react-router-dom";
import { Loader2 } from "lucide-react";

const RelatoriosAtual = lazy(() => import("./Relatorios"));
const RelatoriosFechamentos = lazy(() => import("./RelatoriosInteligentes"));

const TABS = [
  { id: "atual", label: "Período atual" },
  { id: "fechamentos", label: "Fechamentos" },
];

export default function RelatoriosHub() {
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "fechamentos" ? "fechamentos" : "atual";
  const focus = params.get("foco") === "categorias" ? "categorias" : undefined;

  return (
    <div className="space-y-4">
      <nav className="mx-auto flex w-full max-w-md gap-1.5 md:max-w-2xl" aria-label="Relatórios">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setParams({ tab: t.id }, { replace: true })}
            className={`flex-1 rounded-full px-3 py-2 text-[12px] font-semibold transition ${
              tab === t.id ? "bg-primary text-primary-foreground" : "border border-border text-muted-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <Suspense
        fallback={
          <div className="grid place-items-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        }
      >
        {tab === "fechamentos" ? <RelatoriosFechamentos /> : <RelatoriosAtual focus={focus} />}
      </Suspense>
    </div>
  );
}
