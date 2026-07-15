import { Link } from "react-router-dom";
import {
  MessageCircle,
  ShieldCheck,
  Sparkles,
  Target,
  Wallet,
  ArrowRight,
  Check,
  BrainCircuit,
  LineChart,
} from "lucide-react";

/**
 * Landing page pública do NoControle.ia.
 * F0: apenas apresentação da marca e da promessa. Login/Signup são placeholders
 * (F1 conecta Lovable Cloud, F5 conecta WhatsApp de verdade).
 */
export default function Landing() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* NAV */}
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3.5 md:px-8">
          <Link to="/" className="flex items-center gap-2.5" aria-label="NoControle.ia">
            <span className="grid h-9 w-9 place-items-center rounded-2xl bg-gradient-brand text-white shadow-brand">
              <Wallet size={18} strokeWidth={2.4} />
            </span>
            <span className="font-display text-lg font-bold tracking-tight">
              NoControle<span className="text-gradient-brand">.ia</span>
            </span>
          </Link>

          <nav className="hidden items-center gap-8 md:flex" aria-label="Principal">
            <a href="#produto" className="text-sm text-muted-foreground transition-colors hover:text-foreground">
              Produto
            </a>
            <a href="#como-funciona" className="text-sm text-muted-foreground transition-colors hover:text-foreground">
              Como funciona
            </a>
            <a href="#perguntas" className="text-sm text-muted-foreground transition-colors hover:text-foreground">
              Perguntas
            </a>
          </nav>

          <div className="flex items-center gap-2">
            <Link
              to="/login"
              className="hidden text-sm font-medium text-foreground/80 transition-colors hover:text-foreground md:inline-flex md:px-3 md:py-2"
            >
              Entrar
            </Link>
            <Link to="/signup" className="btn-brand !py-2 !px-4 text-sm">
              Começar grátis
            </Link>
          </div>
        </div>
      </header>

      {/* HERO */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 -z-10 grid-pattern opacity-40" aria-hidden />
        <div
          className="absolute -top-40 left-1/2 -z-10 h-[520px] w-[520px] -translate-x-1/2 rounded-full opacity-30 blur-3xl"
          style={{ background: "var(--gradient-brand)" }}
          aria-hidden
        />

        <div className="mx-auto grid max-w-6xl gap-14 px-4 pb-16 pt-14 md:grid-cols-2 md:gap-10 md:px-8 md:pb-24 md:pt-24">
          {/* Copy */}
          <div className="flex flex-col justify-center">
            <span className="mb-5 inline-flex w-fit items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-brand-coral" aria-hidden />
              Novo — controle financeiro conversacional
            </span>

            <h1 className="font-display text-4xl font-bold leading-[1.05] tracking-tight text-balance md:text-5xl lg:text-6xl">
              Seu controle financeiro começa com uma{" "}
              <span className="text-gradient-brand">conversa</span>.
            </h1>

            <p className="mt-5 max-w-xl text-base leading-relaxed text-muted-foreground md:text-lg">
              Registre gastos, acompanhe metas e entenda seus hábitos direto pelo WhatsApp.
              O NoControle.ia organiza sua vida financeira sem planilhas, sem julgamento e sem promessas mágicas.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link to="/signup" className="btn-brand">
                Criar minha conta grátis
                <ArrowRight size={16} />
              </Link>
              <a href="#como-funciona" className="btn-ghost-brand">
                Ver como funciona
              </a>
            </div>

            <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-xs text-muted-foreground">
              <li className="flex items-center gap-2">
                <Check size={14} className="text-success" /> 100% em português
              </li>
              <li className="flex items-center gap-2">
                <Check size={14} className="text-success" /> Sem cartão de crédito
              </li>
              <li className="flex items-center gap-2">
                <Check size={14} className="text-success" /> Dados protegidos com LGPD
              </li>
            </ul>
          </div>

          {/* Chat mockup */}
          <div className="relative">
            <div className="absolute -inset-6 -z-10 rounded-[3rem] bg-gradient-brand-soft blur-2xl" aria-hidden />
            <div className="relative mx-auto max-w-md rounded-[2rem] border border-border bg-card p-4 shadow-lg">
              <div className="mb-3 flex items-center gap-2 border-b border-border pb-3">
                <span className="grid h-9 w-9 place-items-center rounded-full bg-gradient-brand text-white">
                  <MessageCircle size={16} />
                </span>
                <div>
                  <p className="text-sm font-semibold">NoControle.ia</p>
                  <p className="text-[11px] text-muted-foreground">Assistente financeira · online</p>
                </div>
              </div>

              <div className="space-y-2.5 py-2 text-sm">
                <ChatBubble side="right">Gastei R$80 no bar ontem no Nubank</ChatBubble>
                <ChatBubble side="left" muted>
                  Anotado. R$80 em <b className="text-foreground">Lazer</b>, ontem, no cartão Nubank. Confirma?
                </ChatBubble>
                <ChatBubble side="right">Confirmo</ChatBubble>
                <ChatBubble side="left" muted>
                  Pronto. Você já registrou <b className="text-foreground">R$1.240</b> em Lazer este mês —
                  cerca de <b className="text-foreground">12%</b> da sua renda. Ainda dentro do seu limite. 🙂
                </ChatBubble>
              </div>

              <div className="mt-3 flex items-center gap-2 rounded-2xl bg-secondary px-3 py-2.5">
                <MessageCircle size={14} className="text-muted-foreground" aria-hidden />
                <span className="flex-1 text-xs text-muted-foreground">Diga o que aconteceu…</span>
                <span className="grid h-7 w-7 place-items-center rounded-full bg-gradient-brand text-white">
                  <ArrowRight size={12} />
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* VALUE */}
      <section id="produto" className="border-y border-border/60 bg-card/40 py-16 md:py-24">
        <div className="mx-auto max-w-6xl px-4 md:px-8">
          <div className="mb-12 max-w-2xl">
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Por que NoControle.ia
            </p>
            <h2 className="font-display text-3xl font-bold tracking-tight md:text-4xl">
              Menos planilha, mais decisão.
            </h2>
            <p className="mt-3 text-base text-muted-foreground">
              Três coisas que fazemos diferente para você realmente sair do modo automático com o dinheiro.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <FeatureCard
              icon={MessageCircle}
              title="Registre pelo WhatsApp"
              desc="Fale como você falaria com um amigo. A gente entende, categoriza e confirma antes de salvar."
            />
            <FeatureCard
              icon={Target}
              title="Metas que fazem sentido"
              desc="Reserva, viagem, saída de dívida. Aportes recorrentes e projeções realistas — sem promessas milagrosas."
            />
            <FeatureCard
              icon={BrainCircuit}
              title="Antes de gastar"
              desc="Simule uma compra e veja o impacto real no seu saldo, nas suas metas e no seu bolso, antes de decidir."
            />
          </div>
        </div>
      </section>

      {/* HOW */}
      <section id="como-funciona" className="py-16 md:py-24">
        <div className="mx-auto max-w-6xl px-4 md:px-8">
          <div className="mb-12 max-w-2xl">
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Como funciona
            </p>
            <h2 className="font-display text-3xl font-bold tracking-tight md:text-4xl">
              Em três passos, você recupera o controle.
            </h2>
          </div>

          <ol className="grid gap-4 md:grid-cols-3">
            <StepCard
              step="01"
              title="Crie sua conta"
              desc="Cadastro rápido e gratuito. Configura sua renda, metas iniciais e pronto — o painel aparece com tudo que importa."
            />
            <StepCard
              step="02"
              title="Conecte o WhatsApp"
              desc="Um número oficial, uma vinculação segura. Depois é só escrever: 'Gastei R$40 no mercado'."
            />
            <StepCard
              step="03"
              title="Deixe o app pensar"
              desc="Indicadores, alertas e projeções atualizam sozinhos. Você foca nas decisões — não na digitação."
            />
          </ol>

          <div className="mt-12 grid gap-4 rounded-3xl border border-border bg-card p-6 md:grid-cols-3 md:p-8">
            <div className="flex items-start gap-3">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-secondary text-primary">
                <ShieldCheck size={18} />
              </span>
              <div>
                <p className="text-sm font-semibold">Seus dados, seus</p>
                <p className="text-xs text-muted-foreground">Criptografia em trânsito e em repouso, políticas LGPD.</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-secondary text-primary">
                <Sparkles size={18} />
              </span>
              <div>
                <p className="text-sm font-semibold">Tom humano</p>
                <p className="text-xs text-muted-foreground">Sem culpa, sem infantilização, sem promessas de riqueza.</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-secondary text-primary">
                <LineChart size={18} />
              </span>
              <div>
                <p className="text-sm font-semibold">Indicadores reais</p>
                <p className="text-xs text-muted-foreground">Fórmulas explicadas. Nada de score mágico sem base.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ resumida */}
      <section id="perguntas" className="border-t border-border/60 bg-card/40 py-16 md:py-24">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 md:grid-cols-[1fr_2fr] md:px-8">
          <div>
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Perguntas</p>
            <h2 className="font-display text-3xl font-bold tracking-tight md:text-4xl">Ainda com dúvida?</h2>
            <p className="mt-3 text-sm text-muted-foreground">
              Estamos construindo em público. Se algo não estiver claro, escreve pra gente.
            </p>
          </div>
          <div className="space-y-3">
            <FAQ q="Preciso pagar para usar?" a="A conta é gratuita para começar. Recursos avançados virão em planos pagos no futuro." />
            <FAQ q="Meus dados ficam seguros?" a="Sim. Dados criptografados, acesso restrito por conta, e aderência à LGPD desde o dia um." />
            <FAQ q="Meus lançamentos são compartilhados?" a="Nunca. Cada conta enxerga apenas os próprios dados — inclusive no WhatsApp." />
            <FAQ q="E se eu não quiser usar WhatsApp?" a="Sem problema. Você pode lançar tudo direto pelo aplicativo web ou mobile." />
          </div>
        </div>
      </section>

      {/* CTA final */}
      <section className="py-16 md:py-24">
        <div className="mx-auto max-w-3xl px-4 text-center md:px-8">
          <h2 className="font-display text-3xl font-bold tracking-tight md:text-4xl text-balance">
            Comece hoje. Continue amanhã <span className="text-gradient-brand">com clareza</span>.
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-base text-muted-foreground">
            Você não precisa virar planilheiro para cuidar do seu dinheiro. Precisa de um lugar honesto onde as decisões ficam mais fáceis.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link to="/signup" className="btn-brand">
              Criar minha conta grátis
              <ArrowRight size={16} />
            </Link>
            <Link to="/login" className="btn-ghost-brand">
              Já tenho conta
            </Link>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="border-t border-border/60 bg-card/40">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8 md:flex-row md:items-center md:justify-between md:px-8">
          <div className="flex items-center gap-2.5">
            <span className="grid h-8 w-8 place-items-center rounded-xl bg-gradient-brand text-white">
              <Wallet size={14} />
            </span>
            <span className="font-display text-sm font-bold tracking-tight">
              NoControle<span className="text-gradient-brand">.ia</span>
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            © {new Date().getFullYear()} NoControle.ia · Feito no Brasil com carinho.
          </p>
        </div>
      </footer>
    </div>
  );
}

