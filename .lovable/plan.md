
# Redesign estratégico — Landing Page Meu Nino.IA (mobile-first)

> Plan Mode. Nenhum arquivo foi alterado. Sem código, sem build, sem deploy. Aguarda aprovação explícita.

---

## 1. Diagnóstico da versão mobile atual

Estado real observado em `src/pages/landing/LandingPage.tsx` (691 linhas) e `landing.css` (610 linhas):

- **14 blocos** em sequência: `top`, `hero`, `manifesto`, `previsao`, `comportamento`, `metas`, `insights`, `role`, `capacidades`, `como-funciona`, `confianca`, `seguranca`, `duvidas`, `comecar`.
- Alternância de fundos claros/escuros repetida, criando fadiga visual no mobile.
- Hero denso (linhas 83–184): headline + subheadline + selos + dois CTAs + mockup elaborado dentro da primeira dobra.
- 4 seções distintas (`previsao`, `comportamento`, `metas`, `insights`) explicando essencialmente a mesma promessa com pequenas variações.
- Seções `confianca` e `seguranca` duplicam a mensagem de "você no controle".
- CTA fixo inferior presumivelmente sobrepondo conteúdo (a apurar no CSS).
- Muitos cards e sub-cards; poucos momentos editoriais respiráveis.
- Copy tecnicamente correta, mas mistura tom humano ("percebe mudanças") com tom SaaS ("insights acionáveis", "categorização automática").

## 2. Percepção premium atual — avaliação

Nível atual: **"SaaS financeiro brasileiro bem-feito"**. Não é ainda **"marca proprietária jovem e sofisticada"**.

Razões:
- excesso de superfícies (cards em cards) dilui hierarquia;
- ritmo previsível: título → parágrafo → visual, repetido 8+ vezes;
- gradiente e ícones aplicados como decoração, não como pontuação;
- ausência de silêncio tipográfico — pouca área branca dominante.

## 3. Problemas de storytelling

- Cada seção reintroduz o produto em vez de avançar a história.
- O visitante recebe todas as respostas antes de ter perguntas.
- Nenhum arco emocional claro entre "isso acontece comigo" e "quero começar".
- Divisão do Rolê aparece perdida entre seções analíticas, matando seu potencial de identificação.

## 4. Problemas de copy

- Recorrência de "entender mudanças", "decidir melhor", "próximos passos", "sem planilhas".
- Termos B2B/SaaS: "insights", "capacidades", "consolidado".
- Explicações longas onde uma cena curta bastaria.
- Poucas frases concretas com valor, pessoa, cenário real.

## 5. Problemas de design e ritmo

- 14 seções ~= página mobile muito longa (rolagem cansativa).
- Cards de altura similar em sequência.
- Duas colunas repetidas em desktop, sem contraste editorial.
- Ícones em quase todos os títulos.
- CTA fixo + header fixo comprimem viewport útil.

---

## 6. Mapa da nova narrativa (7 atos → 7 blocos)

```text
1. HERO            → "Isso pode ser diferente."          (identificação + promessa)
2. MANIFESTO       → "Isso acontece comigo."             (reconhecimento emocional)
3. DEMONSTRAÇÃO    → "Como assim ele percebe?"           (prova viva em uma cena)
4. TRANSFORMAÇÃO   → "O que muda pra mim."               (3 benefícios narrados)
5. DIVISÃO DO ROLÊ → "Até isso ele resolve?"             (momento concreto, memorável)
6. SIMPLES+CONFIA  → "Como funciona e o que ele não faz" (mecânica + confiança)
7. CTA FINAL + FAQ → "Vou começar."                      (ação + últimas dúvidas)
```

Cada bloco responde **uma pergunta nova**. Nenhum repete o anterior.

---

## 7. Estrutura final recomendada

7 blocos. Fundo predominantemente **Cloud/Branco**. Deep Ink apenas no Hero e no CTA final. Coral e gradiente reservados para 2–3 pontos de energia.

