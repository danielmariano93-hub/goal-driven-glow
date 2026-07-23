import { Link } from "react-router-dom";
import { NinoWordmark } from "./NinoWordmark";
import { NinoSymbol } from "./NinoSymbol";
import "./landing.css";

/**
 * Landing page pública Meu Nino.IA (rota "/").
 * Baseada em meu_nino_lp_premium_v3.html — reescrita como React acessível.
 * Não afeta o app autenticado nem o admin: todos os estilos vivem em .mn-lp.
 */

/** Se algum dia tivermos depoimentos reais assinados, habilitar aqui. */
const SHOW_LANDING_TESTIMONIALS = false;

export default function LandingPage() {
  return (
    <div className="mn-lp">
      <LandingHeader />
      <main id="top">
        <HeroSection />
        <PainSection />
        <IntelligenceBento />
        <FeaturesDark />
        <AIBand />
        {SHOW_LANDING_TESTIMONIALS ? <SocialProof /> : null}
        <FAQSection />
        <FinalCTA />
      </main>
      <LandingFooter />
      <LandingMobileCTA />
    </div>
  );
}

/* --------------------------------- Header --------------------------------- */

function LandingHeader() {
  return (
    <header className="lp-header">
      <div className="lp-nav">
        <Link to="/" className="lp-logo" aria-label="Meu Nino.IA — início">
          <NinoWordmark size="sm" />
        </Link>
        <nav className="lp-nav-links" aria-label="Principal">
          <a href="#inteligencia">Como funciona</a>
          <a href="#recursos">Recursos</a>
          <a href="#duvidas">Dúvidas</a>
        </nav>
        <Link to="/signup" className="lp-btn primary" aria-label="Começar gratuitamente">
          Começar grátis
        </Link>
      </div>
    </header>
  );
}

/* ---------------------------------- Hero ---------------------------------- */

function HeroSection() {
  return (
    <section className="lp-hero">
      <div className="lp-wrap lp-hero-grid">
        <div>
          <span className="lp-badge">
            <i aria-hidden="true" /> Inteligência financeira que conversa com você
          </span>
          <h1>
            Você não precisa controlar cada centavo.
            <br />
            <span className="lp-grad">Precisa entender o que vem pela frente.</span>
          </h1>
          <p className="lp-lead">
            O Nino organiza sua rotina financeira, identifica mudanças nos seus hábitos e
            usa inteligência artificial para mostrar riscos, oportunidades e próximos
            passos antes que o mês aperte.
          </p>
          <div className="lp-actions">
            <Link to="/signup" className="lp-btn primary">
              Quero organizar minha vida financeira →
            </Link>
            <a href="#recursos" className="lp-btn secondary">
              Descobrir o que o Nino faz
            </a>
          </div>
          <div className="lp-micro">
            <span>Comece gratuitamente</span>
            <span>Experiência pelo WhatsApp</span>
            <span>Sem planilhas e sem julgamento</span>
          </div>
          <p className="lp-micro" style={{ marginTop: 8, color: "#8b8e9b" }}>
            <Link to="/login" style={{ textDecoration: "underline" }}>
              Já tenho conta
            </Link>
          </p>
        </div>
        <HeroVisual />
      </div>
    </section>
  );
}

function HeroVisual() {
  return (
    <div className="lp-hero-visual" aria-hidden="true">
      <div className="lp-symbol-halo" />
      <div
        className="lp-symbol-main"
        style={{ display: "grid", placeItems: "center" }}
      >
        <NinoSymbol size={240} />
      </div>
      <div className="lp-glass forecast">
        <small>Previsão do mês</small>
        <strong>R$ 4.820</strong>
        <div className="lp-spark" aria-hidden="true">
          <i style={{ height: "38%" }} />
          <i style={{ height: "60%" }} />
          <i style={{ height: "48%" }} />
          <i style={{ height: "72%" }} />
          <i style={{ height: "56%" }} />
          <i style={{ height: "82%" }} />
          <i style={{ height: "66%" }} />
        </div>
      </div>
      <div className="lp-glass goal">
        <small>Meta — Viagem</small>
        <strong>72%</strong>
        <div className="lp-bar"><span /></div>
      </div>
      <div className="lp-glass insight">
        <small>Insight do Nino</small>
        <strong style={{ fontSize: "1.05rem", lineHeight: 1.35 }}>
          Você gastou 22% a mais em alimentação nas últimas 2 semanas. Quer ajustar o plano?
        </strong>
      </div>
    </div>
  );
}

