
# Reconstrução premium da LP Meu Nino.IA

Escopo estrito: apenas `src/pages/landing/**`, `index.html` (head/fonte) e um novo `public/brand/*` para o SVG oficial. Nada de app autenticado, admin, backend, dados ou rotas internas.

## 1. Diagnóstico da LP atual

Ler `LandingPage.tsx` (592 linhas), `landing.css` (381), `NinoSymbol.tsx`, `NinoWordmark.tsx`, `icons/NinoIcons.tsx`:

- **Marca**: `NinoSymbol` é um SVG *reinterpretado* (geometria própria, não o símbolo oficial). Precisa ser substituído pelo SVG exato fornecido. `NinoWordmark` já usa "Meu Nino" com `.IA` opcional — estrutura ok, mas tracking, tamanho relativo do `.IA` e cor precisam ser recalibrados.
- **Tipografia**: hoje usa Plus Jakarta Sans. Aceitável pelo briefing como fallback, mas priorizar DM Sans (open, SIL OFL, Google Fonts, coerente com o rascunho do wordmark) para alinhar títulos/wordmark.
- **Tokens**: `landing.css` usa `--lp-violet #6D4AFF`, `--lp-indigo #4338FF`, `--lp-coral #FF6B5F`, `--lp-mint #2FC99A` — batem com o briefing. Faltam `Deep Ink Elevated #181A25`, `Bordas claras #E7E5EE`, `Texto secundário #6D7080` (hoje `#737688`).
- **Composição**: seções seguem padrão card+ícone+título+texto repetitivo (Pain, Features, FAQ, AI band). Falta ritmo editorial. Bento de "Inteligência" mistura chat + previsão + meta sem causalidade.
- **Mockups**: `HeroVisual` mistura Previsão + Meta Viagem + Insight sem correlação — viola a regra "cada mockup conta UMA história com dados correlacionados".
- **Iconografia**: `NinoIcons.tsx` mistura pictogramas próprios (ChatBubble, Sparkle, Pulse, HeartOutline etc). Briefing exige Phosphor Icons regular/light — trocar.
- **Narrativa**: falta seção dedicada a Previsão, Metas, Divisão do Rolê, Como Funciona (3 etapas), Segurança. Prova social existe atrás de flag, mas sem marcação visual clara de placeholder.
- **Responsivo**: `HeroVisual` usa `position:absolute` para os 3 glass cards — precisa entrar no fluxo em <768px.
- **Repetição de "Nino"**: copy usa frequente "O Nino" — ok, mas há trechos com "Meu Nino" repetidos que precisam ser reduzidos.

## 2. Desalinhamentos vs. marca

1. Símbolo não é o oficial.
2. `.IA` no wordmark ora é pill gradient, ora ausente — precisa padronizar como sobrescrito discreto, tamanho ~45–55% da altura de "Nino", cor violet ou gradiente sutil.
3. Ícones não-Phosphor.
4. Mockups misturam narrativas.
5. Cores secundárias divergem em 1–2 hexes.
6. Falta seção Segurança e Como Funciona.
7. Tipografia principal não é a prioritária do briefing.

## 3. Mapa de seções (14)

```
1  Header sticky (logo oficial + nav + CTA)
2  Hero escuro — "O Nino entende seus gastos hoje..."
3  Manifesto da dor
4  Previsão de fechamento (mockup dedicado)
5  Mudanças de comportamento (mockup dedicado)
6  Metas acompanhadas (mockup dedicado)
7  Insights acionáveis / próximos passos
8  Divisão do Rolê (mockup com participantes/status)
9  Outras capacidades (composição compacta: patrimônio,
   investimentos, recorrências, alertas, edição, organização)
10 Como funciona — 3 etapas
11 Prova social (placeholders MARCADOS)
12 Segurança (afirmações verdadeiras)
13 FAQ compacto
14 CTA final com gradiente + símbolo oficial
+ Footer com logo oficial
+ Mobile CTA sticky
```

## 4. Wireframe textual

### Desktop (≥1024px)

