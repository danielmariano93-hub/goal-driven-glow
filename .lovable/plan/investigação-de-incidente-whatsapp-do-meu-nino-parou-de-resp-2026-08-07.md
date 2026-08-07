# Investigação de incidente — WhatsApp do Meu Nino parou de responder

## 1. Executive summary

A falha **não** está no AgentCore, LLM, prompts, IA, secrets, JWT ou vínculo de telefone. Está **antes de tudo**: a Edge Function `whatsapp-webhook` **não consegue nem inicializar (BootFailure)**. O commit V8 (`7ec727c`) removeu 68 linhas de `_shared/agent/core/ActionPlanner.ts` — inclusive `buildDeterministicPlan` e `dedupePlan` — mas o barril `_shared/agent/core/index.ts` **continua re-exportando esses nomes**. Em Deno isso é erro de carregamento de módulo, não erro de runtime: o worker morre no boot. Logs de produção mostram exatamente: `worker boot error: Uncaught SyntaxError: The requested module './ActionPlanner.ts' does not provide an export named 'buildDeterministicPlan' at _shared/agent/core/index.ts:13`. Portanto todo POST da WAHA recebe erro do runtime: nada é persistido em `inbound_messages`, e **nem mesmo** em `provider_inbound_drops` (último registro de ambos: 07/08 02:36 UTC).

O agravante V9/V9.1 é independente e real: o watchdog compara a URL do webhook por igualdade literal contra a base **sem** `?t=<secret>`, enquanto `buildSessionConfig()` grava **com** `?t=`. Isso gera `webhook_mismatch` falso, dispara `syncWebhook()` → PUT na sessão a cada tick → sessão presa em `STARTING`.

Confiança: causa raiz original **comprovada**; agravante V9.1 **alta confiança**.

## 2. Timeline

| Hora/data (UTC) | Evento | Evidência | Conclusão |
|---|---|---|---|
| 06/08 17:42 → 23:20 | Sessão WAHA saudável, alternando `STARTING`→`WORKING` | `provider_health_events` (`ok=true`, `WORKING`) | Canal funcional |
| 06/08 23:20 | Eventos `session.status` chegando ao webhook | `provider_inbound_drops` reason=`event_ignored/session.status/default` | Runtime do webhook **vivo** |
| 07/08 00:49 → 02:36 | Inbounds reais persistidos; drops `from_me` registrados | `inbound_messages` (últimos 5) + `provider_inbound_drops` | Data plane completo funcionando |
| 07/08 02:36:36 | **Último inbound persistido** | `inbound_messages.received_at` máx. | Fim do funcionamento comprovado |
| 07/08 02:36:44 | **Último evento de qualquer natureza recebido** | `provider_inbound_drops.occurred_at` máx. | Depois disso o runtime deixa de registrar até drops |
| 07/08 09:41 | Commit V8 `7ec727c` — remove 68 linhas de `ActionPlanner.ts` | `git show --stat 7ec727c -- _shared/agent/core/` | Introdução do defeito |
| 07/08 (deploy V8) | `whatsapp-webhook` passa a falhar no boot | Logs: `BootFailure ... buildDeterministicPlan` | Transporte morto |
| 07/08 11:44 | Commit V9.1 `d90d42f` | git log | Não corrige o barril |
| 07/08 11:50 → 12:20 | `STARTING:webhook_mismatch` a cada ~10 min, `ok=false` | `provider_health_events` (5 eventos consecutivos) | Loop de autorreparo do watchdog |
| 07/08 12:10–12:19 | Boot failures repetidos do `whatsapp-webhook` | logs de Edge Function (12 ocorrências) | Falha persiste no código atual |

## 3. Último estado conhecido como funcional

07/08 02:36:36 UTC — inbound persistido em `inbound_messages`, drop correlato de `from_me` às 02:36:44, sessão WAHA `WORKING` (último `ok=true` em 06/08 23:20), outbound/ACK do ciclo anterior marcados `delivered`.

## 4. Primeiro ponto de falha

