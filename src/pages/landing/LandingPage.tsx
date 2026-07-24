import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Plus } from "@phosphor-icons/react";
import { NinoLogo } from "./NinoLogo";
import { NinoSymbol } from "./NinoSymbol";
import "./landing.css";

/**
 * Landing page pública Meu Nino.IA (rota "/").
 * Escopada em .mn-lp — não afeta app autenticado nem admin.
 *
 * Estrutura: 7 blocos, refinamento mobile-first (auditoria .lovable/plan.md).
 *  1. Hero            #top / #hero
 *  2. Manifesto       #manifesto
 *  3. Demonstração    #demonstracao
 *  4. Transformação   #transformacao   (2 splits)
 *  5. Divisão do Rolê #role
 *  6. Simples+Confiança #simples
 *  7. CTA Final + FAQ #comecar / #duvidas
 */
export default function LandingPage() {
  return (
    <div className="mn-lp">
      <LandingHeader />
      <main id="top">
        <HeroSection />
        <ManifestoSection />
        <DemoSection />
        <TransformSection />
        <RoleSection />
        <SimpleTrustSection />
        <FinalCtaSection />
        <FAQSection />
      </main>
      <LandingFooter />
      <MobileCta />
    </div>
  );
}

/* ============================== Header =============================== */

function LandingHeader() {
  return (
    <header className="lp-header">
      <div className="lp-wrap lp-nav">
        <Link to="/" aria-label="Meu Nino.IA — início">
          <NinoLogo variant="dark" size="sm" />
        </Link>
        <nav className="lp-nav-links" aria-label="Principal">
          <a href="#transformacao">Como ajuda</a>
          <a href="#role">Divisão do Rolê</a>
          <a href="#duvidas">Dúvidas</a>
          <Link to="/login">Entrar</Link>
        </nav>
        <Link to="/login" className="lp-nav-mobile-login">Entrar</Link>
      </div>
    </header>
  );
}

/* =============================== Hero ================================ */

function HeroSection() {
  return (
    <section className="lp-hero" id="hero">
      <div className="lp-wrap lp-hero-grid">
        <div className="lp-hero-copy">
          <h1>
            Seu dinheiro não está desorganizado.{" "}
            <span className="lp-hero-h1-soft">
              Só faltava alguém para cuidar dele com você.
            </span>
          </h1>
          <p className="lp-lead">
            O Nino registra sua rotina, percebe mudanças e ajuda você a decidir
            — pelo WhatsApp ou pelo app.
          </p>
          <div className="lp-actions">
            <Link to="/signup" className="lp-btn primary">
              Quero meu Nino grátis
            </Link>
          </div>
          <p className="lp-micro">
            Grátis para começar · Sem cartão · Menos de 1 minuto
          </p>
        </div>
        <HeroMockup />
      </div>
    </section>
  );
}

function HeroMockup() {
  return (
    <div className="lp-chat lp-chat--hero" aria-hidden="true">
      <div className="lp-chat-head">
        <span className="lp-chat-avatar"><NinoSymbol size={22} /></span>
        <div>
          <strong>Nino</strong>
          <small>agora</small>
        </div>
      </div>
      <div className="lp-msg user">Gastei R$ 80 no bar ontem no Nubank.</div>
      <div className="lp-msg nino">Organizei em Lazer.</div>
      <div className="lp-msg nino">
        Nesse ritmo, seu mês fecha em <b>R$ 3.180</b> — 8% acima do anterior.
      </div>
    </div>
  );
}

/* ============================ Manifesto ============================== */

function ManifestoSection() {
  return (
    <section className="lp-manifesto" id="manifesto">
      <div className="lp-wrap lp-manifesto-inner">
        <p className="lp-manifesto-1">
          O mês não sai do controle em um único gasto.
        </p>
        <p className="lp-manifesto-2">Ele muda aos poucos.</p>

        <div className="lp-manifesto-signals">
          <p className="lp-manifesto-line">Um delivery a mais.</p>
          <p className="lp-manifesto-line">Uma assinatura esquecida.</p>
          <p className="lp-manifesto-line">Uma semana mais cara que o normal.</p>
        </div>

        <p className="lp-manifesto-close">
          Quando você percebe, a fatura já fechou.
        </p>

        <p className="lp-manifesto-final">
          — O Nino acompanha esses sinais com você.
        </p>
      </div>
    </section>
  );
}

/* =========================== Demonstração ============================ */

