# Rebranding NoControle.ia → MeuNino

Troca de nome público e técnico não-destrutiva. Nenhuma regra financeira, schema, política RLS, secret existente ou histórico de mensagens é alterado. Nenhum domínio ou URL nova é introduzido (aguardar domínio real). Identidade visual permanece.

## 1. Escopo por classe

### (a) Substituir — texto público / novo

Frontend (React):
- `index.html` — `<title>`, `meta description`, `author`, `og:title`, `og:description`, `twitter:title`, `twitter:description`.
- `src/index.css` — comentário do design-system.
- Wordmarks visíveis: `src/pages/Landing.tsx` (header, hero, chip, seções, footer), `src/pages/Login.tsx`, `src/pages/Signup.tsx`, `src/pages/Onboarding.tsx`, `src/pages/auth/ForgotPassword.tsx`, `src/pages/auth/ResetPassword.tsx`, `src/components/DesktopSidebar.tsx`, `src/components/admin/AdminLayout.tsx`. O JSX `NoControle<span>.ia</span>` vira `MeuNino` (uma única palavra, sem span de sufixo — o span some).
- Textos e microcopy: `src/lib/copy/strings.ts` (consentimento LGPD), `src/lib/ui/feedback.ts` (comentário), `src/components/whatsapp/WhatsAppLinkSheet.tsx` (mensagem gerada e legenda), `src/pages/WhatsApp.tsx` (mensagem, instrução, consentimento LGPD), `src/pages/Perfil.tsx` (nome do arquivo de export → `meunino_export_YYYY-MM-DD.json`), `src/components/AIPreferencesCard.tsx`, `src/components/ui/empty-state.tsx` (comentário).
- Admin: `src/components/admin/useAdminDocumentTitle.ts` (`Admin · … · MeuNino`), `src/components/admin/WhatsAppValidateCard.tsx` (label "Webhook do MeuNino"), `src/pages/admin/WhatsApp.tsx`, `src/pages/admin/WhatsAppSessionPanel.tsx`, `src/pages/admin/VisaoGeral.tsx`, `src/pages/admin/Usuarios.tsx`, `src/pages/admin/Financeiro.tsx`, `src/pages/admin/Configuracoes.tsx`, `src/pages/admin/Agente.tsx`, `src/pages/admin/agente/BehaviorEditor.tsx` (placeholders), `src/pages/admin/agente/cfg.ts` (welcome default, fallback comment). O `pix_key` e `pix_sentence` em `cfg.ts` (`daniel@nocontrole.ia`) são defaults de UI — trocar para `daniel@meunino` (mantém coerência; valores reais do usuário no banco não são tocados).
- Componente: `src/components/auth/PlatformAdminRoute.tsx` (mensagem de acesso).

Edge Functions (texto novo gerado):
- `supabase/functions/whatsapp-webhook/index.ts` — mensagens de boas-vindas/fallback (linhas 313, 365) trocam para MeuNino. Manter `if (/NoControle/i.test(t))` como aceitação legada e **adicionar** `/MeuNino/i` (item (b) abaixo).
- `supabase/functions/whatsapp-session/index.ts` — string `[TESTE NoControle.ia]` → `[TESTE MeuNino]`.
- `supabase/functions/assistant-ingest-document/index.ts` — `SYSTEM_PROMPT` referencia o app.
- `supabase/functions/insights-generate/index.ts` — system prompt do gerador.
- `supabase/functions/_shared/agent/prompt.ts` — `DEFAULT_SYSTEM_PROMPT` (identidade do assessor).
- `supabase/functions/user-data-export/index.ts` — `Content-Disposition` filename → `meunino_export.json`.
- `supabase/functions/_shared/messaging/waha.ts` — campos de payload `app`/`project` = `"meunino"` (metadata do provedor; não é a `session_name`).

`package.json`: `"name": "vite_react_shadcn_ts"` — **não trocar** (é o nome interno do template Vite e não é publicado). Se o usuário quiser, apenas este campo pode virar `"meunino"`; deixamos como opção B e mantemos o valor atual por padrão para reduzir risco (é referência do lockfile e de scripts internos do Lovable).

### (b) Compatibilidade — aceitar antigo, escrever novo

