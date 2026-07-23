import { Link } from "react-router-dom";
import {
  ChatCircleDots,
  TrendUp,
  Target,
  Sparkle,
  Bell,
  ArrowsClockwise,
  ShieldCheck,
  Users,
  Wallet,
  ChartLineUp,
  PencilSimple,
  Lock,
  UserFocus,
  CaretRight,
  Check,
  type IconProps,
} from "@phosphor-icons/react";
import { NinoLogo } from "./NinoLogo";
import { NinoSymbol } from "./NinoSymbol";
import "./landing.css";

/**
 * Landing page pública oficial Meu Nino.IA (rota "/").
 * Escopo: estilos escopados em .mn-lp — não afeta app autenticado nem admin.
 *
 * Prova social por padrão em modo placeholder até depoimentos reais serem
 * coletados. Trocar para false apenas quando houver conteúdo real.
 */
// TODO: substituir por depoimentos reais antes da publicação final.
const SOCIAL_PROOF_IS_PLACEHOLDER = true;

export default function LandingPage() {
  return (
    <div className="mn-lp">
      <LandingHeader />
      <main id="top">
        <HeroSection />
        <ManifestoSection />
        <PrevisaoSection />
        <ComportamentoSection />
        <MetasSection />
        <InsightsSection />
        <DivisaoRoleSection />
        <CapacidadesSection />
        <ComoFuncionaSection />
        <ProvaSocialSection />
        <SegurancaSection />
        <FAQSection />
        <FinalCTA />
      </main>
      <LandingFooter />
      <LandingMobileCTA />
    </div>
  );
}

/* ================================ Header ================================= */

function LandingHeader() {
  return (
    <header className="lp-header">
      <div className="lp-nav">
        <Link to="/" aria-label="Meu Nino.IA — início">
          <NinoLogo variant="light" size="sm" />
        </Link>
        <nav className="lp-nav-links" aria-label="Principal">
          <a href="#previsao">Previsão</a>
          <a href="#comportamento">Comportamento</a>
          <a href="#metas">Metas</a>
          <a href="#duvidas">Dúvidas</a>
        </nav>
        <Link to="/signup" className="lp-btn primary">
          Começar grátis
        </Link>
      </div>
    </header>
  );
}

/* ================================= Hero ================================== */

function HeroSection() {
  return (
    <section className="lp-hero">
      <div className="lp-wrap lp-hero-grid">
        <div>
          <span className="lp-badge">
            <Sparkle size={16} weight="regular" />
            Inteligência financeira que conversa com você
          </span>
          <h1>
            O Nino entende seus gastos hoje para ajudar você a{" "}
            <span className="lp-grad-text">decidir melhor amanhã.</span>
          </h1>
          <p className="lp-lead">
            Uma inteligência pessoal que percebe sua rotina, antecipa mudanças e
            transforma seus registros em decisões — sem planilhas, sem julgamento.
          </p>
          <div className="lp-actions">
            <Link to="/signup" className="lp-btn primary">
              Começar gratuitamente <CaretRight size={16} weight="bold" />
            </Link>
            <a href="#previsao" className="lp-btn ghost-dark">
              Ver como funciona
            </a>
          </div>
          <div className="lp-micro">
            <span><Check size={14} weight="bold" /> Registro por conversa</span>
            <span><Check size={14} weight="bold" /> Também pelo WhatsApp</span>
            <span><Check size={14} weight="bold" /> Comece sem cartão</span>
          </div>
          <p className="lp-micro" style={{ marginTop: 14 }}>
            <Link to="/login" style={{ textDecoration: "underline", color: "inherit" }}>
              Já tenho conta
            </Link>
          </p>
        </div>
        <HeroMockup />
      </div>
    </section>
  );
}

function HeroMockup() {
  return (
    <div className="lp-hero-mockup" aria-hidden="true">
      <div className="lp-hero-mockup-header">
        <span className="dot" />
        Conversa com o Nino · agora
      </div>
      <div className="lp-chat-msg user">Gastei R$ 62 no jantar ontem</div>
      <div className="lp-chat-msg nino">
        Anotado em Alimentação. Este mês você já está 14% acima da sua média,
        ainda dentro do previsto.
        <small>Quer que eu acompanhe essa categoria de perto?</small>
      </div>
    </div>
  );
}

