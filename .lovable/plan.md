# Rodada única: Nino coerente (badge/Home/tela) + categorização do Lucas com evidência

## O que foi verificado agora (fatos, não suposições)

Nino (usuário 088920ce…, o caso do print):

- `financial_situations` tem 8 leituras materialmente ativas hoje: `goal_feasibility` (primary, atenção), `goal_feasibility` futura, `anticipation` de parcela de dívida, `debt_progress`, `spending_pace_change`, 2 `behavioral_pattern`, 1 `duplicate_review` operacional.
- `nino_situation_cooldown_ids()` devolve exatamente esses ids: houve feedback `useful` (01/09) em `spending_pace_change` e na antecipação, e `not_useful` (07/08 e 12/08 → 30 dias) na meta primária, na meta futura e nas duplicidades.
- `nino_home_context_for_user()` aplica `NOT (s.id = ANY(v_cool))` em primary, supporting, patterns, anticipations e operational_tasks. Resultado: com cooldown proativo ativo, Home e tela do Nino ficam literalmente vazias — é a causa raiz do "Nada urgente pede sua atenção neste momento".
- O badge da tela Mais vem de outra coleção: `my_more_menu_context()` conta `nino_intelligence_items` (8 ativos), sem nenhuma relação com o que a tela do Nino consegue renderizar. Daí "4 novidades" + tela vazia.
- `MaisMenu.tsx` chama `markNinoSeen("mais","all")`, mas `my_more_menu_context()` lê `nino_surface_state` com `surface='nino' AND section='all'` — a página do Nino não escreve esse estado.
- O detector de ritmo (`nino_evaluate_financial_situations`) publica `spending_pace_change` com `abs(delta)>=100 and (abs(pct)>=15 or previous=0)`. Não há piso de dias corridos nem de transações: no dia 1, com R$ 0 gasto, "seus gastos caíram R$ 334,46" é matematicamente certo e editorialmente errado.

Lucas (`ed265223-…`):

- 49 lançamentos confirmados sem categoria: 48 `movement_kind=transaction / type=expense` e 1 `refund/income` (fora do escopo de consumo).
- Histórico próprio: 124 despesas categorizadas. O casamento por merchant normalizado cobre poucos casos (ex.: `fakku bar` → Lazer; `logoali mercado` aparece com conflito Alimentação × Mercado → ambíguo).
- `merchant_global_knowledge` está vazia; `merchant_aliases` (24) e `user_merchant_preferences` (18) do Lucas são as únicas fontes secundárias reais. Portanto a expectativa correta é corrigir uma parte dos 48, não todos.

## Bloco A — Nino: uma só coleção editorial

1. **Separar visibilidade de tela de elegibilidade proativa (migration).**
   - `nino_situation_cooldown_ids()` continua existindo e continua sendo a regra proativa (dispatcher/WhatsApp): mantida sem alteração de intervalos.
   - Nova função `nino_situation_screen_hidden_ids(_user_id)`: esconde da tela **apenas** o que o usuário decidiu esconder — último feedback `dismiss` dentro da janela de dismiss. `useful`, `acted` e `not_useful` não escondem mais nada da interface (`not_useful` passa a apenas rebaixar prioridade no ranking).
   - `nino_home_context_for_user()` e `nino_diagnosis_context_for_user()` trocam `v_cool` por `screen_hidden` em primary/supporting/patterns/anticipations/operational_tasks, e passam a devolver os dois conjuntos: `suppressed_situation_ids` (tela) e `proactive_cooldown_ids` (informativo). Nada de cálculo financeiro é tocado.

2. **Badge verdadeiro.** `my_more_menu_context()` deixa de contar `nino_intelligence_items` cru e passa a contar sobre a mesma coleção que a tela renderiza: situações materialmente ativas, não escondidas por dismiss, não expiradas (`valid_until`), deduplicadas por `situation_key`. `new_since_last_visit` = itens dessa coleção com `first_seen`/criação após `nino_surface_state(surface='nino', section='all').last_seen_at`, e para `behavioral_pattern` só conta como novo quando houve criação ou mudança material de conclusão/confiança (não `updated_at` técnico).

