# Admin Meu Nino — Centro de Decisão (2 pacotes)

Auditoria feita sobre o HEAD atual (rotas, `platform_permissions`, `pg_proc`, páginas admin). Nenhum arquivo foi alterado nesta execução.

---

## PACOTE 1 — Confiança, funcionamento e nova experiência

### 1. Diagnóstico confirmado no código/banco atual

**Bug crítico de permissão (causa raiz do "bloqueado"):** `platform_permissions` NÃO contém as ações `ops.read` / `ops.write` (apenas `operations.read`/`operations.write`). Sete funções exigem as inexistentes:
`admin_communication_catalog`, `admin_communication_templates`, `admin_proactive_queue`, `admin_proactive_engine_status` (`ops.read`) e `admin_communication_catalog_update`, `admin_communication_template_upsert`, `admin_proactive_engine_toggle` (`ops.write`). Resultado: **42501 permission_denied para todos os papéis, inclusive platform_owner** — por isso Templates/Catálogo/Fila aparecem vazios ou bloqueados. A navegação usa `messaging.read`, que existe e é concedida.

**RPC sem verificação:** `admin_v2_proactive_summary` não chama `_require_perm` (é SECURITY DEFINER). Precisa exigir `messaging.read`.

**Universos divergentes (confirmado):** auth_users=6, profiles=6, platform_admins=1, product_events=482, outbound_messages=192, communication_deliveries=10. Cada RPC define "usuário" de um jeito (auth, profiles, v_client_universe, eventos). `v_client_universe` depende de `is_client_user`.

**Contratos heterogêneos:** `admin_v2_cockpit(_from,_to)`, `admin_v2_growth_summary(_from,_to,_tz)`, `admin_v2_clients_list(_from,_to,_tz,_limit,_lifecycle,_financial)`, `admin_v2_operations_health(_hours)`, `admin_v2_whatsapp_monitor(_days)`, `admin_v2_message_intelligence(_days)`. Enviar `_tz` para o cockpit quebra a chamada (regressão já ocorrida). `admin_v2_clients_list` filtra por período → risco de cliente novo sem eventos não aparecer (a validar na leitura da função).

**Duplicação:** `ProactiveEnginePanel.tsx` e `ProactiveEnginePanelV2.tsx` coexistem; páginas órfãs após o redesign (`Crescimento.tsx`, `InteligenciaProduto.tsx`, `Receita.tsx`, `IAInteligencia.tsx`, `Configuracoes.tsx`, `operacao/Assistente.tsx`, `operacao/IaOcr.tsx`) só são alcançadas via hubs/redirects.

**Estados:** `KpiCard` imprime `amostra low (n=…)` como texto técnico; Saúde mostra p95 no primeiro nível; Segurança abre com Break-glass no corpo; `Cockpit` já usa `Promise.allSettled` (padrão a generalizar).

### 2. Escopo funcional tela a tela
- **Visão geral** (`/admin`): Atenção necessária (só acionável, cada item com CTA Investigar/Tentar novamente/Ver clientes) → Pulso do negócio (4 KPIs: ativos 7d, ativos 30d, novos, ativação) → Faixa operacional compacta (saudáveis recolhidos) → Movimentos vs. período anterior. KPIs sem amostra viram um único bloco "Ainda aprendendo".
- **Clientes**: lista com nome/estágio/última atividade/WhatsApp/risco/ação; busca; filtros de estágio primários e "com/sem dados" secundários; ficha com abas Resumo, Jornada, Financeiro, Nino, Comunicações, Erros.
- **Produto**: abas Jornada (funil cadastro→onboarding→1º dado→1º valor→W1/W4), Experiências, Receita (oculta sem integração).
- **Operações**: Central de Incidentes (Ação necessária / Em observação / Saudável), WhatsApp (Conexão, Entregabilidade, Falhas, Fila), Nino e Documentos (sucesso, correção do usuário, falhas, custo por sucesso), Automações. Tokens/p50/p95 em "Detalhes técnicos".
- **Comunicações**: entra no menu principal (base do Pacote 2), já desbloqueada.
- **Administração** (menu de conta): Segurança, Auditoria, Acessos, Configurações. Break-glass vira botão + modal com justificativa.

### 3. Arquivos / RPCs / migrations afetados
- Migration (idempotente): inserir `ops.read`/`ops.write` **ou** — preferido — `CREATE OR REPLACE` das 7 funções trocando para `messaging.read`/`messaging.reprocess` (comunicações) e `operations.read`/`operations.write` (motor); adicionar `_require_perm('messaging.read')` em `admin_v2_proactive_summary`. Sem DROP, sem mudança de assinatura.
- `src/components/admin/AdminLayout.tsx` (6 grupos), `src/App.tsx` (rotas + redirects antigos preservados).
- Novo `src/lib/admin/rpcContracts.ts` (assinatura declarada por RPC; builder de args impede argumento extra) + `src/lib/admin/kpiRegistry.ts` (universo/fórmula/fonte/exclusões).
- Novos primitivos: `AttentionCard`, `IncidentGroup`, `TechnicalDetails`, `AdminAsyncBoundary` (loading/erro/vazio/sem permissão + degradação parcial).
- Refatorar: `Cockpit.tsx`, `Clientes.tsx`, `operacao/Saude.tsx`, `operacao/WhatsApp.tsx`, `AssessorHub.tsx`, `GovernancaSeguranca.tsx`, `AuditoriaHub.tsx`, `displayDictionary.ts`, `statusMapper.ts`, `KpiCard.tsx`.
- Ocultar (não deletar) páginas órfãs; remover `ProactiveEnginePanel.tsx` (v1) após confirmar zero imports.

