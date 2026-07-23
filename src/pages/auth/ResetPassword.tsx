import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Wallet, Loader2, CheckCircle2 } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { resetPasswordSchema } from "@/lib/validation/auth";

export default function ResetPassword() {
  const { updatePassword } = useAuth();
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [invalidLink, setInvalidLink] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    // Supabase places the recovery session in the URL hash on click.
    const hash = window.location.hash;
    const isRecovery = hash.includes("type=recovery");

    supabase.auth.getSession().then(({ data }) => {
      if (data.session || isRecovery) {
        setReady(true);
      } else {
        setInvalidLink(true);
        setReady(true);
      }
    });
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = resetPasswordSchema.safeParse({ password, confirm });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Senha inválida");
      return;
    }
    setLoading(true);
    const { error } = await updatePassword(parsed.data.password);
    setLoading(false);
    if (error) {
      setError(error);
      return;
    }
    setDone(true);
    await supabase.auth.signOut();
    setTimeout(() => navigate("/login", { replace: true }), 1600);
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
      </header>

      <main className="mx-auto max-w-md px-4 pb-16 pt-6 md:pt-12">
        <div className="rounded-3xl border border-border bg-card p-6 shadow-card md:p-8">
          <h1 className="font-display text-2xl font-bold tracking-tight">Nova senha</h1>
          <p className="mt-1 text-sm text-muted-foreground">Escolha uma senha forte.</p>

          {!ready ? (
            <div className="mt-8 grid place-items-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : invalidLink ? (
            <div className="mt-6 rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm">
              <p className="font-medium text-foreground">Link inválido ou expirado</p>
              <p className="mt-1 text-muted-foreground">
                Solicite um novo link em "Esqueci minha senha".
              </p>
              <Link
                to="/forgot-password"
                className="mt-3 inline-block text-xs font-medium text-foreground underline underline-offset-2"
              >
                Pedir novo link
              </Link>
            </div>
          ) : done ? (
            <div className="mt-6 rounded-xl border border-success/40 bg-success/10 p-4 text-sm">
              <div className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 h-4 w-4 text-success" />
                <p className="text-foreground">Senha atualizada. Redirecionando para o login…</p>
              </div>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
              <div>
                <label htmlFor="password" className="mb-1.5 block text-xs font-medium">
                  Nova senha
                </label>
                <input
                  id="password"
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm"
                />
              </div>
              <div>
                <label htmlFor="confirm" className="mb-1.5 block text-xs font-medium">
                  Confirmar senha
                </label>
                <input
                  id="confirm"
                  type="password"
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  className="w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm"
                />
              </div>
              {error && <p className="text-xs text-destructive">{error}</p>}
              <button type="submit" disabled={loading} className="btn-brand w-full">
                {loading ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : "Salvar nova senha"}
              </button>
            </form>
          )}
        </div>
      </main>
    </div>
  );
}
