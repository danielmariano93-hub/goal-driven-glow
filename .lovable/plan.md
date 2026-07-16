## Diagnóstico
- `WhatsAppSessionPanel` fica travado em `not_configured`: o CTA "Revisar conexão" apenas rechama `status` e o backend só lê credenciais de env vars — sem jornada dentro do portal.
- Vault do Supabase (`supabase_vault` + schema `vault.secrets`) está disponível neste projeto — dá para guardar as credenciais criptografadas server-side, sem tabela em texto claro nem criptografia caseira.
- Página `/admin/agente` é somente-leitura. `agent_prompt_versions` já tem versionamento (versão 1 ativa, unique parcial em `status='active'`), mas falta editor estruturado, rascunho, simulador funcional, publicar/restaurar e vitrine executiva.
- Runtime do agente (`agent-run` / `_shared/agent/prompt.ts`) carrega a versão ativa por SELECT — basta manter o contrato de "apenas uma ativa" para o novo runtime pegar mudanças automaticamente.

## Arquitetura de segredos (WAHA)
- **Storage**: `vault.create_secret / update_secret` via RPCs `SECURITY DEFINER` — nomes fixos `waha.api_url`, `waha.api_key`, `waha.webhook_secret`, `waha.session_name`. Nenhuma tabela pública guarda o valor.
- **Leitura**: só dentro de edge functions, com `service_role`, através de RPC `admin_waha_resolve_config()` (retorna o payload deno-side) — não exposta ao frontend. Frontend só chama `admin_waha_config_status()` que devolve `{ configured, updated_at, has_api_url, has_api_key, has_webhook_secret, session_name }` (sem valores).
- **Escrita/substituição**: RPC `admin_waha_save_config(p_url, p_api_key, p_webhook_secret?)` — gera `webhook_secret` via `gen_random_bytes(32)` se ausente; exige `current_platform_admin_role() = 'platform_owner'`; auditoria em `platform_admin_audit` sem os valores.
- **Precedência no provider**: Vault → env vars (retrocompat). `waha.ts` vira resolver assíncrono `getWahaConfig()` cacheado por request; helpers (`sendText`, `getHealth`, `validateWahaCredentials`, etc.) passam a receber a config resolvida.

## SSRF & validação
- Novo `_shared/security/ssrf.ts`: `assertPublicHttpsUrl(u)` — só `https:`, host não pode ser IP privado (10/8, 172.16/12, 192.168/16, 127/8, 169.254/16, ::1, fc00::/7), sem `localhost`, porta padrão ou allowlist; DNS resolve + reject se qualquer registro cai em faixa privada; timeout 6 s. Usado em `save_config` e `test_config`.

## Contrato do backend (`whatsapp-session`)
Ações novas/renomeadas, todas gated por `is_platform_admin()`, com `save_config` exigindo `platform_owner`:
- `config_status` → `{ configured, has_url, has_api_key, has_webhook_secret, updated_at, session_name }`
- `save_config { url, api_key, webhook_secret? }` → valida SSRF, guarda no Vault, retorna `config_status`
- `test_config { url, api_key }` → chama `GET {url}/api/version` + `GET /api/sessions` com a candidata em memória, **não persiste**; retorna `{ host_ok, auth_ok, latency_ms, code }`
- `setup_session` → idempotente: `create` OR `update` (`PUT/POST`), garante webhook apontando para nosso `whatsapp-webhook`, chama `start` se `STOPPED`; tolera 404/409; devolve `status` normalizado
- `status`, `qr`, `restart`, `logout`, `send_test`, `sync_webhook`, `validate` mantidos, agora resolvendo config do Vault
- Rate limit simples in-memory + tabela `admin_action_rate` (10/min por admin) para as ações de escrita
- Correlation-id no cabeçalho de resposta, `error_code` sanitizado, sem `error.message` cru

## Wizard "Conectar WhatsApp"
Substitui o card `not_configured`. Componente `WhatsAppSetupWizard` com 4 passos:
1. **Credenciais** — inputs URL (HTTPS) + API key (type=password, autocomplete off, sem preenchimento). Chama `test_config` server-side. Nunca envia ao Vault até passar no teste. Botão "Salvar e continuar" → `save_config` (owner) + refetch `config_status`.
2. **Sessão** — chama `setup_session` (idempotente). Mostra chip do status.
3. **Conectar** — puxa `qr` em polling 3 s até `status=connected` ou timeout 3 min; QR só em memória.
4. **Concluído** — telefone mascarado + envio de teste opcional (mantém fluxo atual).

Quando já `configured=true` a página exibe "Credencial configurada · atualizada em X". CTA `Substituir credenciais` abre AlertDialog forte antes de destravar os campos.

Estados: `connected|awaiting_qr|connecting|disconnected|needs_attention` reusam `mapWhatsAppStatus`. "Gerar novo QR", "Reiniciar" e "Desconectar" aparecem por capability, não por status literal.

## Configuração real do assistente
### Schema
- `ALTER TABLE agent_prompt_versions`
  - `structured_config jsonb` (nome, objetivo, tom, deve/nunca fazer, boas-vindas, fallback, proatividade)
  - `published_at timestamptz`, `published_by uuid`, `parent_version_id uuid`, `restored_from_id uuid`