| # | Bloco | Fundo | Papel |
|---|-------|-------|-------|
| 1 | Hero | Deep Ink | Promessa + demo mínima |
| 2 | Manifesto | Cloud | Editorial, tipografia grande |
| 3 | Demonstração | Branco | Cena completa: registro → previsão → causa → ação |
| 4 | Transformação | Cloud alternado | 3 benefícios com composição alternada |
| 5 | Divisão do Rolê | Branco | 1 mockup concreto, leve |
| 6 | Simples + Confiança | Cloud | 3 passos + o que o Nino não faz |
| 7 | CTA final + FAQ | Deep Ink → Cloud | Fecho emocional + 5 perguntas |

---

## 8. Copy completa proposta

### Bloco 1 — Hero
- **Eyebrow (opcional, discreta):** "Inteligência financeira conversacional"
- **H1:** "Seu dinheiro não está desorganizado. Só faltava alguém para cuidar dele com você."
- **Sub (1 linha):** "O Nino registra sua rotina, percebe mudanças e ajuda você a decidir antes que o mês aperte."
- **Complemento:** "Pelo WhatsApp ou pelo app."
- **CTA primário:** "Quero meu Nino grátis"
- **CTA secundário (link discreto):** "Ver o Nino em ação"
- **Microcopy:** "Grátis para começar · Sem cartão · Menos de 1 minuto"

*Alternativas de H1 a testar (documentadas, não simultâneas):*
- "O mês não aperta de uma vez. Ele vai dando sinais."
- "Seu dinheiro tenta avisar antes. O Nino ajuda você a perceber."

### Bloco 2 — Manifesto
Texto editorial, uma frase por linha, tipografia grande:

> O mês não sai do controle em um único gasto.
> Ele muda aos poucos.
> Um delivery a mais.
> Uma assinatura esquecida.
> Uma semana mais cara do que o normal.
> Quando você percebe, a fatura já fechou.
>
> **O Nino acompanha esses sinais com você.**

Sem cards. Sem ícones. Só respiro.

### Bloco 3 — Demonstração central
- **H2:** "Antes de mostrar um número, o Nino explica o que mudou."
- **Cena (mockup único, conversa + camada de inteligência):**
  - Você: *"Gastei R$ 80 no bar ontem no Nubank."*
  - Nino: *"Pronto. Organizei em Lazer."*
  - Nino: *"Nesse ritmo, seu mês fecha em R$ 3.180 — 8% acima do anterior."*
  - Nino: *"Lazer e alimentação fora explicam a maior parte da alta."*
  - Sugestão: *"Quer definir um limite para o restante do mês?"*
- **Legenda curta abaixo:** "Uma conversa. Um registro. Uma previsão que muda com você."

Sem outros cards competindo. Sem métricas soltas ao lado.

### Bloco 4 — O que muda na sua vida
- **H2:** "Menos planilha. Mais clareza."
- Três subseções com **composição alternada** (imagem à direita, imagem à esquerda, texto pleno):

  **A. Perceber antes que aperte**
  "O Nino percebe quando seu ritmo muda e avisa enquanto ainda dá tempo de ajustar."

  **B. Manter seus planos vivos**
  "Metas deixam de ser um número esquecido e passam a acompanhar o que acontece no mês."

  **C. Resolver a rotina em uma conversa**
  "Registrar, corrigir, perguntar, entender. Você fala como fala. O Nino organiza."

Cada benefício com **um visual próprio** (não três cards iguais).

### Bloco 5 — Divisão do Rolê
- **H2:** "Dividir a conta não deveria virar outra conta pra você resolver."
- **Corpo:** "Você conta quem foi, quanto foi e quem pagou. O Nino calcula a parte de cada um e te ajuda a preparar um lembrete amigável."
- **Mockup:** total, participantes, valor por pessoa, quem pagou, pendentes, botão "Preparar lembrete".

