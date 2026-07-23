import { Link } from "react-router-dom";
import {
  TrendUp,
  Target,
  Sparkle,
  Bell,
  ArrowsClockwise,
  Users,
  Wallet,
  ChartLineUp,
  PencilSimple,
  CaretRight,
  Check,
  type IconProps,
} from "@phosphor-icons/react";
import { NinoLogo } from "./NinoLogo";
import { NinoSymbol } from "./NinoSymbol";
import "./landing.css";

/**
 * Landing page pública oficial Meu Nino.IA (rota "/").
 * Escopada em .mn-lp — não afeta app autenticado nem admin.
 *
 * Direção:
 *  - Deep Ink apenas em hero, previsão e footer;
 *  - CTA final em gradiente oficial;
 *  - demais seções em branco/Cloud;
 *  - sem prova social fictícia;
 *  - sem claims não comprovados (criptografia, LGPD, exportar/excluir).
 */
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
        <ConfiancaSection />
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
        <Link to="/signup" className="lp-btn primary lp-btn--sm">
          Quero meu Nino
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
        <div className="lp-hero-copy">
          <span className="lp-badge">
            <Sparkle size={14} weight="regular" />
            Inteligência financeira pessoal
          </span>
          <h1>
            Seu dinheiro não está desorganizado.{" "}
            <span className="lp-grad-text">
              Só faltava alguém para cuidar dele com você.
            </span>
          </h1>
          <p className="lp-lead">
            O Nino entende seus gastos, percebe mudanças e ajuda você a decidir
            antes que o mês aperte.
          </p>
          <p className="lp-lead lp-lead--sub">
            Converse pelo WhatsApp ou pelo app, registre sua rotina em segundos
            e receba previsões, alertas, metas e próximos passos que realmente
            fazem sentido.
          </p>
          <div className="lp-actions">
            <Link to="/signup" className="lp-btn primary">
              Quero meu Nino grátis <CaretRight size={16} weight="bold" />
            </Link>
            <a href="#previsao" className="lp-btn ghost-dark">
              Ver o Nino em ação
            </a>
          </div>
          <div className="lp-micro">
            <span><Check size={14} weight="bold" /> Grátis para começar</span>
            <span><Check size={14} weight="bold" /> Sem cartão</span>
            <span><Check size={14} weight="bold" /> Leva menos de 1 minuto</span>
          </div>
          <p className="lp-micro lp-micro-login">
            <Link to="/login">Já tenho conta</Link>
          </p>
        </div>
        <HeroComposition />
      </div>
    </section>
  );
}

/**
 * Composição unificada do hero: uma única história —
 * usuário → resposta do Nino → contexto causal → ação.
 */
function HeroComposition() {
  return (
    <div className="lp-hero-comp" aria-hidden="true">
      <div className="lp-hero-chat">
        <div className="lp-hero-chat-head">
          <span className="lp-hero-avatar">
            <NinoSymbol size={22} />
          </span>
          <div>
            <strong>Nino</strong>
            <small>agora</small>
          </div>
          <span className="lp-hero-dot" />
        </div>
        <div className="lp-chat-msg user">
          Gastei R$ 80 no bar ontem no Nubank.
        </div>
        <div className="lp-chat-msg nino">
          Pronto. Organizei em <b>Lazer</b>. Com esse gasto, sua previsão
          para fechar o mês passou para <b>R$ 3.180</b>.
        </div>
        <div className="lp-chat-msg nino">
          Isso é <b>8% acima</b> do mês anterior. Lazer e alimentação fora
          explicam <b>72%</b> da alta.
        </div>
      </div>
      <div className="lp-hero-card">
        <div className="lp-hero-card-head">
          <span>Previsão · fechamento do mês</span>
          <TrendUp size={16} weight="regular" />
        </div>
        <span className="lp-hero-num">R$ 3.180</span>
        <span className="lp-delta">
          <TrendUp size={12} weight="bold" /> +8% vs. mês anterior
        </span>
        <a className="lp-hero-action" href="#previsao">
          Criar um limite para essas categorias
          <CaretRight size={14} weight="bold" />
        </a>
      </div>
    </div>
  );
}

/* ============================== Manifesto ================================ */

