# Refatoração visual da Landing Page — Meu Nino

Escopo restrito à rota `/` (`src/pages/landing/*` + `index.html`). Nada de app autenticado, admin, Supabase, edge functions ou rotas internas. Sem publicação ao final.

## Auditoria — divergências encontradas na LP atual

Baseada em leitura de `src/pages/landing/LandingPage.tsx`, `landing.css`, `NinoSymbol.tsx`, `NinoWordmark.tsx`:

1. **Marca**: wordmark usa Manrope + pill ".IA" gradiente como parte obrigatória — contraria "não invente Meu Nino.IA como parte obrigatória do logotipo".
2. **Símbolo**: `NinoSymbol` é um squircle com "N" retangular geométrico — não é monograma conversacional orgânico, não tem curvas M/N, não tem ponto coral, não tem balão de conversa.
3. **Tipografia**: Inter + Manrope carregadas via Google Fonts. Sofia Pro ausente. Falta fallback autorizado documentado (Plus Jakarta Sans é a escolha ideal open-source próxima da Sofia Pro).
4. **Iconografia dura**: `FEATURES` usa caracteres tipográficos (`✎ ◎ ⟳ ◈ ! ≡`) como ícones. `lp-feature-icon` idem (`◎`, `◈`). Nenhum SVG outline arredondado com stroke consistente.
5. **Tagline oficial ausente**: "Seu dinheiro começa a fazer mais sentido." não aparece no Hero.
6. **Avatar do Nino**: inexistente. Não há variante em círculo Deep Ink com indicador mint para uso em mockup conversacional.
7. **Mockup de chat**: usa gradiente cheio na bolha do usuário e visual genérico; falta avatar do Nino ao lado das bolhas dele.
8. **Cards flutuantes do Hero**: `lp-glass forecast/goal/insight` bons em conceito mas com iconografia zero — números soltos, sem símbolos orgânicos da marca (pulso, estrela, coração).
9. **Bordas/sombras**: `--lp-line: #E8E6F0` cria contornos cinza um pouco pesados vs. "bordas suaves, sombras difusas discretas".
10. **Pills em excesso**: badge do hero + label uppercase de cada seção + pill `.IA` no logo — acumula sensação SaaS.
11. **Gradient overuse**: bolhas do usuário no chat usam gradient cheio; deveriam ser mais discretas (superfície clara com acento).
12. **Metadados**: `index.html` traz "Meu Nino.IA" como título/OG. Deve destacar "Meu Nino" e tagline oficial.

## Estratégia de fonte

- Sofia Pro é comercial (Fontspring). **Não** será carregada.
- Fallback autorizado: **Plus Jakarta Sans** via Google Fonts (open-source, SIL OFL). Formato geométrico humanista muito próximo da Sofia Pro. Pesos 300/400/500/600/700.
- Stack CSS: `"Plus Jakarta Sans", "Sofia Pro", "Avenir Next", "Nunito Sans", system-ui, sans-serif` — se o cliente tiver Sofia Pro instalada localmente, será usada; senão cai em Jakarta Sans. Documentar em comentário no CSS.
- Remover pré-conexão do Manrope; substituir pela do Jakarta Sans no `index.html`.

## Arquitetura da entrega

Reaproveita a estrutura de seções aprovada (Header, Hero, Pain, Bento, Features Dark, AI Band, FAQ, FinalCTA, Footer, MobileCTA) — o que muda é a camada visual: marca, ícones, tipografia, superfícies, tokens.

### Arquivos alterados

| Arquivo | O que muda |
|---|---|
| `src/pages/landing/NinoSymbol.tsx` | Reescrito. Monograma orgânico com duas curvas contínuas em gradiente (M/N + balão) e ponto coral no canto inferior direito. Props: `variant: "gradient" \| "mono" \| "avatar"`. Variante `avatar` desenha o próprio círculo Deep Ink + indicador mint. |
| `src/pages/landing/NinoWordmark.tsx` | Reescrito. Lettering "Meu Nino" em Plus Jakarta Sans SemiBold, tracking justo, sem pill ".IA". Aceita prop `withDescriptor` (default false); quando true, mostra ".IA" como descritor discreto abaixo/ao lado, cor `--lp-muted`, peso Regular, tamanho ~0.62rem, sem gradient. |
| `src/pages/landing/icons/NinoIcons.tsx` | **NOVO**. Biblioteca SVG própria com stroke arredondado consistente (24×24, stroke 1.6, `stroke-linecap="round"`, `stroke-linejoin="round"`, `fill="none"`): `ChatBubble`, `Sparkle`, `Pulse`, `HeartOutline`, `Target`, `Compass`, `TrendUp`, `BellSoft`, `CalendarSoft`, `Wallet`. Aceitam `accent: "violet"\|"coral"\|"mint"\|"ink"` aplicando `stroke="url(#grad-...)"` quando accent é violet/coral. |
| `src/pages/landing/landing.css` | Refactor amplo: novos tokens (mantém paleta oficial), remove `--lp-line` pesado (troca por `rgba(16,17,26,.06)`), sombras difusas com raio maior e opacidade menor, superfícies com radius 20–28, remove Manrope/Inter e adota Plus Jakarta Sans, ajusta bolhas de chat (bolha do usuário deixa de ser gradient cheio — passa a ser Deep Ink com texto branco; bolha do Nino ganha avatar circular), refina `lp-badge` (uma única pill no hero), remove pill do wordmark, adiciona `lp-avatar` para avatar Deep Ink + indicador mint, ajusta ícones features dark para o novo componente. |
| `src/pages/landing/LandingPage.tsx` | Atualiza Hero para incluir tagline oficial "Seu dinheiro começa a fazer mais sentido." com "sentido." em `lp-grad`. Substitui todos os placeholders tipográficos de ícones por componentes de `NinoIcons`. Adiciona `<NinoSymbol variant="avatar" />` ao lado das bolhas do Nino no mockup. Adiciona pequenos ícones aos cards flutuantes do hero (Pulse na previsão, Target na meta, Sparkle no insight). Reduz labels uppercase onde acumulam. Remove pill `.IA` do header. |
| `index.html` | Título: `Meu Nino — seu dinheiro começa a fazer mais sentido`. Description alinhada. Substitui preconnect Manrope→Jakarta Sans. Mantém OG/Twitter sem `og:image` fabricado. |
| `src/test/landing-page.test.tsx` | Ajusta smoke tests: valida tagline oficial presente, CTAs `/signup` e `/login`, 5 itens FAQ, ausência de marca antiga, ausência de pill ".IA" obrigatória no wordmark. |