**WAHA → whatsapp-webhook (boot do isolate)**. Não é `webhook → inbound`, nem rede, nem secret: o módulo não carrega, então nenhum handler roda. Prova negativa decisiva: `provider_inbound_drops` — que registra até eventos descartados — **para no mesmo instante**. Se o request chegasse ao handler, haveria drop.

## 5. Diff de deployment vs Git diff

- **Git diff `c684373` → `7ec727c`** em `whatsapp-webhook/`, `_shared/messaging/`, `whatsapp-session/` e `supabase/config.toml`: **vazio** (confirmado por `git diff --stat`). `config.toml` manteve `[functions.whatsapp-webhook] verify_jwt = false`. Secrets WAHA não foram tocados pelo V8.
- **Runtime/deployment diff**: o V8 alterou `_shared/agent/core/*`, que é **dependência transitiva** de `whatsapp-webhook` (`index.ts` → `_shared/agent/orchestrator.ts` → `./core/index.ts`). O rebundle do `_shared` no deploy do V8 é o que quebrou o transporte **sem nenhuma alteração nos arquivos de transporte**. Isso responde exatamente à hipótese “git diff ≠ deployment diff”.
- `webhookUrlWithToken` existe desde 16/07 (`42b3893`), muito antes do V8 — logo **não** é a causa da parada original.

## 6. Causa raiz original — COMPROVADA

Evento A: V8 remove `buildDeterministicPlan`/`dedupePlan` de `ActionPlanner.ts` (hoje o arquivo só exporta `plan` e o tipo `PlannerResult`).
→ B: `_shared/agent/core/index.ts` (linhas 17-20) continua re-exportando os nomes removidos.
→ C: qualquer função que importe o barril falha no *module linking* — erro de carregamento, não capturável por try/catch.
→ D: `whatsapp-webhook` retorna erro de runtime para todo POST da WAHA; nenhum inbound e nenhum drop é gravado.
→ E: o usuário manda mensagem e **nunca** recebe resposta.

Escopo do dano (mesmo barril): `whatsapp-webhook`, `agent-chat`, `agent-run`, `agent-proactive-tick`, `insights-generate`, `pulse-compute`, `finance-bridges-backfill`, `anticipation-tick` (via `anticipation/runner.ts`), `_shared/engine/metrics.ts`.

## 7. Agravantes V9/V9.1 — ALTA CONFIANÇA (independentes)

1. **Falso `webhook_mismatch`**: `validateWahaCredentials` compara `h.url === expectedWebhookUrl` (waha.ts:181) com a base sem token, mas `buildSessionConfig` grava `url: webhookUrlWithToken(...)` = `.../whatsapp-webhook?t=<secret>`. Comparação literal → `matches_url=false` → código `webhook_mismatch` mesmo com webhook correto.
2. **Loop de autorreparo**: watchdog (index.ts:119-132) chama `syncWebhook()` → `createOrUpdateSession()` → PUT na sessão sempre que `webhook.code !== "ok"`, **sem checar estado transitório, sem cooldown e sem máximo de tentativas**. Cada PUT recoloca a sessão em `STARTING`, o que garante `webhookHealthy=false` na revalidação → repete a cada tick. Assinatura em `provider_health_events`: 5× `STARTING:webhook_mismatch`.
3. **`webhook_repaired` enganoso**: `webhookRepair` é marcado `webhook_repaired` só porque o PUT retornou ok, mesmo quando a revalidação seguinte continua unhealthy — mascarando o incidente no relatório.
4. **Heartbeat**: o resultado do tick não é reprovado por provider unhealthy, então `job_heartbeats.last_ok` pode ficar verdadeiro com canal morto.

## 8. Hipóteses descartadas