/* -------- helpers -------- */

function ChatBubble({
  children,
  side,
  muted,
}: {
  children: React.ReactNode;
  side: "left" | "right";
  muted?: boolean;
}) {
  const base = "max-w-[85%] rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed";
  if (side === "right") {
    return (
      <div className="flex justify-end">
        <div className={`${base} bg-gradient-brand text-white shadow-brand`}>{children}</div>
      </div>
    );
  }
  return (
    <div className="flex justify-start">
      <div
        className={`${base} ${
          muted ? "bg-secondary text-foreground" : "bg-primary text-primary-foreground"
        }`}
      >
        {children}
      </div>
    </div>
  );
}

function FeatureCard({
  icon: Icon,
  title,
  desc,
}: {
  icon: typeof MessageCircle;
  title: string;
  desc: string;
}) {
  return (
    <div className="group relative rounded-3xl border border-border bg-card p-6 transition-all hover:-translate-y-0.5 hover:shadow-card">
      <span className="mb-5 grid h-11 w-11 place-items-center rounded-2xl bg-gradient-brand text-white shadow-brand">
        <Icon size={20} />
      </span>
      <h3 className="font-display text-lg font-semibold">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{desc}</p>
    </div>
  );
}

function StepCard({ step, title, desc }: { step: string; title: string; desc: string }) {
  return (
    <li className="rounded-3xl border border-border bg-card p-6">
      <span className="font-display text-xs font-bold tracking-[0.24em] text-gradient-brand">{step}</span>
      <h3 className="mt-3 font-display text-lg font-semibold">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{desc}</p>
    </li>
  );
}

function FAQ({ q, a }: { q: string; a: string }) {
  return (
    <details className="group rounded-2xl border border-border bg-card p-4 open:shadow-card">
      <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-semibold">
        {q}
        <span className="grid h-6 w-6 place-items-center rounded-full bg-secondary text-muted-foreground transition-transform group-open:rotate-45">
          +
        </span>
      </summary>
      <p className="mt-2 text-sm text-muted-foreground">{a}</p>
    </details>
  );
}
