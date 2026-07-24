
# Auditoria LP Mobile — Meu Nino.IA

Documento de análise. **Nenhum arquivo foi alterado.** Base: `src/pages/landing/LandingPage.tsx` (553 linhas, 7 blocos) e `src/pages/landing/landing.css` (606 linhas).

---

## 1. Notas gerais (0–10)

| Dimensão | Nota | Justificativa |
|---|---|---|
| Percepção premium | 6.5 | Tipografia e paleta certas, mas hero denso, CTA fixo agressivo e mockups em caixas repetidas puxam pra baixo. |
| Clareza | 7.5 | Copy boa; hierarquia por vezes competida por eyebrow + 2 leads + micro. |
| Storytelling | 7.0 | Arco correto (percepção → previsão → ação), mas transições abruptas (manifesto → demo, demo → transform). |
| Copy | 8.0 | Forte, humana, portuguesa. Peca em repetir "fazer mais sentido" no CTA final. |
| Ritmo mobile | 5.5 | Página longa; padding 72px repetido; mockups altos empilhados; CTA fixo compete. |
| Conversão | 6.0 | Hero exige 6 elementos antes do CTA; CTA fixo perde valor por onipresença; final tem eco de promessa em vez de decisão. |
| Consistência de marca | 8.0 | Gradiente/Deep Ink/Cloud coerentes; excesso de gradiente no CTA fixo enfraquece. |
| **Geral** | **6.9** | Boa fundação, precisa de edição editorial e faxina rítmica. |

---

## 2. Auditoria bloco a bloco

### 2.1 Hero (`.lp-hero`, `HeroSection`)
- **Densidade**: eyebrow + H1 duas partes + lead + lead-tight + 2 CTAs + micro + mockup completo. Na primeira dobra 390×844, mockup começa antes do CTA aparecer. H1 mobile em 40px quebra em 5–6 linhas.
- **Massa escura**: header fixo (rgba ink 0.82) + hero ink + mockup `--lp-ink-elev` criam um bloco preto contínuo.
- **Impacto**: leitor não avança porque não terminou a dobra 1.

### 2.2 Manifesto (`.lp-manifesto`)
- Copy forte. Composição quebrada: `lp-manifesto-1` (28/40px) → `lp-manifesto-2` (20/22px) → 3 linhas 18/20px iguais → `lp-manifesto-close` (20/22px) → `lp-manifesto-final` (22/28px).
- Gaps `gap: 8px` são planos demais entre grupos que deveriam respirar (linhas-observação × fechamento).
- Falta hierarquia entre "sinais cotidianos" e "conclusão emocional".

### 2.3 Demonstração (`.lp-demo-inner`)
- Chat (caixa branca com borda) + Trend (caixa branca com borda) dentro da seção branca = 3 níveis de branco, cada um com radius 20–28px. Ruído visual.
- Botão pill violeta `lp-inline-action` DENTRO do chat + `lp-trend` separado quebram a leitura "conversa → previsão".
- Legend abaixo é redundante.

### 2.4 Transformação (`.lp-section--cloud`, 3× `lp-split`)
- 3 splits com mesma cadência (copy 1 lado, card do outro). Mobile empilha tudo virando 6 blocos verticais. Vira coleção de cards.
- H2 "Menos planilha. Mais clareza." entra sem ponte após o mockup demo.
- `lp-goal` traz 5 elementos numéricos (nome, %, barra, valor, 2 notas) — protagonismo dos números em vez da frase do Nino.
- `lp-split-copy p` limitado a 42ch, mas mockups ao lado inflam altura no mobile.

### 2.5 Divisão do Rolê (`.lp-role-card`)
- Card com header (título+sub+total) + 4 linhas com avatar/nome/valor/status + botão primário largura total. Altura ≈ 480px. Somado ao section-head vira uma tela inteira de mockup.
- Botão "Preparar lembrete" (primary com gradiente) colide com CTA fixo (também gradiente) na mesma dobra.

### 2.6 Simplicidade + Confiança (`.lp-steps` + `.lp-trust`)
- 3 passos numerados 40px violet + `lp-trust` com lead + lista de 3 itens. Ao final da página parece manual de onboarding.
- Repete conceitos já expostos no hero ("WhatsApp ou app") e demo ("organiza e explica").