```
┌─ Header 64px, sticky, glass ──────────────────────────┐
│ [Logo]        [nav]                        [CTA]      │
└───────────────────────────────────────────────────────┘

Hero (ink #10111A, ~720px)
┌─────────────────────────┬─────────────────────────────┐
│ badge                   │                             │
│ H1 grande (2 linhas)    │  Mockup Hero: chat curto    │
│ subtítulo 620px         │  do Nino com 1 bolha usuário│
│ [CTA primário] [ghost]  │  + 1 resposta com contexto  │
│ micro-provas            │  (UMA história só)          │
└─────────────────────────┴─────────────────────────────┘

Manifesto (cloud, texto editorial centrado, 760px máx)

Previsão (dark, split 50/50)
  Copy à esquerda | Mockup: previsão R$3.180 + delta
                  + causa (lazer/alimentação 72%)
                  + botão "revisar limite"

Comportamento (cloud, split invertido)
  Mockup: 3 categorias com variação % vs média,
          barra comparativa, insight causal.

Metas (dark, cards horizontais)
  Mockup: 1 meta com aportes, projeção fim, ajuste sugerido.

Insights (cloud, lista editorial numerada 01–03)

Divisão do Rolê (dark, mockup próprio)
  Participantes com avatar inicial, status (pago/pendente),
  total do rolê, botão "cobrar restantes".

Outras capacidades (grid 3x2, tiles compactos Phosphor)

Como funciona (cloud, 3 passos horizontais)
  01 Conecte / 02 Converse / 03 Decida

Prova social (cloud, 3 blocos com badge "Exemplo")

Segurança (dark, 3 pilares verdadeiros:
  criptografia em trânsito, dados no seu controle,
  LGPD)

FAQ (cloud, <details>, 6 perguntas)

CTA final (gradiente 135deg, símbolo grande)

Footer (ink, logo + copyright)
```

### Mobile (320–767px)

Uma coluna. Hero: badge → H1 → sub → CTAs empilhados → mockup abaixo (no fluxo, sem `absolute`). Seções split viram vertical. Grids 3×2 viram 1 coluna. Todos os mockups entram no fluxo. Nenhum texto/CTA em `position:absolute`. Header vira barra compacta com logo + botão CTA. CTA mobile sticky no rodapé.

## 5. Sistema tipográfico

- Família principal: **DM Sans** (Google Fonts, SIL OFL, licença livre). Fallback: Plus Jakarta Sans, Inter, system-ui.
- Escala fluida `clamp()`:
  - H1: `clamp(2.4rem, 5.2vw, 4.2rem)` / weight 700 / line-height 1.05 / tracking -0.02em
  - H2: `clamp(1.9rem, 3.6vw, 3.1rem)` / 700 / 1.08 / -0.015em
  - H3: `clamp(1.15rem, 1.6vw, 1.4rem)` / 600 / 1.2
  - Lead: `clamp(1.05rem, 1.3vw, 1.2rem)` / 400 / 1.6 / max 720px
  - Body: `1rem` / 400 / 1.65 / max 620px
  - Label overline: 0.75rem / 600 / uppercase / tracking 0.14em
- Sofia Pro **não** será carregada (comercial). Mantido como preferência local do usuário no stack, sem @font-face.

## 6. Tokens e componentes

### Tokens CSS (escopados em `.mn-lp`)

```
--lp-ink:            #10111A
--lp-ink-elev:       #181A25
--lp-cloud:          #F7F6FB
--lp-white:          #FFFFFF
--lp-violet:         #6D4AFF
--lp-indigo:         #4338FF
--lp-coral:          #FF6B5F
--lp-mint:           #2FC99A
--lp-muted:          #6D7080
--lp-line:           #E7E5EE
--lp-grad:           linear-gradient(135deg,#6D4AFF 0%,#4338FF 54%,#FF6B5F 100%)
--lp-radius-card:    20px
--lp-radius-pill:    999px
--lp-shadow-soft:    0 14px 40px rgba(16,17,26,.06)
--lp-shadow-lift:    0 30px 80px rgba(16,17,26,.10)
```

### Componentes (arquivo único ou co-locados em `src/pages/landing/`)

