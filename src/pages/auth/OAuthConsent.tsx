import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Loader2, ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type OAuthClient = { name?: string | null; client_name?: string | null };
type AuthorizationDetails = {
  client?: OAuthClient | null;
  redirect_url?: string | null;
  redirect_to?: string | null;
};

type OAuthNamespace = {
  getAuthorizationDetails: (id: string) => Promise<{ data: AuthorizationDetails | null; error: { message: string } | null }>;
  approveAuthorization: (id: string) => Promise<{ data: AuthorizationDetails | null; error: { message: string } | null }>;
  denyAuthorization: (id: string) => Promise<{ data: AuthorizationDetails | null; error: { message: string } | null }>;
};

function oauth(): OAuthNamespace {
  return (supabase.auth as unknown as { oauth: OAuthNamespace }).oauth;
}

export default function OAuthConsent() {
  const [params] = useSearchParams();
  const authorizationId = params.get("authorization_id") ?? "";
  const [details, setDetails] = useState<AuthorizationDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      if (!authorizationId) {
        setError("Pedido de autorização inválido (identificador ausente).");
        return;
      }
      const { data: sess } = await supabase.auth.getSession();
      if (!sess.session) {
        const next = window.location.pathname + window.location.search;
        window.location.href = "/login?next=" + encodeURIComponent(next);
        return;
      }
      const { data, error: err } = await oauth().getAuthorizationDetails(authorizationId);
      if (!active) return;
      if (err) {
        setError(err.message);
        return;
      }
      const immediate = data?.redirect_url ?? data?.redirect_to;
      if (immediate && !data?.client) {
        window.location.href = immediate;
        return;
      }
      setDetails(data ?? {});
    })();
    return () => {
      active = false;
    };
  }, [authorizationId]);

  async function decide(approve: boolean) {
    setBusy(true);
    setError(null);
    const { data, error: err } = approve
      ? await oauth().approveAuthorization(authorizationId)
      : await oauth().denyAuthorization(authorizationId);
    if (err) {
      setBusy(false);
      setError(err.message);
      return;
    }
    const target = data?.redirect_url ?? data?.redirect_to;
    if (!target) {
      setBusy(false);
      setError("O servidor de autorização não devolveu um destino de retorno.");
      return;
    }
    window.location.href = target;
  }

  const clientName = details?.client?.name ?? details?.client?.client_name ?? "este aplicativo";

  return (
    <main className="grid min-h-screen place-items-center bg-background px-4">
      <div className="w-full max-w-md rounded-3xl border border-border bg-card p-6 shadow-card">
        <span className="grid h-11 w-11 place-items-center rounded-2xl bg-primary/10 text-primary">
          <ShieldCheck size={20} />
        </span>

        {error ? (
          <>
            <h1 className="mt-4 font-display text-xl font-bold tracking-tight">
              Não foi possível concluir a conexão
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">{error}</p>
            <p className="mt-4 text-xs text-muted-foreground">
              Tente iniciar a conexão novamente pelo aplicativo que fez o pedido.
            </p>
          </>
        ) : !details ? (
          <>
            <h1 className="mt-4 font-display text-xl font-bold tracking-tight">
              Verificando o pedido…
            </h1>
            <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="animate-spin" size={14} /> Só um instante.
            </p>
          </>
        ) : (
          <>
            <h1 className="mt-4 font-display text-xl font-bold tracking-tight">
              Conectar {clientName} à sua conta
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Ao aprovar, {clientName} poderá consultar seus lançamentos, resumo do mês,
              contas, categorias, cartões, dívidas e metas — e registrar novos lançamentos —
              agindo como você no Meu Nino.
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              Você pode desconectar quando quiser no aplicativo que fez o pedido.
            </p>
            <div className="mt-6 flex gap-3">
              <button
                type="button"
                disabled={busy}
                onClick={() => decide(true)}
                className="flex-1 rounded-2xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-60"
              >
                {busy ? "Processando…" : "Aprovar"}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => decide(false)}
                className="flex-1 rounded-2xl border border-border bg-card px-4 py-3 text-sm font-semibold disabled:opacity-60"
              >
                Recusar
              </button>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