Nada sobre envio automático.

### Bloco 6 — Simples + Confiança
- **H2:** "Falar com o Nino é simples. Entender o que ele faz também."
- **Três passos (sem cards pesados, tipografia numerada):**
  1. Você conta o que aconteceu.
  2. O Nino organiza e explica.
  3. Você decide com mais clareza.
- **Bloco curto de confiança (2–3 linhas, sem selos):**
  "Você escolhe o que registrar. O Nino não movimenta seu dinheiro. Tudo que ele conclui, ele mostra por quê."

### Bloco 7 — CTA final + FAQ
- **H2:** "Seu dinheiro começa a fazer mais sentido a partir de uma conversa."
- **Sub:** "Fale com o Nino e descubra o que seus números estão tentando dizer."
- **CTA:** "Quero meu Nino grátis"
- **FAQ (5 perguntas, `<details>`):**
  1. O Nino é um banco? → Não. Ele organiza e explica; nunca movimenta dinheiro.
  2. Funciona pelo WhatsApp? → Sim, pelo WhatsApp e pelo app.
  3. O Nino movimenta meu dinheiro? → Nunca. Ele só entende e sugere.
  4. Como as previsões funcionam? → A partir do que você registra no mês, com a fórmula explicada quando você pergunta.
  5. Quanto custa para começar? → Grátis. Sem cartão.

---

## 9. Wireframe textual — Mobile (360–430 px)

```text
┌────────────────────────────┐
│ [Nino] Meu Nino.IA   Entrar│  header 52px
├────────────────────────────┤
│                            │
│  H1 (3–4 linhas, 34–40px)  │
│                            │
│  Sub (1 linha, 15px)       │
│  · WhatsApp ou app         │
│                            │
│  [Quero meu Nino grátis]   │
│  Ver o Nino em ação →      │
│                            │
│  microcopy pequena         │
│                            │
│  ┌ mockup conversa ─────┐  │
│  │ Você: ...           │  │
│  │ Nino: ...           │  │
│  └─────────────────────┘  │
├────────────────────────────┤ ← após rolar: CTA fixo aparece
│  MANIFESTO                 │
│  frases curtas             │
│  tipografia grande         │
│  respiro                   │
├────────────────────────────┤
│  DEMONSTRAÇÃO              │
│  H2                        │
│  mockup conversa completo  │
│  legenda                   │
├────────────────────────────┤
│  TRANSFORMAÇÃO             │
│  A. imagem em cima         │
│      texto embaixo         │
│  B. imagem embaixo         │
│      texto em cima         │
│  C. texto pleno + visual   │
├────────────────────────────┤
│  DIVISÃO DO ROLÊ           │
│  mockup enxuto             │
├────────────────────────────┤
│  SIMPLES + CONFIANÇA       │
│  3 passos numerados        │
│  confiança em 2 linhas     │
├────────────────────────────┤
│  CTA FINAL (Deep Ink)      │
│  H2 grande                 │
│  [Quero meu Nino grátis]   │
├────────────────────────────┤
│  FAQ (5 <details>)         │
├────────────────────────────┤
│  footer minimalista        │
└────────────────────────────┘
```

CTA fixo: **oculto** durante Hero e durante CTA final/FAQ.

## 10. Wireframe textual — Desktop (≥1024 px)