- `NinoLogo.tsx` (novo) — símbolo oficial + wordmark, variantes `light`/`dark`, `sm`/`md`.
- `NinoSymbol.tsx` — reescrito para renderizar exatamente o SVG oficial (via `<img src="/brand/meu-nino-symbol.svg">` ou inline; inline preferido para controle de cor de fundo/tamanho, com o markup EXATO do briefing).
- `NinoWordmark.tsx` — apenas lettering "Meu Nino" + descritor `.IA` sobrescrito discreto.
- `LandingPage.tsx` — orquestrador, importa seções.
- Seções separadas para clareza: `sections/Hero.tsx`, `Manifesto.tsx`, `Previsao.tsx`, `Comportamento.tsx`, `Metas.tsx`, `Insights.tsx`, `DivisaoRole.tsx`, `Capacidades.tsx`, `ComoFunciona.tsx`, `ProvaSocial.tsx`, `Seguranca.tsx`, `FAQ.tsx`, `CTAFinal.tsx`, `Footer.tsx`, `MobileCTA.tsx`.
- `landing.css` reescrito com tokens acima.

## 7. Uso do símbolo e wordmark

- Header: `NinoLogo` variante `light` (fundo claro), altura 28px.
- Footer: `NinoLogo` variante `dark`, altura 24px.
- CTA final: símbolo isolado 96px acima do H2.
- Nenhum outro uso do símbolo. Zero prints, zero labels "símbolo/wordmark" na página. `.IA` sempre menor (~50% altura de "Nino"), elevado, cor `--lp-violet` (ou gradiente sutil no header apenas).

## 8. Iconografia

- Biblioteca única: **Phosphor Icons** via `phosphor-react` já presente? Verificar; se não, adicionar `@phosphor-icons/react` (dependência nova, ~poucos KB tree-shaken). Estilo `regular`. Weight `light` para tiles secundários.
- Remover `src/pages/landing/icons/NinoIcons.tsx` (pictogramas próprios) — substituídos por Phosphor.
- Ícones usados: ChatCircleDots, TrendUp, Target, Sparkle, Bell, ArrowsClockwise, ShieldCheck, Users, Wallet, ChartLineUp, PencilSimple, Sparkle, CaretRight.

## 9. Mockups (HTML/CSS/SVG, uma história cada)

1. **Hero mockup** — Conversa curta: usuário "Gastei R$62 no jantar ontem" → Nino "Anotado. Alimentação subiu 14% este mês, ainda dentro do previsto." (UMA história: conversa + contexto imediato.)
2. **Previsão** — Card com: previsão fim do mês R$ 3.180, delta +8% vs mês anterior, causa "Lazer e alimentação fora explicam 72% do aumento", CTA "revisar limite". Todos os números coerentes.
3. **Comportamento** — Três linhas de categorias (Alimentação +22%, Transporte -8%, Lazer +14%) com barras comparando "este mês vs média 3 meses" + rodapé com insight causal único.
4. **Metas** — UMA meta: "Viagem set/2026", progresso 72%, aportes últimos 3 meses (R$400, R$400, R$500), projeção "fecha 12 dias antes do prazo", CTA "aumentar aporte".
5. **Divisão do Rolê** — Rolê "Churrasco 15/07", 4 participantes com iniciais, status Pago/Pendente coerente com valor total (R$ 320 = 4 × R$ 80).
6. **CTA final** — Símbolo oficial em destaque, sem mockup competindo.

Cada mockup em bloco próprio, no fluxo mobile, sem `position:absolute` para dados.

## 10. Estratégia responsiva

- Mobile first (base 375). Breakpoints: 640, 768, 1024, 1280.
- Grids CSS com `minmax` e `auto-fit` para tiles.
- Splits usam `grid-template-columns: 1fr` em mobile, `1.05fr .95fr` em ≥1024.
- Zero `position:absolute` para conteúdo com dado/CTA. Absolute apenas para halos/glow de fundo com `aria-hidden`.
- Header vira compacto <768 (logo + CTA); nav some, substituído pelo scroll.
- Validar em 320, 375, 390, 414, 768, 1024, 1280, 1440.
- Respeitar `prefers-reduced-motion` (desabilita gradients animados / spark).

## 11. O que remover, refazer, preservar