### 4. Reaproveitar / refatorar / criar / ocultar
Reaproveitar: todas as RPCs `admin_v2_*`, `usePlatformPermissions`, `AdminTabs`, `AdminResponsiveList`, `AdminDateFilter`, `periodPresets`, `WhatsAppPairingDialog`, `WhatsAppSessionPanel`, `BreakGlassPanel`, `ProactiveEnginePanelV2`, `displayDictionary`. Criar apenas o registry, o boundary e os cards de incidente. Nada de banco é removido.

### 5. Contratos e fórmulas
Cada KPI declara `{ key, label, universo, fórmula, período, fonte(live|agregado|backfill), última atualização, exclusões, amostra mínima }`. Universo canônico único = clientes reais (exclui admins e usuários de teste). Datas sempre `America/Sao_Paulo`. Amostra < mínimo → não vira KPI.

### 6. UX/UI e mobile
DM Sans, Phosphor rounded, paleta/gradiente oficiais, raios 18/24/32, sombras suaves. Mobile-first: drawer, tabs roláveis, tabelas → cards expansíveis, uma ação primária por tela, progressive disclosure. Sem novos gráficos neste pacote além dos existentes já corretos.

### 7. Critérios de aceite
Owner acessa Comunicações/Templates/Fila sem 42501; nenhum KPI contradiz outro (mesmo universo); usuário novo sem eventos aparece em Clientes; nenhuma tela mostra UUID/`unknown`/nome de RPC/SQLSTATE fora de "Detalhes técnicos"; falha secundária não apaga dados principais; nenhum card de "amostra insuficiente" isolado; sem `to_phone`/corpo íntegro de mensagem/segredos.

### 8. Testes
Unitários do registry e do builder de args; contrato RPC ↔ assinatura real; matriz rota↔permissão por papel (4 papéis); regressão de app do cliente/WhatsApp/agente intocados; snapshot mobile/desktop; acessibilidade (foco, rótulos, contraste).

### 9. Migrations / flags / rollback
Uma migration idempotente, apenas `CREATE OR REPLACE` + `INSERT ... ON CONFLICT` em `platform_permissions`. Flag `admin_ia_v4` (localStorage + `financial_feature_flags`) para alternar navegação nova/antiga; rollback = desligar flag; rotas antigas continuam redirecionando.

### 10. Riscos
Permissões (mitigado por testes por papel), `is_client_user` restrito (validar grants), regressão de contrato em RPC (mitigado pelo registry).

### 11. Ordem
Permissões/RPC → registry+boundary → navegação → Visão geral → Clientes → Operações → Produto → Administração.

### 12. Esforço
Permissões P · Registry/boundary M · Navegação P · Visão geral M · Clientes M · Operações G · Produto M · Administração P.

---

## PACOTE 2 — Comunicações e inteligência

### 1. Diagnóstico
Já existe base real: `communication_catalog` (16 tipos), `communication_templates` (20 registros, com `version`, `allowed_variables`, `active`), `communication_deliveries` (status apenas `delivered`/`suppressed`, com `reason`, `block_context`, `user_feedback`), `outbound_messages` (192, `sent|delivered|dead`), `reminder_jobs` (44). O editor de template existe dentro de `ProactiveEnginePanelV2.tsx` — funcional, mas escondido e bloqueado pelo bug de permissão. **Não existe** conceito de fluxo, rascunho/publicação, histórico/rollback nem preview.

### 2. Escopo
Rota `/admin/comunicacoes` com abas **Visão geral / Fluxos / Templates / Fila e regras**. Cabeçalho: estado do motor, CTA "Criar fluxo", CTA "Novo template", 4 indicadores, navegação interna.
- **Visão geral**: alcance, entregues, lidas, ações, opt-out, falhas, custo — com comparação temporal e drill-down; separa tentativa/envio/entrega/leitura/ação.
- **Templates**: busca e filtros (canal, caso de uso, status); editor com variáveis validadas por schema; preview fiel WhatsApp/app; teste controlado; rascunho → publicação → histórico → rollback → auditoria.
- **Fluxos** (linear, sem canvas): Evento → Público → Condições → Mensagem → Canal/Horário → Saída/Objetivo, com trigger versionado, exclusões, template fixado por versão, quiet hours, cooldown, limite de frequência, idempotência, simulação, kill switch. Casos iniciais: onboarding 24h, inativo 7d, pendentes de categorização, Divisão do Rolê D-1/D0/D+1/D+3/D+7, resumo semanal, recuperação após erro.
- **Fila e regras**: pendentes, falhas, bloqueadas, suprimidas, quiet hours, cooldown, limite semanal, opt-out, kill switch. Catálogo técnico secundário.
- **Ficha operacional do cliente**: retry, reprocessar, reenviar onboarding, teste controlado, abrir logs, simular — todos com confirmação, escopo, permissão, idempotência e auditoria.