/* ---------------------------------- Pain ---------------------------------- */

const PAIN_ITEMS = [
  {
    n: "01",
    title: "O mês parece tranquilo — até deixar de parecer.",
    body: "Pequenos aumentos passam despercebidos e viram um rombo silencioso.",
  },
  {
    n: "02",
    title: "Você vê números, mas não sabe o que fazer com eles.",
    body: "Totais e gráficos não bastam quando falta contexto e recomendação.",
  },
  {
    n: "03",
    title: "As metas competem com a vida real.",
    body: "Sem acompanhamento contínuo, qualquer imprevisto tira o plano do caminho.",
  },
  {
    n: "04",
    title: "Organizar tudo exige energia demais.",
    body: "Quando registrar e categorizar vira tarefa, a rotina financeira não se sustenta.",
  },
];

function PainSection() {
  return (
    <section className="lp-section" id="dor">
      <div className="lp-wrap lp-problem-grid">
        <div className="lp-sticky">
          <div className="lp-label">O problema não é falta de vontade</div>
          <h2>Você só descobre que perdeu o controle quando já ficou caro demais.</h2>
          <p className="lp-sub">
            Aplicativos mostram o passado. O Nino ajuda você a interpretar o presente
            e a se preparar para o próximo passo.
          </p>
        </div>
        <div className="lp-problem-list">
          {PAIN_ITEMS.map((item) => (
            <article className="lp-problem" key={item.n}>
              <div className="lp-num">{item.n}</div>
              <div>
                <h3>{item.title}</h3>
                <p>{item.body}</p>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------- Bento (IA) ------------------------------- */

function IntelligenceBento() {
  return (
    <section className="lp-section" id="inteligencia">
      <div className="lp-wrap">
        <div className="lp-label">Inteligência com propósito</div>
        <h2>Nino não apenas registra. Ele percebe, projeta e ajuda você a agir.</h2>
        <p className="lp-sub">
          A IA do Nino trabalha em silêncio para transformar seus registros em contexto e
          decisões — não em mais uma tela cheia de números.
        </p>

        <div className="lp-bento">
          <div className="lp-col">
            <article className="lp-card">
              <h3>Fale como você já fala</h3>
              <p>
                Registre gastos por conversa, no ritmo do dia. O Nino entende, categoriza
                e confirma antes de salvar.
              </p>
              <div className="lp-chat" aria-hidden="true">
                <div className="lp-msg u">Gastei R$ 62 no jantar ontem</div>
                <div className="lp-msg n">
                  Anotado. R$ 62 em <b>Alimentação</b>, ontem. Confirmo?
                </div>
                <div className="lp-msg u">Confirmo</div>
                <div className="lp-msg n">
                  Pronto. Você já registrou R$ 1.240 em Alimentação neste mês.
                </div>
              </div>
            </article>

            <article className="lp-card">
              <h3>O contexto aparece antes da dúvida</h3>
              <p>
                Em vez de te devolver só números, o Nino conecta cada movimento ao seu
                momento — para que a próxima decisão fique mais clara.
              </p>
              <div className="lp-feature-line">
                <div className="lp-feature-icon">◎</div>
                <p>
                  “Você está gastando mais rápido do que na média — sobra estimada cai
                  para <b style={{ color: "var(--lp-ink)" }}>R$ 320</b> até o fim do mês.”
                </p>
              </div>
            </article>
          </div>

          <div className="lp-col">
            <article className="lp-card black">
              <h3>Previsões que ajudam a decidir hoje</h3>
              <p>
                Com base no seu histórico e nos próximos compromissos, o Nino projeta
                cenários de curto prazo — sem promessa de bola de cristal.
              </p>
              <div className="lp-predict">
                <div className="lp-metric">
                  <div>
                    <small style={{ color: "rgba(255,255,255,.6)", fontSize: ".78rem" }}>
                      Sobra estimada em 30 dias
                    </small>
                    <b>R$ 1.180</b>
                  </div>
                  <span className="lp-trend">−12%</span>
                </div>
                <div className="lp-bar" style={{ background: "rgba(255,255,255,.08)" }}>
                  <span style={{ width: "58%" }} />
                </div>
              </div>
            </article>

            <article className="lp-card">
              <h3>Metas acompanhadas de verdade</h3>
              <p>
                Cada aporte, cada gasto — o Nino atualiza o quadro em tempo real e
                sinaliza se a meta precisa de ajuste.
              </p>
              <div className="lp-feature-line">
                <div className="lp-feature-icon">◈</div>
                <p>
                  <b style={{ color: "var(--lp-ink)" }}>Viagem em setembro:</b> você está
                  no ritmo. Mais R$ 420 e a meta fecha antes do prazo.
                </p>
              </div>
            </article>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------ Features dark ----------------------------- */

const FEATURES = [
  { i: "✎", t: "Registro por conversa", d: "Anote gastos e entradas por texto, no app ou pelo WhatsApp." },
  { i: "◎", t: "Contexto imediato", d: "Cada valor vem acompanhado do impacto real no seu mês." },
  { i: "⟳", t: "Projeções de curto prazo", d: "Cenários de 30 dias com base no seu comportamento recente." },
  { i: "◈", t: "Metas em movimento", d: "Acompanhamento contínuo de aportes, prazos e ajustes." },
  { i: "!", t: "Alertas quando algo muda", d: "O Nino avisa quando categorias sobem fora do esperado." },
  { i: "≡", t: "Resumos por período", d: "Fechamentos semanais e mensais em linguagem humana." },
];

function FeaturesDark() {
  return (
    <section className="lp-section lp-dark" id="recursos">
      <div className="lp-wrap">
        <div className="lp-label" style={{ color: "#B7A6FF" }}>O que você recebe</div>
        <h2>Menos esforço para registrar. Mais inteligência para decidir.</h2>
        <p className="lp-sub">
          Um conjunto de recursos pensados para durar na sua rotina — não para impressionar
          na primeira tela.
        </p>
        <div className="lp-features">
          {FEATURES.map((f) => (
            <div className="lp-feature" key={f.t}>
              <div className="lp-ico" aria-hidden="true">{f.i}</div>
              <b>{f.t}</b>
              <p>{f.d}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* --------------------------------- AI band -------------------------------- */

function AIBand() {
  return (
    <section className="lp-section">
      <div className="lp-wrap">
        <div className="lp-ai-band">
          <div className="lp-ai-copy">
            <div className="lp-label" style={{ color: "#B7A6FF" }}>Nino.IA</div>
            <h2 style={{ fontSize: "clamp(1.9rem, 3.6vw, 3.4rem)", color: "#fff" }}>
              Inteligência artificial com uma função prática: ajudar você a agir antes.
            </h2>
            <p className="lp-sub">
              O Nino combina o histórico dos seus registros com sinais do mês atual para
              antecipar sobras, riscos e oportunidades — sempre com transparência sobre
              o que é fato e o que é estimativa.
            </p>
          </div>
          <div className="lp-ai-ui">
            <small style={{ color: "rgba(255,255,255,.6)", fontWeight: 700, letterSpacing: ".12em", textTransform: "uppercase", fontSize: ".72rem" }}>
              Projeção — próximos 30 dias
            </small>
            <div className="lp-forecast-list">
              <div className="lp-forecast-row">
                <span>Entradas previstas</span>
                <b>R$ 8.400</b>
              </div>
              <div className="lp-forecast-row">
                <span>Compromissos fixos</span>
                <b>R$ 4.120</b>
              </div>
              <div className="lp-forecast-row">
                <span>Sobra estimada</span>
                <b style={{ color: "#7CFFA6" }}>R$ 1.180</b>
              </div>
            </div>
            <p style={{ marginTop: 14, color: "rgba(255,255,255,.55)", fontSize: ".82rem" }}>
              Estimativas baseadas no seu histórico. Podem mudar conforme novos registros.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------- Social Proof ----------------------------- */

function SocialProof() {
  const QUOTES = [
    { p: "Comecei a perceber padrões que eu não via em planilhas.", a: "Exemplo demonstrativo" },
    { p: "Registrar pelo WhatsApp mudou meu jeito de anotar gastos.", a: "Exemplo demonstrativo" },
    { p: "As projeções me ajudam a decidir antes de comprar.", a: "Exemplo demonstrativo" },
  ];
  return (
    <section className="lp-section">
      <div className="lp-wrap">
        <div className="lp-label">Como as pessoas usam</div>
        <h2>Organização que finalmente cabe na rotina.</h2>
        <p className="lp-sub">
          Estes são exemplos demonstrativos enquanto reunimos depoimentos reais de quem
          está usando o Nino no dia a dia.
        </p>
        <div className="lp-features" style={{ marginTop: 32 }}>
          {QUOTES.map((q, i) => (
            <blockquote key={i} className="lp-card" style={{ margin: 0 }}>
              <p style={{ color: "var(--lp-ink)", fontSize: "1.05rem", margin: 0 }}>
                “{q.p}”
              </p>
              <small style={{ marginTop: 16, display: "block", color: "var(--lp-muted)" }}>
                {q.a}
              </small>
            </blockquote>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ----------------------------------- FAQ ---------------------------------- */

const FAQ_ITEMS = [
  {
    q: "O Nino é um banco?",
    a: "Não. O Nino é um assistente financeiro que organiza informações, acompanha sua rotina e oferece inteligência para decisões melhores.",
  },
  {
    q: "Como a inteligência artificial é usada?",
    a: "Para reconhecer padrões, identificar mudanças, projetar cenários e gerar orientações personalizadas com base nas informações que você registra.",
  },
  {
    q: "O Nino movimenta meu dinheiro?",
    a: "Não. O produto organiza e analisa informações; qualquer movimentação depende de autorização e de recursos específicos que sejam disponibilizados futuramente.",
  },
  {
    q: "Preciso preencher tudo manualmente?",
    a: "Não. Você pode registrar movimentações por conversa e usar recursos de importação disponíveis no produto.",
  },
  {
    q: "Quanto custa?",
    a: "Você pode começar gratuitamente. Planos e recursos adicionais serão apresentados com transparência.",
  },
];

function FAQSection() {
  return (
    <section className="lp-section" id="duvidas">
      <div className="lp-wrap">
        <div className="lp-label">Perguntas frequentes</div>
        <h2>Clareza antes de começar.</h2>
        <div className="lp-faq">
          {FAQ_ITEMS.map((item, i) => (
            <details key={i}>
              <summary>{item.q}</summary>
              <p>{item.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

/* --------------------------------- Final CTA ------------------------------ */

function FinalCTA() {
  return (
    <section id="comecar">
      <div className="lp-wrap">
        <div className="lp-final">
          <div className="lp-label" style={{ color: "rgba(255,255,255,.85)" }}>
            Comece hoje
          </div>
          <h2>O futuro do seu dinheiro não precisa ser uma surpresa.</h2>
          <p>
            Crie sua conta gratuita, converse com o Nino e comece a entender o que vem
            pela frente — sem planilha, sem julgamento.
          </p>
          <div className="lp-actions">
            <Link to="/signup" className="lp-btn secondary" style={{ background: "#fff", color: "var(--lp-ink)" }}>
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

/* --------------------------------- Footer --------------------------------- */

function LandingFooter() {
  return (
    <footer className="lp-footer">
      <div className="lp-wrap lp-footer-row">
        <div className="lp-logo">
          <NinoSymbol size={26} />
          <span className="lp-wordmark" style={{ fontSize: "1rem" }}>Meu Nino</span>
          <span className="lp-ia-pill">.IA</span>
        </div>
        <p style={{ margin: 0 }}>
          © {new Date().getFullYear()} Meu Nino.IA · Feito no Brasil com cuidado.
        </p>
      </div>
    </footer>
  );
}

/* ------------------------------ Mobile CTA bar ---------------------------- */

function LandingMobileCTA() {
  return (
    <div className="lp-mobile-cta">
      <Link to="/signup" className="lp-btn primary">
        Começar grátis →
      </Link>
    </div>
  );
}
