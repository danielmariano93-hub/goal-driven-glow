# Correção definitiva da experiência Nino — tela vazia, botão Atualizar e qualidade das leituras

Nenhuma alteração foi feita nesta etapa: apenas leitura de código e consultas somente-leitura ao banco.

## 1. Resumo executivo

A aba Nino aparece vazia por um bug de JavaScript no cliente, não por falta de inteligência. Todas as chamadas de RPC da camada Nino falham antes de sair do navegador, o erro nunca é exibido, e a tela cai no texto de "nada urgente" — transformando uma falha técnica em uma conclusão financeira falsa. Junto disso, o conteúdo gerado tem problemas reais de formatação monetária (padrão americano), volume excessivo em "Agora", duplicidades e semântica financeira frágil.

## 2. Causa raiz confirmada da tela vazia

`src/lib/nino/intelligence.ts:8`

```ts
const rpc = supabase.rpc as unknown as Rpc;
```

O método `rpc` do cliente Supabase depende da instância:

`node_modules/@supabase/supabase-js/dist/index.mjs:769-774`

```js
rpc(fn, args = {}, options = {...}) {
  return this.rest.rpc(fn, args, options);
}
```

Ao guardar a referência solta, `this` fica `undefined` na chamada e a execução lança `TypeError: Cannot read properties of undefined (reading 'rpc')`. Isso afeta **todas** as funções do arquivo: `my_nino_intelligence_context`, `my_nino_home_item`, `my_more_menu_context`, `my_reports_current_context`, `my_nino_refresh`, `my_nino_item_feedback`, `my_nino_item_act`, `my_nino_mark_seen`, `my_nino_record_exposure`.

Consequências observadas e explicadas por essa única causa:
- Nino, Relatórios e aba Mais sem conteúdo.
- `nino_item_exposures` e `nino_surface_state` vazios (as chamadas de telemetria têm `catch` silencioso).
- Botão Atualizar sem efeito perceptível (a mutation falha; nada é comunicado).

Evidência de que o dado existe: executando `my_nino_intelligence_context()` com o usuário real retorna `now=21, changes=3, learnings=5, history=7, prepare=0, achievements=0`; `nino_intelligence_items` tem 62 itens ativos (26 recommendation, 15 risk, 8 closed_period_summary, 5 change, 5 pattern, 3 data_quality).

## 3. Causas secundárias confirmadas

1. **Erro mascarado como vazio** — `src/pages/Nino.tsx` usa apenas `data` e `isLoading`; ignora `isError`, `error` e `ok:false`.
2. **Mesmo bug em outro módulo** — `src/lib/db/sharedGoals.ts:63` repete o padrão de referência solta (`const rpc = supabase.rpc as unknown as ...`, usado em `:66`); precisa da mesma correção.
3. **Formatação monetária americana gerada no banco** — `nino_rebuild_items` usa `to_char(..., 'FM999G999G990D00')`, que depende de `lc_numeric` do servidor (C) e produz `1,170.54`. Item real existente: título "Seus gastos caíram 3,313.81" e texto "R$ 1,170.54 contra R$ 4,484.35". O título também omite o símbolo `R$`.
4. **Rotas de ação rejeitadas pelo validador** — `safeRoute` (`src/lib/nino/intelligence.ts:195`) não aceita `%`, e existem itens com `route: /app/alertas/grow%3Aoverall`; o CTA cai no fallback `/app/nino` (link circular).
5. **Assinatura de exposição divergente** — `my_nino_record_exposure` no banco tem 5 parâmetros (`_item_id, _surface, _rank, _selection_reason, _channel`) e o cliente envia 4; precisa confirmar default do 5º ou passar `_channel`.
6. **`primary_action` sem `label`** em parte dos itens (o item de risco inspecionado só tem `route`), caindo sempre em "Abrir".
7. **Grants amplos** — `my_nino_*` estão `SECURITY DEFINER` com EXECUTE para `PUBLIC` (inclui `anon`).
8. **Volume e duplicidade** — 21 itens em "Agora", 26 recommendations, mesma meta em revisão semanal e mensal, itens de junho/julho tratados como atuais.
9. **`prepare` e `achievements` vazios** — não há geração real de antecipações elegíveis; o texto atual não distingue "nada a preparar" de "sem confiança suficiente".

## 4. Inventário afetado

Frontend: `src/lib/nino/intelligence.ts`, `src/pages/Nino.tsx`, `src/components/nino/NinoItemCard.tsx`, `src/pages/RelatoriosHub.tsx`, `src/pages/MaisMenu.tsx`, `src/components/home/AssistantTipCard.tsx`, `src/lib/db/sharedGoals.ts`, novo `src/lib/nino/contracts.zod.ts`, novo `src/lib/nino/format.ts`, novo `src/components/nino/NinoRefreshButton.tsx`, novo `src/components/nino/NinoStateBlocks.tsx`, novo `src/hooks/useNinoExposure.ts`.

