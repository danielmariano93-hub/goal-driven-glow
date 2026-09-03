# Correção crítica: parcela paga não pode virar cobrança

Investiguei o banco e o código antes de escrever este plano. Abaixo o que está confirmado e o que será feito.

## O que eu confirmei no banco e no código

Dívida real "Banco Sim": `due_day = 4`, parcela `97,06`, `installments_total = 12`, `installments_paid = 1`, sem `first_due_date` e sem `start_date`, saldo `1.067,66`. Existe pagamento em `debt_payments` de `97,06` em `2026-09-02` com `installments_covered = 1`.

1. **Duas implementações da mesma regra, ambas erradas para pagamento antecipado.**
   - `public.nino_diag_detect_debt_alerts` (SQL, marcada como `debt_status.v2`) calcula pagas como `greatest(installments_paid, soma de installments_covered)` = 1, deriva a âncora como "ciclo atual menos pagas" = 04/08, e conclui próximo vencimento 04/09 → dispara `debt_due_soon`. Ela **não** verifica se existe pagamento dentro do ciclo corrente.
   - `src/lib/engine/debtStatus.ts` (`debt_status.v1`) tem `currentCycleCovered`, mas o incremento só é aplicado quando `expected > base` — ou seja, só quando já há atraso. Pagando **antes** do dia 4, `expected = 1` e `base = 1`, o bônus não entra e o TS também conclui "vence em breve em 04/09". O bug é o mesmo em duas linguagens.

2. **Timezone (data civil tratada como timestamp).** `commitmentAgenda.debtDueDate` monta `new Date(ano, mês, dia)` (meia-noite local do runtime = UTC em produção) e formata via `todayISO → todaySP`. Em runtime UTC, 04/09 vira **03/09**. Mesmo padrão em `dueDateForCompetence` e `addDaysISO`.

3. **Agenda não conhece pagamento.** `CommitmentAgendaInput` não recebe `debt_payments`; o item de dívida é projetado apenas por `status`/`due_day`/`installment_amount`, sem estado de pagamento.

4. **WhatsApp duplicando.** Em `CommunicationDispatcherV3.ts` o corpo enfileirado é `${rendered.title}\n\n${rendered.body}`, e o `frame_template`/`body` já contém o heading e a sentença do motor. Daí "São R$ 97,06 com vencimento em 04/09" duas vezes.

5. **Short link quebrado.** `public.create_short_link` roda com `search_path = public` e chama `gen_random_bytes(8)` sem qualificar; pgcrypto está no schema `extensions`. Toda criação de link curto falha (74 ocorrências no dia).

6. **`proactive_decisions` sem `timing_window`.** A tabela tem `timing_score`, `timing_trigger`, `defer_until`, mas **não** `timing_window`; `pipeline.ts` insere `timing_window` e não checa `.error` → o lote inteiro é rejeitado em silêncio.

7. **Relatório financeiro com schema drift.** `financial-reports-generate` seleciona `accounts.is_active` e `goals.due_date`; o banco tem `accounts.active` e `goals.target_date`. Erro não verificado → `data ?? []` → relatório afirma ausência de meta/conta.

8. **`outbound_insert_failed` (agent-run 500).** Verifiquei os 5 triggers de `outbound_messages` (`fill_outbound_surface_feature`, `set_updated_at`, `audit_outbound_status_change`, `sync_communication_delivery_from_outbound`, `sync_reminder_delivery_from_outbound`): **nenhum** referencia `created_at`. A hipótese do scanner não se sustenta, então a causa será investigada a partir dos dados reais (FK de `inbound_message_id`, `run_id`, `source`) antes de qualquer mudança — sem correção especulativa.

## Os 5 itens do monitoramento (status inicial)

| # | Item | Reproduzível | Escopo |
| --- | --- | --- | --- |
| 1 | agent-run falha ao salvar resposta (`outbound_insert_failed`) | a confirmar por log/dados | investigar e corrigir causa real |
| 2 | `create_short_link` / `gen_random_bytes` | sim | corrigir nesta rodada |
| 3 | Escopo herdado bloqueia pergunta global seguinte | sim (código atual) | corrigir nesta rodada |
| 4 | Relatório: `goals.due_date` / `accounts.is_active` | sim | corrigir nesta rodada |
| 5 | `proactive_decisions` não persiste (`timing_window`) | sim | corrigir nesta rodada |

## O que será construído

### A. Uma única verdade da obrigação (`debt_obligation.v1`)

Fonte canônica: **função SQL** `public.debt_obligation_state(_user_id, _as_of)`, que devolve por dívida: `schedule_anchor`, `installment_index`, `current_cycle_due_date`, `current_cycle_status` (`paid` | `partial` | `pending` | `overdue`), `current_cycle_paid_amount`, `paid_at`, `source_payment_id`, `next_due_date`, `installments_paid`, `outstanding`, `formula_version`.

Regra corrigida: um pagamento cujo `paid_at` cai na janela do ciclo corrente (após o vencimento anterior, até o próximo vencimento) **quita o ciclo corrente**, mesmo pago antes do `due_day`. Sem regra especial para nenhuma dívida.