```text
┌──────────────────────────────────────────────────────────┐
│ Header 64px  [Nino] Meu Nino.IA           menu    Entrar │
├──────────────────────────────────────────────────────────┤
│ HERO — grid 12 col                                       │
│  ├ 7 col: eyebrow · H1 grande · sub · CTAs · microcopy   │
│  └ 5 col: mockup conversa único                          │
├──────────────────────────────────────────────────────────┤
│ MANIFESTO — coluna central max 720px, tipografia editorial│
├──────────────────────────────────────────────────────────┤
│ DEMONSTRAÇÃO — mockup grande centralizado + legenda      │
├──────────────────────────────────────────────────────────┤
│ TRANSFORMAÇÃO — 3 linhas alternadas texto↔visual (não 3 cards)│
├──────────────────────────────────────────────────────────┤
│ DIVISÃO DO ROLÊ — 6/6 texto+mockup                       │
├──────────────────────────────────────────────────────────┤
│ SIMPLES+CONFIANÇA — 3 passos horizontais + linha confiança│
├──────────────────────────────────────────────────────────┤
│ CTA FINAL Deep Ink — full width, tipografia grande       │
│ FAQ Cloud — coluna central 720px                         │
│ Footer                                                   │
└──────────────────────────────────────────────────────────┘
```

Sem duas colunas repetidas. Cada bloco tem uma composição diferente.

---

## 11. Direção visual por bloco

1. **Hero** — Deep Ink `#10111A`. Textura sutil do símbolo Nino como water-mark grande atrás. Mockup em superfície `#181A25` elevada, borda 1px `rgba(255,255,255,0.06)`.
2. **Manifesto** — Cloud `#F7F6FB`, tipografia 28–40px, coluna estreita, respiro generoso, uma linha por frase.
3. **Demonstração** — Branco. Mockup único centralizado. Camada de inteligência (previsão + causa) surge abaixo do mockup em superfície levemente elevada; **sem card dentro de card**.
4. **Transformação** — Cloud. Composição editorial alternada. Coral pontual em uma das três cenas.
5. **Divisão do Rolê** — Branco. Mockup compacto; gradiente aparece **uma vez** no botão "Preparar lembrete".
6. **Simples + Confiança** — Cloud. Números 01/02/03 em tipografia grande servindo como ícone; confiança em texto corrido, sem selos.
7. **CTA final** — Deep Ink full-bleed, título grande, botão coral. FAQ imediatamente abaixo em Cloud com `<details>` mínimos.

---

## 12. Seções atuais a **remover**

- `previsao`, `comportamento`, `insights` (fundem-se na Demonstração)
- `capacidades` (funcionalidades genéricas — inimigo do storytelling)
- `confianca` e `seguranca` como blocos separados (fundem-se em Simples+Confiança)
- `como-funciona` como bloco autônomo (absorvido em Simples+Confiança)

## 13. Seções a **agrupar**

- `previsao` + `comportamento` + `insights` → **Demonstração central**
- `como-funciona` + `confianca` + `seguranca` → **Simples + Confiança**
- `metas` → subseção B de **Transformação**

## 14. Componentes a **preservar**

- `NinoSymbol`, `NinoWordmark`, `NinoLogo` (marca oficial — não mexer)
- Tokens de cor já definidos em `landing.css`
- Estrutura de `<details>` do FAQ
- Testes de fumaça em `src/test/landing-page.test.tsx` (serão ajustados nos ids/qtd. de FAQ como parte da futura implementação)

## 15. Componentes a **refazer**

- `LandingPage.tsx` inteira (composição de 7 blocos)
- Subcomponentes propostos (na futura implementação):
  - `HeroBlock`, `ManifestoBlock`, `DemoBlock`, `TransformBlock`, `RoleBlock`, `SimpleTrustBlock`, `FinalCtaFaqBlock`
  - `ConversationMockup` (usado no Hero e na Demonstração, com variantes de densidade)
  - `StickyCta` (com regra de visibilidade condicional)
- `landing.css` reescrita: menos utilitárias, mais escopo editorial, remoção de blocos órfãos.

---

## 16. Estratégia do CTA fixo mobile

**Recomendação: CTA fixo condicional (opção preferencial do briefing).**