**Remover:**
- `src/pages/landing/icons/NinoIcons.tsx` (substituído por Phosphor).
- `HeroVisual` atual (3 glass cards absolutos misturando narrativas).
- Seção `SocialProof` inline atrás de flag → refeita como componente com placeholders visualmente marcados.

**Refazer:**
- `NinoSymbol.tsx` — usar SVG oficial exato do briefing.
- `NinoWordmark.tsx` — calibrar `.IA` sobrescrito.
- `landing.css` — reescrito completo com novos tokens, tipografia, escala 4/8, sem redundâncias.
- `LandingPage.tsx` — decomposto em 14 seções.
- `index.html` — trocar `<link>` do Google Fonts para DM Sans; manter title/description v3 já aprovados; adicionar preconnect.

**Preservar:**
- Rotas `to="/signup"` e `to="/login"`.
- `src/App.tsx` sem alteração (rota `/` já aponta pra `LandingPage`).
- Flag `SHOW_LANDING_TESTIMONIALS` (renomeada `SOCIAL_PROOF_IS_PLACEHOLDER`, default `true`).
- Testes `src/test/landing-page.test.tsx` atualizados (não removidos) para novo DOM.

## 12. Riscos, dependências, dúvidas

- **Nova dep**: `@phosphor-icons/react` (~tree-shaken). Baixo risco. Alternativa: inline SVGs de Phosphor copiados manualmente para zero-dep. **Dúvida**: prefere adicionar dep ou inline?
- **Fonte**: DM Sans via Google Fonts. Alternativa: Plus Jakarta Sans já carregada. **Dúvida**: mantenho DM Sans ou fico com Plus Jakarta Sans para zero mudança de carga?
- **SVG oficial**: será servido de `/public/brand/meu-nino-symbol.svg` E inline no componente (para permitir controle de cor sem CORS). Confirmado que o conteúdo é o markup do briefing sem alterações.
- **Testes**: `landing-page.test.tsx` precisa ser adaptado ao novo DOM (contagem FAQ, seletores). `rebranding-meunino.test.ts` continua passando (marca "Meu Nino.IA" preservada).
- **Não fará**: publicação, alterações fora da LP, novos endpoints, novas rotas.

## 13. Critérios de aceite verificáveis

1. `/public/brand/meu-nino-symbol.svg` existe com o markup EXATO do briefing (diff byte-a-byte).
2. `NinoSymbol` renderiza o SVG oficial inline; nenhum outro símbolo aparece na LP (grep `<svg` em `src/pages/landing/` retorna apenas o oficial + ícones Phosphor).
3. Wordmark: "Meu Nino" 700 + `.IA` sobrescrito ~50% altura, cor `--lp-violet`.
4. Todas as 14 seções da narrativa presentes (teste por `getByRole('heading')`).
5. Nenhum `NinoIcons` importado; apenas Phosphor (`grep -r 'from ".*NinoIcons"' src/pages/landing` retorna vazio).
6. Zero `position: absolute` em elementos com texto/CTA/dado (auditoria manual + regra CSS).
7. Mockups: cada um em seção própria, sem dado de outra história misturado.
8. Prova social com atributo `data-placeholder="true"` e badge visível "Exemplo demonstrativo".
9. Responsivo sem overflow horizontal em 320/375/768/1024/1440 (`document.documentElement.scrollWidth <= clientWidth`).
10. Contraste AA em texto principal (ink em cloud, white em ink).
11. `bunx vitest run src/test/landing-page.test.tsx src/test/rebranding-meunino.test.ts` passa.
12. Typecheck e build do harness passam.
13. Nenhum arquivo fora de `src/pages/landing/**`, `src/test/landing-page.test.tsx`, `index.html`, `public/brand/**` alterado.
14. Nenhuma publicação em produção.

---

**Aguardando aprovação explícita antes de implementar.** Duas dúvidas pontuais para responder junto da aprovação (ou aceitar defaults):
- (a) Phosphor via `@phosphor-icons/react` (nova dep) **ou** SVGs inline copiados? Default proposto: dep.
- (b) Trocar para DM Sans **ou** manter Plus Jakarta Sans já carregada? Default proposto: DM Sans.