- Índice parcial já garante única `active`.
- RPCs `SECURITY DEFINER` (`search_path=public`, admin gate):
  - `agent_prompt_get_active()` / `agent_prompt_get_draft()`
  - `agent_prompt_create_draft(from_id uuid)` — clona ativa/versão em `draft`
  - `agent_prompt_update_draft(id, structured, notes, expected_updated_at)` — optimistic locking; recompila `system_prompt` server-side com **camada de segurança fixa** prependida (regras não editáveis: nunca inventar valores, sempre CONFIRMAR mutação, LGPD, etc.)
  - `agent_prompt_publish(id, expected_updated_at)` — arquiva ativa, promove draft, gera nova `version = max+1`, `published_at/by`
  - `agent_prompt_restore(id)` — cria novo draft com estrutura da versão indicada, `restored_from_id`
  - Auditoria em `platform_admin_audit`.

### UI `/admin/agente`
Redesenho completo:
- Header executivo: chip do agente + canal + versão ativa + "publicada há X" + botão "Editar comportamento" / "Criar rascunho".
- Cards de métricas mantidos.
- Bloco "Comportamento": lista de versões (ativa, drafts, arquivadas) com autor/data/notas, ações Publicar (draft) / Restaurar (arquivada) / Ver diff.
- Editor `AgentBehaviorEditor` (drawer): formulário estruturado em pt-BR, salva rascunho, mostra preview do prompt compilado (somente leitura) e a camada de segurança fixa como caixa cinza informativa.
- Diff simples lado-a-lado entre duas versões (`AgentVersionDiff`).
- CTA "Abrir simulador" leva para `/admin/agente/simulador` já existente, agora funcional.

### Simulador isolado
Nova edge function `agent-simulate` — usa **exclusivamente** o rascunho (ou versão passada), roda o LLM sem tools de escrita (`createTransaction`, `sendText`, etc. off), retorna `{ reply, intents, proposed_actions }`. Zero side-effect no domínio financeiro e zero chamada ao WAHA. `AgenteSimulador.tsx` reescrito para essa API, reset da conversa em memória.

## Ordem de implementação
1. **Migração 1** — Vault helpers + RPCs WAHA (`admin_waha_save_config`, `admin_waha_config_status`, `admin_waha_replace_config`, `admin_waha_resolve_config` restrita), tabela `admin_action_rate`, GRANTs + RLS.
2. **Migração 2** — colunas em `agent_prompt_versions` + RPCs de rascunho/publish/restore + backfill de `structured_config` para v1.
3. `_shared/security/ssrf.ts` e refactor de `_shared/messaging/waha.ts` para resolver async via Vault.
4. `whatsapp-session` reescrita das ações + rate limit + correlation-id.
5. Nova edge `agent-simulate`.
6. Front admin: wizard WhatsApp, novo panel Agente + editor + diff + simulador reescrito, hook `useAgentPrompts`.
7. Testes (`admin-waha-config.test.ts`, `agent-prompt-compile.test.ts`, `ssrf.test.ts`) + typecheck + build.
8. Auditoria de bundle/logs por strings proibidas (regex `sk_|X-Api-Key|api[_-]?key|waha_api|token`).

## Copy / UX (pt-BR)
- Wizard: "Configurar conexão", "Testar conexão", "Salvar credenciais", "Substituir credenciais".
- Mensagens sem termos técnicos: "Não consegui falar com o servidor do WhatsApp.", "As credenciais foram recusadas pelo servidor.", "Tudo certo. Vamos criar o número oficial."
- Agente: "Comportamento em uso", "Criar rascunho a partir desta versão", "Publicar comportamento", "Restaurar esta versão", "Este bloco de segurança é obrigatório e não pode ser editado."

## Segurança e riscos
- API key nunca em `search_params`, sempre header `X-Api-Key` server-side.
- QR nunca persistido; nunca logado.
- Auditoria só grava metadados (quem/quando/ação/hash curto), nunca valor.
- `admin_waha_resolve_config` é `EXECUTE` só para `service_role` (revogar `PUBLIC`/`anon`/`authenticated`).
- SSRF: reject por DNS + host literal.
- Optimistic locking nas RPCs do agente evita sobrescrita concorrente.
- Camada fixa de segurança no prompt compilado (nunca inventar valores, sempre pedir CONFIRMAR, respeitar LGPD) é impossível de remover pelo editor.
- Retrocompat: se Vault estiver vazio, provider ainda lê env vars (fallback ordenado), então nada quebra até o founder salvar pela UI.

## Aceite
- Owner autenticado abre `/admin/whatsapp` sem env vars, roda wizard completo (URL + API key → teste → salvar → sessão → QR → conectado) e vê telefone mascarado.
- Admin não-owner abre `/admin/whatsapp` e vê "credencial configurada" mas o botão "Substituir credenciais" fica desabilitado com hint de permissão.
- `curl` no endpoint `whatsapp-session` sem JWT → 401; com JWT de consumidor → 403.
- `SELECT` direto em qualquer tabela pública não devolve API key nem webhook secret.
- Bundle produção (`bun run build`) e logs de edge functions (grep pós-run) não contêm valores de secret.
- `test_config` bloqueia `http://`, `https://localhost`, `https://10.0.0.1`.
- `setup_session` chamado 3x seguidas produz o mesmo estado final sem 5xx.
- `/admin/agente`: criar rascunho, editar em UI amigável, abrir simulador funcional, publicar (v2 ativa, v1 archived), restaurar v1 (cria v3 draft com estrutura de v1). Runtime de `agent-run` passa a usar v2 imediatamente após publish.
- 74+ testes existentes continuam verdes; novos testes cobrem SSRF, compilação de prompt e permissões de owner.
