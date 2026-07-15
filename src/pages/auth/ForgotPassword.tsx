import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Wallet, Loader2, CheckCircle2 } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { forgotPasswordSchema } from "@/lib/validation/auth";

export default function ForgotPassword() {
  const { requestPasswordReset } = useAuth();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = forgotPasswordSchema.safeParse({ email });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "E-mail inválido");
      return;
    }
    setLoading(true);
    const { error } = await requestPasswordReset(parsed.data.email);
    setLoading(false);
    if (error) setError(error);
    else setSent(true);
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4 md:px-8">
        <Link to="/" className="flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-2xl bg-gradient-brand text-white shadow-brand">
            <Wallet size={18} />
          </span>
          <span className="font-display text-lg font-bold tracking-tight">
            NoControle<span className="text-gradient-brand">.ia</span>
          </span>
        </Link>
        <Link
          to="/login"
          className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft size={12} /> Voltar
        </Link>
      </header>

      <main className="mx-auto max-w-md px-4 pb-16 pt-6 md:pt-12">
        <div className="rounded-3xl border border-border bg-card p-6 shadow-card md:p-8">
          <h1 className="font-display text-2xl font-bold tracking-tight">Recuperar senha</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Enviaremos um link para redefinir sua senha.
          </p>

          {sent ? (
            <div className="mt-6 rounded-xl border border-success/40 bg-success/10 p-4 text-sm">
              <div className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 h-4 w-4 text-success" />
                <div>
                  <p className="font-medium text-foreground">Verifique seu e-mail</p>
                  <p className="mt-1 text-muted-foreground">
                    Se este e-mail estiver cadastrado, você receberá o link em instantes.
                  </p>
                </div>
              </div>
            </div>
          ) : (
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
                  className="w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm"
                  placeholder="voce@email.com"
                />
              </div>
              {error && <p className="text-xs text-destructive">{error}</p>}
              <button type="submit" disabled={loading} className="btn-brand w-full">
                {loading ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : "Enviar link"}
              </button>
            </form>
          )}

          <div className="mt-6 border-t border-border pt-4 text-center text-xs text-muted-foreground">
            Lembrou a senha?{" "}
            <Link to="/login" className="font-medium text-foreground underline underline-offset-2">
              Entrar
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
