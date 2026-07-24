# Plano — Redesign narrativo da LP Meu Nino.IA (6 capítulos)

> Auditoria confirmada por leitura direta de `src/pages/landing/LandingPage.tsx` (505 linhas) e `src/pages/landing/landing.css` (602 linhas). **Nenhum arquivo foi alterado nesta etapa.**

---

## 1. Diagnóstico técnico — onde o CSS atual cria os vazios

| # | Sintoma observado | Origem confirmada no código |
|---|---|---|
| A | 176px de vazio entre seções | `.lp-section { padding: 88px 0 }` (linha 158) somado a `.lp-hero { padding: 96px 0 56px }` e `.lp-manifesto { padding: 88px 0 }` (293). Toda transição soma paddings verticais idênticos. |
| B | Manifesto ocupa quase 1 tela sem progressão | `.lp-manifesto-inner { gap: 20px }` mais `padding: 88px 0` sem qualquer elemento visual — só parágrafos. |
| C | Sparkline solto abaixo do chat | `.lp-chat-spark` (279) posicionado como filho fraternal do `.lp-msg` sem relação causal — apenas `border-top`. |
| D | CTA fixo compete com mockups | `.lp-mobile-cta` (561–591) + `body.mn-lp-has-mobile-cta { padding-bottom: 76px }` (592) + `IntersectionObserver` no `MobileCta` (426–504 do TSX). |
| E | Cards de features rasos | `SimpleTrustSection` (300–330 TSX) — 3 `<li>` com `01/02/03` + parágrafo curto = título + 3 linhas + vazio. |
| F | Meta sem valor / esforço | `.lp-goal` (373–395 CSS) exibe só quote + barra 72% + label — sem valor absoluto, ritmo, prazo. |
| G | Cards que "flutuam" isolados | `.lp-note`, `.lp-goal`, `.lp-role-card` cada um em `lp-split` ou `lp-role-inner` próprios, com `.lp-section { padding: 88px 0 }` a cada troca. |
| H | Header pode cobrir âncoras | Header `position: fixed` (128) sem `scroll-margin-top` nas seções. |
| I | Gradiente onipresente | `--lp-grad` usado em `.lp-btn.primary`, `.lp-role-avatar`, `.lp-goal-bar > span`, `lp-trend-grad` do SVG — viola regra de 1–3 usos. |
| J | Passos 01/02/03 genéricos | `.lp-steps` (448–472) — bloco autônomo sem contexto narrativo. |

Conclusão: o CSS trata seções como recipientes autônomos com padding uniforme, e o TSX não conecta visualmente chat → dado → causa → ação. A pilha é aditiva, não causal.

---

## 2. Mapa de componentes atuais — remover / fundir / reconstruir

### Remover completamente
- `MobileCta` (LandingPage.tsx 420–504) e toda referência a `mn-lp-has-mobile-cta`.
- `SimpleTrustSection` (300–330) e função `.lp-steps` / `.lp-step-num` / `.lp-step-title` / `.lp-trust-para` isoladas.
- `.lp-chat-spark` e `.lp-chat-spark-label` (SVG sparkline decorativa em `DemoSection`).
- `.lp-msg.suggestion` como bolha passiva ("Quer definir um limite...").
- `.lp-mobile-cta*`, `body.mn-lp-has-mobile-cta` no CSS.
- `--lp-grad` em `.lp-role-avatar` e `.lp-goal-bar` (mantido só em símbolo, 1 indicador da demo central, 1 CTA).

### Fundir
- `HeroSection` + `HeroMockup` → **Cap. 1** com artboard único terminando em faixa que transiciona para Cloud.
- `ManifestoSection` → **Cap. 2** virando timeline (não parágrafos soltos).
- `DemoSection` → base do **Cap. 3 (`FinancialStoryCanvas`)**, expandido em 4 etapas causais.
- `TransformSection` (2 splits) → **Cap. 4** com casos aprofundados (padrão + meta) numa sequência editorial única com divisor 1px.
- `RoleSection` → **Cap. 5** artboard 3-passos (conversa → divisão → mensagem preparada).
- `FinalCtaSection` + `FAQSection` + faixa de confiança nova → **Cap. 6** compacto.

### Reconstruir
- Sistema de espaçamento: eliminar `.lp-section { padding: 88px 0 }` uniforme. Introduzir tokens `--lp-chapter-*` mobile 40–72 / desktop 88–104.
- Header: adicionar `scroll-margin-top: 72px` nas âncoras de capítulo; ajustar bg no scroll para `rgba(16,17,26,.94)`.
- Todos os artboards com `border-radius: 28px` mobile, `padding: 20–24px`, sem `min-height`.

---

## 3. Wireframe textual — mobile e desktop

### Cap. 1 — HERO (`#hero`)

