import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Plus } from "@phosphor-icons/react";
import { NinoLogo } from "./NinoLogo";
import { NinoSymbol } from "./NinoSymbol";
import "./landing.css";

/**
 * Landing pública Meu Nino.IA (rota "/").
 * Escopada em .mn-lp — não afeta app autenticado nem admin.
 *
 * Redesign narrativo em 6 capítulos causais:
 *  1. Hero              #hero
 *  2. Reconhecimento    #reconhecimento
 *  3. O Nino em ação    #acao
 *  4. Acompanha o mês   #mes
 *  5. Divisão do Rolê   #role
 *  6. Confiança+CTA+FAQ #comecar / #duvidas
 */
export default function LandingPage() {
  return (
    <div className="mn-lp">
      <LandingHeader />
      <main id="top">
        <HeroChapter />
        <RecognitionChapter />
        <StoryCanvasChapter />
        <MonthTrackingChapter />
        <SplitStoryChapter />
        <FinalChapter />
      </main>
      <LandingFooter />
    </div>
  );
}

/* ============================== Header =============================== */

function LandingHeader() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return (
    <header className={`lp-header${scrolled ? " is-scrolled" : ""}`}>
      <div className="lp-wrap lp-nav">
        <Link to="/" aria-label="Meu Nino.IA — início">
          <NinoLogo variant="dark" size="sm" />
        </Link>
        <nav className="lp-nav-links" aria-label="Principal">
          <a href="#acao">Como ajuda</a>
          <a href="#role">Divisão do Rolê</a>
          <a href="#duvidas">Dúvidas</a>
          <Link to="/login">Entrar</Link>
        </nav>
        <Link to="/login" className="lp-nav-mobile-login">Entrar</Link>
      </div>
    </header>
  );
}

/* ============================ Cap. 1 — Hero ========================== */

function HeroChapter() {
  return (
    <section className="lp-chapter lp-chapter--ink lp-hero" id="hero">
      <div className="lp-wrap lp-hero-grid">
        <div className="lp-hero-copy">
          <h1>
            Seu dinheiro não está desorganizado.{" "}
            <span className="lp-hero-h1-soft">
              Só faltava alguém para cuidar dele com você.
            </span>
          </h1>
          <p className="lp-lead">
            O Nino entende o que você registra, percebe quando o mês muda e
            mostra o que fazer antes que aperte.
          </p>
          <p className="lp-hero-apoio">Pelo WhatsApp ou pelo app.</p>
          <div className="lp-actions">
            <Link to="/signup" className="lp-btn primary">
              Quero meu Nino grátis
            </Link>
          </div>
          <p className="lp-micro">
            Grátis para começar · Sem cartão · Menos de 1 minuto
          </p>
        </div>
        <HeroArtboard />
      </div>
      <div className="lp-hero-transition" aria-hidden="true" />
    </section>
  );
}

function HeroArtboard() {
  return (
    <div className="lp-hero-artboard" aria-hidden="true">
      <div className="lp-chat-head">
        <span className="lp-chat-avatar"><NinoSymbol size={22} /></span>
        <div>
          <strong>Nino</strong>
          <small>agora</small>
        </div>
      </div>
      <div className="lp-msg user">Gastei R$ 80 no bar ontem no Nubank.</div>
      <div className="lp-msg nino">Registrado em Lazer · Nubank · ontem</div>
      <div className="lp-msg nino">
        Nesse ritmo, seu mês fecha em <b>R$ 3.180</b>.
      </div>
      <div className="lp-hero-summary">
        <span className="lp-hero-summary-label">Previsão atualizada</span>
        <span className="lp-hero-summary-value">R$ 3.180</span>
      </div>
    </div>
  );
}

/* ==================== Cap. 2 — Reconhecimento ======================== */

const TIMELINE_ITEMS = [
  { day: "Segunda", value: "R$ 42", note: "delivery" },
  { day: "Quarta", value: "R$ 29", note: "assinatura que você esqueceu" },
  { day: "Sexta", value: "R$ 86", note: "jantar fora" },
  { day: "Domingo", value: "R$ 54", note: "outro delivery" },
];

