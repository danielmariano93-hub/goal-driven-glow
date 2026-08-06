# Bloco corretivo — Ação, feedback e rotação dos insights da Home + auditoria WhatsApp

Escopo: consertar o CTA "Recalibrar meta", devolver o ciclo completo de feedback com rotação de leituras na Home, garantir que nenhuma ação aponte para rota inexistente, e endurecer o disparo de insights por WhatsApp (catálogo, limites e significância do padrão de dia da semana).

## Diagnóstico confirmado

- `nino_diag_select_action` gera para `goal_feasibility` a rota `/app/metas/{goal_id}`; o roteador só tem `/app/metas` (sem rota dinâmica). Existe hoje **1 ação persistida** com rota `/app/metas/<uuid>` — nenhuma com `/app/cartoes/<uuid>` (a de cartão também pode gerar rota inválida em novos diagnósticos e será corrigida junto).
- `NinoGuidanceCard` só dispara feedback `acted` ao clicar na ação; não há botões Útil/Não ajudou nem rotação.
- `nino_assemble_diagnosis` escolhe o `primary` apenas por severidade e relevância — não consulta `financial_situation_feedback`, por isso a mesma leitura fica fixa.
- `Metas.tsx` já lê `?goal=`, mas apenas expande e rola até o card; não abre o formulário de edição nem entende `action=recalibrate`.
- O detector `weekday_spending_risk` já usa média diária por dia da semana com dias sem gasto no denominador e remoção de outliers por IQR; falta o teste de separação contra o **segundo maior dia** (segunda vs sexta muito próximas).

## Parte 1 — Rotas de ação válidas

- Migration idempotente: substituir em `nino_diag_select_action` as rotas por deep links suportados — `/app/metas?goal={goal_id}&action=recalibrate` e `/app/cartoes?card={card_id}`; e um `UPDATE` restrito em `financial_situation_actions` convertendo rotas `^/app/metas/<uuid>$` e `^/app/cartoes/<uuid>$` para o formato válido (sem tocar em outras linhas).
- `Metas.tsx`: ao receber `goal` + `action=recalibrate`, localizar a meta do usuário, abrir o modal canônico de edição já preenchido (reuso do formulário existente, sem página duplicada), e limpar os parâmetros ao fechar. Meta inexistente/excluída/de outro usuário → aviso curto e neutro, sem abrir nada (a leitura de metas já é limitada ao usuário por RLS).
- `src/lib/nino/actions.ts`: alinhar `diagnosisRouteForSituation` ao mesmo deep link e manter o allow-list de rotas.
- Novo teste de contrato que enumera todas as rotas produzidas por `nino_diag_select_action` (recalibrar meta, entender padrão, ver gastos do padrão, sem categoria, duplicidades, cartão, pressão do mês, planejar, ver melhoria, ver detalhes) e falha se alguma não casar com as rotas declaradas em `App.tsx`.

## Parte 2 — Feedback e rotação na Home

- Fila determinística de leituras no cliente, derivada do diagnóstico canônico já carregado: principal → apoio/contraponto → antecipações → padrões confirmados → leituras positivas. Deduplicação por `situation_key`/identidade canônica, sem mensagens semanticamente equivalentes em sequência, ignorando expiradas/resolvidas/suprimidas e respeitando severidade e confiança. Leitura crítica não é escondida por variedade.
- `NinoGuidanceCard`: ações discretas **Útil**, **Não ajudou** e **Ver outra leitura** (esta só quando houver próxima), com rótulos acessíveis além do ícone. O card nunca é desmontado durante a troca (sem salto visual) e trata: salvando, salvo, falha de rede com "tentar novamente", ausência de próxima leitura, ação sem rota válida e leitura expirada entre carregamento e clique.
- Fluxos: `useful` → confirmação curta e avanço imediato; `not_useful` → avanço imediato e cooldown; `acted` → registra, navega só para rota válida e marca a ação como aceita/em andamento; `dismiss` (quando houver) → oculta no cooldown preservando histórico. A troca é otimista no cliente e depois sincroniza invalidando a query canônica.
- Persistência continua exclusivamente via `my_nino_situation_feedback` (sem segundo motor, sem voltar ao legado `user_insights`).

## Parte 3 — Backend do feedback (migration)

- `my_nino_situation_feedback`: tornar idempotente por (situação, feedback, superfície, dia) para não criar eventos duplicados em cliques repetidos, mantendo o histórico auditável.
- `nino_assemble_diagnosis`: excluir da escolha do `primary` situações com `not_useful`/`dismiss` recentes (janela de cooldown configurável) e situações já marcadas como `useful` no mesmo dia; leituras `critical` permanecem elegíveis. Feedback positivo passa a somar na priorização de situações da mesma família.

## Parte 4 — WhatsApp: catálogo, limites e significância

- Travar o envio ao catálogo autorizado (os 12 tipos informados); qualquer tipo fora dele não é enfileirado.
- Antes de enfileirar, exigir em cadeia: tipo ativo, `whatsapp` em `allowed_channels`, `whatsapp_proactive`, `anticipation_enabled` + `anticipation_whatsapp` + `anticipation_kinds` para antecipações, tipos silenciados, consentimento, horário de silêncio (21h–8h), cooldown do tipo, máximo diário (1) e semanal (3), deduplicação, confiança e cobertura mínimas. Preferências atuais do usuário são preservadas.
- `weekday_spending_risk`: acrescentar teste de separação contra o segundo maior dia — quando a diferença entre o maior e o segundo não for material/significativa, o padrão fica como candidato e a afirmação é enfraquecida em vez de disparar alerta categórico. Nada de valores ou dias fixos no código.

## Testes

Novos testes cobrindo: rotas geradas sempre existentes; deep link abrindo exatamente a meta indicada; meta de outro usuário nunca aberta; meta inexistente com fallback seguro; `useful`/`not_useful`/`acted` registrados; avanço imediato de leitura; insight respondido não reaparece no dia; cooldown após `not_useful`/`dismiss`; ausência de eventos duplicados; prioridade de situação crítica preservada; rotação sem motor legado; WhatsApp respeitando catálogo, preferências, consentimento, silêncio e limites; weekday excluindo outliers, incluindo dias sem gasto no denominador e não afirmando padrão forte quando dois dias estão próximos.

## Entrega

Uma única entrega: migration corretiva idempotente aplicada, Edge Functions afetadas implantadas, testes e build verdes. Publicação apenas com autorização explícita.

## Detalhes técnicos

- Arquivos: `src/components/home/NinoGuidanceCard.tsx`, `src/lib/nino/diagnosis.ts` (fila/rotação e mutação de feedback), `src/lib/nino/homeGuidance.ts`, `src/lib/nino/actions.ts`, `src/pages/Metas.tsx`, testes em `src/test/`.
- Banco: `nino_diag_select_action`, `my_nino_situation_feedback`, `nino_assemble_diagnosis`, `UPDATE` restrito em `financial_situation_actions`.
- Edge: `supabase/functions/_shared/anticipation/patterns.ts` (separação do segundo maior dia), camada de decisão de comunicação e `anticipation-tick`/`agent-proactive-tick` para redeploy.
