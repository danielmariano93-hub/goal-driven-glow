import { Link, Navigate, useLocation } from "react-router-dom";
import { useEffect } from "react";
import { Compass, Home, LayoutGrid } from "lucide-react";
import { resolveAppRoute } from "@/lib/navigation/resolveRoute";

/**
 * Qualquer caminho /app/... sem tela: tenta o destino certo (apelidos e pai mais próximo) e, se não houver,
 * mostra um aviso dentro do app (com a navegação), sem tirar a pessoa do contexto.
 */
export default function AppRouteFallback() {
  const location = useLocation();
  const target = resolveAppRoute(`${location.pathname}${location.search}`);
  useEffect(() => {
    console.warn("[route_fallback]", location.pathname, "->", target ?? "sem destino");
  }, [location.pathname, target]);
  if (target && target !== `${location.pathname}${location.search}`) return <Navigate to={target} replace />;
  return (
    <div className="mx-auto grid max-w-md place-items-center px-2 py-16 text-center">
      <div className="mb-5 grid h-12 w-12 place-items-center rounded-2xl bg-secondary text-primary"><Compass size={20} aria-hidden /></div>
      <h1 className="font-display text-xl font-bold tracking-tight">Essa tela não existe mais</h1>
      <p className="mt-2 text-sm text-muted-foreground">O link pode ser antigo. O que você procura deve estar no início ou no menu Mais.</p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        <Link to="/app" className="btn-brand inline-flex items-center gap-2"><Home size={14} /> Ir para o início</Link>
        <Link to="/app/mais" className="btn-ghost-brand inline-flex items-center gap-2"><LayoutGrid size={14} /> Abrir o menu Mais</Link>
      </div>
    </div>
  );
}
