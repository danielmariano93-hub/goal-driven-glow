# Admin Meu Nino — Centro de Decisão (auditoria do HEAD + 2 pacotes)

Nenhum arquivo foi alterado nesta resposta. Auditoria via leitura de código e consultas somente-leitura ao banco.

## O que JÁ existe no HEAD (não recriar)

Verificado agora: navegação de 6 destinos (`AdminLayout.tsx`: Visão geral, Clientes, Produto, Operações, Comunicações, Administração) com redirects das rotas antigas em `App.tsx`; `src/lib/admin/rpcContracts.ts` (filtra argumentos não declarados — resolve o `_tz` no cockpit); `src/lib/admin/kpiRegistry.ts` (universo/fórmula/período/fonte/exclusões); `AdminAsyncBoundary.tsx`, `AttentionCard.tsx`/`IncidentGroup`, `TechnicalDetails.tsx`, `AdminTabs`, `AdminResponsiveList`, `DataTable`, `StatusChip`, `displayDictionary.ts`, `BreakGlassPanel.tsx`, `WhatsAppPairingDialog.tsx`, `ProactiveEnginePanelV2`.
Banco: nenhuma função exige mais `ops.*` (confirmado em `pg_get_functiondef`); `messaging.write` existe; `admin_v2_proactive_summary` agora valida `messaging.read`.

## PACOTE 1 — Confiança, funcionamento e nova experiência

### 1. Diagnóstico confirmado no código/banco
- **"2 clientes vs 16 usuários vs centenas de eventos"**: `auth.users`=6, `profiles.is_test`=3, `platform_admins`=1 → **2 clientes reais**. `product_events`=482 linhas com **16 `pseudo_id` distintos**, mas `user_pseudonyms`=6: **10 pseudônimos órfãos** (10 eventos) vindos de backfill. E **469 dos 482 eventos têm `event_source <> 'live'`**. Ou seja: telas que contam "usuários" a partir de `product_events` medem *pseudônimos de eventos*, não clientes.
- **Sem dados recentes**: último `occurred_at` em 25/07 — telas de produto exibem "sem histórico" corretamente, mas sem explicar por quê.
- **Cliente novo some**: métricas ancoradas em eventos/transações não enxergam quem só se cadastrou.
- **Comunicações**: `ComunicacaoProativa.tsx` chama `supabase.rpc` direto (fora de `callAdminRpc`, sem proteção de contrato), mostra "Dados de communication_deliveries" no cabeçalho e nomes técnicos; `communication_deliveries` só possui status `delivered`/`suppressed` (5 suprimidas, motivos `channel_not_ready` e `kind_cooldown_24h`) — o funil tentativa→envio→entrega→leitura→ação só existe em `outbound_messages` (`sent_at`, `delivered_at`, `read_at`).
- **20 templates e 16 itens de catálogo são inalcançáveis pela UI**: não há nenhuma tela que chame `admin_communication_templates`.
- `outbound_messages` expõe `to_phone` e `body` — nunca podem chegar à UI.

### 2. Escopo tela a tela
- **Visão geral**: "Atenção necessária" (via `IncidentGroup`), Pulso do negócio com **no máximo 4 KPIs** (clientes ativos, novos clientes, clientes usando na semana, custo do Nino), faixa operacional compacta e Movimentos vs. baseline. Saudáveis recolhidos. Todo alerta com ação real.
- **Clientes**: lista (nome, estágio, última atividade, WhatsApp, risco, ação), busca e filtros; **ficha** com Resumo, Jornada, Situação financeira, Interações com o Nino, Comunicações e Erros/intervenções.
- **Produto**: Jornada (cadastro → onboarding → 1º dado financeiro → 1º valor do Nino → retorno W1/W4) e Experiências (alcance, adoção, conclusão, recorrência, abandono, valor). Receita **oculta** até haver integração confiável.
- **Operações**: Central de Incidentes; WhatsApp (Conexão, Entregabilidade, Falhas, Fila); Nino/Documentos (sucesso, correção do usuário, falhas, tempo e custo por sucesso). Tokens, p50/p95 e logs em Detalhes técnicos.
- **Administração**: Configurações como aba própria; Auditoria em tabela compacta com detalhe lateral; break-glass como ação com justificativa.

