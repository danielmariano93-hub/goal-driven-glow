
# Landing Page pública MeuNino → Meu Nino.IA (reescrita fiel ao HTML v3)

## A. Diagnóstico

A LP atual (`src/pages/Landing.tsx`, ~380 linhas) é uma composição própria com hero+chat, 3 features, 3 steps, FAQ curta e footer, usando tokens de marca do app (roxo/coral já existentes em `src/index.css` / `tailwind.config.ts`).

O HTML anexado propõe **outra narrativa e estética**, mais próxima de fintech premium:
- Header sticky flutuante com pill translúcida.
- Hero com headline de duas linhas (“Você não precisa controlar cada centavo. / Precisa entender o que vem pela frente.”), visual composto por símbolo + 3 cards flutuantes (Previsão / Meta / Insight escuro).
- Seção “dor” com layout sticky + 4 cards numerados.
- Seção “inteligência” com **bento** (chat card + card preto de projeção + 2 cards menores).
- Seção **dark** com 6 features.
- Faixa AI escura com lista de projeção 30 dias.
- Prova social (declarada demonstrativa no HTML).
- FAQ com 5 perguntas (conteúdo diferente do atual).
- CTA final em card gradiente.
- Footer minimalista.

Paleta é compatível com os tokens já existentes (violet #6D4AFF, coral #FF6B5F, ink #10111A, cloud #F7F6FB). Diferenças: fundo `--cloud` mais claro que o `--background` atual do app; a LP terá **tokens próprios** para não afetar o app.

Marca: passa a exibir **“Meu Nino.IA”** (o `.IA` como pill gradiente). Texto corrente varia entre “Nino”, “O Nino”, “Com o Nino”. Nome interno do produto (package, metadados operacionais) permanece como está.

## B. Mapa de seções → componentes

Rota `/` (público) renderiza `LandingPage` com esta composição:

1. `<LandingHeader />` — pill sticky, logo (símbolo SVG + wordmark “Meu Nino” + pill “.IA”), 3 âncoras (`#inteligencia`, `#recursos`, `#duvidas`), botões “Entrar” (`/login`) e “Começar grátis” (`/signup`).
2. `<HeroSection />` — badge, H1 com trecho em gradiente, lead, 2 CTAs (`/signup`, `#recursos`), 3 microbenefícios com check, `<HeroVisual />` (halo + símbolo + 3 glass cards absolutos).
3. `<PainSection />` — sticky de intro + 4 `<PainCard />` numerados.
4. `<IntelligenceBento />` — bento grid: 
   - `<ChatCard />` (mockup de conversa com 4 balões);
   - `<ForecastCard />` (card preto com projeção 30 dias + barra);
   - `<ContextCard />` e `<GoalCard />` menores.
5. `<FeaturesDark />` — seção dark com 6 `<FeatureTile />` (registro por conversa, contexto imediato, projeções, acompanhamento de metas, alertas de mudança, resumos periódicos — conforme HTML).
6. `<AIBand />` — faixa escura com copy + `<ForecastList />` (3 linhas de previsão de 30 dias).
7. `<SocialProof />` — **tratamento ético**: renderizada por trás de flag `SHOW_LANDING_TESTIMONIALS` (default `false`). Enquanto `false`, a seção não é montada. Quando `true`, mostra os 3 cards com etiqueta explícita “Exemplo demonstrativo”. **Recomendado: manter oculta até termos depoimentos reais assinados.**
8. `<FAQSection />` — 5 perguntas do HTML como `<details>` estilizados, com `aria-expanded` via estado controlado + suporte a teclado.
9. `<FinalCTA />` — card gradiente com H2 e dois CTAs (`/signup`, `#duvidas`).
10. `<LandingFooter />` — logo + copyright. Links “Privacidade”, “Termos”, “Contato” **só aparecem se houver destino real**. Como o projeto não possui essas rotas hoje, planejamos: (a) ocultar por ora **ou** (b) apontar Contato para `mailto:contato@meunino.com.br` se o e-mail estiver disponível (decisão trivial na implementação, sem bloqueio).
11. `<LandingMobileCTA />` — barra fixa inferior mobile com um botão “Começar grátis” → `/signup` (equivalente ao `.mobile` do HTML).

Cada componente é **puro de apresentação**, sem chamadas a Supabase.

## C. Arquivos a criar/alterar

Criar:
- `src/pages/landing/LandingPage.tsx` — orquestra as seções.
- `src/pages/landing/sections/LandingHeader.tsx`
- `src/pages/landing/sections/HeroSection.tsx`
- `src/pages/landing/sections/HeroVisual.tsx`
- `src/pages/landing/sections/PainSection.tsx`
- `src/pages/landing/sections/IntelligenceBento.tsx`
- `src/pages/landing/sections/FeaturesDark.tsx`
- `src/pages/landing/sections/AIBand.tsx`
- `src/pages/landing/sections/SocialProof.tsx`
- `src/pages/landing/sections/FAQSection.tsx`
- `src/pages/landing/sections/FinalCTA.tsx`
- `src/pages/landing/sections/LandingFooter.tsx`
- `src/pages/landing/sections/LandingMobileCTA.tsx`
- `src/pages/landing/brand/NinoSymbol.tsx` — símbolo SVG recriado.
- `src/pages/landing/brand/NinoWordmark.tsx` — lettering “Meu Nino” + pill “.IA”.
- `src/pages/landing/landing.css` — **escopado** com prefixo `.mn-lp` (evita vazar tokens/`html` para o resto do app). Contém apenas o que não é razoável em Tailwind (glass cards absolutos, halos, gradientes específicos, `details[open]`).

Alterar:
- `src/App.tsx` — trocar `import Landing` para a nova `LandingPage` (mesma rota `/`).
- `src/pages/Landing.tsx` — **remover** (ou manter como reexport temporário do novo módulo; preferir remover).
- `index.html` — atualizar `<title>` e `<meta name="description">` para a versão do HTML v3 (“Meu Nino.IA — inteligência para a sua vida financeira” / descrição correspondente), ajustar `og:title`, `og:description`, `twitter:*`. Sem inventar `og:image`; deixar o auto-preview do Lovable atuar (ver F). Preconnect de Inter já existe.

Não alterar:
- `src/index.css`, `tailwind.config.ts` (tokens globais do app permanecem intactos — a LP usa `landing.css` escopado + utilitários Tailwind já disponíveis).
- Qualquer rota autenticada, layout, admin, edge functions, migrations, Supabase, WAHA.

## D. Estratégia de marca e assets (os 3 PNGs base64)

Os 3 PNGs no HTML são: (1) wordmark de header, (2) símbolo grande do hero, (3) wordmark de footer. **Nenhum será importado como base64**. Estratégia:

- **`NinoSymbol.tsx`**: componente SVG inline (círculos/curvas + gradiente `--grad`) que reproduz o símbolo como forma geométrica leve. Aceita `size` e `variant` (`solid` / `mono`).
- **`NinoWordmark.tsx`**: lettering em texto real usando a Manrope/Inter já carregada, com peso 800, letter-spacing negativo, e a pill “.IA” como `<span>` com fundo `--grad`. Zero imagem.
- Se, no futuro, o usuário fornecer artes definitivas, criamos `.asset.json` via `lovable-assets` e trocamos o SVG por `<img>`. Fora do escopo desta rodada.

Resultado: **nenhum data URI**, sem novos binários no repo, bundle não cresce significativamente.

## E. Ajustes de copy por precisão factual

Copy do HTML já é conservadora; ainda assim:

- ✅ **Manter**: “Comece gratuitamente”, “Experiência pelo WhatsApp”, “Sem planilhas e sem julgamento”, faixa de projeção 30 dias (rotulada como projeção/estimativa).
- ⚠️ **Ajustar**: microbenefício/qualquer texto que sugira “segurança bancária”, “criptografia ponta-a-ponta” ou “conformidade LGPD certificada” — o HTML v3 não contém essas promessas explícitas, então nada a ajustar aí; **remover a linha atual da LP antiga** “Dados protegidos com LGPD” já sai naturalmente.
- ⚠️ **FAQ “Quanto custa?”**: manter a resposta do HTML (“Você pode começar gratuitamente. Planos e recursos adicionais serão apresentados com transparência.”) — não citar valores.
- ⚠️ **FAQ “Preciso preencher tudo manualmente?”**: manter menção genérica a “recursos de importação disponíveis no produto” (o projeto já tem OFX/CSV). OK.
- ⚠️ **Prova social**: seção fica **desligada** por padrão (ver B.7). Não publicar depoimentos fictícios.
- ⚠️ **Rodapé — Privacidade/Termos/Contato**: só linkar se houver destino real. Recomendação: nesta rodada, exibir apenas “Contato → `mailto:` do owner (se autorizado)” ou ocultar todos. Decisão trivial, não bloqueia.

## F. Critérios de aceite

Funcional:
- [ ] `/` renderiza a nova LP; `/login`, `/signup`, `/app/*`, `/admin/*` intactos.
- [ ] Todos os CTAs de “começar/cadastrar” apontam para `/signup`; “entrar” para `/login`. Nenhum `wa.me/` sem número, nenhum `#` vazio.
- [ ] Âncoras `#inteligencia`, `#recursos`, `#duvidas`, `#comecar` funcionam com scroll suave e respeitam `prefers-reduced-motion`.
- [ ] FAQ abre/fecha por clique **e** por teclado (Enter/Space), com foco visível.

Visual/responsivo (Playwright headless nas larguras 320, 360, 390, 430, 768, 1024, 1440):
- [ ] Sem overflow horizontal (checar `document.documentElement.scrollWidth ≤ innerWidth`).
- [ ] Hero visual não sobrepõe texto em ≤600px (empilha, `min-height` ajustado).
- [ ] Header sticky não cobre H1 no primeiro fold em nenhuma largura.
- [ ] Barra mobile inferior só aparece <960px e não cobre o footer (padding-bottom aplicado ao `body` do escopo).

Acessibilidade:
- [ ] Um único `<h1>`; hierarquia h2→h3 correta por seção.
- [ ] Contraste AA em texto sobre `--cloud`, sobre dark e sobre gradiente final (verificar branco em `--grad` — passa).
- [ ] `nav` com `aria-label="Principal"`; FAQ com `aria-expanded` correto.
- [ ] `focus-visible` estilizado.

Performance / bundle:
- [ ] Nenhuma imagem base64; nenhum novo pacote NPM.
- [ ] `bun run build` verde; tamanho do chunk da LP monitorado (esperado <25kB gz para a página).

SEO / metadados:
- [ ] `index.html` com title/description v3, `og:*` e `twitter:*` coerentes. Sem `og:image` fabricado. Canonical: `https://meunino.com.br/`.

Testes automatizados:
- [ ] Novo `src/test/landing-page.test.tsx` (RTL): renderiza LP; CTAs apontam para `/signup` e `/login`; FAQ toggles; SocialProof oculta com flag false; ausência de string “Lovable” e de placeholders `#`.
- [ ] Suíte `rebranding-meunino.test.ts` continua passando.

## G. Ordem de implementação (uma rodada única)

1. Criar `landing.css` escopado + tokens locais + `NinoSymbol` e `NinoWordmark`.
2. Montar `LandingPage` compondo os 11 subcomponentes (usar os textos exatos do HTML — copy só ajustada nos pontos de E).
3. Trocar import em `src/App.tsx`; remover `src/pages/Landing.tsx` antigo.
4. Atualizar metadados em `index.html`.
5. Criar `landing-page.test.tsx`; rodar `bunx vitest run` e `bun run build`.
6. Rodar smoke visual Playwright nas 7 larguras com screenshots em `/tmp/browser/landing/`.
7. Relatório: rotas, testes, screenshots, tamanho de chunk.

Publicação em produção: **fora desta rodada** (o usuário decidirá quando publicar).

## H. Riscos / decisões bloqueantes

- **Nenhuma decisão bloqueante** — todos os pontos ambíguos já têm default seguro definido acima (SocialProof oculta por flag; footer sem links jurídicos até termos rotas; símbolo em SVG; sem `og:image` inventado; tokens em CSS escopado).
- Risco menor: se surgir demanda futura de trocar o SVG por artes definitivas, exige apenas um patch cirúrgico via `lovable-assets` — não afeta esta rodada.

---

**Nenhum código foi alterado em Plan Mode.**