function ManifestoSection() {
  const dores = [
    "O mês parece normal — até deixar de parecer.",
    "Pequenos aumentos passam despercebidos.",
    "Metas se desconectam da rotina.",
    "Decisões chegam tarde.",
  ];
  return (
    <section className="lp-manifesto">
      <div className="lp-wrap lp-manifesto-inner">
        <blockquote>
          Você não precisa olhar mais números.{" "}
          <span>Precisa entender o que eles estão tentando dizer.</span>
        </blockquote>
        <p className="lp-lead lp-lead--wide lp-manifesto-lead">
          Planilhas e aplicativos mostram o que já aconteceu. O Nino conecta o
          que mudou, por que mudou e o que você pode fazer agora.
        </p>
        <ol className="lp-manifesto-list">
          {dores.map((d, i) => (
            <li key={d}>
              <span className="lp-manifesto-index">{String(i + 1).padStart(2, "0")}</span>
              <span>{d}</span>
            </li>
          ))}
        </ol>
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
            <h2>Veja onde o mês provavelmente termina antes que ele termine.</h2>
            <p className="lp-lead" style={{ marginTop: 18 }}>
              O Nino projeta o fim do mês com base no seu histórico e nos
              compromissos já registrados. Quando algo muda, você percebe cedo
              — e ainda dá tempo de decidir.
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
                <TrendUp size={12} weight="bold" /> +8% vs. mês anterior
              </span>
              <div className="lp-trend">
                <svg viewBox="0 0 300 90" preserveAspectRatio="none" aria-hidden="true">
                  <defs>
                    <linearGradient id="lp-trend-grad" x1="0" y1="0" x2="1" y2="0">
                      <stop offset="0" stopColor="#6D4AFF" />
                      <stop offset="1" stopColor="#FF6B5F" />
                    </linearGradient>
                  </defs>
                  <path
                    d="M0,70 C40,60 70,50 110,52 C150,54 180,44 220,34 C250,26 275,22 300,18"
                    fill="none" stroke="url(#lp-trend-grad)" strokeWidth="3" strokeLinecap="round"
                  />
                </svg>
                <div className="lp-trend-marks"><span>01</span><span>08</span><span>15</span><span>22</span><span>29</span></div>
              </div>
              <div className="lp-cause">
                Lazer e alimentação fora explicam <b>72%</b> do aumento.
              </div>
              <a className="lp-mockup-cta" href="#previsao">
                Revisar limite <CaretRight size={14} weight="bold" />
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
  const sinais = [
    { t: "Alimentação fora", d: "+22% em 3 semanas", why: "Consistente e acima da sua média — não é um pico isolado.", tone: "alert" as const },
    { t: "Transporte", d: "−8% no mês", why: "Você diminuiu ao trabalhar mais em casa. Sobra útil para a meta.", tone: "good" as const },
    { t: "Assinatura recorrente", d: "Nova cobrança identificada", why: "Um débito repetido apareceu no cartão. Vale confirmar.", tone: "neutral" as const },
    { t: "Gasto fora do padrão", d: "R$ 240 · terça, 22h", why: "Fora do seu ritmo habitual. Confira se foi você.", tone: "alert" as const },
  ];
  return (
    <section className="lp-section" id="comportamento">
      <div className="lp-wrap">
        <div className="lp-section-head">
          <span className="lp-label">Mudanças de comportamento</span>
          <h2>O Nino percebe mudanças que passam despercebidas na rotina.</h2>
          <p className="lp-lead lp-lead--wide">
            Em vez de mostrar totais, ele compara seus movimentos com a sua
            própria história e explica o que está por trás — sem ranking,
            sem julgamento.
          </p>
        </div>
        <div className="lp-signals">
          {sinais.map((s, i) => (
            <article className={`lp-signal lp-signal--${s.tone} lp-signal--${i}`} key={s.t}>
              <span className="lp-signal-delta">{s.d}</span>
              <h3>{s.t}</h3>
              <p>{s.why}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

/* =============================== Metas =================================== */

function MetasSection() {
  return (
    <section className="lp-section" id="metas">
      <div className="lp-wrap">
        <div className="lp-split lp-split--reverse">
          <div className="lp-split-visual">
            <div className="lp-mockup lp-mockup--light" aria-hidden="true">
              <div className="lp-mockup-head">
                <span>Viagem · setembro 2026</span>
                <Target size={16} weight="regular" />
              </div>
              <div className="lp-goal-row">
                <span className="lp-mockup-num">R$ 4.320</span>
                <span className="lp-goal-total">de R$ 6.000</span>
              </div>
              <div className="lp-goal-progress lp-goal-progress--light">
                <span style={{ width: "72%" }} />
              </div>
              <div className="lp-goal-meta">
                <div><small>Ritmo necessário</small><strong>R$ 420 / mês</strong></div>
                <div><small>Previsão</small><strong>Fecha 12 dias antes</strong></div>
              </div>
              <div className="lp-cause">
                Se o ritmo cair para <b>R$ 260/mês</b>, a meta atrasa 3 semanas.
                O Nino avisa antes que isso aconteça.
              </div>
            </div>
          </div>
          <div>
            <span className="lp-label">Metas acompanhadas</span>
            <h2>Suas metas não ficam esquecidas depois de serem criadas.</h2>
            <p className="lp-lead" style={{ marginTop: 18 }}>
              Cada aporte, cada imprevisto: o Nino atualiza o quadro e sinaliza
              quando a meta precisa de um pequeno ajuste — antes que o prazo
              vire pressão.
            </p>
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
      ctx: "Ritmo atual encerra a categoria R$ 220 acima do previsto.",
      d: "Um teto temporário de R$ 320 já devolve o mês ao azul.",
    },
    {
      t: "Antecipe parte da fatura",
      ctx: "Sobra estimada permite antecipar sem comprometer as fixas.",
      d: "Antecipar R$ 480 reduz o juros do próximo ciclo.",
    },
    {
      t: "Planeje o próximo aporte",
      ctx: "Você fez aportes constantes por 3 meses.",
      d: "Vale planejar o próximo com base no ritmo atual — sem depender de lembrete.",
    },
  ];
  return (
    <section className="lp-section" id="insights">
      <div className="lp-wrap">
        <div className="lp-section-head">
          <span className="lp-label">Próximos passos</span>
          <h2>Não basta dizer o que aconteceu. O Nino ajuda você a decidir o próximo passo.</h2>
        </div>
        <div className="lp-insights-list">
          {items.map((i) => (
            <article className="lp-insight-item" key={i.t}>
              <div>
                <h3>{i.t}</h3>
                <p className="lp-insight-ctx">{i.ctx}</p>
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
    <section className="lp-section" id="role">
      <div className="lp-wrap">
        <div className="lp-split">
          <div>
            <span className="lp-label">Divisão do Rolê</span>
            <h2>Dividir a conta não deveria virar outra conta para você resolver.</h2>
            <p className="lp-lead" style={{ marginTop: 18 }}>
              O Nino ajuda você a acompanhar quem pagou, quem está pendente e
              prepara uma mensagem de lembrete quando precisar.
            </p>
          </div>
          <div className="lp-split-visual">
            <div className="lp-mockup lp-mockup--light" aria-hidden="true">
              <div className="lp-mockup-head">
                <span>Churrasco · 15/jul</span>
                <Users size={16} weight="regular" />
              </div>
              <div className="lp-goal-row">
                <span className="lp-mockup-num">R$ 320</span>
                <span className="lp-goal-total">4 pessoas · R$ 80 cada</span>
              </div>
              <div className="lp-role-participants lp-role-participants--light">
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
                Preparar lembrete amigável <CaretRight size={14} weight="bold" />
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
  { icon: Wallet,           t: "Patrimônio consolidado", d: "Contas, investimentos e faturas em uma visão só." },
  { icon: ChartLineUp,      t: "Investimentos",          d: "Aportes, rendimentos e vínculo com metas específicas." },
  { icon: ArrowsClockwise,  t: "Recorrências",           d: "Assinaturas e contas fixas identificadas e projetadas." },
  { icon: Bell,             t: "Alertas úteis",          d: "Avisos quando algo importante muda — sem barulho." },
  { icon: PencilSimple,     t: "Edição onde estiver",    d: "Corrija e organize no app ou pelo WhatsApp." },
  { icon: Sparkle,          t: "Organização por contexto", d: "O Nino organiza com base nas informações que você registra." },
];

function CapacidadesSection() {
  return (
    <section className="lp-section lp-section--soft" id="capacidades">
      <div className="lp-wrap">
        <div className="lp-section-head">
          <span className="lp-label">Outras capacidades</span>
          <h2>Um assistente completo — na medida do seu dia.</h2>
        </div>
        <div className="lp-tiles">
          {CAPACIDADES.map(({ icon: Icon, t, d }, idx) => (
            <article className={`lp-tile lp-tile--${idx}`} key={t}>
              <div className="lp-tile-icon"><Icon size={20} weight="light" /></div>
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
    { n: "03", t: "Decida",   d: "Receba insights com próximos passos, no momento em que fazem diferença." },
  ];
  return (
    <section className="lp-section" id="como-funciona">
      <div className="lp-wrap">
        <div className="lp-section-head">
          <span className="lp-label">Como funciona</span>
          <h2>Três passos. Nenhuma planilha.</h2>
        </div>
        <ol className="lp-flow">
          {steps.map((s, i) => (
            <li className="lp-flow-step" key={s.n}>
              <span className="lp-flow-num">{s.n}</span>
              <div>
                <h3>{s.t}</h3>
                <p>{s.d}</p>
              </div>
              {i < steps.length - 1 && <span className="lp-flow-line" aria-hidden="true" />}
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/* =========================== Confiança (editorial) ======================== */

function ConfiancaSection() {
  const points = [
    {
      t: "Registre em segundos",
      d: "Converse naturalmente, sem formulário longo.",
    },
    {
      t: "Entenda sem decifrar gráficos",
      d: "Mudanças explicadas em linguagem humana, sem ranking nem julgamento.",
    },
    {
      t: "Decida no momento certo",
      d: "Contexto e próximos passos conectados à rotina — quando fazem diferença.",
    },
  ];
  return (
    <section className="lp-section" id="confianca">
      <div className="lp-wrap">
        <div className="lp-trust-editorial">
          <div className="lp-trust-copy">
            <span className="lp-label">Feito para caber na rotina</span>
            <h2>Feito para caber na rotina, não para criar mais uma tarefa.</h2>
            <p className="lp-lead" style={{ marginTop: 18 }}>
              Sem menus infinitos, sem planilhas paralelas. O Nino se encaixa
              no seu dia — no app quando faz sentido, no WhatsApp quando é mais
              rápido.
            </p>
          </div>
          <ol className="lp-trust-list">
            {points.map((p, i) => (
              <li className="lp-trust-row" key={p.t}>
                <span className="lp-trust-index">{String(i + 1).padStart(2, "0")}</span>
                <div>
                  <h3>{p.t}</h3>
                  <p>{p.d}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

/* ============================== Segurança ================================ */

function SegurancaSection() {
  const apoios = [
    "Você escolhe o que registrar.",
    "O Nino não executa movimentações financeiras.",
    "Privacidade explicada sem letras miúdas.",
  ];
  return (
    <section className="lp-section" id="seguranca">
      <div className="lp-wrap">
        <div className="lp-security">
          <span className="lp-label">Privacidade</span>
          <h2>Seu dinheiro é pessoal. Seus dados também.</h2>
          <p className="lp-lead lp-lead--wide" style={{ marginTop: 18 }}>
            O Nino não movimenta seu dinheiro. Ele organiza as informações que
            você decide registrar e deixa claro como elas são usadas.
          </p>
          <ul className="lp-security-apoios">
            {apoios.map((a) => (
              <li key={a}>
                <Check size={14} weight="bold" />
                <span>{a}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

/* ================================= FAQ =================================== */

const FAQ_ITEMS = [
  {
    q: "O Nino é um banco?",
    a: "Não. O Nino é um assistente financeiro que organiza informações e ajuda você a decidir. Ele não movimenta dinheiro.",
  },
  {
    q: "Como a inteligência artificial é usada?",
    a: "Para reconhecer padrões nos registros que você faz, identificar mudanças no seu comportamento e projetar cenários com base no seu histórico.",
  },
  {
    q: "Preciso preencher tudo manualmente?",
    a: "Não. Você conversa com o Nino no app ou pelo WhatsApp e ele extrai, categoriza e confirma antes de salvar.",
  },
  {
    q: "Funciona pelo WhatsApp?",
    a: "Sim. Você vincula seu número uma vez e passa a registrar gastos e conversar com o Nino direto por lá.",
  },
  {
    q: "O que acontece com os meus dados?",
    a: "O Nino organiza apenas o que você decide registrar e deixa claro como cada informação é usada.",
  },
  {
    q: "Quanto custa para começar?",
    a: "Você começa gratuitamente. Planos e recursos adicionais serão apresentados com transparência quando existirem.",
  },
];

function FAQSection() {
  return (
    <section className="lp-section lp-section--soft" id="duvidas">
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
            <NinoSymbol size={72} />
          </div>
          <h2>Seu dinheiro começa a fazer mais sentido a partir de uma conversa.</h2>
          <p>
            Fale com o Nino, organize sua rotina e entenda o que vem pela frente.
          </p>
          <div className="lp-actions">
            <Link to="/signup" className="lp-btn on-grad">
              Quero meu Nino grátis
            </Link>
            <a href="#duvidas" className="lp-btn ghost-light">
              Ainda tenho dúvidas
            </a>
          </div>
          <p className="lp-final-micro">
            Grátis para começar · Sem cartão de crédito
          </p>
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
        Quero meu Nino grátis <CaretRight size={16} weight="bold" />
      </Link>
    </div>
  );
}