- `nino_diag_detect_debt_alerts` deixa de calcular agenda: passa a **ler** essa função. `debt_due_soon` e `debt_overdue` só nascem de ciclo `pending`/`overdue`.
- `src/lib/engine/debtStatus.ts` sobe para `debt_status.v3` com a mesma regra e passa a ser o espelho documentado (usado em cálculo offline/simulação), com **suíte de paridade** comparando TS × SQL sobre os mesmos fixtures. Divergência quebra o build.
- Consumidores (Home, Compromissos, `financial_current_snapshot`, diagnóstico, ProactiveEngine, WhatsApp, relatórios) derivam desse estado. Novo pagamento invalida/recalcula o snapshot na hora.

### B. Data civil segura

Novo utilitário date-only (`YYYY-MM-DD` puro, sem `Date` local): `civilDueDate(ano, mês, dueDay)` com clamp de fim de mês. `commitmentAgenda` e helpers passam a usá-lo. Testes: `due_day 4` em setembro/2026 = `2026-09-04` em runtime UTC e em São Paulo; fevereiro; `due_day` 29/30/31; virada de mês e de ano.

### C. Compromissos com estado de pagamento

`CommitmentItem` ganha `payment_status`, `paid_at`, `source_payment_id`, `next_due_date`. Home mostra só pendentes (pago fora de "Saídas já conhecidas", fora da contagem e do total). Página de Compromissos mantém histórico com selo "Pago", data, visual atenuado e fora do total pendente.

### D. Late revalidation gate

Imediatamente antes de enfileirar/enviar, o dispatcher reconsulta o estado canônico. Se a condição original caiu, marca `suppressed` com motivo `already_paid` / `condition_no_longer_true` e registra na auditoria. Nunca mais "se já pagou, me avisa".

### E. Composição de mensagem por canal

Responsabilidade final da composição fica em um único compositor por canal. Para WhatsApp: nunca concatenar título quando o corpo/frame já traz heading, dedupe de sentença normalizada, destaque com `*asterisco*`, no máximo um CTA, remoção de filler. Auditoria dos outros templates proativos com o mesmo antipadrão. Testes de qualidade: sem heading duplicado, sem sentença repetida, campos-chave em markdown, tamanho conciso.

### F. Correções pontuais confirmadas

- Migration redefinindo `create_short_link` com `extensions.gen_random_bytes` (sem afrouxar `search_path`) + teste de integração criar/resolver.
- `proactive_decisions`: migration adicionando `timing_window text` (faz parte do modelo canônico, já existe em `proactive_situations`) e verificação de `.error` no insert.
- `financial-reports-generate`: `accounts.active`, `goals.target_date`, `.error` verificado em toda consulta, e distinção entre "zero registros" e `query_failed` (relatório marcado `partial`/`technical_failure`, nunca narrativa de ausência).
- Auditoria de schema drift nas demais funções financeiras principais, com contract tests contra o schema atual.
- Escopo herdado: só é aplicado quando o turno novo também é escopado; pergunta global volta a ser respondida.
- `outbound`: investigação do erro real (com `run_id`, operation, código sanitizado), tratamento de `.error` nos writes críticos e teste E2E de regressão.

### G. Observabilidade

Regra transversal: toda leitura/escrita crítica trata `.error` e registra `run_id`, componente, operação, código, versão de fórmula/runtime e desfecho. Proibido `erro → [] → "não existem dados"`.

## Testes e validação em produção

Testes novos: ciclo pago antecipadamente (zero `debt_due_soon`), candidate criado antes do pagamento → `suppressed`, Home sem o item pago, Compromissos com selo Pago, data civil em UTC e SP, WhatsApp sem duplicação, short link criar+resolver real, relatório carregando conta e meta reais, `proactive_decisions` persistida, outbound real persistido/enfileirado. Integração de contrato contra o banco onde o bug depende do schema.

Depois: migrations aplicadas, types regenerados, redeploy do lote atômico de `_shared/agent` (as 10 funções de `DEPENDENTS.md`) mais as funções afetadas, snapshots recalculados, build, typecheck, suíte completa e acceptance em produção — Banco Sim sem pendência e sem mensagem, vencimento 04/09 em todas as superfícies, token de short link criado, meta real no relatório, decisão proativa persistida, template sem duplicação. Cenário destrutivo só em fixture/usuário de teste, sem criar dado fictício na conta real.

## Relatório final

Encerro com tabela `PROBLEMA | CAUSA RAIZ | CORREÇÃO | TESTE | PRODUÇÃO | STATUS`, status individual dos 5 itens do monitoramento, arquivos, migrations, funções SQL, funções redeployadas, versões de runtime/fórmula, evidências e riscos residuais.

## Notas técnicas

- Decisão de arquitetura documentada: regra canônica em SQL (`debt_obligation.v1`) porque diagnóstico, snapshot e detectores rodam dentro do banco; TS é espelho com teste de paridade obrigatório.
- Sem regra local para "Banco Sim"; a correção vale para qualquer dívida parcelada.
- Semantic IR v3, AgentCore, gates de Truth/Grounding/Completeness, regras de WRITE, confirmações e dedupe não sofrem mudança destrutiva.