Banco (migration nova, sem destruir dados): `nino_rebuild_items`, `my_nino_refresh`, `my_nino_intelligence_context`, `my_nino_record_exposure`, `my_nino_mark_seen`, novo helper `nino_brl(numeric)`, novas funções de dedup/supersessão, revisão de grants.

Testes: `src/test/` (novos arquivos de contrato, formatação, priorização, estados de UI).

## 5. Severidades

**P0**
- Referência solta de `supabase.rpc` em `intelligence.ts` e `sharedGoals.ts`.
- Erro exibido como empty state em `Nino.tsx` (e nas demais superfícies).
- Botão Atualizar sem feedback, sucesso, erro ou horário.

**P1**
- Formatação BRL no gerador SQL (títulos e explicações).
- "Agora" com 21 itens sem priorização; duplicidade semanal/mensal.
- Itens antigos como novidade (regras temporais de `valid_until`/supersessão).
- Estornos/transferências/pagamento de fatura recebendo recomendação de corte.
- Padrões com título contrário ao sinal do efeito.
- Validação runtime do payload (hoje só `as T`).
- Telemetria de exposição e `last_seen_at` sem regra clara.

**P2**
- `safeRoute` recusando rotas legítimas com `%`; `primary_action.label` ausente.
- Hierarquia visual por tipo de item; "Como o Nino chegou aqui" com chaves técnicas.
- Diferenciar "Prepare-se" vazio por ausência de risco vs. falta de confiança.
- Comparações de início de mês sem aviso de cobertura/amostra.
- Grants `PUBLIC`/`anon` nas RPCs `my_nino_*`.

**P3**
- Destaque discreto de itens novos/alterados após refresh.
- Observabilidade estruturada e métricas de refresh.

## 6. Plano único de implementação (ordem segura)

**Etapa 1 — Restaurar o consumo (P0, sem migration)**
1. Em `intelligence.ts`, substituir a referência solta por chamada direta (`supabase.rpc(name, args)`) dentro de `callRpc`, mantendo a tipagem via cast local do método, não da referência. Mesma correção em `sharedGoals.ts`.
2. `callRpc` passa a: (a) propagar `error.message`, `error.code`, `details` em um `NinoRpcError` com `kind: "network" | "auth" | "rpc" | "contract"`; (b) validar o payload; (c) logar de forma estruturada sem valores financeiros.
3. Adicionar teste unitário que garante que o wrapper chama o método com `this` correto (spy em `supabase.rpc`) e um teste de regressão de código que proíbe o padrão `supabase.rpc as unknown as`.

**Etapa 2 — Estados explícitos na UI (P0)**
4. `Nino.tsx` passa a consumir `isLoading | isError | error | isFetching | data.ok` e renderizar blocos distintos (ver seção 11). Nunca exibir texto de conclusão financeira quando houver erro.
5. Novo `NinoRefreshButton` com a especificação da seção 10.
6. Aplicar os mesmos estados em `RelatoriosHub.tsx`, `MaisMenu.tsx` e `AssistantTipCard.tsx` (um bloco compartilhado em `NinoStateBlocks.tsx`).

**Etapa 3 — Contratos e validação (P1)**
7. `src/lib/nino/contracts.zod.ts` com schemas Zod para `NinoItem`, `NinoContext`, `MoreMenuContext`, `ReportsContext` e envelope `{ ok:false, error }`. Campos desconhecidos tolerados; enums com fallback seguro; item inválido é descartado individualmente e logado, sem derrubar a seção.
8. Ajustar `safeRoute` para aceitar rotas percent-encoded válidas (whitelist de prefixos `/app/...`, decode + validação), mantendo bloqueio de esquemas externos.

**Etapa 4 — Migration de qualidade de conteúdo (P1)**
9. `nino_brl(numeric)`: formatação `pt-BR` determinística (milhar `.`, decimal `,`, prefixo `R$`, sinal explícito quando relevante), independente de locale do servidor. Substituir todos os `to_char` monetários em `nino_rebuild_items`.
10. Regras de elegibilidade: excluir de recomendações de corte as categorias/tipos não comparáveis (estornos, reembolsos, transferências, pagamento de fatura, pagamento de dívida, aportes, movimentos internos). Lista canônica derivada do ledger canônico já existente, não uma nova fonte de verdade.
11. Direção do efeito: detectores de padrão só emitem item quando o sinal do delta corresponde à narrativa; títulos passam a ser derivados do sinal ("menor", "maior") com o valor formatado.
12. Cobertura/maturidade: itens de comparação de período curto recebem `data_quality` e uma frase de cobertura ("com base em N dias"), e perdem prioridade quando a amostra é curta.
13. Dedup/supersessão (seção 9).
14. Limites por seção e ordenação (seção F do pedido) aplicados no `my_nino_intelligence_context`: "Agora" retorna conclusão principal + até 3 itens, com `overflow_count` e lista expandida sob demanda.
15. `my_nino_refresh` passa a retornar contrato rico: `{ ok, at, counts: { created, updated, superseded, expired, unchanged, active_total }, by_section }`.
16. `my_nino_mark_seen` só atualiza `last_seen_at` após a renderização confirmada da seção; `my_nino_record_exposure` com `_channel` default e idempotência por (item, superfície, dia).

