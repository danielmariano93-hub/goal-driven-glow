# Auditoria Técnica e Correção do Admin — Meu Nino

Objetivo: encontrar a causa raiz de telas vazias e falhas do painel administrativo antes de propor qualquer correção definitiva. Nada será alterado antes do diagnóstico terminar.

## Fase 1 — Diagnóstico (somente leitura)

### 1.1 Inventário de RPCs consumidos pelo Admin
- Varredura de `src/pages/admin/**` e `src/lib/admin/**` listando toda chamada `supabase.rpc(...)` e `callAdminRpc(...)`.
- Montar tabela: tela → RPC → argumentos passados pelo front.
- Cruzar com `pg_proc` no banco: para cada RPC coletar assinatura real, `security definer`, `search_path`, `volatile/stable`, grants (`has_function_privilege` para `anon`, `authenticated`, `service_role`).
- Flagar RPCs em que o front envia argumentos que a assinatura do banco não aceita (padrão do bug histórico `_tz` no `admin_v2_cockpit`).

### 1.2 Execução direta de cada RPC no banco
- Rodar cada RPC via `supabase--read_query` (com `SELECT ... FROM rpc(...)`) usando um intervalo curto (últimos 30 dias) e o `user_id` de um admin real.
- Registrar: retorno resumido, `EXPLAIN ANALYZE` só quando o tempo passar de 500 ms, e mensagens de erro (`code`, `message`, `hint`, `detail`).
- Marcar cada RPC como OK, LENTA, ERRO ou CONTRATO_DIVERGENTE.

### 1.3 Segurança, RLS e roles
- Ler `platform_admins`, `platform_permissions`, `user_roles` e as políticas de cada tabela consumida pelos RPCs admin.
- Verificar se `current_platform_permissions()` devolve o conjunto esperado para o admin logado.
- Rodar `supabase--linter` e anotar findings relevantes ao admin.
- Confirmar que RPCs admin estão `revoke ... from anon` e apenas `authenticated`/`service_role` executam.

### 1.4 Deploy vs. main
- Comparar commit publicado em `https://meunino.com.br` (via header/asset ou build stamp acessível) com o HEAD atual de `main` no sandbox.
- Se o build publicado for anterior, registrar o gap de commits que afeta o Admin (contrato de RPC, hooks etc.).

### 1.5 Front-end: React Query, hooks, Suspense, Promise.all
- Para cada página do Admin listada, revisar:
  - uso de `useQuery`/`useQueries` (`queryKey`, `enabled`, `retry`, `throwOnError`);
  - `Promise.all` que derrubam a tela inteira quando um item falha (padrão já corrigido no Cockpit, verificar reincidência);
  - `Suspense`/`ErrorBoundary` (`AdminErrorBoundary`) e o que ele mascara;
  - tratamento de `error`, `isLoading`, `data == null` vs. array vazio;
  - dependência de `usePlatformPermissions` — se `loading` inicial esconde tudo indefinidamente.
- Instrumentar logs **temporários** (console.debug com prefixo `[admin-audit]`) em cada `queryFn` e em `AdminErrorBoundary` para capturar exatamente onde a cadeia quebra em produção. Esses logs são removidos ao final da Fase 3.

### 1.6 Auditoria de usuários (somente relatório, nada é apagado)
- Cruzar `auth.users` × `profiles` × `user_roles` × `platform_admins` × `whatsapp_links` × `agent_runs`/`transactions` (sinal de uso real).
- Classificar cada `user_id` em: **real** (tem atividade financeira/mensagens), **teste interno** (email @meunino/@lovable ou domínios internos), **duplicado** (mesmo email normalizado ou mesmo telefone), **órfão** (`auth.users` sem `profiles` ou vice-versa), **admin** (`platform_admins.active = true`).
- Entregar CSV em `/mnt/documents/admin-audit-users-2026-07-26.csv` com colunas: `user_id, email_mascarado, created_at, last_sign_in_at, tem_profile, tem_role, is_admin, tem_transacoes, tem_whatsapp, classificacao, motivo`.

### 1.7 Validação por tela
Para cada tela abaixo, registrar estado observado (carrega / vazio / erro), RPCs envolvidas, tempo total e primeiro ponto de quebra:
Cockpit · Crescimento · Clientes · WhatsApp · Saúde · OCR · Inteligência de Produto · Auditoria.

Evidência: prints via Playwright headless autenticado como admin real (usando a sessão injetada no sandbox), console + network capturados.

## Fase 2 — Relatório de causa raiz

Entrego um único documento `docs/admin-audit-2026-07-26.md` com:
- tabela RPC × contrato × resultado direto no banco;
- lista de contratos divergentes e permissões faltantes;
- gap deploy vs. main (se houver);
- pontos exatos de quebra no front (arquivo + linha);
- relatório de usuários (link para o CSV);
- causa raiz consolidada por tela.

**Nenhuma correção é aplicada antes deste relatório existir e ser aprovado.**

## Fase 3 — Correção definitiva (após aprovação do relatório)

Só entra em execução depois que a Fase 2 identificar as causas. O escopo será limitado ao que o relatório apontar, tipicamente:
- alinhar assinatura front↔RPC (argumentos, tipos, nomes);
- isolar falhas em cargas paralelas (substituir `Promise.all` por `Promise.allSettled` onde derruba a tela);
- corrigir grants/RLS que estejam bloqueando o admin real;
- consertar hooks que travam em `loading` eterno;
- republicar o frontend se o deploy estiver atrás de `main`;
- remover os logs `[admin-audit]` temporários.

Ao final: re-executar a bateria da Fase 1.7 (todas as telas), anexar prints pós-correção, resultado da suíte de testes e as queries SQL usadas como evidência.

## Fora de escopo

- Nenhuma nova feature.
- Nenhuma exclusão automática de usuários (o relatório apenas classifica).
- Nenhuma mudança em landing page, app do usuário final, agente, WhatsApp de produção ou billing.

## Entregáveis

1. `docs/admin-audit-2026-07-26.md` — relatório de causa raiz.
2. `/mnt/documents/admin-audit-users-2026-07-26.csv` — auditoria de usuários.
3. Patch cirúrgico de correção (Fase 3), com diff mínimo.
4. Evidências: prints Playwright por tela (antes/depois), saídas SQL, logs.