### 2.7 CTA Final + FAQ
- CTA final: mesma promessa do hero ("faz mais sentido"). Sem gatilho de decisão.
- FAQ: 5 perguntas, `<details>` com padding 20/22. Pergunta 4 ("Como as previsões funcionam?") é a única realmente objeção; outras 4 são reiteração.
- **Bug observado no vídeo**: CTA fixo continua visível sobre o footer — observer só ativa em `#comecar`/`#duvidas`, não em `.lp-footer`.

---

## 3. Tabela de ação por bloco

| Bloco | Ação |
|---|---|
| Header | **Manter** |
| Hero — eyebrow | **Remover** no mobile |
| Hero — lead + lead-tight | **Fundir** em um parágrafo curto |
| Hero — link "Ver o Nino em ação" | **Remover** (redundante com scroll) |
| Hero — mockup | **Reduzir** (3 msgs, altura -30%) |
| Manifesto | **Redesenhar** (ritmo tipográfico + peso do fechamento) |
| Demo — chat + trend em caixas separadas | **Fundir** em uma única composição |
| Demo — legend final | **Remover** |
| Transform — split C ("Resolver em conversa") | **Remover** (redundante com demo) |
| Transform — `lp-goal` métricas duplicadas | **Reduzir** para frase-Nino + barra + 1 número |
| Rolê — 4 participantes | **Reduzir** para 3 (2 pago, 1 pendente) |
| Rolê — botão primary no card | **Reduzir** (ghost/link) para não competir com CTA fixo |
| Simples+Trust — trust-lead + trust-list | **Fundir** em 1 parágrafo editorial curto |
| Simples+Trust — 3 passos | **Reduzir** para linha corrida "01 → 02 → 03" |
| CTA Final — copy | **Redesenhar** ("Comece a entender seu dinheiro antes que o mês termine.") |
| FAQ — 5 itens | **Reduzir** para 4 (remover "Quanto custa" — já em micro do hero e CTA) |
| CTA fixo | **Redesenhar** (altura, cor, escopo de exibição) |
| Footer | **Manter** |

---

## 4. Copy final revisada (fechada)

### Header
Nav: `Como ajuda · Divisão do Rolê · Dúvidas · Entrar`

### Hero
- H1: **Seu dinheiro não está desorganizado.** (quebra) *Só faltava alguém para cuidar dele com você.*
- Lead único: `O Nino registra sua rotina, percebe mudanças e ajuda você a decidir — pelo WhatsApp ou pelo app.`
- CTA primário: `Quero meu Nino grátis`
- Micro: `Grátis para começar · Sem cartão · Menos de 1 minuto`
- (sem eyebrow, sem link secundário no mobile)

### Manifesto
```
O mês não sai do controle
em um único gasto.

Ele muda aos poucos.

Um delivery a mais.
Uma assinatura esquecida.
Uma semana mais cara que o normal.

Quando você percebe,
a fatura já fechou.

— O Nino acompanha esses sinais com você.
```
(última linha em coral, peso 600, tamanho maior)

### Demonstração
- H2: `Antes de mostrar um número, o Nino explica o que mudou.`
- Chat unificado (mesmo card, sem trend separado):
  - user: `Gastei R$ 80 no bar ontem no Nubank.`
  - nino: `Organizei em Lazer.`
  - nino: `Nesse ritmo, seu mês fecha em **R$ 3.180** — 8% acima do anterior.`
  - inline no card: mini-sparkline + label `8% acima do mês anterior`
  - suggestion: `Quer definir um limite para o restante do mês?`
- (sem legend abaixo)

### Transformação
H2: `Menos planilha. Mais clareza.`

**A. Perceber antes que aperte.**
`O Nino nota quando seu ritmo muda e avisa enquanto ainda dá tempo de ajustar.`
Mockup: nota `Seus gastos com delivery aumentaram nas últimas 3 semanas — a maior parte às sextas e sábados.`