| Hipótese | Veredito | Evidência |
|---|---|---|
| AgentCore/LLM/capability router | Descartada como causa primária | Sem `inbound_messages`, o AgentCore nunca é alcançado |
| Migration financeira V8 | Descartada | Não toca objetos de mensageria nem config WAHA |
| `verify_jwt` / JWT | Descartada | `config.toml` inalterado, `verify_jwt=false` antes e depois |
| Vault/secrets WAHA | Descartada | Não alterados no V8; validação atual reporta `auth.ok` e sessão existente |
| Vínculo do telefone (`whatsapp_links`) | Descartada | Falha ocorre antes de qualquer lookup |
| Outbound/`whatsapp-send` | Descartada como causa | Nenhum outbound é criado porque nada entra |
| Host WAHA inacessível | Descartada | Watchdog obtém status da sessão e config de webhook |
| Session state (`STARTING`) | **Consequência**, não causa | Efeito do PUT repetido do watchdog |

## 9. Arquivos responsáveis

| Arquivo | Função | Problema | Impacto | Correção proposta |
|---|---|---|---|---|
| `_shared/agent/core/index.ts` | Barril do Agent Core | Re-exporta `buildDeterministicPlan`/`dedupePlan` inexistentes | **Boot failure** de 8+ funções, WhatsApp morto | Remover os dois nomes do re-export (ou reintroduzir os símbolos, se algum consumidor precisar) |
| `_shared/messaging/waha.ts` | `validateWahaCredentials` (l.181) | Igualdade literal de URL ignora `?t=` | Falso `webhook_mismatch` | Comparação canônica: origin + pathname + token válido, separando rota/auth/eventos |
| `whatsapp-ack-watchdog/index.ts` | Autorreparo (l.119-132) | Repara em estado transitório, sem cooldown/max attempts; `webhook_repaired` sem revalidação bem-sucedida | Sessão presa em `STARTING`, telemetria enganosa | Bloquear em `STARTING`/`SCAN_QR_CODE`; cooldown; 1 mutação por janela; `webhook_repair_failed` quando pós-validação falha; heartbeat fecha em falha |

## 10. Correção proposta (mínima e cirúrgica)

1. **Corrigir o barril** `_shared/agent/core/index.ts`: alinhar os re-exports ao que `ActionPlanner.ts` realmente exporta. Uma linha. Restaura o transporte inteiro.
2. **Identidade canônica de webhook** em `waha.ts`: função `compareWebhookIdentity(actualUrl, expectedBaseUrl, secret)` retornando `{ routeValid, authValid, eventsValid }` — compara `origin` + `pathname` normalizado (trailing slash), aceita token em `?t=` **ou** header `X-Webhook-Secret`, e valida os 4 eventos obrigatórios. `code: "ok"` quando rota + auth + eventos ok.
3. **Self-heal seguro** no watchdog: não agir se `session.status` ∈ {`STARTING`,`SCAN_QR_CODE`}; cooldown (ex. 15 min) e no máximo 1 PUT por janela, registrado em telemetria; após o PUT, revalidar e só então `webhook_repaired`, senão `webhook_repair_failed`; heartbeat reflete provider unhealthy.
4. **Guarda anti-regressão**: teste que carrega `_shared/agent/core/index.ts` e valida que todo nome re-exportado existe no módulo de origem (varredura estática do barril) — impede que essa classe de erro volte.

Sem tocar em AgentCore, finanças, migrations, dados ou UI.

## 11. Testes necessários

Unitários/contrato (vitest, sem rede):
1. **Barrel integrity** — todo símbolo re-exportado por `core/index.ts` existe no arquivo de origem; falha hoje.
2. **Canonical webhook URL** — `.../whatsapp-webhook?t=SECRET` vs base sem token ⇒ `routeValid=true`, `authValid=true`, sem `webhook_mismatch`.
3. **Secret errado** — mesma rota, token/header inválido ⇒ `authValid=false`, unhealthy.
4. **Pathname errado** — mesmo host, outra função ⇒ `webhook_mismatch`.
5. **Eventos incompletos** — falta `message`/`message.any`/`message.ack`/`session.status` ⇒ unhealthy.
6. **STARTING** — provider `STARTING` ⇒ `syncWebhook` **não** é chamado.
7. **Cooldown** — dois ticks consecutivos ⇒ no máximo 1 PUT.
8. **Self-heal verdadeiro** — divergência real; após 1 reparo e revalidação saudável ⇒ `webhook_repaired`.
9. **Falso repair** — PUT 2xx mas pós-validação falha ⇒ `webhook_repair_failed` + heartbeat unhealthy.