Regras:
- **Oculto** enquanto o Hero está visível (usa `IntersectionObserver` sobre o Hero).
- **Aparece** ao ultrapassar o Hero, com fade de 180ms.
- **Desaparece** ao entrar em vista o bloco de CTA Final/FAQ.
- Altura 52px, fundo `rgba(16,17,26,0.92)` com blur leve, apenas o botão coral + microcopy de 1 linha.
- Nunca cobre conteúdo: adiciona `padding-bottom` dinâmico ao `<main>` só quando visível.
- Desktop: **sem** CTA fixo — a densidade não pede.

Justificativa: mantém conversão no scroll longo sem competir com o hero (que já tem CTA claro) nem com o CTA final (redundância prejudica).

---

## 17. Sistema — tipografia, espaçamento, cores

**Cores (uso disciplinado):**
- Fundo dominante: Cloud `#F7F6FB` + Branco `#FFFFFF` (~70% da página).
- Deep Ink `#10111A` (~15%): Hero + CTA final.
- Nino Coral `#FF6B5F`: CTA primário + 1 destaque narrativo por página.
- Nino Mint `#2FC99A`: apenas estados positivos em mockups.
- Gradiente `135deg #6D4AFF → #4338FF → #FF6B5F`: máximo 2–3 aparições (mockup do Hero, botão da Divisão do Rolê, borda sutil do símbolo).

**Tipografia (DM Sans):**
- H1: 40/1.06 mobile, 64/1.04 desktop, peso 600.
- H2: 28/1.10 mobile, 44/1.08 desktop, peso 600.
- H3: 20/1.15, peso 600.
- Body: 16/1.65 mobile, 17/1.7 desktop, peso 400–500.
- Label/eyebrow: 12/1.2, peso 600, tracking +0.06em, uppercase discreto.
- Máx. 60–66 caracteres por linha em parágrafos.

**Espaçamento (escala 4px):**
- Padding vertical entre blocos: 72px mobile, 128px desktop.
- Gap interno em blocos editoriais: 24/32/48px.
- Container mobile: 20px padding lateral; desktop: max-width 1120px.

---

## 18. Estratégia de iconografia

- **Phosphor Icons** apenas em: FAQ toggler, microcopy do CTA fixo, itens utilitários do footer.
- **Sem ícone** em títulos de seção.
- **Sem ícone** decorando parágrafos.
- Símbolo oficial do Nino: watermark no Hero, avatar do Nino nos mockups, âncora do CTA final. Nunca como ícone funcional.

---

## 19. Mockups necessários — história de cada um

1. **Hero mockup** — Uma bolha do usuário + duas bolhas do Nino + linha de sugestão. História: "eu falo, ele entende, ele já projeta."
2. **Demonstração mockup** — Extensão do Hero mockup, com um mini gráfico linha única mostrando a previsão atualizada. História: "não é só resposta, é consciência."
3. **Transformação A — Percepção** — Notificação sutil "Seus gastos com delivery aumentaram nas últimas 3 semanas."
4. **Transformação B — Metas** — Barra de progresso viva com nota "Sua meta continua possível, mas o próximo aporte precisa ser um pouco maior."
5. **Transformação C — Conversa** — Frase natural do usuário + correção rápida ("Foi no débito, não no crédito").
6. **Divisão do Rolê** — Card com total, 3 avatares, valor por pessoa, status (pago/pendente), botão "Preparar lembrete".

Todos os mockups: estética consistente, mesma família de bolha, mesmo símbolo do Nino como avatar. Sem screenshot real; ilustrações fiéis à UI do app.

---

## 20. Microinterações recomendadas

- Bolhas de mensagem entram com fade+translate 180–220ms, escalonadas.
- Linha do mini-gráfico da Demonstração se desenha uma única vez ao entrar no viewport (path-length 600ms).
- Barra da meta preenche em 500ms ease-out.
- CTA fixo: fade 200ms.
- Hover CTA: brilho 1px + translateY(-1px), 180ms.
- `prefers-reduced-motion`: tudo estático.

Proibido: parallax, partículas, 3D, glow contínuo, bounce.

---

## 21. Critérios de aceite verificáveis

