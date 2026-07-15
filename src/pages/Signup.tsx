import { Link } from "react-router-dom";
import { ArrowLeft, Wallet, Check } from "lucide-react";

/**
 * F0: placeholder visual apenas. F1 conecta com Supabase Auth (email/senha + Google).
 */
export default function Signup() {
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
          <p className="mt-1 text-sm text-muted-foreground">Cadastro chega junto com a conta em nuvem.</p>

          <form
            className="mt-6 space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              // F1 conecta com Supabase Auth
            }}
            noValidate
          >
            <div>
              <label htmlFor="nome" className="mb-1.5 block text-xs font-medium text-foreground">
                Seu nome
              </label>
              <input
                id="nome"
                type="text"
                autoComplete="name"
                disabled
                placeholder="Como podemos te chamar?"
                className="w-full rounded-xl border border-border bg-secondary/60 px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground disabled:cursor-not-allowed"
              />
            </div>
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
                autoComplete="new-password"
                disabled
                placeholder="Mínimo 8 caracteres"
                className="w-full rounded-xl border border-border bg-secondary/60 px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground disabled:cursor-not-allowed"
              />
            </div>

            <button type="submit" disabled className="btn-brand w-full !opacity-70 cursor-not-allowed">
              Em breve
            </button>

            <p className="text-center text-xs text-muted-foreground">
              Ao criar sua conta, você concorda com nossos termos e política de privacidade.
            </p>
          </form>

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