**B. Manter seus planos vivos.**
`Suas metas deixam de ser um número esquecido e passam a caminhar com o mês.`
Mockup (frase do Nino em destaque + barra + 1 número):
> "Mantendo o ritmo atual, você chega lá em novembro."
> Viagem de fim de ano · 72%

(split C removido)

### Divisão do Rolê
- H2: `Dividir a conta não deveria virar outra conta pra você resolver.`
- Lead: `Você conta quem foi e quanto foi. O Nino calcula a parte de cada um e prepara um lembrete amigável.`
- Card compacto: título `Jantar de sábado · R$ 480` + 3 linhas (Ana pago, Bruno pago, Camila pendente) + rodapé `+1 pessoa` + botão ghost `Preparar lembrete` (sem gradiente).

### Simplicidade + Confiança
- H2: `Simples de usar. Claro no que faz.`
- Passos em linha corrida:
  `01 Você conta. · 02 O Nino organiza e explica. · 03 Você decide.`
- Parágrafo único de confiança:
  `Você escolhe o que registrar. O Nino não movimenta seu dinheiro — só organiza, explica e sugere caminhos em linguagem humana.`
(sem lista de bullets)

### CTA Final
- H2: `Comece a entender seu dinheiro antes que o mês termine.`
- Lead: `Uma conversa com o Nino já muda o jeito que você olha pros seus números.`
- CTA: `Quero meu Nino grátis`
- Micro: `Grátis para começar · Sem cartão de crédito`

### FAQ (4)
1. `O Nino é um banco?` — Não. Ele organiza informações, explica mudanças e ajuda você a decidir. Não movimenta dinheiro.
2. `Funciona pelo WhatsApp?` — Sim. Você conversa com o Nino pelo WhatsApp ou usa o app.
3. `Como as previsões funcionam?` — São calculadas com base no que você registra, no seu ritmo atual e no histórico. O Nino mostra o que influenciou cada previsão.
4. `Meus dados ficam seguros?` — Ficam. Nada é compartilhado sem seu consentimento e nenhuma decisão financeira é tomada automaticamente.

(remover "Quanto custa" — coberto pelo micro em hero/CTA)

---

## 5. Estrutura final recomendada — **7 blocos**, mesma contagem

Mantém o número; muda o peso interno de cada bloco. Sequência:

```text
[Header fixo, escuro, translúcido]
1. Hero (ink)              — 1 dobra 390×844 completa
2. Manifesto (cloud)       — 1 dobra
3. Demonstração (white)    — 1 dobra
4. Transformação (cloud)   — 2 splits (não 3)
5. Divisão do Rolê (white) — card compacto
6. Simples + Confiança (cloud) — passos em linha + 1 parágrafo
7. CTA Final (ink) + FAQ (cloud, 4 itens)
[Footer ink]
```

Contagem de dobras mobile alvo: **10 dobras** (hoje ≈14).

---

## 6. Especificação visual por bloco (mobile 390px)

Tokens já existem em `landing.css`; abaixo os valores-alvo.

### Hero
- Fundo: `--lp-ink` com radial suave existente.
- Wrap: 20px padding lateral, `padding: 96px 0 56px` (hoje 96/72).
- H1: 36px / 1.08 / -0.02em; máx 4 linhas.
- Lead: 16px / 1.65; máx 3 linhas.
- CTA: `lp-btn.primary` altura 48px (mantém).
- Micro: 12px, opacity 0.55.
- Mockup: altura máx 320px, 3 mensagens.
- **Sem eyebrow, sem link secundário no mobile** (`@media (max-width: 767px)`).

### Manifesto
- Fundo: cloud.
- `padding: 88px 0`.
- Inner: `max-width: 520px`, `gap: 20px` entre grupos, `gap: 4px` dentro de grupo.
- Linha 1: 32px / 1.15 / 600 ink.
- Linha 2: 20px muted.
- 3 linhas-sinal: 18px / 1.5 ink com `margin-block: 2px`.
- Close: 20px muted, `margin-top: 24px`.
- Final: 22px / 600 **em coral** (`--lp-coral`), `margin-top: 28px`.