function DemoSection() {
  return (
    <section className="lp-section lp-section--white" id="demonstracao">
      <div className="lp-wrap lp-demo-inner">
        <div className="lp-section-head">
          <h2>Antes de mostrar um número, o Nino explica o que mudou.</h2>
          <p className="lp-lead">
            Você conta o que aconteceu. O Nino organiza, compara com o seu ritmo
            e mostra o que isso muda no restante do mês.
          </p>
        </div>

        <div className="lp-chat lp-chat--light lp-chat--unified" aria-hidden="true">
          <div className="lp-msg user">Gastei R$ 80 no bar ontem no Nubank.</div>
          <div className="lp-msg nino">Organizei em Lazer.</div>
          <div className="lp-msg nino">
            Nesse ritmo, seu mês fecha em <b>R$ 3.180</b> — 8% acima do anterior.
          </div>

          <div className="lp-chat-spark">
            <svg viewBox="0 0 320 56" preserveAspectRatio="none" aria-hidden="true">
              <defs>
                <linearGradient id="lp-trend-grad" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0" stopColor="#6D4AFF" />
                  <stop offset="1" stopColor="#FF6B5F" />
                </linearGradient>
              </defs>
              <path
                d="M0,44 C40,38 70,34 110,34 C150,34 180,26 220,18 C250,12 275,10 320,8"
                fill="none"
                stroke="url(#lp-trend-grad)"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <circle cx="320" cy="8" r="4" fill="#FF6B5F" />
            </svg>
            <p className="lp-chat-spark-label">8% acima do mês anterior</p>
          </div>

          <div className="lp-msg suggestion">
            Quer definir um limite para o restante do mês?
          </div>
        </div>
      </div>
    </section>
  );
}

/* =========================== Transformação =========================== */