### 3. Arquivos / RPCs / permissões
Refatorar: `Cockpit.tsx`, `Clientes.tsx`, `Saude.tsx`, `operacao/WhatsApp.tsx`, `Assistente.tsx`, `IaOcr.tsx`, `Crescimento.tsx`, `InteligenciaProduto.tsx`, `ComunicacaoProativa.tsx` (passar por `callAdminRpc`), `displayDictionary.ts`, `GovernancaAuditoria.tsx`.
Criar: `ClienteFicha.tsx`, `lib/admin/universe.ts`, `lib/admin/incidents.ts`, `components/admin/AdminChart.tsx`.
Migration: view canônica `v_admin_universe` (clientes, usuários, sessões, eventos, execuções como conceitos distintos) + `admin_v2_client_profile(_pseudo_id)`; `product_events` sempre juntado a `user_pseudonyms` com `event_source` exposto.
Ocultar: Receita; `ProactiveEnginePanel` v1 (duplicado do V2); `IAInteligencia.tsx` se não referenciado.

### 4. Contratos e fórmulas (dicionário canônico)
| KPI | Universo | Fórmula | Fonte | Exclusões |
|---|---|---|---|---|
| Clientes ativos | v_client_universe | contas não excluídas ao fim do período | live | admins, teste |
| Novos clientes | v_client_universe | `created_at` no período | live | admins, teste |
| Começaram a usar | v_client_universe | onboarding + 1ª ação financeira | live | admins, teste |
| Usando na semana | v_client_universe | distintos com ação em 7d | live | eventos de sistema |
| Custo do Nino | agent_runs | soma de custo / 100 | live | simulações |
| Falha de mensagens | outbound_messages | falhas ÷ tentativas | live | fila, suprimidas |
Todos em `America/Sao_Paulo`; `event_source <> 'live'` rotulado como histórico reconstruído; abaixo da amostra mínima o número vira o bloco único **"Ainda aprendendo"**.

### 5. UX/UI e mobile
DM Sans, Phosphor, paleta e gradiente oficiais; raios 18/24/32; mobile-first com abas e listas expansíveis; uma ação primária por tela; resumo antes do diagnóstico; foco visível, rótulos e alvos de toque adequados. Gráficos só na evolução diária e na entregabilidade — linha suave, eixos discretos, poucas séries, período e universo explícitos.

### 6. Critérios de aceite
Visão geral responde "o que precisa da minha atenção hoje?"; nenhum número sem universo declarado; cliente recém-cadastrado aparece em Clientes e em Novos clientes sem nenhum evento; falha secundária nunca apaga dados principais; nenhum termo técnico, UUID, telefone, corpo de mensagem ou segredo na superfície.

### 7. Testes
Contrato de argumentos por RPC; universo (clientes ≠ usuários ≠ pseudônimos de evento); fórmula dos 6 KPIs; permissão rota→ação; estados (carregando/erro/vazio/sem permissão/parcial); responsividade 360/768/1280; regressão da suíte atual (713 testes).

### 8. Migrations / rollout / rollback
Migration idempotente e aditiva (views + 1 RPC de leitura). Flag `admin_experience_v4` para a ficha do cliente. Rollback = desligar a flag; nenhuma coluna removida.

### 9. Riscos / ordem / esforço
Risco: métricas mudarem de valor ao trocar de universo — mitigado por tela de auditoria mostrando o antes/depois. Ordem: universo → contratos → Visão geral → Clientes → Operações → Produto → Administração. Esforço: **G**.

## PACOTE 2 — Capacidades operacionais e inteligência

### 1. Diagnóstico confirmado
Templates existem no banco (20 ativos, 16 tipos) com coluna `version`, **sem tabela de histórico** e **sem UI**. Não existe nenhuma entidade de fluxo. Fila e supressões só são observáveis em `outbound_messages` + `communication_deliveries.reason`.

