import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, Wallet, Check, Loader2, MailCheck } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { signupSchema } from "@/lib/validation/auth";

export default function Signup() {
  const { signUp } = useAuth();
  const navigate = useNavigate();

  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [needsConfirm, setNeedsConfirm] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = signupSchema.safeParse({ displayName, email, password });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Dados inválidos");
      return;
    }
    setLoading(true);
    const { error, needsEmailConfirmation } = await signUp(
      parsed.data.email,
      parsed.data.password,
      parsed.data.displayName
    );
    setLoading(false);
    if (error) {
      setError(error);
      return;
    }
    if (needsEmailConfirmation) {
      setNeedsConfirm(true);
    } else {
      navigate("/onboarding", { replace: true });
    }
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
          to="/"
          className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft size={12} /> Voltar
        </Link>
      </header>

      <main className="mx-auto grid max-w-5xl gap-10 px-4 pb-16 pt-4 md:grid-cols-2 md:gap-16 md:px-8 md:pt-10">
        <div className="hidden flex-col justify-center md:flex">
          <h1 className="font-display text-4xl font-bold leading-[1.05] tracking-tight text-balance">
            Comece com o que você já tem: <span className="text-gradient-brand">uma conversa</span>.
          </h1>
          <p className="mt-4 max-w-md text-base leading-relaxed text-muted-foreground">
            Sem cartão de crédito, sem planilha. Sua primeira meta pode virar realidade a partir de hoje.
          </p>
          <ul className="mt-6 space-y-2 text-sm text-foreground">
            <li className="flex items-center gap-2">
              <Check size={16} className="text-success" /> Grátis para começar
            </li>
            <li className="flex items-center gap-2">
              <Check size={16} className="text-success" /> Sem depender de planilhas
            </li>
            <li className="flex items-center gap-2">
              <Check size={16} className="text-success" /> Você decide o que registrar
            </li>
          </ul>
        </div>

        <div className="mx-auto w-full max-w-md rounded-3xl border border-border bg-card p-6 shadow-card md:p-8">
          <h2 className="font-display text-2xl font-bold tracking-tight">Criar conta</h2>
          <p className="mt-1 text-sm text-muted-foreground">É rápido — leva menos de um minuto.</p>

          {needsConfirm ? (
            <div className="mt-6 rounded-xl border border-success/40 bg-success/10 p-4 text-sm">
              <div className="flex items-start gap-2">
                <MailCheck className="mt-0.5 h-4 w-4 text-success" />
                <div>
                  <p className="font-medium text-foreground">Confirme seu e-mail</p>
                  <p className="mt-1 text-muted-foreground">
                    Enviamos um link para <strong>{email}</strong>. Depois de confirmar, você poderá entrar.
                  </p>
                </div>
              </div>
              <Link
                to="/login"
                className="mt-4 inline-block text-xs font-medium text-foreground underline underline-offset-2"
              >
                Ir para o login
              </Link>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
              <div>
                <label htmlFor="nome" className="mb-1.5 block text-xs font-medium">
                  Seu nome
                </label>
                <input
                  id="nome"
                  type="text"
                  autoComplete="name"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Como podemos te chamar?"
                  className="w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm"
                />
              </div>
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
                <label htmlFor="senha" className="mb-1.5 block text-xs font-medium">
                  Senha
                </label>
                <input
                  id="senha"
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Mínimo 8 caracteres, com letra e número"
                  className="w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm"
                />
              </div>

              {error && <p className="text-xs text-destructive">{error}</p>}

              <button type="submit" disabled={loading} className="btn-brand w-full">
                {loading ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : "Criar conta"}
              </button>

              <p className="text-center text-xs text-muted-foreground">
                Ao criar sua conta, você concorda com nossos termos e política de privacidade.
              </p>
            </form>
          )}

          <div className="mt-6 border-t border-border pt-4 text-center text-xs text-muted-foreground">
            Já tem uma conta?{" "}
            <Link to="/login" className="font-medium text-foreground underline underline-offset-2 hover:text-accent">
              Entrar
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