### 3. Banco / RPCs
Novas tabelas: `communication_flows`, `communication_flow_versions`, `communication_template_versions`, `communication_flow_runs` (todas com GRANT + RLS restrita a admins). Novas RPCs: `admin_comm_overview`, `admin_comm_flow_upsert/publish/pause/simulate`, `admin_comm_template_versions/publish/rollback/preview`, `admin_comm_queue`. Permissões: `messaging.read`, `messaging.write`, `messaging.reprocess`; ações de escrita restritas a `platform_admin`/`platform_owner`.

### 4. Reaproveitar
Editor e catálogo do `ProactiveEnginePanelV2`, `tipPolicy`/`communicationPolicy`, `CommunicationDispatcherV3`, `reminder_jobs` e a régua já implementada da Divisão do Rolê. O dispatcher passa a ler a versão publicada do template — sem quebrar o comportamento atual (fallback para o template ativo).

### 5. Fórmulas
Alcance = destinatários elegíveis; Entrega = entregues/tentados; Ação = ações/entregues; Opt-out = opt-outs/entregues; Custo por resultado = custo/ação bem-sucedida. Sempre com universo, período e comparação explícitos.

### 6. UX/UI
Workspace com tabs; mobile: tabs roláveis, fila como cards, editor em tela cheia. Gráficos só quando superam texto: linha suave, eixos sutis, cores semânticas, tooltip claro, estados de loading/vazio/erro/amostra insuficiente; cálculo determinístico no backend.

### 7–12
Aceite: criar/publicar/reverter template e fluxo com auditoria; simulação antes de publicar; kill switch em 1 clique; nenhuma PII exposta. Testes: RLS/permissões, idempotência de fluxo, simulação sem envio real, contratos das RPCs, responsividade. Rollout: flag `comm_workspace`; fluxos nascem pausados; rollback = pausar tudo, dispatcher volta ao comportamento atual. Ordem: schema → Templates → Visão geral → Fila → Fluxos → ações na ficha → inteligência. Esforço: schema M · Templates M · Visão geral P · Fila P · Fluxos G · Ações M · Inteligência G.

---

## Anexos

**Inconsistências encontradas:** (1) `ops.read`/`ops.write` inexistentes em 7 RPCs → 42501; (2) `admin_v2_proactive_summary` sem `_require_perm`; (3) universos divergentes (auth 6 / clientes reais / eventos 482); (4) assinaturas de RPC heterogêneas (`_tz` só em algumas); (5) duplicação ProactiveEnginePanel v1/v2; (6) páginas órfãs; (7) texto técnico "amostra low (n=…)"; (8) break-glass no corpo da tela; (9) Configurações escondida dentro de Auditoria; (10) p95/tokens no primeiro nível.

**Matriz rota → permissão FE → BE:** cockpit→cockpit.read→cockpit.read ✔ · clientes→clients.read→clients.read ✔ · crescimento→growth.read→growth.read/product_intel.read ✔ · operacao/saude→operations.read→operations.read ✔ · operacao/whatsapp→whatsapp.read→whatsapp.read/messaging.read ✔ · operacao/assistente→agent.read→agent.read/operations.read ✔ · **comunicacao→messaging.read→ops.read ✖ (quebrado)** · seguranca→security.read→governance.read ⚠ (divergente) · auditoria→audit.read→audit.read ✔.

**Dicionário KPI:** definido no `kpiRegistry` (chave → fórmula → universo → fonte → atualização → exclusões), fonte única para UI e testes.

**Estrutura atual → proposta:** Negócio/Operação/Governança (9 destinos) → Visão geral, Clientes, Produto, Operações, Comunicações + Administração (secundária).

**Não será alterado:** app do cliente, autenticação, AgentCore, webhook/envio WhatsApp, pipeline de documentos, Divisão do Rolê, Metas Conjuntas, identidade visual/logo/paleta, `client.ts`/`types.ts`.

**Sequência futura:** Prompt 1 = Pacote 1; Prompt 2 = Pacote 2.

**Confirmação:** nenhum arquivo foi criado, editado ou removido; nenhuma migration, deploy ou publicação foi executada nesta rodada.

### Dúvidas bloqueantes
1. Corrigir permissões renomeando para `messaging.*`/`operations.*` (preferido) ou criando `ops.*` como alias?
2. "Receita" deve sair do menu até existir integração de pagamento?
3. Break-glass permanece só para `platform_owner`?