**Etapa 5 — Hierarquia visual e explicação humana (P2)**
17. `NinoItemCard` com variantes por `kind`/`severity` usando os tokens do design system Meu Nino (Deep Ink, Violet/Indigo, Coral para risco, Mint para conquista), acento lateral/ícone por tipo, densidade mobile-first.
18. "Como o Nino chegou aqui" reescrito: frase em linguagem natural + linhas rotuladas em português (amostra, período, confiança). Chaves técnicas (`detector`, `formula_version`) apenas em um nível secundário e sem JSON bruto.
19. Empty states diferenciados por motivo (`insufficient_confidence`, `no_risk_detected`, `no_data`).

**Etapa 6 — Telemetria, segurança e observabilidade (P2/P3)**
20. `useNinoExposure`: registra exposição via IntersectionObserver quando o card fica realmente visível, com dedup em memória por sessão.
21. Revisão de grants: `REVOKE EXECUTE ... FROM PUBLIC, anon` nas `my_nino_*`, `GRANT EXECUTE ... TO authenticated`; confirmar `SECURITY DEFINER` com `SET search_path = public`.
22. Logs estruturados e métricas de refresh (latência, contagens, falhas por tipo), sem valores financeiros.

## 7. Mudanças exatas por arquivo

| Arquivo | Mudança |
|---|---|
| `src/lib/nino/intelligence.ts` | remover `const rpc = supabase.rpc as unknown as Rpc`; chamada direta; `NinoRpcError`; validação Zod; `safeRoute` tolerante a percent-encoding; label default por `kind` |
| `src/lib/db/sharedGoals.ts` | mesma correção de contexto |
| `src/pages/Nino.tsx` | estados 1–10; botão de refresh extraído; limites por seção + "ver mais"; empty states por motivo |
| `src/components/nino/NinoItemCard.tsx` | variantes visuais por tipo; explicação humanizada; exposição por visibilidade |
| `src/components/nino/NinoRefreshButton.tsx` (novo) | estados de pressão, processando, sucesso, erro, último horário |
| `src/components/nino/NinoStateBlocks.tsx` (novo) | loading, erro de rede/auth/contrato, vazio verdadeiro, dados desatualizados |
| `src/lib/nino/contracts.zod.ts` (novo) | schemas + parse seguro |
| `src/lib/nino/format.ts` (novo) | BRL/pt-BR, datas, deltas com sinal |
| `src/hooks/useNinoExposure.ts` (novo) | exposição idempotente por visibilidade |
| `src/pages/RelatoriosHub.tsx`, `src/pages/MaisMenu.tsx`, `src/components/home/AssistantTipCard.tsx` | estados compartilhados |
| migration `nino_quality_and_contract` | `nino_brl`, `nino_rebuild_items`, `my_nino_refresh`, `my_nino_intelligence_context`, `my_nino_record_exposure`, `my_nino_mark_seen`, dedup/supersessão, grants |

## 8. Migração e limpeza dos itens existentes

Sem `DELETE`. A migration:
1. Recalcula texto/título dos itens ativos via `nino_rebuild_items` idempotente (mesmo `dedup_key` → `UPDATE`), corrigindo formatação sem perder histórico de exposição/feedback.
2. Marca como `superseded` (não apagados) os itens duplicados e os fora de janela, preenchendo `superseded_by` e mantendo-os visíveis em "Histórico".
3. Marca como `expired` itens com `valid_until` passado que ainda estejam `active`.
4. Itens gerados por detectores agora inelegíveis (estorno, transferência) vão para `archived` com motivo registrado.
5. Snapshot de auditoria antes/depois (contagens por `kind`/`status`) registrado em tabela de auditoria já existente do admin.

## 9. Deduplicação e supersessão

- Chave lógica canônica por família: `família:assunto:janela` (ex.: `recommendation:goal:<goal_id>`), independente de semanal/mensal.
- Dentro da família, apenas o item de maior (confiança, prioridade, recência) fica `active`; os demais recebem `superseded`.
- Deduplicação semântica adicional para recomendações de categorização (mesma categoria/merchant) e para padrões (mesmo detector + mesma direção em janelas sobrepostas).
- Teto por seção após dedup; overflow contado, não descartado silenciosamente.

## 10. Especificação do botão Atualizar