- [ ] Página com exatamente **7 blocos** principais.
- [ ] Hero exibe **uma** promessa principal + no máx. 1 CTA primário + 1 CTA texto.
- [ ] Nenhuma seção repete a ideia de outra (auditoria de copy).
- [ ] `previsao`, `comportamento`, `insights`, `capacidades`, `confianca`, `seguranca`, `como-funciona` **não existem** como seções autônomas.
- [ ] CTA fixo mobile **oculto** no Hero e no CTA final/FAQ.
- [ ] Página funciona sem overflow horizontal em 320/360/390/430/768/1024/1440.
- [ ] Nenhum conteúdo essencial em `position: absolute` no mobile.
- [ ] Alturas de toque ≥ 44px.
- [ ] Deep Ink usado em no máximo 2 blocos (Hero + CTA final).
- [ ] Gradiente aparece em no máximo 3 pontos.
- [ ] FAQ com exatamente 5 perguntas.
- [ ] Sem selos, sem prova social fictícia, sem promessas absolutas.
- [ ] Testes existentes em `landing-page.test.tsx` atualizados e verdes (ids revisados na fase de execução).
- [ ] Lighthouse mobile: LCP < 2.5s, CLS < 0.05, sem shift do CTA fixo.
- [ ] Title/description conforme SEO abaixo.

**SEO:**
- Title: `Meu Nino.IA — seu dinheiro começa a fazer mais sentido`
- Description: `Converse com o Nino para organizar gastos, perceber mudanças, acompanhar metas e entender o que vem pela frente.`

---

## 22. Estimativa de arquivos a alterar (na futura execução)

- `src/pages/landing/LandingPage.tsx` — reescrita completa.
- `src/pages/landing/landing.css` — reescrita completa (poda de ~40% das regras).
- **Novos**: `src/pages/landing/blocks/HeroBlock.tsx`, `ManifestoBlock.tsx`, `DemoBlock.tsx`, `TransformBlock.tsx`, `RoleBlock.tsx`, `SimpleTrustBlock.tsx`, `FinalCtaFaqBlock.tsx`, `ConversationMockup.tsx`, `StickyCta.tsx`.
- `src/test/landing-page.test.tsx` — atualização de ids, contagem de FAQ (6 → 5), asserts de copy.
- `index.html` — title/description/OG.
- Preservados: `NinoSymbol.tsx`, `NinoWordmark.tsx`, `NinoLogo.tsx`, `public/brand/meu-nino-symbol.svg`.

Estimativa: **~10 arquivos** tocados, **7 novos**, **0 no backend/app autenticado**.

---

## 23. Riscos de implementação

- **Testes de LP** dependem de ids atuais (`previsao`, `comportamento`, etc.). Precisarão ser reescritos na mesma execução para não quebrar CI.
- **Regras de CTA fixo condicional** dependem de `IntersectionObserver`; garantir fallback quando indisponível (mostrar estático após 200px de scroll).
- **Cortes agressivos** podem gerar pedido de rollback parcial — mitigado mantendo o commit anterior como referência.
- Divisão do Rolê como bloco isolado exige mockup novo — arriscar-se a mensagem prometer envio automático (proibido). Copy foi travada em "preparar lembrete".
- Regressão SEO se meta tags não forem atualizadas junto — incluído no escopo do patch único.
- Contradição com `custom-instructions` sobre nome interno "NoControle.ia": o rebranding para Meu Nino.IA já foi executado em ondas anteriores; este plano mantém a marca vigente.

---

## 24. Confirmação de Plan Mode

Nenhum arquivo do projeto foi criado, alterado ou removido nesta etapa. Nenhum build, deploy, migration ou comando de estado foi executado. Nenhum crédito de implementação foi consumido. Este documento é integralmente uma proposta de redesign.

**Aguardando aprovação explícita** para prosseguir com a execução em um único patch consolidado, conforme critérios de aceite acima.