### 2. Escopo
**Comunicações como workspace**, abas: Visão geral, Fluxos, Templates, Fila e regras. Cabeçalho com status do motor, "Criar fluxo", "Novo template" e 4 KPIs.
- **Visão geral**: alcance, entregues, lidas, ações, opt-out, falhas e custo, com comparação e drill-down; tentativa/envio/entrega/leitura/ação separados.
- **Templates**: reaproveita `admin_communication_templates` e `_upsert`; busca, filtros, editor com validação de variáveis, preview fiel de WhatsApp e app, teste em sandbox, rascunho/publicação, histórico, rollback e auditoria.
- **Fluxos** (linear, sem canvas): Evento → Público → Condições → Mensagem → Canal/Horário → Saída. Casos: onboarding incompleto 24h, inativo 7d, categorização pendente, Divisão do Rolê D-1/D0/D+1/D+3/D+7 com idempotência por estado, resumo semanal, recuperação após erro. Cada fluxo com trigger versionado, exclusões, quiet hours, cooldown, limite de frequência, objetivo, simulação, kill switch e rollback.
- **Fila e regras**: pendentes, falhas, bloqueadas, suprimidas, quiet hours, cooldown, limite semanal, opt-out, kill switch.
- **Ficha operacional**: retry, reprocessamento, reenvio de onboarding, teste controlado — sempre com confirmação, escopo, permissão, idempotência e auditoria.
- **Inteligência**: baseline, anomalias com amostra mínima, coortes, atribuição, W1/W4, valor entregue e custo por sucesso, calculados em camada canônica compartilhada por app e WhatsApp.

### 3. Arquivos / RPCs / migrations
Novos: `pages/admin/comunicacoes/{VisaoGeral,Fluxos,Templates,FilaRegras}.tsx`, `TemplateEditor.tsx`, `WhatsAppPreview.tsx`, `FlowBuilder.tsx`, `lib/admin/communicationContracts.ts`.
Migration: `communication_template_versions`, `communication_flows`, `communication_flow_runs`; RPCs `admin_flow_upsert/toggle/simulate`, `admin_template_publish/rollback`, `admin_queue_list`. Permissões: leitura `messaging.read`; escrita `messaging.write`; reprocesso `messaging.reprocess`.

### 4–12 (resumo)
Aceite: nenhum envio sem template versionado; simulação obrigatória antes de ativar fluxo; toda ação auditada. Testes: contrato de RPC, idempotência de fluxo, quiet hours/cooldown, permissão de escrita, preview e responsividade. Rollout por flag `communications_workspace`; rollback desativa a aba e mantém o motor atual. Riscos: disparo indevido em fluxo mal configurado — mitigado por rascunho padrão, simulação e kill switch. Ordem: templates → fila/regras → visão geral → fluxos → inteligência. Esforço: **G**.

## Mapa atual → proposto
`/admin/cockpit`→`/admin/visao-geral`; `crescimento|receita|ia`→`/admin/produto`; `operacao/*`→`/admin/operacoes?secao=`; `operacao/comunicacao-proativa`→`/admin/comunicacoes`; `governanca/*`→`/admin/administracao?secao=` (todos já redirecionados no HEAD).

## Matriz rota → permissão
visao-geral `cockpit.read`; clientes `clients.read` (+`clients.identity.*`); produto `growth.read`/`product_intel.read`; operacoes `operations.read`/`whatsapp.read`/`agent.read`; comunicacoes `messaging.read` (+`messaging.write`, `messaging.reprocess`); administracao `security.read`/`audit.read`/`settings.*`.

## Não será alterado
Identidade, logo, símbolo, wordmark, paleta e gradiente; app autenticado do cliente; autenticação e sessão; motor do Nino e Edge Functions; pipeline de documentos; Divisão do Rolê e Metas Conjuntas; `client.ts`/`types.ts`.

## Sequência: 2 prompts futuros
1. "Executar Pacote 1"  2. "Executar Pacote 2"

## Dúvida bloqueante (1)
Os 3 perfis marcados como teste devem ser **excluídos de tudo** no admin, ou visíveis atrás de um filtro "incluir contas de teste"?