/* ============================== Manifesto ================================ */

function ManifestoSection() {
  return (
    <section className="lp-manifesto">
      <div className="lp-wrap">
        <blockquote>
          Você não precisa olhar mais números.{" "}
          <span>Precisa entender o que eles estão tentando dizer.</span>
        </blockquote>
      </div>
    </section>
  );
}

/* =========================== Previsão de fechamento ====================== */

function PrevisaoSection() {
  return (
    <section className="lp-section lp-dark" id="previsao">
      <div className="lp-wrap">
        <div className="lp-split">
          <div>
            <span className="lp-label">Previsão de fechamento</span>
            <h2>Saiba onde o mês termina antes que ele te surpreenda.</h2>
            <p className="lp-lead" style={{ marginTop: 18 }}>
              O Nino projeta o fim do mês com base no seu histórico e nos
              compromissos já registrados. Quando algo muda, você percebe cedo —
              e ainda dá tempo de decidir.
            </p>
          </div>
          <div className="lp-split-visual">
            <div className="lp-mockup" aria-hidden="true">
              <div className="lp-mockup-head">
                <span>Fechamento estimado · julho</span>
                <TrendUp size={16} weight="regular" />
              </div>
              <span className="lp-mockup-num">R$ 3.180</span>
              <span className="lp-delta">
                <TrendUp size={14} weight="bold" /> +8% vs. mês anterior
              </span>
              <div className="lp-cause">
                Lazer e alimentação fora explicam <b>72%</b> do aumento nas últimas 2 semanas.
              </div>
              <a className="lp-mockup-cta" href="#previsao">
                Revisar limite dessas categorias <CaretRight size={14} weight="bold" />
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* =========================== Mudanças de comportamento =================== */

function ComportamentoSection() {
  const categorias = [
    { nome: "Alimentação fora", atual: 92, media: 68, delta: "+22%", pos: false },
    { nome: "Transporte", atual: 48, media: 60, delta: "−8%", pos: true },
    { nome: "Lazer", atual: 74, media: 58, delta: "+14%", pos: false },
  ];
  return (
    <section className="lp-section" id="comportamento">
      <div className="lp-wrap">
        <div className="lp-split lp-split--reverse">
          <div className="lp-split-visual">
            <div className="lp-mockup" aria-hidden="true">
              <div className="lp-mockup-head">
                <span>Comparativo — este mês vs. média 3 meses</span>
                <ChartLineUp size={16} weight="regular" />
              </div>
              <div style={{ marginTop: 8 }}>
                {categorias.map((c) => (
                  <div key={c.nome} className="lp-cat-row">
                    <span className="lp-cat-name">{c.nome}</span>
                    <span className={`lp-delta ${c.pos ? "lp-delta--good" : ""}`}>{c.delta}</span>
                    <div className="lp-cat-bars">
                      <div className="lp-cat-bar"><span style={{ width: `${c.atual}%` }} /></div>
                      <div className="lp-cat-bar lp-cat-bar--avg"><span style={{ width: `${c.media}%` }} /></div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="lp-cause" style={{ marginTop: 18 }}>
                Alimentação fora subiu de forma consistente por 3 semanas.
                Boa hora para um limite temporário.
              </div>
            </div>
          </div>
          <div>
            <span className="lp-label">Mudanças de comportamento</span>
            <h2>O Nino percebe o que muda antes de virar problema.</h2>
            <p className="lp-lead" style={{ marginTop: 18 }}>
              Em vez de mostrar totais, ele compara seus movimentos com a sua
              própria história e explica o que está por trás — sem ranking, sem
              julgamento.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

/* =============================== Metas =================================== */

function MetasSection() {
  return (
    <section className="lp-section lp-dark" id="metas">
      <div className="lp-wrap">
        <div className="lp-split">
          <div>
            <span className="lp-label">Metas acompanhadas</span>
            <h2>Meta viva. Ajustada com o que realmente aconteceu no seu mês.</h2>
            <p className="lp-lead" style={{ marginTop: 18 }}>
              Cada aporte, cada imprevisto: o Nino atualiza o quadro e sinaliza
              quando a meta precisa de um pequeno ajuste — antes que o prazo
              vire pressão.
            </p>
          </div>
          <div className="lp-split-visual">
            <div className="lp-mockup" aria-hidden="true">
              <div className="lp-mockup-head">
                <span>Viagem · setembro 2026</span>
                <Target size={16} weight="regular" />
              </div>
              <span className="lp-mockup-num">72%</span>
              <div className="lp-goal-progress"><span style={{ width: "72%" }} /></div>
              <div className="lp-goal-aportes">
                <span className="lp-goal-chip">Mai · R$ 400</span>
                <span className="lp-goal-chip">Jun · R$ 400</span>
                <span className="lp-goal-chip">Jul · R$ 500</span>
              </div>
              <div className="lp-cause" style={{ marginTop: 18 }}>
                No ritmo atual, a meta <b>fecha 12 dias antes</b> do prazo.
              </div>
              <a className="lp-mockup-cta" href="#metas">
                Aumentar aporte de agosto <CaretRight size={14} weight="bold" />
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ============================== Insights ================================= */

function InsightsSection() {
  const items = [
    {
      t: "Reveja o limite de alimentação fora",
      d: "Ao continuar no ritmo atual, essa categoria termina R$ 220 acima do previsto.",
    },
    {
      t: "Antecipe a fatura da próxima semana",
      d: "Sobra estimada permite antecipar R$ 480 sem comprometer contas fixas.",
    },
    {
      t: "Automatize seu aporte da meta",
      d: "Você está fazendo aportes constantes há 3 meses. Vale programar como recorrência.",
    },
  ];
  return (
    <section className="lp-section" id="insights">
      <div className="lp-wrap">
        <div className="lp-section-head">
          <span className="lp-label">Próximos passos</span>
          <h2>Insights que sugerem o que fazer — não mais um relatório.</h2>
          <p className="lp-lead lp-lead--wide">
            Cada recomendação nasce dos seus dados e vem com uma ação clara.
            Você aplica com um toque ou explica ao Nino por que não faz sentido.
          </p>
        </div>
        <div className="lp-insights-list">
          {items.map((i) => (
            <article className="lp-insight-item" key={i.t}>
              <div>
                <h3>{i.t}</h3>
                <p>{i.d}</p>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ============================ Divisão do Rolê ============================ */

function DivisaoRoleSection() {
  const parts = [
    { nome: "Ana",     valor: "R$ 80", status: "pago" as const },
    { nome: "Bruno",   valor: "R$ 80", status: "pago" as const },
    { nome: "Camila",  valor: "R$ 80", status: "pendente" as const },
    { nome: "Diego",   valor: "R$ 80", status: "pendente" as const },
  ];
  return (
    <section className="lp-section lp-dark" id="role">
      <div className="lp-wrap">
        <div className="lp-split">
          <div>
            <span className="lp-label">Divisão do Rolê</span>
            <h2>Divida a conta sem virar cobrança chata no grupo.</h2>
            <p className="lp-lead" style={{ marginTop: 18 }}>
              O Nino organiza quem participou, quanto cada um deve e envia
              lembretes pelo WhatsApp — mantendo o histórico visível pra todo
              mundo.
            </p>
          </div>
          <div className="lp-split-visual">
            <div className="lp-mockup" aria-hidden="true">
              <div className="lp-mockup-head">
                <span>Churrasco · 15/jul</span>
                <Users size={16} weight="regular" />
              </div>
              <span className="lp-mockup-num">R$ 320</span>
              <p style={{ color: "rgba(255,255,255,.6)", fontSize: ".88rem", margin: 0 }}>
                4 participantes · R$ 80 cada
              </p>
              <div className="lp-role-participants">
                {parts.map((p) => (
                  <div className="lp-role-row" key={p.nome}>
                    <div className="lp-role-avatar">{p.nome[0]}</div>
                    <span className="lp-role-name">{p.nome}</span>
                    <span className="lp-role-value">{p.valor}</span>
                    <span className={`lp-role-status ${p.status}`}>
                      {p.status === "pago" ? "Pago" : "Pendente"}
                    </span>
                  </div>
                ))}
              </div>
              <a className="lp-mockup-cta" href="#role" style={{ marginTop: 16 }}>
                Cobrar os pendentes pelo WhatsApp <CaretRight size={14} weight="bold" />
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ============================ Capacidades ================================ */

const CAPACIDADES: Array<{ icon: React.ComponentType<IconProps>; t: string; d: string }> = [
  { icon: Wallet,           t: "Patrimônio consolidado", d: "Contas, investimentos e faturas somados em uma visão só." },
  { icon: ChartLineUp,      t: "Investimentos",          d: "Aportes, rendimentos e vínculo com metas específicas." },
  { icon: ArrowsClockwise,  t: "Recorrências",           d: "Assinaturas e contas fixas identificadas e projetadas." },
  { icon: Bell,             t: "Alertas úteis",          d: "Avisos quando algo importante muda — sem barulho." },
  { icon: PencilSimple,     t: "Edição em qualquer lugar", d: "Corrigir e organizar no app ou pelo WhatsApp." },
  { icon: ChatCircleDots,   t: "Organização automática", d: "Categorização inteligente que aprende com você." },
];

function CapacidadesSection() {
  return (
    <section className="lp-section" id="capacidades">
      <div className="lp-wrap">
        <div className="lp-section-head">
          <span className="lp-label">Outras capacidades</span>
          <h2>Um assistente completo — na medida do seu dia.</h2>
        </div>
        <div className="lp-tiles">
          {CAPACIDADES.map(({ icon: Icon, t, d }) => (
            <article className="lp-tile" key={t}>
              <div className="lp-tile-icon"><Icon size={22} weight="regular" /></div>
              <h3>{t}</h3>
              <p>{d}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ============================= Como funciona ============================= */

function ComoFuncionaSection() {
  const steps = [
    { n: "01", t: "Conecte", d: "Crie sua conta e escolha começar pelo app ou pelo WhatsApp." },
    { n: "02", t: "Converse", d: "Registre gastos por texto. O Nino entende, categoriza e confirma." },
    { n: "03", t: "Decida",   d: "Receba insights com próximos passos e aplique com um toque." },
  ];
  return (
    <section className="lp-section" id="como-funciona">
      <div className="lp-wrap">
        <div className="lp-section-head">
          <span className="lp-label">Como funciona</span>
          <h2>Três passos. Nenhuma planilha.</h2>
        </div>
        <div className="lp-steps">
          {steps.map((s) => (
            <article className="lp-step" key={s.n}>
              <span className="lp-step-num">{s.n}</span>
              <h3>{s.t}</h3>
              <p>{s.d}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ============================= Prova social ============================== */

function ProvaSocialSection() {
  // Placeholders explicitamente marcados. Substituir por depoimentos reais.
  const quotes = [
    { p: "Passei a entender o que muda no meu mês antes do fim.",   a: "Persona demonstrativa · Ana, 32" },
    { p: "Registrar pelo WhatsApp virou hábito em duas semanas.",   a: "Persona demonstrativa · Bruno, 28" },
    { p: "As sugestões me ajudam a decidir antes de comprar.",      a: "Persona demonstrativa · Camila, 41" },
  ];
  return (
    <section className="lp-section" id="prova">
      <div className="lp-wrap">
        <div className="lp-section-head">
          <span className="lp-label">Quem já usa</span>
          <h2>Organização que finalmente cabe na rotina.</h2>
          {SOCIAL_PROOF_IS_PLACEHOLDER ? (
            <p className="lp-lead lp-lead--wide">
              Estamos coletando depoimentos reais. Os exemplos abaixo estão
              marcados como <b>demonstrativos</b> até essa etapa concluir.
            </p>
          ) : null}
        </div>
        <div className="lp-quotes" data-placeholder={SOCIAL_PROOF_IS_PLACEHOLDER}>
          {quotes.map((q) => (
            <article className="lp-quote" key={q.a}>
              {SOCIAL_PROOF_IS_PLACEHOLDER ? (
                <span className="lp-quote-badge">Exemplo demonstrativo</span>
              ) : null}
              <blockquote>“{q.p}”</blockquote>
              <cite>{q.a}</cite>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ============================== Segurança ================================ */

function SegurancaSection() {
  const pillars = [
    {
      icon: Lock,
      t: "Criptografia em trânsito",
      d: "Toda comunicação com o Nino é feita por conexões seguras (HTTPS/TLS).",
    },
    {
      icon: UserFocus,
      t: "Seus dados sob seu controle",
      d: "Você pode exportar ou excluir suas informações a qualquer momento.",
    },
    {
      icon: ShieldCheck,
      t: "LGPD como padrão",
      d: "Tratamos dados pessoais conforme a Lei Geral de Proteção de Dados.",
    },
  ];
  return (
    <section className="lp-section lp-dark" id="seguranca">
      <div className="lp-wrap">
        <div className="lp-section-head">
          <span className="lp-label">Segurança</span>
          <h2>Confiança começa na base.</h2>
          <p className="lp-lead lp-lead--wide">
            O Nino não movimenta dinheiro. Ele apenas organiza informações que
            você registra — com boas práticas de segurança e privacidade.
          </p>
        </div>
        <div className="lp-security">
          {pillars.map(({ icon: Icon, t, d }) => (
            <article className="lp-security-item" key={t}>
              <div className="lp-tile-icon"><Icon size={22} weight="regular" /></div>
              <h3>{t}</h3>
              <p>{d}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ================================= FAQ =================================== */

const FAQ_ITEMS = [
  {
    q: "O Nino é um banco?",
    a: "Não. O Nino é um assistente financeiro que organiza informações e ajuda você a decidir. Nada de movimentação de dinheiro.",
  },
  {
    q: "Como a inteligência artificial é usada?",
    a: "Para reconhecer padrões, identificar mudanças no seu comportamento e projetar cenários com base no que você registra.",
  },
  {
    q: "Preciso preencher tudo manualmente?",
    a: "Não. Você conversa com o Nino no app ou pelo WhatsApp e ele extrai, categoriza e confirma antes de salvar.",
  },
  {
    q: "Funciona pelo WhatsApp de verdade?",
    a: "Sim. Você vincula seu número uma vez e passa a registrar gastos, receber alertas e responder ao Nino direto por lá.",
  },
  {
    q: "Meus dados ficam seguros?",
    a: "Sim. Comunicação criptografada, dados pessoais tratados conforme a LGPD e controle total nas suas mãos para exportar ou excluir.",
  },
  {
    q: "Quanto custa para começar?",
    a: "Você começa gratuitamente. Planos e recursos adicionais serão apresentados com transparência quando existirem.",
  },
];

function FAQSection() {
  return (
    <section className="lp-section" id="duvidas">
      <div className="lp-wrap">
        <div className="lp-section-head">
          <span className="lp-label">Dúvidas frequentes</span>
          <h2>Clareza antes de começar.</h2>
        </div>
        <div className="lp-faq">
          {FAQ_ITEMS.map((item) => (
            <details key={item.q}>
              <summary>{item.q}</summary>
              <p>{item.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

/* =============================== Final CTA =============================== */

function FinalCTA() {
  return (
    <section id="comecar">
      <div className="lp-wrap">
        <div className="lp-final">
          <div className="lp-final-symbol" aria-hidden="true">
            <NinoSymbol size={56} />
          </div>
          <h2>Fale com o Nino. Seu dinheiro começa a fazer mais sentido.</h2>
          <p>
            Crie sua conta gratuita e comece a entender o que vem pela frente —
            sem planilha, sem julgamento.
          </p>
          <div className="lp-actions">
            <Link to="/signup" className="lp-btn on-grad">
              Criar minha conta grátis
            </Link>
            <a href="#duvidas" className="lp-btn ghost-dark">
              Ainda tenho dúvidas
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ================================= Footer ================================ */

function LandingFooter() {
  return (
    <footer className="lp-footer">
      <div className="lp-wrap lp-footer-row">
        <NinoLogo variant="dark" size="sm" />
        <p style={{ margin: 0 }}>
          © {new Date().getFullYear()} Meu Nino.IA · Feito no Brasil com cuidado.
        </p>
      </div>
    </footer>
  );
}

/* ============================ Mobile CTA bar ============================= */

function LandingMobileCTA() {
  return (
    <div className="lp-mobile-cta">
      <Link to="/signup" className="lp-btn primary">
        Começar grátis <CaretRight size={16} weight="bold" />
      </Link>
    </div>
  );
}