```text
MOBILE (Ink)                                DESKTOP (Ink, 2 col)
┌────────────────────────────┐              ┌──────────────┬──────────────┐
│ [header 56px fixed]         │              │ H1           │ artboard     │
│                             │              │ lead         │ conversa     │
│ H1 (38/1.06) esquerda       │              │ apoio        │ 3 bolhas     │
│ lead 17/1.62 muted-hi       │              │ CTA primary  │ resumo Ink   │
│ apoio "Pelo WhatsApp..."    │              │ micro        │              │
│ [CTA gradient]              │              └──────────────┴──────────────┘
│ micro                       │
│ ─── artboard Ink-elev ───   │
│ • Usuário: R$ 80 no bar     │
│ • Nino: Registrado em Lazer │
│ • Nino: Previsão R$ 3.180   │
│ [rodapé: Previsão · 3.180]  │
│ ═══ faixa de transição ═══  │  ← borda inferior curva/gradient → Cloud
└────────────────────────────┘
```

### Cap. 2 — RECONHECIMENTO (`#reconhecimento`, Cloud)

```text
H2 esquerda: "O mês não sai do controle de uma vez."
Lead: "Ele muda em pequenas decisões..."

┌ Rail vertical Violet, dots Coral ────────────┐
│ ● Segunda   R$ 42   · delivery                │
│ ● Quarta    R$ 29   · assinatura esquecida    │
│ ● Sexta     R$ 86   · jantar fora             │
│ ● Domingo   R$ 54   · outro delivery          │
└──────────────────────────────────────────────┘
Fechamento: "Separados, parecem pouco..."
▸ Nino (conectada ao rail): "O Nino acompanha esses sinais..."
Altura alvo mobile: 520–620px.
```

### Cap. 3 — O NINO EM AÇÃO (`#acao`, White) — `FinancialStoryCanvas`

```text
H2: "Uma conversa vira contexto..."
Lead 1 linha.

┌ artboard único radius 28, borda #E7E5EE ─────────────────────────┐
│ ▏ rail Violet vertical conectando 4 etapas ▏                     │
│                                                                   │
│ 1 REGISTRO   [msg user] R$ 80 no bar · Nubank                    │
│              [msg Nino] Registrado em Lazer · Nubank · ontem     │
│                                                                   │
│ 2 IMPACTO    Previsão de fechamento                              │
│              R$ 3.180    ▲ 8% mês anterior (Coral)               │
│                                                                   │
│ 3 EXPLICAÇÃO O que puxou a alta                                  │
│              Lazer            ████████░░  +R$ 180                │
│              Alim. fora       █████░░░░░  +R$ 95                 │
│              Outras           ██░░░░░░░░  +R$ 34                 │
│                                                                   │
│ 4 AÇÃO       [Nino] "Se limitar Lazer/Alim. a R$ 350..."         │
│              → R$ 2.940 (Mint)                                   │
│              [ Criar limite de R$ 350 ]  ← único CTA gradient    │
└──────────────────────────────────────────────────────────────────┘
Altura mobile: 720–860px.
Desktop: mesmo artboard, largura 880–1040px, rail à esquerda.
```

### Cap. 4 — O NINO ACOMPANHA O MÊS (`#mes`, Cloud)

```text
H2: "O Nino não olha só para um gasto..."

CASO A — Padrão de gasto
  H3: "Ele percebe padrões antes de virarem hábito."
  Copy: "Delivery subiu 22%..."
  Visual: grade 3 semanas × 7 dias, pontos Coral só em sex/sáb/dom
  [Nino] "Seu aumento não está espalhado..."
  [ Criar limite para sexta a domingo ] (ghost)

── divisor 1px, 40px de gap ──

CASO B — Meta
  H3: "E mantém seus planos conectados ao mês real."
  Meta: Viagem de fim de ano
    R$ 4.320 de R$ 6.000  |  72%  |  faltam R$ 1.680
    Ritmo: R$ 280/mês  |  Previsão: novembro
    [barra Mint 72%]
  [Nino] "Com R$ 280/mês, você chega em novembro..."
  [ Ver um plano possível ] (ghost)

Altura combinada mobile: 1050–1250px.
```

### Cap. 5 — DIVISÃO DO ROLÊ (`#role`, White)

```text
H2 + Lead.

┌ artboard único (mobile stack, desktop 2 col) ─────────────────┐
│ 1) Conversa                                                    │
│    [msg user] "O jantar deu R$ 480. Eu, Ana, Bruno, Camila."   │
│                                                                │
│ 2) Divisão                                                     │
│    Jantar de sábado · 4 pessoas · R$ 120 cada                  │
│    ● Você    Pago  (Mint)                                      │
│    ● Ana     Pago                                              │
│    ● Bruno   Pendente (Coral)                                  │
│    ● Camila  Pendente                                          │
│    (avatares Violet flat, não gradient)                        │
│                                                                │
│ 3) Mensagem preparada                                          │
│    "Oi, Bruno! Sua parte do jantar de sábado ficou em R$ 120…" │
│    [ Copiar lembrete ] (ghost)                                 │
└───────────────────────────────────────────────────────────────┘
Altura mobile: 720–840px.
```