function RecognitionChapter() {
  return (
    <section
      className="lp-chapter lp-chapter--cloud lp-recognition"
      id="reconhecimento"
    >
      <div className="lp-wrap">
        <div className="lp-chapter-head">
          <h2>O mês não sai do controle de uma vez.</h2>
          <p className="lp-lead">
            Ele muda em pequenas decisões que parecem inofensivas quando
            acontecem.
          </p>
        </div>

        <ol className="lp-timeline" aria-hidden="true">
          {TIMELINE_ITEMS.map((it) => (
            <li key={it.day} className="lp-timeline-item">
              <span className="lp-timeline-dot" />
              <span className="lp-timeline-day">{it.day}</span>
              <span className="lp-timeline-value">{it.value}</span>
              <span className="lp-timeline-note">· {it.note}</span>
            </li>
          ))}
        </ol>

        <p className="lp-timeline-close">
          Separados, parecem pouco. Juntos, mudam o mês.
        </p>
        <p className="lp-timeline-nino">
          O Nino acompanha esses sinais enquanto ainda dá tempo de escolher
          diferente.
        </p>
      </div>
    </section>
  );
}

/* ================== Cap. 3 — O Nino em ação ========================== */

function StoryCanvasChapter() {
  return (
    <section
      className="lp-chapter lp-chapter--white lp-story-chapter"
      id="acao"
    >
      <div className="lp-wrap">
        <div className="lp-chapter-head">
          <h2>Uma conversa vira contexto. O contexto vira uma decisão melhor.</h2>
          <p className="lp-lead">
            O Nino não joga um gráfico na sua tela. Ele mostra o que mudou, por
            que mudou e o que você pode fazer agora.
          </p>
        </div>

        <div className="lp-story" aria-hidden="true">
          <div className="lp-story-rail" />

          <div className="lp-story-step">
            <span className="lp-story-step-num">1</span>
            <div className="lp-story-step-body">
              <p className="lp-story-step-label">Registro</p>
              <div className="lp-msg user">Gastei R$ 80 no bar ontem no Nubank.</div>
              <div className="lp-msg nino">
                Registrado em Lazer · Nubank · ontem
              </div>
            </div>
          </div>

          <div className="lp-story-step">
            <span className="lp-story-step-num">2</span>
            <div className="lp-story-step-body">
              <p className="lp-story-step-label">Impacto</p>
              <div className="lp-story-impact">
                <p className="lp-story-impact-caption">Previsão de fechamento</p>
                <p className="lp-story-impact-value">R$ 3.180</p>
                <p className="lp-story-impact-delta">
                  ▲ 8% acima do mês anterior
                </p>
              </div>
            </div>
          </div>

          <div className="lp-story-step">
            <span className="lp-story-step-num">3</span>
            <div className="lp-story-step-body">
              <p className="lp-story-step-label">O que puxou a alta</p>
              <ul className="lp-story-bars">
                <ImpactBar label="Lazer" pct={78} value="+ R$ 180" tone="coral" />
                <ImpactBar label="Alimentação fora" pct={48} value="+ R$ 95" tone="coral" />
                <ImpactBar label="Outras" pct={20} value="+ R$ 34" tone="coral" />
              </ul>
            </div>
          </div>

          <div className="lp-story-step">
            <span className="lp-story-step-num">4</span>
            <div className="lp-story-step-body">
              <p className="lp-story-step-label">Ação</p>
              <div className="lp-msg nino">
                Se você limitar Lazer e alimentação fora a{" "}
                <b>R$ 350</b> até o fim do mês, a projeção cai para{" "}
                <b className="lp-story-mint">R$ 2.940</b>.
              </div>
              <div className="lp-story-action">
                <button type="button" className="lp-btn primary" tabIndex={-1}>
                  Criar limite de R$ 350
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function ImpactBar({
  label,
  pct,
  value,
  tone,
}: {
  label: string;
  pct: number;
  value: string;
  tone: "coral" | "mint";
}) {
  return (
    <li className="lp-impact-bar">
      <span className="lp-impact-bar-label">{label}</span>
      <span className="lp-impact-bar-track">
        <span
          className={`lp-impact-bar-fill lp-impact-bar-fill--${tone}`}
          style={{ width: `${pct}%` }}
        />
      </span>
      <span className="lp-impact-bar-value">{value}</span>
    </li>
  );
}

/* ================= Cap. 4 — O Nino acompanha o mês =================== */

function MonthTrackingChapter() {
  return (
    <section
      className="lp-chapter lp-chapter--cloud lp-month"
      id="mes"
    >
      <div className="lp-wrap">
        <div className="lp-chapter-head">
          <h2>O Nino não olha só para um gasto. Ele acompanha o que está mudando na sua vida.</h2>
        </div>

        {/* Caso A — Padrão de gasto */}
        <article className="lp-month-case">
          <h3>Ele percebe padrões antes de virarem hábito.</h3>
          <p className="lp-month-lede">
            Delivery subiu <b>22%</b> nas últimas 3 semanas.{" "}
            <span className="lp-muted">73% aconteceram entre sexta e domingo.</span>
          </p>

          <PatternGrid />

          <div className="lp-msg nino lp-month-nino">
            Seu aumento não está espalhado pela semana. Ele está concentrado no
            fim de semana.
          </div>
          <button type="button" className="lp-btn ghost lp-month-action" tabIndex={-1}>
            Criar limite para sexta a domingo
          </button>
        </article>

        <div className="lp-month-divider" role="presentation" />

        {/* Caso B — Meta */}
        <article className="lp-month-case">
          <h3>E mantém seus planos conectados ao mês real.</h3>

          <div className="lp-goal-block">
            <p className="lp-goal-title">Viagem de fim de ano</p>
            <p className="lp-goal-progress">
              <span className="lp-goal-current">R$ 4.320</span>
              <span className="lp-goal-of">de R$ 6.000</span>
              <span className="lp-goal-pct">72%</span>
            </p>
            <div className="lp-goal-bar-mint" aria-hidden="true">
              <span style={{ width: "72%" }} />
            </div>
            <dl className="lp-goal-meta-grid">
              <div>
                <dt>Falta</dt>
                <dd>R$ 1.680</dd>
              </div>
              <div>
                <dt>Ritmo</dt>
                <dd>R$ 280 / mês</dd>
              </div>
              <div>
                <dt>Previsão</dt>
                <dd>novembro</dd>
              </div>
            </dl>
          </div>

          <div className="lp-msg nino lp-month-nino">
            Com <b>R$ 280 por mês</b>, você chega em novembro. Se gastar R$ 200
            a menos neste mês, pode antecipar para outubro.
          </div>
          <button type="button" className="lp-btn ghost lp-month-action" tabIndex={-1}>
            Ver um plano possível
          </button>
        </article>
      </div>
    </section>
  );
}

/**
 * Grade 3 semanas × 7 dias.
 * Coral apenas em sexta (5), sábado (6) e domingo (0/7).
 */
function PatternGrid() {
  const DAYS = ["S", "T", "Q", "Q", "S", "S", "D"];
  const rows = [0, 1, 2];
  const activeCols = new Set([4, 5, 6]); // sex, sáb, dom
  return (
    <div className="lp-pattern-grid" aria-hidden="true">
      <div className="lp-pattern-head">
        {DAYS.map((d, i) => (
          <span key={i}>{d}</span>
        ))}
      </div>
      {rows.map((r) => (
        <div key={r} className="lp-pattern-row">
          {DAYS.map((_, c) => (
            <span
              key={c}
              className={`lp-pattern-dot${activeCols.has(c) ? " is-active" : ""}`}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/* ==================== Cap. 5 — Divisão do Rolê ======================= */

function SplitStoryChapter() {
  return (
    <section
      className="lp-chapter lp-chapter--white lp-split-chapter"
      id="role"
    >
      <div className="lp-wrap">
        <div className="lp-chapter-head">
          <h2>Dividir a conta não deveria virar outra conta para você resolver.</h2>
          <p className="lp-lead">
            Você fala quem foi e quanto deu. O Nino organiza a divisão,
            acompanha quem pagou e deixa a mensagem pronta para quem ficou
            pendente.
          </p>
        </div>

        <div className="lp-split-story" aria-hidden="true">
          {/* 1. Conversa */}
          <div className="lp-split-step">
            <p className="lp-split-step-label">1 · Conversa</p>
            <div className="lp-msg user">
              O jantar deu R$ 480. Eu, Ana, Bruno e Camila.
            </div>
          </div>

          {/* 2. Divisão */}
          <div className="lp-split-step">
            <p className="lp-split-step-label">2 · Divisão</p>
            <div className="lp-split-card">
              <div className="lp-split-card-head">
                <p className="lp-split-card-title">Jantar de sábado</p>
                <p className="lp-split-card-sub">4 pessoas · R$ 120 cada</p>
              </div>
              <ul className="lp-split-participants">
                <SplitPerson name="Você" status="pago" />
                <SplitPerson name="Ana" status="pago" />
                <SplitPerson name="Bruno" status="pendente" />
                <SplitPerson name="Camila" status="pendente" />
              </ul>
            </div>
          </div>

          {/* 3. Mensagem preparada */}
          <div className="lp-split-step">
            <p className="lp-split-step-label">3 · Mensagem preparada</p>
            <div className="lp-msg nino lp-split-message">
              Oi, Bruno! Sua parte do jantar de sábado ficou em{" "}
              <b>R$ 120</b>. Quando conseguir, me avisa por aqui 🙂
            </div>
            <button type="button" className="lp-btn ghost lp-month-action" tabIndex={-1}>
              Copiar lembrete
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function SplitPerson({
  name,
  status,
}: {
  name: string;
  status: "pago" | "pendente";
}) {
  return (
    <li className="lp-split-person">
      <span className="lp-split-avatar">{name[0]}</span>
      <span className="lp-split-name">{name}</span>
      <span className={`lp-split-status ${status}`}>
        {status === "pago" ? "Pago" : "Pendente"}
      </span>
    </li>
  );
}

/* =========== Cap. 6 — Confiança + CTA + FAQ ========================== */

const FAQ_ITEMS = [
  {
    q: "O Nino é um banco?",
    a: "Não. Ele organiza informações, explica mudanças e ajuda você a decidir.",
  },
  {
    q: "Funciona pelo WhatsApp?",
    a: "Sim. Você conversa com o Nino pelo WhatsApp ou usa o app.",
  },
  {
    q: "Como as previsões funcionam?",
    a: "São calculadas com base no que você registra, no seu ritmo atual e no histórico. O Nino mostra o que influenciou cada previsão.",
  },
  {
    q: "O Nino movimenta meu dinheiro?",
    a: "Não. Ele organiza, explica e sugere caminhos. Nenhuma movimentação é feita automaticamente.",
  },
];

function FinalChapter() {
  return (
    <section className="lp-final-chapter" id="comecar">
      <div className="lp-final-symbol" aria-hidden="true">
        <NinoSymbol size={480} />
      </div>

      <div className="lp-wrap lp-final-inner">
        <div className="lp-trust-strip">
          <p className="lp-trust-head">Você continua no controle.</p>
          <ul className="lp-trust-lines">
            <li>O Nino não movimenta seu dinheiro.</li>
            <li>Você escolhe o que registrar.</li>
            <li>Toda previsão mostra o que influenciou o resultado.</li>
          </ul>
        </div>

        <div className="lp-final-cta">
          <h2>Entenda seu mês enquanto ainda dá tempo de mudar.</h2>
          <p className="lp-lead">
            Comece com uma conversa. O Nino organiza o resto com você.
          </p>
          <div className="lp-actions">
            <Link to="/signup" className="lp-btn primary">
              Quero meu Nino grátis
            </Link>
          </div>
          <p className="lp-micro">Grátis para começar · Sem cartão de crédito</p>
        </div>

        <div className="lp-faq-inline" id="duvidas">
          <h3 className="lp-faq-title">Dúvidas frequentes</h3>
          <div className="lp-faq">
            {FAQ_ITEMS.map((item) => (
              <details key={item.q}>
                <summary>
                  {item.q}
                  <Plus size={20} weight="regular" className="lp-faq-icon" />
                </summary>
                <p>{item.a}</p>
              </details>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ================================ Footer ============================= */

function LandingFooter() {
  return (
    <footer className="lp-footer">
      <div className="lp-wrap lp-footer-row">
        <NinoLogo variant="dark" size="sm" />
        <p className="lp-footer-copy">© 2026 Meu Nino.IA</p>
        <nav className="lp-footer-links" aria-label="Rodapé">
          <a href="#duvidas">Dúvidas</a>
          <Link to="/login">Entrar</Link>
        </nav>
      </div>
    </footer>
  );
}
