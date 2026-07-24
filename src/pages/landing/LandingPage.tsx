import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { CaretRight, Plus } from "@phosphor-icons/react";
import { NinoLogo } from "./NinoLogo";
import { NinoSymbol } from "./NinoSymbol";
import "./landing.css";

/**
 * Landing page pública Meu Nino.IA (rota "/").
 * Escopada em .mn-lp — não afeta app autenticado nem admin.
 *
 * Estrutura fechada: 7 blocos.
 *  1. Hero            #top
 *  2. Manifesto       #manifesto
 *  3. Demonstração    #demonstracao   (absorve previsao/comportamento/insights)
 *  4. Transformação   #transformacao  (absorve metas + o que muda)
 *  5. Divisão do Rolê #role
 *  6. Simplicidade+Confiança #simples (absorve como-funciona/confianca/seguranca)
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
          <span className="lp-eyebrow">Inteligência financeira conversacional</span>
          <h1>
            Seu dinheiro não está desorganizado.{" "}
            <span className="lp-hero-h1-soft">
              Só faltava alguém para cuidar dele com você.
            </span>
          </h1>
          <p className="lp-lead">
            O Nino registra sua rotina, percebe mudanças e ajuda você a decidir
            antes que o mês aperte.
          </p>
          <p className="lp-lead lp-lead--tight">Pelo WhatsApp ou pelo app.</p>
          <div className="lp-actions">
            <Link to="/signup" className="lp-btn primary">
              Quero meu Nino grátis
            </Link>
            <a href="#demonstracao" className="lp-btn-link">
              Ver o Nino em ação
            </a>
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
      <div className="lp-msg nino">Pronto. Organizei em Lazer.</div>
      <div className="lp-msg nino">
        Nesse ritmo, seu mês fecha em <b>R$ 3.180</b> — 8% acima do anterior.
      </div>
      <div className="lp-msg suggestion">
        Quer definir um limite para o restante do mês?
      </div>
    </div>
  );
}

/* ============================ Manifesto ============================== */