### Cap. 6 — CONFIANÇA + CTA + FAQ (`#comecar` / `#duvidas`, Ink)

```text
Faixa Ink-elev compacta (sem cards):
  H4: "Você continua no controle."
  · O Nino não movimenta seu dinheiro.
  · Você escolhe o que registrar.
  · Toda previsão mostra o que influenciou o resultado.

── 40px ──

CTA final (Ink, símbolo watermark):
  H2 centralizada: "Entenda seu mês enquanto ainda dá tempo..."
  Lead
  [ Quero meu Nino grátis ] ← gradient (2º e último uso)
  micro

── 48px ──

FAQ (4 perguntas <details>, direto no Ink dark ou Ink-elev card):
  1. O Nino é um banco?
  2. Funciona pelo WhatsApp?
  3. Como as previsões funcionam?
  4. O Nino movimenta meu dinheiro?

Footer 32px.
```

---

## 4. Novos componentes React (todos em `LandingPage.tsx`)

| Componente | Substitui | Papel |
|---|---|---|
| `HeroChapter` | `HeroSection` + `HeroMockup` | Hero com rodapé de resumo integrado e faixa de transição. |
| `RecognitionTimeline` | `ManifestoSection` | Rail visual com 4 eventos + fecho + linha Nino. |
| `FinancialStoryCanvas` | `DemoSection` | Artboard único com 4 etapas conectadas por rail vertical. |
| `ImpactBar` (interno) | — | Barra horizontal Coral/Mint com valor à direita. |
| `MonthTrackingChapter` | `TransformSection` | Cap. 4 unificado (padrão + meta) com divisor 1px. |
| `PatternGrid` (interno) | — | Grade 3×7 semanas × dias com pontos Coral. |
| `GoalBreakdown` (interno) | `.lp-goal` | Valor, faltante, ritmo, previsão, barra Mint. |
| `SplitStory` | `RoleSection` | Artboard 3-passos (chat → divisão → mensagem). |
| `TrustStrip` | `SimpleTrustSection` | Faixa compacta 3 afirmações sem cards. |
| `FinalChapter` | `FinalCtaSection` + `FAQSection` | Confiança + CTA + FAQ em fluxo contínuo. |

**Remover:** `MobileCta`, `SimpleTrustSection`, `HeroMockup` (fundido).

---

## 5. Seletores CSS — remover e criar

### Remover
```
.lp-section, .lp-section--white, .lp-section--cloud, .lp-section--faq
.lp-section-head, .lp-section-head--center
.lp-manifesto, .lp-manifesto-inner, .lp-manifesto-1, .lp-manifesto-2,
  .lp-manifesto-signals, .lp-manifesto-line, .lp-manifesto-close, .lp-manifesto-final
.lp-chat-spark, .lp-chat-spark-label
.lp-split, .lp-split--reverse, .lp-split-copy, .lp-split-visual
.lp-note, .lp-note-dot, .lp-note-title, .lp-note-sub
.lp-goal, .lp-goal-quote, .lp-goal-bar, .lp-goal-meta
.lp-steps, .lp-steps--inline, .lp-step-num, .lp-step-title
.lp-trust-para
.lp-mobile-cta, .lp-mobile-cta-btn, .lp-mobile-cta.is-visible
body.mn-lp-has-mobile-cta
gradient em .lp-role-avatar e .lp-goal-bar
```

### Criar
```
/* Escala editorial (tokens) */
--lp-space-8/12/16/20/24/32/40/48/56/64/72
--lp-chapter-pad-mobile: 48px
--lp-chapter-pad-desktop: 96px
--lp-artboard-radius: 28px

/* Capítulo genérico */
.lp-chapter { padding-block: var(--lp-chapter-pad-mobile); }
.lp-chapter--ink / --cloud / --white
.lp-chapter-head, .lp-chapter-title, .lp-chapter-lead
[id].lp-chapter { scroll-margin-top: 72px; }

/* Cap 1 */
.lp-hero-artboard, .lp-hero-summary, .lp-hero-transition

/* Cap 2 */
.lp-timeline, .lp-timeline-rail, .lp-timeline-item, .lp-timeline-dot,
.lp-timeline-close, .lp-timeline-nino

/* Cap 3 */
.lp-story, .lp-story-rail, .lp-story-step, .lp-story-step-num,
.lp-story-impact, .lp-story-impact-value, .lp-story-delta,
.lp-story-bars, .lp-impact-bar, .lp-story-action

/* Cap 4 */
.lp-month, .lp-month-case, .lp-month-divider,
.lp-pattern-grid, .lp-pattern-dot,
.lp-goal-block, .lp-goal-meta-grid, .lp-goal-bar-mint

/* Cap 5 */
.lp-split-story, .lp-split-step, .lp-split-participants,
.lp-split-avatar (flat Violet), .lp-split-message

/* Cap 6 */
.lp-trust-strip, .lp-trust-line, .lp-final-chapter, .lp-final-cta, .lp-faq-inline
```

