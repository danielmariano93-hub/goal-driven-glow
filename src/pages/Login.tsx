import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, Wallet, Sparkles, Loader2 } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { loginSchema } from "@/lib/validation/auth";
import { LOGOUT_REASON_KEY } from "@/hooks/useSessionInactivity";

export default function Login() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const nextParam = params.get("next");
  const reasonParam = params.get("reason");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [inactivityNotice, setInactivityNotice] = useState<string | null>(null);

  useEffect(() => {
    let reason: string | null = reasonParam;
    if (!reason) {
      try { reason = sessionStorage.getItem(LOGOUT_REASON_KEY); } catch { /* noop */ }
    }
    if (reason === "inactivity") {
      setInactivityNotice(
        "Sua sessão expirou por inatividade. Entre novamente para continuar.",
      );
      try { sessionStorage.removeItem(LOGOUT_REASON_KEY); } catch { /* noop */ }
    }
  }, [reasonParam]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = loginSchema.safeParse({ email, password });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Dados inválidos");
      return;
    }
    setLoading(true);
    const { error } = await signIn(parsed.data.email, parsed.data.password);
    if (error) {
      setLoading(false);
      setError(error);
      return;
    }
    // Decidir destino: platform admin → /admin; caso contrário /app ou next.
    try {
      const { data: role } = await supabase.rpc("current_platform_admin_role");
      if (role) {
        navigate("/admin", { replace: true });
        return;
      }
    } catch {}
    const target = nextParam && nextParam.startsWith("/") ? nextParam : "/app";
    navigate(target, { replace: true });
  }


  return (
    <div className="min-h-screen bg-background">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4 md:px-8">
        <Link to="/" className="flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-2xl bg-gradient-brand text-white shadow-brand">
            <Wallet size={18} />
          </span>
          <span className="font-display text-lg font-bold tracking-tight">
            MeuNino
          </span>
        </Link>
        <Link
          to="/"
          className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft size={12} /> Voltar
        </Link>
      </header>

      <main className="mx-auto grid max-w-5xl gap-10 px-4 pb-16 pt-4 md:grid-cols-2 md:gap-16 md:px-8 md:pt-10">
        <div className="hidden flex-col justify-center md:flex">
          <span className="mb-4 inline-flex w-fit items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground">
            <Sparkles size={12} className="text-brand-coral" /> Bem-vindo de volta
          </span>
          <h1 className="font-display text-4xl font-bold leading-[1.05] tracking-tight text-balance">
            Suas finanças, do jeito que você deixou.
          </h1>
          <p className="mt-4 max-w-md text-base leading-relaxed text-muted-foreground">
            Entre com sua conta para ver seus indicadores, metas e conversas com o assistente.
          </p>
        </div>

        <div className="mx-auto w-full max-w-md rounded-3xl border border-border bg-card p-6 shadow-card md:p-8">
          <h2 className="font-display text-2xl font-bold tracking-tight">Entrar</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Use seu e-mail e senha.
          </p>

          <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
            <div>
              <label htmlFor="email" className="mb-1.5 block text-xs font-medium">
                E-mail
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="voce@email.com"
                className="w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm"
              />
            </div>
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <label htmlFor="senha" className="block text-xs font-medium">
                  Senha
                </label>
                <Link
                  to="/forgot-password"
                  className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                >
                  Esqueci minha senha
                </Link>
              </div>
              <input
                id="senha"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm"
              />
            </div>

            {error && <p className="text-xs text-destructive">{error}</p>}

            <button type="submit" disabled={loading} className="btn-brand w-full">
              {loading ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : "Entrar"}
            </button>
          </form>

          <div className="mt-6 border-t border-border pt-4 text-center text-xs text-muted-foreground">
            Ainda não tem conta?{" "}
            <Link to="/signup" className="font-medium text-foreground underline underline-offset-2 hover:text-accent">
              Criar conta
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