function TransformSection() {
  return (
    <section className="lp-section lp-section--cloud" id="transformacao">
      <div className="lp-wrap">
        <div className="lp-section-head lp-section-head--center">
          <h2>Menos planilha. Mais clareza.</h2>
        </div>

        {/* A. Perceber antes que aperte */}
        <div className="lp-split">
          <div className="lp-split-copy">
            <h3>Perceber antes que aperte.</h3>
            <p>
              O Nino nota quando seu ritmo muda e avisa enquanto ainda dá tempo
              de ajustar.
            </p>
          </div>
          <div className="lp-split-visual">
            <div className="lp-note" aria-hidden="true">
              <span className="lp-note-dot" />
              <p className="lp-note-title">
                Seus gastos com delivery aumentaram nas últimas 3 semanas.
              </p>
              <p className="lp-note-sub">
                A maior parte aconteceu às sextas e sábados.
              </p>
            </div>
          </div>
        </div>

        {/* B. Manter seus planos vivos */}
        <div className="lp-split lp-split--reverse">
          <div className="lp-split-copy">
            <h3>Manter seus planos vivos.</h3>
            <p>
              Suas metas deixam de ser um número esquecido e passam a caminhar
              com o mês.
            </p>
          </div>
          <div className="lp-split-visual">
            <div className="lp-goal" aria-hidden="true">
              <p className="lp-goal-quote">
                “Mantendo o ritmo atual, você chega lá em novembro.”
              </p>
              <div className="lp-goal-bar"><span style={{ width: "72%" }} /></div>
              <p className="lp-goal-meta">
                Viagem de fim de ano <span>· 72%</span>
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ============================ Divisão do Rolê ======================== */

function RoleSection() {
  const participantes = [
    { nome: "Ana", status: "pago" as const },
    { nome: "Bruno", status: "pago" as const },
    { nome: "Camila", status: "pendente" as const },
  ];
  return (
    <section className="lp-section lp-section--white" id="role">
      <div className="lp-wrap lp-role-inner">
        <div className="lp-section-head">
          <h2>Dividir a conta não deveria virar outra conta pra você resolver.</h2>
          <p className="lp-lead">
            Você conta quem foi e quanto foi. O Nino calcula a parte de cada um
            e prepara um lembrete amigável.
          </p>
        </div>
        <div className="lp-role-card" aria-hidden="true">
          <div className="lp-role-head">
            <div>
              <p className="lp-role-title">Jantar de sábado</p>
              <p className="lp-role-sub">4 pessoas · R$ 120 por pessoa</p>
            </div>
            <p className="lp-role-total">R$ 480</p>
          </div>
          <ul className="lp-role-list">
            {participantes.map((p) => (
              <li key={p.nome}>
                <span className="lp-role-avatar">{p.nome[0]}</span>
                <span className="lp-role-name">{p.nome}</span>
                <span className={`lp-role-status ${p.status}`}>
                  {p.status === "pago" ? "Pago" : "Pendente"}
                </span>
              </li>
            ))}
            <li className="lp-role-more">+1 pessoa</li>
          </ul>
          <button type="button" className="lp-btn ghost lp-role-btn" tabIndex={-1}>
            Preparar lembrete
          </button>
        </div>
      </div>
    </section>
  );
}

/* ======================= Simplicidade + Confiança ==================== */

function SimpleTrustSection() {
  return (
    <section className="lp-section lp-section--cloud" id="simples">
      <div className="lp-wrap">
        <div className="lp-section-head lp-section-head--center">
          <h2>Simples de usar. Claro no que faz.</h2>
        </div>

        <ol className="lp-steps lp-steps--inline">
          <li>
            <span className="lp-step-num">01</span>
            <p className="lp-step-title">Você conta.</p>
          </li>
          <li>
            <span className="lp-step-num">02</span>
            <p className="lp-step-title">O Nino organiza e explica.</p>
          </li>
          <li>
            <span className="lp-step-num">03</span>
            <p className="lp-step-title">Você decide.</p>
          </li>
        </ol>

        <p className="lp-trust-para">
          Você escolhe o que registrar. O Nino não movimenta seu dinheiro — só
          organiza, explica e sugere caminhos em linguagem humana.
        </p>
      </div>
    </section>
  );
}

/* =============================== CTA final =========================== */

function FinalCtaSection() {
  return (
    <section className="lp-final" id="comecar">
      <div className="lp-final-symbol" aria-hidden="true">
        <NinoSymbol size={480} />
      </div>
      <div className="lp-wrap lp-final-inner">
        <h2>Comece a entender seu dinheiro antes que o mês termine.</h2>
        <p className="lp-lead">
          Uma conversa com o Nino já muda o jeito que você olha pros seus números.
        </p>
        <div className="lp-actions">
          <Link to="/signup" className="lp-btn primary">
            Quero meu Nino grátis
          </Link>
        </div>
        <p className="lp-micro">Grátis para começar · Sem cartão de crédito</p>
      </div>
    </section>
  );
}

/* ================================= FAQ =============================== */

const FAQ_ITEMS = [
  {
    q: "O Nino é um banco?",
    a: "Não. Ele organiza informações, explica mudanças e ajuda você a decidir. Não movimenta dinheiro.",
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
    q: "Meus dados ficam seguros?",
    a: "Ficam. Nada é compartilhado sem seu consentimento e nenhuma decisão financeira é tomada automaticamente.",
  },
];

function FAQSection() {
  return (
    <section className="lp-section lp-section--cloud lp-section--faq" id="duvidas">
      <div className="lp-wrap lp-faq-inner">
        <div className="lp-section-head">
          <h2>Dúvidas frequentes</h2>
        </div>
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
          <a href="#simples">Privacidade</a>
          <a href="#duvidas">Termos</a>
          <Link to="/login">Entrar</Link>
        </nav>
      </div>
    </footer>
  );
}

/* ============================ Mobile CTA ============================= */

/**
 * CTA fixo mobile refinado (auditoria §9).
 *  - Oculto em: #hero, #comecar, #duvidas, .lp-footer.
 *  - Fundo Deep Ink sólido (sem gradiente), altura ~52px.
 *  - Delay 200ms de primeira aparição para evitar flicker.
 */
function MobileCta() {
  const [visible, setVisible] = useState(false);
  const heroVisibleRef = useRef(true);
  const suppressorVisibleRef = useRef(false);
  const armedRef = useRef(false);

  useEffect(() => {
    const hero = document.getElementById("hero");
    const finalCta = document.getElementById("comecar");
    const faq = document.getElementById("duvidas");
    const footer = document.querySelector(".lp-footer");

    const supportsIO = typeof IntersectionObserver !== "undefined";
    const armTimer = window.setTimeout(() => {
      armedRef.current = true;
      update();
    }, 200);

    function update() {
      if (!armedRef.current) return;
      setVisible(!heroVisibleRef.current && !suppressorVisibleRef.current);
    }

    if (!supportsIO) {
      const onScroll = () => {
        if (!armedRef.current) return;
        setVisible(window.scrollY > 320);
      };
      window.addEventListener("scroll", onScroll, { passive: true });
      return () => {
        window.clearTimeout(armTimer);
        window.removeEventListener("scroll", onScroll);
      };
    }

    const suppressors = new Map<Element, boolean>();
    const heroObs = new IntersectionObserver(
      ([entry]) => {
        heroVisibleRef.current = entry.isIntersecting;
        update();
      },
      { threshold: 0.15 },
    );
    const suppressObs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) suppressors.set(e.target, e.isIntersecting);
        suppressorVisibleRef.current = Array.from(suppressors.values()).some(Boolean);
        update();
      },
      { threshold: 0.05 },
    );

    if (hero) heroObs.observe(hero);
    for (const el of [finalCta, faq, footer]) {
      if (el) suppressObs.observe(el);
    }

    return () => {
      window.clearTimeout(armTimer);
      heroObs.disconnect();
      suppressObs.disconnect();
    };
  }, []);

  useEffect(() => {
    document.body.classList.toggle("mn-lp-has-mobile-cta", visible);
    return () => document.body.classList.remove("mn-lp-has-mobile-cta");
  }, [visible]);

  return (
    <div
      className={`lp-mobile-cta${visible ? " is-visible" : ""}`}
      aria-hidden={!visible}
    >
      <Link to="/signup" className="lp-mobile-cta-btn" tabIndex={visible ? 0 : -1}>
        Começar grátis
      </Link>
    </div>
  );
}