3. **Seen-state correto.** A página `Nino.tsx` passa a chamar `markNinoSeen("nino","all")` **depois** de um carregamento bem-sucedido (nunca em erro/loading) e registra exposição real via `useNinoExposure` para cada item renderizado. `MaisMenu` continua marcando a própria superfície.

4. **NextBestAction na Home.** A Home ganha a NextBestAction do Change Agent como candidato editorial, competindo com o diagnóstico na hierarquia: risco crítico → próximo passo material → risco/atenção → oportunidade → mudança → estabilidade. Dedup por tópico lógico: se já existe situação equivalente (ex.: mesma meta), só uma aparece. Sem novo cérebro: a NextBestAction entra como candidato no seletor já existente da Home.

5. **Guardrail do dia 1.** No detector `spending_pace_change`: exigir amostra mínima do período corrente (mínimo de dias corridos e de transações confirmadas no período atual) além da materialidade já existente. Sem amostra, nenhuma situação de queda/aumento é publicada — a tela mostra estabilidade em vez de conclusão prematura.

6. **Prepare-se e Aprendizados** voltam a listar porque deixam de ser filtrados por cooldown proativo; validade (`valid_until`) continua respeitada.

7. **Testes** (`src/test/`, vitest): coleção canônica com 4 novos → Mais mostra 4 e Nino renderiza os 4; abrir Nino derruba o badge; `useful` mantém visível e bloqueia proativo; `dismiss` esconde; primary em cooldown proativo ainda aparece na Home; NextBestAction vence insight legado; sem item material → estabilidade; dia 1 sem gasto → nenhum `spending_pace_change`; dia 10 com amostra → pode aparecer.

8. **Deploy.** Mudança em `_shared` exige redeploy atômico das 9 funções de `DEPENDENTS.md` + bump de `AGENT_RUNTIME_VERSION`. Validação em produção: reconsultar as RPCs para o usuário do print e provar que Home/Nino/Mais concordam.

## Bloco B — Lucas: categorização só com evidência

1. **Dry run primeiro** (sem escrever): elegíveis = `user_id` do Lucas, `status='confirmed'`, `category_id IS NULL`, `movement_kind='transaction'`, `type='expense'` — exclui refund, transferência, pagamento de cartão/dívida, investimento, planejado/cancelado.
2. **Chave de merchant** determinística (prioridade `merchant_name` → `normalized_description` → `description`): lower, sem acento, sem pontuação, espaços colapsados, sem ruído bancário. Sem fuzzy.
3. **Fonte 1 — histórico do próprio Lucas:** merchant já categorizado por ele, com **unanimidade** de `category_id`; 1 ocorrência quando a chave é específica, 2 quando genérica. Qualquer conflito → não atualiza.
4. **Fonte 2 — regras determinísticas existentes:** `merchant_aliases` e `user_merchant_preferences` do próprio Lucas, e regras determinísticas já usadas na ingestão, só com confiança alta. Sem LLM. `merchant_global_knowledge` está vazia, então não entra.
5. **Relatório antes do UPDATE**, entregue no chat: total sem categoria, elegíveis por histórico inequívoco, elegíveis por regra forte, ambíguos e distribuição das categorias propostas. Concentração estranha ou "Outros" → paro e reviso com você.
6. **UPDATE idempotente em transação**, via fluxo normal (CTEs `uncategorized` / `historical_matches` / `unambiguous_matches` / `updates`), gravando procedência nos campos que existem no schema: `category_source='historical_merchant_match'`, `category_confidence`, `category_reason`, `category_classified_at`, `category_review_status`. Só linhas com `category_id IS NULL` e só do Lucas.
7. **Validação pós-update:** quantos atualizados, contagem por categoria, quantos seguem sem categoria, confirmação de que nenhum movimento não-consumo foi categorizado e de que nenhum outro `user_id` foi tocado.

## Resposta final

Entrego causa raiz, arquivos/RPCs alterados, regra antiga × nova de cooldown, como badge/Home/Nino passaram a concordar, prova com os dados reais do usuário do print, teste do dia 1, testes executados, build/typecheck — e, para o Lucas, antes/depois com contagens, regra usada e query de validação.