Integração/produção (após deploy): cadeia observável em `whatsapp_pipeline_events`: `webhook_received` → `inbound_persisted` → `agent_started` → `agent_completed` → `outbound_queued` → `provider_sent` → `ack_received`.

## 12. Deploy order

1. Aplicar a correção do barril e rodar a suíte local (typecheck + vitest).
2. Deploy **primeiro** de `whatsapp-webhook` isoladamente; confirmar ausência de `BootFailure` nos logs.
3. Deploy de `agent-chat`, `agent-run`, `agent-proactive-tick`, `anticipation-tick`, `insights-generate`, `pulse-compute` (mesmo barril).
4. Só então deploy de `whatsapp-ack-watchdog` + `whatsapp-session` com a validação canônica e o self-heal seguro.
5. Inspecionar estado da sessão **sem mutar**. Se ainda divergente após a validação canônica, **um único** `sync_webhook` manual; aguardar `WORKING`; revalidar.
6. Mensagem real do usuário; observar os 7 estágios da telemetria.

Nenhuma migration é necessária. Nenhum QR/logout/relink — não há evidência de sessão sem autenticação válida.

## 13. Acceptance criteria

Resolvido somente quando **uma mensagem real** produzir: WAHA → `webhook_received` → `inbound_messages` → `agent_started/completed` → `outbound_messages` → `provider_sent` → ACK `delivered`; e `provider_health_events` registrar `WORKING:webhook_ok` sem novos `webhook_mismatch` em pelo menos 3 ticks consecutivos.

## 14. Rollback

- Reverter apenas o(s) commit(s) do patch (mudanças são localizadas em 3 arquivos) e redeployar `whatsapp-webhook`, `whatsapp-ack-watchdog`, `whatsapp-session`.
- **Não** reverter V8/V9.1 (perderia as correções financeiras) e **não** apagar `whatsapp_pipeline_events`, `provider_inbound_drops`, `provider_health_events` — são a evidência.
- Configuração WAHA conhecida: sessão `default`, engine NOWEB, 1 webhook para `/functions/v1/whatsapp-webhook` com `?t=<secret>`, header `X-Webhook-Secret` e os 4 eventos. Restaurável com um único `sync_webhook`.

## 15. Riscos

- Se algum consumidor futuro esperar `buildDeterministicPlan`, remover o re-export exigirá reintroduzir o símbolo — mitigado pelo teste de integridade do barril.
- Sessão pode permanecer `STARTING` por alguns minutos após o último PUT do watchdog; é preciso esperar em vez de intervir.
- O watchdog atual pode disparar mais um PUT antes do deploy do item 4; aceitável e não destrutivo.

## 16. Veredito final

Root cause original:
Deploy do V8 publicou `_shared/agent/core/index.ts` re-exportando `buildDeterministicPlan`/`dedupePlan` removidos de `ActionPlanner.ts`, causando BootFailure permanente da Edge Function `whatsapp-webhook` — nenhum evento da WAHA chega ao runtime (sem inbound e sem drops desde 07/08 02:36 UTC).

Agravante posterior:
V9.1 mantém validação literal de URL de webhook (base sem `?t=`) contra config gravada com token, gerando falso `webhook_mismatch` e loop de `syncWebhook()`/PUT que prende a sessão em `STARTING` e reporta `webhook_repaired` sem revalidação real.

Correção mínima recomendada:
(1) alinhar o barril do Agent Core; (2) comparação canônica de identidade de webhook com concerns separados; (3) self-heal com guarda de estado transitório, cooldown e falha fechada; (4) teste de integridade de barril como anti-regressão.

Confiança no diagnóstico: 9/10

Pronto para implementação: SIM (aguardando sua autorização explícita)
