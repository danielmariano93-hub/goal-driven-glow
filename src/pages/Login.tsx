import { Link } from "react-router-dom";
import { ArrowLeft, Wallet, Sparkles } from "lucide-react";

/**
 * F0: placeholder visual apenas. Sem autenticação real —
 * F1 conecta Lovable Cloud e transforma este formulário em auth verdadeiro.
 */
export default function Login() {
  return (
    <div className="min-h-screen bg-background">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4 md:px-8">
        <Link to="/" className="flex items-center gap-2.5" aria-label="Voltar à página inicial">
          <span className="grid h-9 w-9 place-items-center rounded-2xl bg-gradient-brand text-white shadow-brand">
            <Wallet size={18} />
          </span>
          <span className="font-display text-lg font-bold tracking-tight">
            NoControle<span className="text-gradient-brand">.ia</span>
          </span>
        </Link>
        <Link
          to="/"
          className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
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
            Autenticação disponível em breve.
          </p>

          <form
            className="mt-6 space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              // F1 conecta com Supabase Auth
            }}
            noValidate
          >
            <div>
              <label htmlFor="email" className="mb-1.5 block text-xs font-medium text-foreground">
                E-mail
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                disabled
                placeholder="voce@email.com"
                className="w-full rounded-xl border border-border bg-secondary/60 px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground disabled:cursor-not-allowed"
              />
            </div>
            <div>
              <label htmlFor="senha" className="mb-1.5 block text-xs font-medium text-foreground">
                Senha
              </label>
              <input
                id="senha"
                type="password"
                autoComplete="current-password"
                disabled
                placeholder="••••••••"
                className="w-full rounded-xl border border-border bg-secondary/60 px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground disabled:cursor-not-allowed"
              />
            </div>

            <button type="submit" disabled className="btn-brand w-full !opacity-70 cursor-not-allowed">
              Em breve
            </button>

            <p className="text-center text-xs text-muted-foreground">
              O login com senha e Google chega junto com a conta em nuvem, na próxima fase.
            </p>
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
