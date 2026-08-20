import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Destino dos links curtos (`/s/:token`). Resolve o caminho interno no backend
 * (com auditoria de clique) e redireciona. Se o link não existir ou expirou,
 * explica em português e leva o usuário para o app.
 */
export default function ShortLink() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!token) { setError("Link inválido."); return; }
      const { data, error: rpcError } = await supabase.rpc("resolve_short_link", { _token: token });
      if (cancelled) return;
      const payload = (data ?? {}) as { ok?: boolean; path?: string; error?: string };
      if (rpcError || !payload.ok || !payload.path) {
        setError(payload.error === "expired"
          ? "Esse link já expirou. Abra o app para ver a informação atualizada."
          : "Não encontrei esse link. Abra o app para continuar.");
        return;
      }
      navigate(payload.path, { replace: true });
    })();
    return () => { cancelled = true; };
  }, [token, navigate]);

  if (error) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
        <h1 className="text-lg font-semibold">Link indisponível</h1>
        <p className="text-sm text-muted-foreground">{error}</p>
        <button
          type="button"
          onClick={() => navigate("/app", { replace: true })}
          className="rounded-full bg-gradient-brand px-5 py-2.5 text-sm font-semibold text-primary-foreground"
        >
          Abrir o Meu Nino
        </button>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="animate-spin" size={16} />Abrindo…
    </main>
  );
}