### Demonstração
- Fundo: white.
- `padding: 88px 0`.
- Section-head max 560px.
- **Composição unificada**: um único `.lp-chat--light`, radius 24px, sombra soft.
  - Sparkline dentro do card (altura 56px, padding 12px 0), separador `border-top: 1px solid --lp-line`.
  - Sem `.lp-trend` externo, sem `.lp-demo-legend`.
- CTA sugestão (suggestion): mantém.

### Transformação
- Fundo cloud, `padding: 88px 0`.
- H2 centralizado, `margin-bottom: 48px`.
- 2 splits (não 3). Mobile: copy acima do visual, `gap: 24px`. Divider entre splits: `border-top: 1px solid --lp-line`, `padding-block: 40px`.
- Split A: card `lp-note` altura ≈ 140px.
- Split B: `lp-goal` redesenhado — frase-Nino em destaque (17px/1.4 ink 500) + barra + `72% · Viagem de fim de ano` em muted 13px.

### Divisão do Rolê
- Fundo white, `padding: 88px 0`.
- Card radius 24px, `padding: 20px`, altura alvo ≤ 360px.
- 3 linhas de participante + `+1 pessoa` como muted.
- Botão: `lp-btn` variante ghost (borda `--lp-line`, texto ink), sem gradiente.

### Simplicidade + Confiança
- Fundo cloud, `padding: 88px 0`.
- Passos: bloco horizontal com 3 células separadas por `·` invisível (grid `1fr auto 1fr auto 1fr`), tipografia 15/1.5, numeral 40px violet.
- Confiança: 1 parágrafo 16px/1.65 max 60ch, sem lista.

### CTA Final
- Fundo ink, `padding: 96px 0`.
- H2 32/1.15, lead 16 muted, CTA único.
- Símbolo decorativo: manter opacity 0.05, mas mover para top-right no mobile.

### FAQ
- Fundo cloud, `padding: 72px 0 96px` (encurta cauda).
- 4 `<details>`, radius 16px.

### Footer
- Ink, `padding: 32px 0` (hoje 40px).

---

## 7. Componentes e seletores a alterar

Arquivos:
- `src/pages/landing/LandingPage.tsx`
- `src/pages/landing/landing.css`
- `src/test/landing-page.test.tsx` (adequar copy final)

Trechos-alvo em `LandingPage.tsx`:
- `HeroSection` (linhas 64–97): remover eyebrow (67:69) e `lp-lead--tight` + link secundário (80–87). Fundir leads.
- `HeroMockup` (99–119): remover uma das mensagens `nino` para 3 bolhas totais.
- `ManifestoSection` (123–142): reordenar copy final; adicionar classe modificadora ao fechamento em coral.
- `DemoSection` (146–201): fundir `.lp-chat--light` e `.lp-trend` em um único card; remover `.lp-demo-legend`.
- `TransformSection` (205–284): remover terceiro `.lp-split` (264–280); refatorar `.lp-goal` (246–260) reduzindo métricas.
- `RoleSection` (288–332): reduzir participantes para 3; trocar `lp-btn primary` (325) por variante ghost.
- `SimpleTrustSection` (336–386): substituir `<ol class="lp-steps">` por linha inline; substituir `<ul class="lp-trust-list">` por parágrafo único.
- `FinalCtaSection` (390–412): substituir H2 e lead.
- `FAQSection` + `FAQ_ITEMS` (416–460): reduzir para 4 itens; ajustar copy.
- `MobileCta` (489–553): trocar sentinelas (ver §9).

Seletores CSS a criar/ajustar em `landing.css`:
- Novo: `.lp-manifesto-final--coral`, `.lp-btn.ghost`, `.lp-steps--inline`, `.lp-mobile-cta` (redesign).
- Ajustar: `.lp-hero` padding mobile, `.lp-eyebrow` `@media (max-width: 767px) { display: none }`, `.lp-lead--tight { display: none }` em mobile, `.lp-section` padding, `.lp-goal` layout, `.lp-role-card` altura, `.lp-final` símbolo posicionamento.
- Remover: `.lp-trend`, `.lp-demo-legend` (blocos e regras).

---

## 8. Redução de comprimento