- `supabase/functions/whatsapp-webhook/index.ts`: regex de vinculação aceita `NoControle` **e** `MeuNino` (`/(NoControle|MeuNino)/i`). Toda resposta gerada usa MeuNino.
- `supabase/functions/_shared/messaging/waha.ts` linha 17: nova ordem de env — `MEUNINO_WAHA_SESSION` ?? `NOCONTROLE_WAHA_SESSION` ?? `WAHA_SESSION` ?? `DEFAULT_SESSION_FALLBACK`. `DEFAULT_SESSION_FALLBACK` fica no valor atual (`"nocontrole"`) para não quebrar a sessão em execução; um comentário documenta que só muda após reprovisionar a sessão no WAHA.
- `src/lib/ui/periodStore.ts`: migrar chave `nocontrole.periodFilter.v1` → `meunino.periodFilter.v1`. Rotina one-shot: ler nova; se ausente, ler antiga; gravar na nova; **só então** `removeItem` da antiga. Encapsular na leitura inicial.
- WhatsApp link sheet e `pages/WhatsApp.tsx`: a mensagem gerada nova usa MeuNino; o parser do webhook aceita ambas.
- `src/lib/import/legacy.ts`: mantém o comentário mencionando "ex-Mindful Money" e adiciona "ex-NoControle.ia" — o parser lê arquivos legados de usuários; string interna de compat.

### (c) Preservar — histórico, secrets, migrations antigas

- Todas as migrations em `supabase/migrations/*` **não são editadas** (histórico versionado). Os prompts default lá dentro já foram sobrescritos por migrations mais novas / por `agent_configs` ativo; qualquer texto residual será tratado pela nova migration (item 3).
- Secret `BOOTSTRAP_ADMIN_EMAIL` e o default `daniel.assis@nocontrole.com.br` em `admin-bootstrap/index.ts` — **não alterar** (é a identidade do owner atual; o admin já existe no banco; mudar quebraria bootstrap idempotente).
- Nomes no Vault: `waha.session_name`, `waha.api_url`, `waha.api_key`, `nocontrole_cron_secret` — **não renomear**. São chaves de segredo já criadas; renomear = perda de acesso.
- Enum/textos `PulseBand "No controle"` (em `src/lib/pulse/rules.ts`, `supabase/functions/_shared/pulse/rules.ts` e teste) — **manter**. É rótulo de faixa comportamental ("estar no controle"), não a marca.
- `supabase/functions/admin-bootstrap/index.ts` TARGET_EMAIL default — manter.
- Mensagens já enviadas em `conversation_messages` — não reescrever.
- `package.json` `"name"` — manter (ver §a).

## 2. Migration idempotente (SQL, não destrutiva)

Arquivo: `supabase/migrations/<ts>_rebrand_meunino_active_config.sql`. Somente **UPDATE** em configurações ativas e itens ainda pendentes:

- `agent_configs`: em cada `structured_config` JSONB, `replace(value, 'NoControle.ia', 'MeuNino')` e `replace('NoControle','MeuNino')` para as chaves `name`, `signature`, `welcome`, `pix_sentence` (quando existentes). NÃO tocar em `pix_key` (dado real do owner). Guardar por `WHERE structured_config::text ILIKE '%NoControle%'`.
- `agent_prompt_versions` **ativos** (`status='active'` ou equivalente atual): reescrever apenas prompts cujo texto ainda mencione NoControle e que sejam a versão em uso. Versões históricas ficam intactas.
- Fila de saída do WhatsApp: `UPDATE messages / messaging_provider_events` (o nome real é o que existir — checar em build) somente `WHERE status IN ('queued','pending') AND body ILIKE '%NoControle%'` — trocar por MeuNino. Mensagens `sent`/`delivered` **não** são tocadas.
- `phone_link_codes` / instruções ativas: se houver colunas com texto sugerido de mensagem, atualizar apenas registros não expirados.
- Idempotência: usar `regexp_replace(..., 'NoControle\.ia|NoControle', 'MeuNino', 'g')` e `WHERE ... ILIKE '%NoControle%'` — rodar 2x é no-op.
- Sem `ALTER`, sem `DROP`, sem `GRANT`, sem tocar em `auth.*`/`vault`/`storage`.

## 3. Testes automatizados (novos)

- `src/test/branding-no-legacy.test.ts`: varre `src/**/*.{ts,tsx}`, `index.html`, `supabase/functions/**/*.ts` (exclui `_shared/messaging/waha.ts` linha do env legado, `whatsapp-webhook` regex de compat, `src/lib/ui/periodStore.ts` bloco de migração, `src/lib/import/legacy.ts`, e todo `supabase/migrations/**`). Falha se encontrar `NoControle` fora dessas allowlists.
- `src/test/waha-session-env.test.ts`: mocka `Deno.env` e verifica ordem `MEUNINO_WAHA_SESSION` > `NOCONTROLE_WAHA_SESSION` > `WAHA_SESSION` > fallback.
- `src/test/period-store-migration.test.ts`: popula `localStorage['nocontrole.periodFilter.v1']`, invoca leitura, valida que nova chave herdou o valor e que a antiga foi removida somente após leitura bem-sucedida.
- `src/test/whatsapp-link-parser.test.ts`: valida que o webhook aceita "meu código é 123456 NoControle" **e** "…MeuNino".