function ManifestoSection() {
  return (
    <section className="lp-manifesto" id="manifesto">
      <div className="lp-wrap lp-manifesto-inner">
        <p className="lp-manifesto-1">O mês não sai do controle em um único gasto.</p>
        <p className="lp-manifesto-2">Ele muda aos poucos.</p>

        <p className="lp-manifesto-line">Um delivery a mais.</p>
        <p className="lp-manifesto-line">Uma assinatura esquecida.</p>
        <p className="lp-manifesto-line">Uma semana mais cara do que o normal.</p>

        <p className="lp-manifesto-close">Quando você percebe, a fatura já fechou.</p>

        <p className="lp-manifesto-final">
          O Nino acompanha esses sinais com você.
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

        <div className="lp-demo-mockup" aria-hidden="true">
          <div className="lp-chat lp-chat--light">
            <div className="lp-msg user">Gastei R$ 80 no bar ontem no Nubank.</div>
            <div className="lp-msg nino">Pronto. Organizei em Lazer.</div>
            <div className="lp-msg nino">
              Nesse ritmo, seu mês fecha em <b>R$ 3.180</b> — 8% acima do anterior.
            </div>
            <div className="lp-msg nino">
              Lazer e alimentação fora explicam a maior parte da alta.
            </div>
            <button type="button" className="lp-inline-action" tabIndex={-1}>
              Definir um limite para o restante do mês
            </button>
          </div>

          <div className="lp-trend">
            <svg viewBox="0 0 320 90" preserveAspectRatio="none" aria-hidden="true">
              <defs>
                <linearGradient id="lp-trend-grad" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0" stopColor="#6D4AFF" />
                  <stop offset="1" stopColor="#FF6B5F" />
                </linearGradient>
              </defs>
              <path
                d="M0,72 C40,62 70,54 110,54 C150,54 180,44 220,32 C250,24 275,20 320,16"
                fill="none"
                stroke="url(#lp-trend-grad)"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <circle cx="320" cy="16" r="5" fill="#FF6B5F" />
            </svg>
            <p className="lp-trend-label">8% acima do mês anterior</p>
          </div>
        </div>

        <p className="lp-demo-legend">
          Uma conversa. Um registro. Uma previsão que muda com você.
        </p>
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
              O Nino percebe quando seu ritmo muda e avisa enquanto ainda dá
              tempo de ajustar.
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
              <span className="lp-note-cta">Ver onde aumentou</span>
            </div>
          </div>
        </div>

        {/* B. Manter seus planos vivos */}
        <div className="lp-split lp-split--reverse">
          <div className="lp-split-copy">
            <h3>Manter seus planos vivos.</h3>
            <p>
              Metas deixam de ser um número esquecido e passam a acompanhar o
              que acontece no mês.
            </p>
          </div>
          <div className="lp-split-visual">
            <div className="lp-goal" aria-hidden="true">
              <div className="lp-goal-head">
                <span className="lp-goal-name">Viagem de fim de ano</span>
                <span className="lp-goal-pct">72%</span>
              </div>
              <div className="lp-goal-bar"><span style={{ width: "72%" }} /></div>
              <p className="lp-goal-values">R$ 4.320 <span>de R$ 6.000</span></p>
              <p className="lp-goal-note">
                Mantendo o ritmo atual, você chega lá em novembro.
              </p>
              <p className="lp-goal-note lp-goal-note--muted">
                Se o próximo aporte cair, o Nino recalcula o caminho.
              </p>
            </div>
          </div>
        </div>

        {/* C. Resolver a rotina em uma conversa */}
        <div className="lp-split">
          <div className="lp-split-copy">
            <h3>Resolver a rotina em uma conversa.</h3>
            <p>
              Registrar, corrigir, perguntar e entender. Você fala como fala.
              O Nino organiza.
            </p>
          </div>
          <div className="lp-split-visual">
            <div className="lp-chat lp-chat--light lp-chat--mini" aria-hidden="true">
              <div className="lp-msg user">Foi no débito, não no crédito.</div>
              <div className="lp-msg nino">
                Corrigido. O lançamento agora está no débito.
              </div>
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
    { nome: "Diego", status: "pendente" as const },
  ];
  return (
    <section className="lp-section lp-section--white" id="role">
      <div className="lp-wrap lp-role-inner">
        <div className="lp-section-head">
          <h2>Dividir a conta não deveria virar outra conta pra você resolver.</h2>
          <p className="lp-lead">
            Você conta quem foi, quanto foi e quem pagou. O Nino calcula a parte
            de cada um e ajuda você a preparar um lembrete amigável.
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
                <span className="lp-role-value">R$ 120</span>
                <span className={`lp-role-status ${p.status}`}>
                  {p.status === "pago" ? "Pago" : "Pendente"}
                </span>
              </li>
            ))}
          </ul>
          <button type="button" className="lp-btn primary lp-role-btn" tabIndex={-1}>
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
        <div className="lp-section-head">
          <h2>Falar com o Nino é simples. Entender o que ele faz também.</h2>
        </div>

        <ol className="lp-steps">
          <li>
            <span className="lp-step-num">01</span>
            <div>
              <p className="lp-step-title">Você conta o que aconteceu.</p>
              <p className="lp-step-sub">Pode ser pelo app ou pelo WhatsApp.</p>
            </div>
          </li>
          <li>
            <span className="lp-step-num">02</span>
            <div>
              <p className="lp-step-title">O Nino organiza e explica.</p>
              <p className="lp-step-sub">
                Valor, categoria, contexto e impacto no seu mês.
              </p>
            </div>
          </li>
          <li>
            <span className="lp-step-num">03</span>
            <div>
              <p className="lp-step-title">Você decide com mais clareza.</p>
              <p className="lp-step-sub">
                O Nino sugere caminhos. A decisão continua sendo sua.
              </p>
            </div>
          </li>
        </ol>

        <div className="lp-trust">
          <p className="lp-trust-lead">
            Você escolhe o que registrar. O Nino não movimenta seu dinheiro.
            Tudo que ele conclui, ele mostra de forma clara.
          </p>
          <ul className="lp-trust-list">
            <li>Sem movimentações financeiras</li>
            <li>Sem decisões automáticas sobre seu dinheiro</li>
            <li>Informações explicadas em linguagem humana</li>
          </ul>
        </div>
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
        <h2>
          Seu dinheiro começa a fazer mais sentido a partir de uma conversa.
        </h2>
        <p className="lp-lead">
          Fale com o Nino e descubra o que seus números estão tentando dizer.
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
    a: "Não. O Nino organiza informações, explica mudanças e ajuda você a decidir. Ele não movimenta dinheiro.",
  },
  {
    q: "Funciona pelo WhatsApp?",
    a: "Sim. Você pode conversar com o Nino pelo WhatsApp ou usar o app.",
  },
  {
    q: "O Nino movimenta meu dinheiro?",
    a: "Não. Ele organiza, acompanha e sugere caminhos. A decisão e qualquer movimentação continuam sendo suas.",
  },
  {
    q: "Como as previsões funcionam?",
    a: "Elas são calculadas a partir do que você registra, do seu ritmo atual e do histórico disponível. O Nino mostra o que influenciou cada previsão.",
  },
  {
    q: "Quanto custa para começar?",
    a: "Você pode começar gratuitamente, sem cartão de crédito.",
  },
];

function FAQSection() {
  return (
    <section className="lp-section lp-section--cloud" id="duvidas">
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
 * CTA fixo condicional (mobile).
 *  - Oculto enquanto o Hero está visível.
 *  - Aparece após sair do Hero.
 *  - Desaparece ao entrar no CTA final (#comecar) ou FAQ (#duvidas).
 *  - Fallback (sem IntersectionObserver): aparece após 200px de scroll.
 */
function MobileCta() {
  const [visible, setVisible] = useState(false);
  const heroVisibleRef = useRef(true);
  const finalVisibleRef = useRef(false);

  useEffect(() => {
    const hero = document.getElementById("hero");
    const finalCta = document.getElementById("comecar");
    const faq = document.getElementById("duvidas");

    const supportsIO = typeof IntersectionObserver !== "undefined";

    if (!supportsIO) {
      const onScroll = () => setVisible(window.scrollY > 200);
      onScroll();
      window.addEventListener("scroll", onScroll, { passive: true });
      return () => window.removeEventListener("scroll", onScroll);
    }

    const update = () => {
      setVisible(!heroVisibleRef.current && !finalVisibleRef.current);
    };

    const heroObs = new IntersectionObserver(
      ([entry]) => {
        heroVisibleRef.current = entry.isIntersecting;
        update();
      },
      { threshold: 0.15 },
    );
    const finalObs = new IntersectionObserver(
      (entries) => {
        finalVisibleRef.current = entries.some((e) => e.isIntersecting);
        update();
      },
      { threshold: 0.05 },
    );

    if (hero) heroObs.observe(hero);
    if (finalCta) finalObs.observe(finalCta);
    if (faq) finalObs.observe(faq);

    return () => {
      heroObs.disconnect();
      finalObs.disconnect();
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
      <Link to="/signup" className="lp-btn primary" tabIndex={visible ? 0 : -1}>
        Quero meu Nino grátis
        <CaretRight size={14} weight="bold" />
      </Link>
    </div>
  );
}
