# Nino na Home: conversacional + "Outra orientação" (`nino_home_editorial.v3`)

Arquitetura mantida: 1 Spotlight + até 2 leituras de apoio + "Ver todas no Nino". Sem carrossel, sem swipe, sem dots. Esta rodada devolve contexto e voz ao Spotlight e permite pedir outra leitura em cada elemento, no próprio lugar.

## 1. Spotlight volta a conversar

Nova variante de copy `home_compact_conversational` em `src/lib/copy/decisionNarrative.ts`, com quatro campos e orçamento próprio:

- `headline` (conclusão, até ~65 chars / 2–3 linhas)
- `context` (causa + significado numa frase, até ~150 chars)
- `recommendation` (1 linha, voz do Nino: "Meu conselho: comece por esse ritmo.")
- valor destacado + CTA

Regras: o valor em destaque aparece uma única vez; o contexto pode citar o valor exigido (R$ 1.943/mês) porque é outro número; nada de coach, culpa, motivação vazia ou jargão técnico. Nenhum cálculo novo — só escolha e escrita sobre fatos já vindos dos motores.

Exemplo alvo:

```text
PRÓXIMO PASSO
Sua meta está pedindo mais do que seu mês comporta hoje
Para cumprir o prazo atual, seriam R$ 1.943/mês. Seu histórico mostra que R$ 290 cabe melhor hoje.
Meu conselho: comece por esse ritmo.
R$ 290/mês
[Seguir esse plano]   Ajustar meta
↻ Outra orientação
```

`NinoSpotlightCard` renderiza contexto e recomendação como duas linhas distintas (recomendação com peso semibold e cor de texto principal), mantendo o card entre 220–260px (teto 280px). Se a copy estourar, ela é reduzida editorialmente — o card não cresce.

## 2. "Outra orientação" no Spotlight

Rodapé do card, peso terciário (texto muted + ícone `ArrowsClockwise` 18px, alvo de toque 44px), abaixo e separado do CTA principal.

- `homeEditorial.ts` passa a expor um pool ordenado de candidatos a Spotlight (o item oficial + as leituras elegíveis da fila canônica) e a função `getNextEligiblePrimary({ pool, currentId, seenIds, supportingIds })`.
- Seleção usa o ranking existente (prioridade/severidade/relevância/fila determinística) mais diversidade semântica — nunca aleatório, nunca item fraco.
- Dedup: o substituto não pode ser o atual, nem um apoio exibido, nem o mesmo assunto canônico (meta/dívida/categoria) sem decisão materialmente diferente.
- Sem candidato: mensagem discreta "Não encontrei outra orientação relevante agora." — nada é inventado.
- Empty state: sem Spotlight, o botão não aparece.
- A troca não altera o ranking oficial, não marca o anterior como dispensado/não útil e não dispara nada proativo (WhatsApp/dispatcher intocados). Só o Spotlight muda; os apoios ficam.

O substituto usa o mesmo template e a mesma variante compacta conversacional, com o CTA próprio do seu tipo (meta: "Seguir esse plano"; dívida: "Ver dívida"; caixa: "Resolver isso"; progresso: "Ver evolução") — sem inventar recomendação financeira para quem não tem.

## 3. "Mostrar outra" em cada leitura de apoio

Cada row de apoio ganha um menu "•••" (44x44, ícone 18px) com "Mostrar outra" e "Ver detalhes". O tap no corpo do row continua abrindo o detalhe — as duas ações ficam separadas por área e por `aria-label` ("Mostrar outra dica no lugar de Parcela em 9 dias").

A troca é individual: só aquele índice é substituído, pelo próximo candidato elegível que não colida com o Spotlight nem com o outro apoio. Sem candidato, o item "Mostrar outra" não é oferecido. Row segue 64–76px, copy curta ("Parcela em 9 dias" / "Banco Pan · R$ 74,54"), sem amostras nem confiança.

## 4. Memória de sessão e transição

Hook novo `useNinoEditorialRotation` (estado em memória, por sessão):

- guarda IDs já apresentados por slot para evitar ciclo A→B→A enquanto houver item não visto; esgotado o pool, o ciclo é liberado;
- guarda os overrides de Spotlight e de cada apoio, recalculados quando o diagnóstico muda.

Transição no lugar: fade out 120ms → replace → fade/slide in 160–200ms, altura estável (mesmo content budget). Sem swipe, sem dots.

## 5. Analytics e aprendizado

Novos eventos em `src/lib/analytics/ninoEditorial.ts`: `nino_primary_next_requested` e `nino_supporting_next_requested`, com `current_item_id`, `replacement_item_id`, `semantic_type`, `position`, `surface`. Payload segue sem valor financeiro, nome de meta ou texto de orientação.

Semântica: pedir outra é `view_next_requested` (substituição neutra), nunca dismissal/rejeição. "Não ajudou" continua sendo o único caminho de aprendizado negativo.

## 6. Testes e validação

Suíte `nino-home-editorial` ampliada com os casos A–K do pedido: troca de primary, primary anterior não vira dispensado, replacement não duplica apoio, apoio 1 troca e apoio 2 permanece, itens vistos não repetem até esgotar, ausência de replacement gera feedback neutro, CTA do substituto funciona, budget de altura respeitado, ausência de carrossel/dots, analytics registrado.

Validação visual via Playwright com sessão real em 375/390/430px, medindo altura do Spotlight, das rows e do bloco, sem overflow nem CTA cortado. Fecha com typecheck, build e suíte completa.

## Fora de escopo

Motores canônicos, backend, edge functions, dispatcher proativo, Change Agent e a tela do Nino continuam intactos — a mudança é de apresentação e seleção editorial no cliente.