Hoje (estimado a 390px):
- Hero ≈ 900px · Manifesto ≈ 720px · Demo ≈ 980px · Transform ≈ 1320px · Rolê ≈ 780px · Simples+Trust ≈ 820px · CTA Final ≈ 620px · FAQ ≈ 720px · Footer ≈ 120px → **≈ 6.980px (≈ 8.3 dobras)**. Com header, gaps e CTA fixo empurrando, percepção ≈ 14 dobras.

Alvo pós-plano:
- Hero 780 · Manifesto 640 · Demo 720 · Transform 900 · Rolê 560 · Simples+Trust 520 · CTA Final 560 · FAQ 520 · Footer 100 → **≈ 5.300px (≈ 6.3 dobras)**.
- **Redução: ≈ 24%**, dentro da meta 20–30%.

Fontes de corte: eliminação de 1 split, fusão chat+trend, redução do `lp-goal`, redução de 5 para 4 FAQs, encurtamento de paddings 120→88 mobile e 40→32 no footer, remoção da lista de trust e da eyebrow.

---

## 9. Regras finais do CTA fixo

### Visual
- Altura total: **52px** (hoje ≈ 64px com padding 8 + botão 48).
- Fundo: `rgba(16, 17, 26, 0.94)` sólido; **sem gradiente**, sem borda.
- Border-radius: 14px (hoje 20).
- Shadow: `0 12px 32px rgba(16, 17, 26, 0.24)`.
- Botão interno: label `Começar grátis`, texto branco, background `rgba(255,255,255,0.10)`, sem gradiente; altura 40px.
- Padding: `left/right 16px, bottom 12px`.

### Comportamento (IntersectionObserver)
- **Oculto** quando qualquer um observado está visível: `#hero`, `#comecar`, `#duvidas`, `.lp-footer`.
- **Visível** apenas quando nenhum dos acima está no viewport (Manifesto → Simples+Trust).
- Adicionar `.lp-footer` como sentinel para corrigir o bug observado.
- Delay de 200ms na primeira aparição para evitar flicker no hero.

### Escopo
- `@media (max-width: 899px)` apenas.
- `prefers-reduced-motion`: sem transição de opacity, aparece direto.

---

## 10. Checklist de QA por viewport

| Viewport | Verificações |
|---|---|
| **320px** (min) | H1 sem overflow; card Rolê participantes cabem sem cortar valor; CTA fixo largura 100% − 24px; padding lateral 16px suficiente. |
| **360px** | Mockup hero ≤ 320px altura; manifesto max-width respeitado; splits empilhados sem lacuna. |
| **390px** (iPhone 14) | Primeira dobra: header + H1 + lead + CTA + micro **sem mockup cortado no meio**; CTA fixo oculto no hero. |
| **430px** (iPhone 15 Pro Max) | Sem widow-lines em H1; padding vertical 88px válido. |
| **768px** (tablet) | Transição para grid 2 col nos splits; nav-mobile-login oculta ainda; CTA fixo oculto (breakpoint 899). |
| **1024px** | Header nav-links visíveis; hero grid 1.05fr / 0.95fr; wrap 1120 respeitado. |
| **1440px** | Sem overflow horizontal; símbolo do CTA final não escapa; footer alinhado horizontal. |

QA transversal:
- CTA fixo desaparece antes do CTA final e permanece oculto no footer.
- `prefers-reduced-motion`: sem animações.
- Contraste texto secundário `--lp-muted #6D7080` sobre `--lp-cloud #F7F6FB` = 4.62:1 (aprova WCAG AA para 16px). Confirmar em mockups.
- Focus visible violet 2px preservado.
- Testes: `src/test/landing-page.test.tsx` — atualizar assertions para copy nova e 4 FAQs.

---

## 11. Confirmação

**Nenhum arquivo do projeto foi alterado nesta análise.** Nenhum build, teste ou deploy foi executado. As únicas leituras foram `src/pages/landing/LandingPage.tsx` e `src/pages/landing/landing.css`, ambas em modo somente-leitura. Aguardando aprovação explícita para prosseguir com a implementação em rodada separada.
