# Densidade do bloco do Nino na Home (`nino_home_editorial.v2`)

Arquitetura mantida: 1 Spotlight + supporting rows + "Ver todas no Nino". Esta rodada é só densidade, hierarquia e copy compacta — nada de nova seção, nada de carrossel.

## O que muda

### 1. Variante compacta de copy (view model)
Hoje a Home usa o mesmo texto detalhado da tela do Nino (`decisionNarrative`), por isso headline de 3–4 linhas e body de 2 frases longas.

- Adicionar em `src/lib/copy/decisionNarrative.ts` uma variante `home_compact` por estágio: headline curta e body de uma frase com números compactos.
  - Antes: "A meta “Meta Financeira” pede um ritmo maior do que cabe hoje" + "Para chegar no prazo atual seriam necessários R$ 1.942,68 por mês. Pelo seu histórico, o ritmo que cabe hoje é menor — e é dele que eu parto."
  - Depois: "Sua meta precisa de um ritmo mais realista" + "O prazo atual pediria R$ 1.943/mês."
  - Conclusão não repete o valor destacado (R$ 290/mês aparece uma vez, no main value).
- CTA principal encurta para "Seguir esse plano" (mesma ação de aceite → revalidação → compromisso, sem mudança funcional). Secundário segue "Ajustar meta" como text action.
- `homeEditorial.ts` passa a consumir a variante compacta com orçamentos de conteúdo: eyebrow ≤ 22, headline ≤ 65, body ≤ 140, CTA ≤ 24, supporting title ≤ 48, subtitle ≤ 60. Resumo por sentença (já existente), sem corte no meio de palavra; `line-clamp` só como rede de segurança.

### 2. Supporting: significado, não metadata
O texto "O comportamento apareceu em 19 amostras, com confiança de 62,00%" vem do banco (`cause_summary` do detector comportamental).

- Sanitizador de Home no view model: subtítulo que contém amostras/confiança/percentual técnico é substituído por linguagem de significado ("Padrão recorrente no seu histórico"). O texto técnico continua íntegro na tela detalhada, evidence e Admin.
- Dívida: título passa a ser prazo + fato curto — "Parcela em 9 dias" / "Banco Pan · R$ 74,54" (sem recalcular nada: os fatos vêm da própria situação).

### 3. Dedup semântico real
- Comparar assunto canônico (goal_id, entidade, domínio, ação recomendada, tipo de situação), não só ID/texto. Se o Spotlight é sobre a meta X, supporting sobre a mesma meta X só entra se a decisão for materialmente diferente.
- Caso atual: "Sua meta pede um próximo aporte" sai da Home.

### 4. Limite de supporting
- Padrão: 2 no mobile. O terceiro só entra quando é materialmente distinto dos dois primeiros. Sobrando 1, mostra 1. Zero supporting → sem heading "Também vale saber".

### 5. Densidade visual
- `NinoSpotlightCard`: padding 20px/18–20px, eyebrow 11–12px/600, headline 19px/700 leading 1.25 (máx 2–3 linhas), body 14–15px leading 1.4, main value 28–30px, gaps 12–14px acima e 14–16px abaixo, radius 20–24px, borda + sombra mínima, `flex-col` sem `flex-1`/`mt-auto`/`h-full`/`min-h`. CTA 44–48px, padding 16–20px, 15px/600, não full-width. Alvo 190–230px, teto 260px.
- `NinoInsightRow`: vira row de 64–76px (máx 80px) em grid `auto 1fr auto`, ícone 20–22px sem quadrado grande, título 15–16px/600 em 1 linha, subtítulo 13–14px muted em 1 linha, chevron 16–18px centralizado, sem sombra e sem radius individual.
- Novo container agrupado: uma única superfície com borda e divisores finos entre rows (sem gap de 16px, sem 3 cards).
- Heading "Também vale saber": 12–13px/600 muted, margin-bottom 8–10px. Link final: "Ver todas no Nino →", 14–15px/500–600, margin-top 12–16px, sem área de botão.
- Espaçamentos: ações rápidas → Spotlight 24–28px; Spotlight → stack 20–24px; stack → link 12–16px; link → próxima seção 24–32px. Skeleton: Spotlight ~190px, rows ~68px.
- Safe area: padding inferior conferido para o CTA não colar na bottom nav no Safari iOS.

### 6. Testes e validação
- Suíte `nino-home-editorial`: casos A–L do pedido (1+2 no cenário real, dedup por meta, ausência de confiança/amostras, teto de altura do Spotlight e das rows, budget do bloco, heading oculto, sem primary, sem feedback, sem carrossel/dots).
- Teste de density budget medindo altura real via Playwright em 390px (bloco ≤ ~430px com 2 supporting, ≤ ~500px com 3).
- Validação visual com sessão real em 375/390/430px, com screenshots antes/depois, e resposta final com alturas medidas do Spotlight, de cada row e do bloco, copy antes/depois, itens deduplicados, CSS/componentes alterados, testes, build e typecheck.

## Fora de escopo
Ranking financeiro, motores canônicos, backend, Change Agent e tela do Nino continuam intactos.