## 4. Arquivos afetados (resumo)

Frontend (edições): `index.html`, `src/index.css`, `src/lib/copy/strings.ts`, `src/lib/ui/feedback.ts`, `src/lib/ui/periodStore.ts`, `src/lib/import/legacy.ts`, `src/components/{DesktopSidebar,AIPreferencesCard}.tsx`, `src/components/admin/{AdminLayout,useAdminDocumentTitle,WhatsAppValidateCard}.tsx`, `src/components/auth/PlatformAdminRoute.tsx`, `src/components/whatsapp/WhatsAppLinkSheet.tsx`, `src/components/ui/empty-state.tsx`, `src/pages/{Landing,Login,Signup,Onboarding,Perfil,WhatsApp}.tsx`, `src/pages/auth/{ForgotPassword,ResetPassword}.tsx`, `src/pages/admin/{WhatsApp,WhatsAppSessionPanel,VisaoGeral,Usuarios,Financeiro,Configuracoes,Agente}.tsx`, `src/pages/admin/agente/{cfg.ts,BehaviorEditor.tsx}`.

Edge Functions (edições): `whatsapp-webhook`, `whatsapp-session`, `assistant-ingest-document`, `insights-generate`, `user-data-export`, `_shared/agent/prompt.ts`, `_shared/messaging/waha.ts`.

Nova migration: `supabase/migrations/<ts>_rebrand_meunino_active_config.sql`.

Novos testes: `src/test/branding-no-legacy.test.ts`, `src/test/waha-session-env.test.ts`, `src/test/period-store-migration.test.ts`, `src/test/whatsapp-link-parser.test.ts`.

## 5. Ordem de execução (na fase de build)

1. Aplicar edições de frontend (textos, wordmark, meta).
2. Aplicar edições em Edge Functions (respostas novas em MeuNino; regex/env com fallback legado).
3. Criar migration idempotente.
4. Escrever os 4 testes; rodar `bunx vitest run` até verde.
5. `bunx tsgo` typecheck. Build automático do harness.
6. Depois da aprovação: deploy das Edge Functions afetadas + aplicação da migration + publicação do frontend.

## 6. Riscos e mitigação

- **Sessão WAHA cair** se `DEFAULT_SESSION_FALLBACK` mudar. → mantido como `"nocontrole"`; troca formal só quando o usuário provisionar nova sessão no painel WAHA e definir `MEUNINO_WAHA_SESSION`.
- **Usuário no meio de vincular WhatsApp** com mensagem antiga. → parser aceita ambos os nomes por tempo indefinido.
- **`periodStore` em uso durante primeira leitura**: migração feita de forma síncrona antes de qualquer `subscribe`.
- **Prompt do agente em cache**: `agent_prompt_versions` ativos são reescritos pela migration; sessões em memória expiram via TTL existente (30 min).
- **Arquivos legados de export** no computador do usuário ainda com nome `nocontrole_export_*.json` → sem impacto; `legacy.ts` continua lendo.

## 7. Critérios de aceite

- Nenhum "NoControle" visível em: landing, login, signup, onboarding, sidebar, admin layout, títulos de página, meta tags, toasts, empty states, mensagens do WhatsApp geradas dali em diante, exports novos.
- `src/test/branding-no-legacy.test.ts` verde.
- Testes de fallback WAHA, migração de localStorage e parser de vínculo verdes.
- Sessão WAHA continua "connected" após deploy (verificar em Admin → WhatsApp).
- Migration roda duas vezes sem erro e sem alterar nada na 2ª execução.
- Usuário com código de vínculo antigo (mensagem "NoControle") consegue completar a vinculação.

## 8. O que exige deploy/publicação depois da aprovação

- Deploy Edge Functions: `whatsapp-webhook`, `whatsapp-session`, `assistant-ingest-document`, `insights-generate`, `user-data-export` (dependem de `_shared/agent/prompt.ts` e `_shared/messaging/waha.ts`).
- Aplicar migration nova.
- Publicar frontend.

## 9. Fora deste plano (explícito)

- Domínio novo, URLs, sufixo `.ia` → aguardando o domínio adquirido; canonical/og:url e `sitemap.xml` (se existir) só são revisados quando o domínio for informado.
- Logo, favicon, cores, tipografia, layout → não alterados.
- Renomear secrets do Vault, TARGET_EMAIL do bootstrap, migrations históricas → não alterados.
- `package.json.name` interno do Vite → mantido.
