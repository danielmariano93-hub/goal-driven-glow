import { Link, useLocation } from "react-router-dom";
import { useEffect } from "react";
import { Home, Compass } from "lucide-react";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.warn("404:", location.pathname);
  }, [location.pathname]);

  return (
    <main className="grid min-h-dvh place-items-center bg-background px-6">
      <div className="w-full max-w-md text-center">
        <div className="mx-auto mb-6 grid h-14 w-14 place-items-center rounded-2xl bg-gradient-brand text-white shadow-brand">
          <Compass size={22} strokeWidth={2.2} aria-hidden />
        </div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          Página não encontrada
        </p>
        <h1 className="mt-2 font-display text-3xl font-bold tracking-tight text-foreground">
          Esse caminho não existe por aqui.
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Talvez o link esteja quebrado ou a página tenha sido movida. Vamos te levar de volta pra um lugar seguro.
        </p>
        <div className="mt-6 flex flex-col items-center justify-center gap-2 sm:flex-row">
          <Link to="/app" className="btn-brand inline-flex items-center gap-2">
            <Home size={14} /> Ir para o início
          </Link>
          <Link to="/" className="btn-ghost-brand inline-flex items-center gap-2">
            Voltar à landing
          </Link>
        </div>
      </div>
    </main>
  );
};

export default NotFound;
