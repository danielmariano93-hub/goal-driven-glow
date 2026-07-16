## Objetivo
Aplicar as credenciais do WAHA fornecidas pelo owner diretamente no Vault via edge function server-side (nunca em código/migration/log) e deixar o canal operacional até QR/WORKING. A correção de `can_manage_config` já foi aplicada na rodada anterior; nada mais a fazer no schema.

## Passos de execução (não gravam segredo em código)

1. **`supabase--curl_edge_functions`** → `whatsapp-session` `action=save_config` com `{ url, api_key, session_name: "default" }`. Roda com o JWT do owner logado no preview; a RPC `admin_waha_save_config` grava no Vault e gera `webhook_secret` server-side quando ausente. Não repetir os valores na resposta.
2. **`config_status`** → confirmar apenas `configured=true`, `has_url/has_api_key/has_webhook_secret=true`, `can_manage_config=true`. Sem valores.
3. **`test_config`** com os mesmos `url`/`api_key` para validar acesso real ao Manager (SSRF + `GET /api/version`). Se falhar por header/endpoint, comparar com o cliente WAHA existente em `_shared/messaging/waha.ts` e ajustar (headers `X-Api-Key`, path `/api/sessions/{name}`, etc.). Nada de pedir credenciais de novo.
4. **`setup_session`** — idempotente: cria/atualiza `default`, sincroniza webhook para `SUPABASE_URL/functions/v1/whatsapp-webhook` com o secret do Vault e eventos `message`, `message.ack`, `session.status`. Inicia sessão se `STOPPED`.
5. **`status`** — ler `status/capabilities/phone_masked`. Se `awaiting_qr`, chamar `qr` para confirmar geração; se `connected`, informar telefone mascarado.
6. **`validate`** — health check completo (host_ok, auth_ok, session_ok, webhook_ok).
7. **`bun run test` + build.** Não publicar.

## Ajustes possíveis durante execução
- Se `test_config` retornar `unreachable`/`unauthorized`: inspecionar `buildWahaTester`/`safeFetch` em `supabase/functions/_shared/messaging/waha.ts`, comparar com Sniper AI (mesma stack), corrigir path/headers no cliente e re-executar. Nada de patch em segredo — só no client HTTP.
- Se `setup_session` gerar 404 → criar; 409 → atualizar; ambos já cobertos por `createOrUpdateSession`, verificar payload.
- Se QR não aparecer, garantir que polling do wizard/`WhatsAppSessionPanel` esteja consumindo `qr` corretamente.

## Sigilo
- Nenhum valor de URL/key/secret escrito em migration, código, tabela pública ou log.
- Payload das chamadas curl fica só na conversa administrativa; o eco de resposta é filtrado (`ok` e `error_code`).
- Auditoria em `platform_admin_audit` já grava apenas metadados, sem valores.

## Aceite
Relatório final com os 7 itens solicitados (credenciais armazenadas, conexão validada, sessão criada/reutilizada, status real, webhook sincronizado, QR no admin, bloqueio restante) — sem expor a chave.