Ao acionar:
- `active:` com escala/opacidade e área de toque mínima 44×44 no mobile;
- `disabled` + `aria-busy="true"` enquanto processa; cliques extras ignorados (guarda de mutation pendente);
- rótulo muda para "Atualizando…" com spinner visível;
- conteúdo atual permanece na tela (sem tela branca); cards recebem indicação suave de atualização.

Sucesso (somente após mutation **e** refetch concluídos):
- toast "Leituras atualizadas agora";
- linha fixa "Atualizado às HH:mm de dd/MM" (`pt-BR`);
- resumo das contagens quando o RPC retornar (`X novas · Y atualizadas · Z encerradas`);
- itens novos/alterados com marcador discreto "novo".

Erro (mutation ou refetch):
- bloco de erro com mensagem compreensível + "Tentar novamente";
- dados anteriores preservados;
- detalhe técnico só no log estruturado;
- `aria-live="polite"` anuncia o resultado.

## 11. Estados de loading, erro, vazio e desatualizado

1. Carregamento inicial: skeletons dos cards.
2. Sucesso com dados: seções normais.
3. Vazio verdadeiro (`ok:true`, sem itens): texto específico por seção e por motivo.
4. Erro de consulta: bloco de erro + retry; jamais texto financeiro.
5. Erro de autenticação: convite a entrar novamente.
6. Erro de contrato: "Não conseguimos ler as leituras agora" + log; itens válidos remanescentes ainda são exibidos.
7. Refresh em andamento: conteúdo mantido + indicação.
8. Refresh concluído: sucesso + horário + contagens.
9. Refresh com erro: mensagem + retry, dados preservados.
10. Desatualizado: badge "dados de HH:mm" quando `as_of` é antigo ou o refetch falhou.

## 12. Critérios de aceite

- Nenhuma ocorrência de `supabase.rpc as unknown as` no repositório (teste automatizado).
- Com o usuário real (62 itens ativos), Nino exibe conclusão principal + até 3 em "Agora", com 3 mudanças, 5 aprendizados e 7 no histórico acessíveis.
- Forçando falha de RPC, a tela mostra erro e retry — nunca "Nada urgente pede sua atenção".
- Zero strings monetárias com padrão americano nos itens (query de verificação por regex `\d,\d{3}\.`).
- Nenhuma recomendação de corte em estorno/reembolso/transferência/pagamento de fatura ou dívida.
- Nenhum padrão com título de aumento e delta negativo.
- Nenhuma família de recomendação com mais de um item `active`.
- Após uma visita, `nino_item_exposures` tem registro para cada card visível, sem duplicatas no mesmo dia/superfície, e `nino_surface_state.last_seen_at` atualizado apenas depois da renderização.
- Refresh: sucesso apenas com refetch concluído; horário e contagens visíveis.
- `my_nino_*` sem EXECUTE para `anon`/`PUBLIC`.

## 13. Matriz de testes

Unitários: contexto do wrapper de RPC; classificação de erro; parsers Zod (payload válido, campo faltando, enum desconhecido, `ok:false`); formatação BRL e deltas; `safeRoute` (rota simples, percent-encoded, externa, vazia); priorização e tetos; dedup/supersessão; regras temporais; direção de padrão; exclusão de movimentos não elegíveis.

Integração (Vitest + mock de cliente e RPC real em staging): usuário com itens; usuário sem itens; RPC com erro; sessão expirada; refresh ok; refresh com erro; refresh ok com refetch falhando; exposição e `last_seen`; feedback e ação (útil, não ajudou, dismiss, act).

Interface (Playwright, sessão autenticada): iPhone e desktop; loading; erro; vazio verdadeiro; todos os estados do botão; navegação entre seções; feedback ao toque; teclado e leitor de tela (`aria-busy`, `aria-live`, foco).

Dados reais: os 62 itens ativos não produzem tela vazia; classificação correta entre ativo/histórico/superseded; BRL e português; estornos sem recomendação de corte; padrões negativos descritos corretamente.

## 14. Riscos e rollback

- **Risco**: a migration de conteúdo altera títulos de itens já expostos. *Mitigação*: idempotência por `dedup_key`, snapshot de auditoria, nenhum `DELETE`.
- **Risco**: tetos por seção esconderem item relevante. *Mitigação*: overflow explícito com "ver mais" e contagem.
- **Risco**: revogar grants quebrar alguma superfície. *Mitigação*: verificar chamadores antes; `authenticated` mantém acesso.
- **Rollback**: frontend por revert de commit; SQL por migration reversa que restaura as definições anteriores das funções (guardadas no arquivo da migration); dados preservados porque nada é apagado.

## 15. Confirmação

Nenhum arquivo de código foi alterado, nenhuma migration aplicada, nenhum deploy ou publicação realizada nesta etapa. Aguardando aprovação para executar.