Header: acrescentar regra `.mn-lp .lp-header.is-scrolled { background: rgba(16,17,26,.94) }` e `scroll-margin-top: 72px` global nas âncoras `[id]`.

---

## 6. Altura mobile estimada por capítulo (390px)

| Capítulo | Alvo | Notas |
|---|---|---|
| 1. Hero | 780–860px | 56 header + copy 260 + artboard 440 + transição 24 |
| 2. Reconhecimento | 560–620px | pad 48 + head 120 + 4 items×48 + fecho 80 + Nino 80 + pad 48 |
| 3. Story Canvas | 780–880px | pad 48 + head 120 + artboard 620 + pad 48 |
| 4. Mês | 1080–1240px | pad 48 + head 100 + caso A 460 + divisor 40 + caso B 500 + pad 48 |
| 5. Rolê | 780–840px | pad 48 + head 100 + artboard 620 + pad 48 |
| 6. Confiança+CTA+FAQ+footer | 780–900px | trust 200 + CTA 320 + FAQ 260 + footer 80 |
| **Total** | **≈ 4.760–5.340px** | ~5.9–6.6 dobras — dentro do alvo de densidade. |

Ganho versus estado atual (~5.900–6.400px com muito padding): densidade real de conteúdo cresce >30% pela eliminação de vazios repetidos e Simple/Steps.

---

## 7. Critérios de QA visual

- [ ] Nenhum `.lp-mobile-cta` no DOM em qualquer viewport.
- [ ] Zero área vazia >72px entre elementos do mesmo capítulo (medição em DevTools).
- [ ] Transição inter-capítulo ≤64px de padding combinado.
- [ ] Header 56px mobile / 64px desktop, `scroll-margin-top: 72px` funcional.
- [ ] Gradient (`--lp-grad`) usado em ≤3 lugares: símbolo, CTA hero, CTA final (a demo central usa 1 indicador Coral+Mint, não gradient).
- [ ] Cap. 3 exibe 4 etapas ligadas por rail contínuo.
- [ ] Cap. 4 mostra valor absoluto (R$ 4.320/R$ 6.000), faltante, ritmo, previsão.
- [ ] Cap. 5 exibe conversa + divisão + mensagem preparada dentro do mesmo artboard.
- [ ] FAQ imediatamente após CTA final, sem `padding: 88px 0`.
- [ ] Zero overflow horizontal em 320 / 360 / 390 / 430 / 768 / 1024 / 1440.
- [ ] Títulos alinhados à esquerda em mobile, exceto CTA final centralizado.
- [ ] Nenhum card com `min-height`.
- [ ] Nenhuma seção com `padding-block > 72px` no mobile.
- [ ] `useSessionInactivity`, guard e rotas autenticadas intocados (verificação por grep).
- [ ] Testes `landing-page.test.tsx` atualizados: novas âncoras (`hero, reconhecimento, acao, mes, role, comecar, duvidas`), 4 FAQs, ausência de `#simples`, ausência de `.lp-mobile-cta`, headline mantida.

---

## 8. Arquivos que serão alterados na execução

- `src/pages/landing/LandingPage.tsx` — reescrita completa dos componentes de seção; remoção de `MobileCta`, `SimpleTrustSection`, `HeroMockup`.
- `src/pages/landing/landing.css` — refatoração completa dos seletores listados; introdução dos tokens de espaçamento e classes de capítulo/artboard.
- `src/test/landing-page.test.tsx` — atualização de âncoras, remoção de asserts de `#simples`/steps, assert explícito de ausência de `.lp-mobile-cta`, mantidos os asserts de headline, 4 FAQs, gratuidade micro, hrefs `/signup` e `/login`.

Não serão tocados: `NinoLogo.tsx`, `NinoSymbol.tsx`, `NinoWordmark.tsx`, `App.tsx`, `AppLayout.tsx`, guards de sessão, backend, migrations, edge functions, admin, integrações WhatsApp, cálculos financeiros.

---

## 9. Confirmação

Nenhum arquivo foi alterado nesta etapa. Nenhuma migration, deploy ou comando de build/teste foi executado. O plano aguarda aprovação explícita para execução.