### Arquivos NÃO alterados

App autenticado, admin, `src/index.css`, tokens globais, Supabase, migrations, edge functions, WAHA/WhatsApp, autenticação, rotas internas. `NinoSymbol` continua sendo importado apenas por arquivos da LP (verificado: uso apenas em `landing/`).

## Detalhes de execução

### NinoSymbol — desenho orgânico

Viewbox 64×64. Duas curvas Bezier contínuas que sugerem M/N entrelaçados dentro de uma silhueta de balão de conversa arredondado; ponto coral (r=4) no canto inferior direito como "cauda" do balão. Stroke 5, `stroke-linecap="round"`, gradiente `violet → indigo → coral` (id único por instância via `useId`). Sem preenchimento sólido pesado; a variante `avatar` envelopa em círculo `fill="#10111A"` com indicador mint (círculo 8×8) no canto superior direito.

### Tipografia

```css
@import Plus Jakarta Sans (300;400;500;600;700) via <link> no index.html
.mn-lp { font-family: "Plus Jakarta Sans", "Sofia Pro", "Avenir Next", "Nunito Sans", system-ui, sans-serif; }
```
Headlines com `letter-spacing: -0.03em` (menos comprimido que -0.055 atual), line-height 1.05, peso 600 (não 800). Subheads peso 400. Labels peso 600 tracking 0.14em uppercase.

### Chat mockup

- Bolha usuário: `background: #10111A; color: #fff; border-radius: 18px 18px 6px 18px`.
- Bolha Nino: `background: #fff; box-shadow: sombra difusa; border-radius: 18px 18px 18px 6px`. Precedida de `<NinoSymbol variant="avatar" size={28} />` alinhado ao topo.
- Sem gradiente cheio em nenhuma bolha.

### Testes, typecheck e build

- Rodar `bunx vitest run src/test/landing-page.test.tsx src/test/rebranding-meunino.test.ts` (LP + guardião de rebrand).
- Typecheck + build automáticos do harness.
- Smoke visual via Playwright em 320/390/768/1024/1440 com screenshots salvos em `/tmp/browser/lp/`.

## Critérios de aceite (checklist final)

- [ ] Wordmark "Meu Nino" limpo, sem pill obrigatória ".IA".
- [ ] Símbolo orgânico com curvas contínuas e ponto coral, variantes gradient/mono/avatar.
- [ ] Plus Jakarta Sans carregada; stack de fallback documentada.
- [ ] Nenhum caractere tipográfico usado como ícone; toda iconografia via `NinoIcons`.
- [ ] Tagline oficial visível no Hero com "sentido." em gradiente.
- [ ] Bolhas de chat sem gradient cheio; avatar Deep Ink com mint presente.
- [ ] Sem overflow horizontal em 320/360/390/430/768/1024/1440.
- [ ] Áreas de toque ≥44 px, foco visível, contraste AA.
- [ ] Testes verdes (LP + rebrand), typecheck e build OK.
- [ ] Nenhuma alteração fora de `src/pages/landing/**`, `src/test/landing-page.test.tsx` e `index.html`.
- [ ] Sem publicação em produção.

## Relatório final (a entregar após implementação)

Divergências corrigidas · arquivos alterados com diff resumido · estratégia de fonte (Plus Jakarta Sans como fallback autorizado, Sofia Pro apenas como stack local) · lista de componentes/ícones novos · saída de vitest + typecheck + build · larguras validadas com screenshots · confirmação explícita de que rotas internas, backend e dados permaneceram intactos · URL de preview.
