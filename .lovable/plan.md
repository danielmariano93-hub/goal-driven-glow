
# Meu Nino Control Center — Plano de Redesign do Admin

Documento de plano. **Nenhum arquivo foi alterado, nenhuma migration/RPC/edge function foi criada, nenhum build/teste/comando/commit/deploy foi executado.**

---

## 1. Diagnóstico técnico (estado atual)

**Rotas / RPCs mapeados**
- `VisaoGeral.tsx` — chama 4 RPCs (`admin_dashboard_stats`, `admin_engagement_stats`, `admin_agent_stats`, `admin_ops_health`). Somente contagens brutas; sem período, comparação, denominador, polaridade ou fórmula.
- `Engajamento.tsx` — reusa `admin_engagement_stats`. Duplicação confirmada com Cockpit.
- `Usuarios.tsx` + `IAInteligencia.tsx` — ambos usam `admin_users_list`. `IAInteligencia` monta inspetor individual expondo patrimônio, renda estimada, capacidade de poupança, perfil de risco, tags comportamentais, memória, preferências, sugestões e decisões — exposição padrão inaceitável.
- `Mensagens.tsx` + `messageCenter.ts` — campos `preview`, `contact`, e input `search` sobre conteúdo/telefone. Viola minimização.
- `Operacao.tsx` — jobs e erros brutos; sem p50/p95, sem backlog, sem idade de fila, sem taxa de sucesso, sem agrupamento por causa nem timeline de incidentes. RPCs `admin_run_check`, `admin_reprocess_failed`, `admin_ops_health`.
- `Financeiro.tsx` — mistura três domínios (economia da empresa, IA, OCR via `admin_document_metrics`).
- `Produto.tsx` — configuração de flags/desafios; não é inteligência de produto.
- `Seguranca.tsx` — `admin_list_platform_admins`; acesso condicionado a `admin_users_list` para lookup por e-mail.
- `Agente.tsx`, `AgenteSimulador.tsx`, `WhatsApp*.tsx` — telas técnicas soltas em Assistente & Mensageria; corretas em espírito, precisam mudar de agrupamento.
- `permissions.ts` — matriz somente frontend (`platform_owner|platform_admin|support|analyst`). Não confirma RLS/RPC server-side por ação.
- `AdminLayout.tsx` — grupos organizados por arquitetura técnica ("Assistente & Mensageria", "Operação & Sistema"), não por decisão de gestão. Usa `SessionInactivityGuard` (herda 30 min do app; admin deveria ter 20 min próprio).
- `StatCard.tsx` — não suporta delta, sparkline, polaridade, denominador, tooltip de fórmula ou freshness.

**Pontos de exposição de PII confirmados no fluxo padrão**
1. `Mensagens.tsx`: `preview`, `contact`, busca por conteúdo/telefone.
2. `IAInteligencia.tsx`: perfil financeiro individual completo.
3. `Usuarios.tsx`: e-mail visível sem gate de reautenticação/motivo.
4. Ausência de log de acesso a PII (nenhuma tabela do tipo `admin_pii_access_log` visível nas tables listadas).

**Redundâncias / débitos**
- `admin_engagement_stats` chamado em duas rotas.
- Sem camada agregada; toda métrica é `count(*)` em tempo real.
- Frontend faz interpretação de status (`statusMapper.ts`) sem contrato canônico do backend.
- Sem versionamento de fórmula, sem `computed_at`, sem `sample_size`.

---

## 2. Arquitetura final de navegação

Sidebar Deep Ink 232–240 px, agrupada por decisão:

```
Cockpit
Crescimento & Retenção
Inteligência de Produto
Operação
  ├─ Saúde dos serviços
  ├─ Mensageria & Entrega
  ├─ IA & OCR
  ├─ WhatsApp
  └─ Assistente & Simulador
Clientes & Suporte
Receita & Custos
Governança
  ├─ Configurações de produto
  ├─ Segurança & acessos
  └─ Auditoria
```

Redirects temporários (mantidos por 1 release):
- `/admin` → Cockpit (nova `VisaoGeral`)
- `/admin/engajamento` → `/admin/crescimento`
- `/admin/mensagens` → `/admin/operacao/mensageria`
- `/admin/ia` → `/admin/produto` (bloco agregado). Inspetor individual removido do menu.
- `/admin/financeiro` → `/admin/receita` (OCR migra para `/admin/operacao/ia-ocr`)
- `/admin/produto` → `/admin/governanca/configuracoes`
- `/admin/seguranca`, `/admin/configuracoes` → `/admin/governanca/*`
- `/admin/agente`, `/admin/agente/simulador`, `/admin/whatsapp` → `/admin/operacao/*`

---

## 3. Dicionário de métricas

| Métrica | Fórmula | Fonte | Janela | Comparação | Polaridade | Amostra mínima | Regra de exibição |
|---|---|---|---|---|---|---|---|
| WVU (Usuários com valor semanal) | usuários únicos com (entrada significativa ∧ entrega de valor) em janela móvel 7 d | `product_events` | 7 d rolante | período anterior mesma duração | maior = melhor | n≥10 | valor + delta abs + delta % + sparkline 8 períodos + tooltip |
| Taxa de ativação | ativados / cadastros elegíveis (janela 7 d concluída) | `product_events` | coorte diária | período anterior | maior = melhor | denom ≥10 | pp; senão "amostra pequena" |
| Tempo mediano até ativação | mediana de (t_valor − t_signup) em ativados | `product_events` | 30 d | anterior | menor = melhor | n≥10 | horas/dias |
| Retenção W1/W4/W8 | usuários com valor em janelas 7-13/28-34/56-62 pós-ativação / coorte | `product_events` | coorte semanal | coorte anterior | maior = melhor | coorte ≥10 (senão cinza + "amostra insuficiente") | heatmap; sem verde/coral se <10 |
| Sucesso das experiências | sucessos / tentativas (excluir cancelamento voluntário pré-envio) | `product_events` | 30 d | anterior | maior = melhor | n≥10 | pp |
| DAU/WAU/MAU | usuários únicos com evento significativo | `product_events` | 1/7/30 d | anterior | neutro (violet) | MAU≥20 senão "volume insuficiente" | sem cor de sucesso |
| Adoção de feature | concluíram / elegíveis | `product_events` (por feature) | 30 d | anterior | maior = melhor | elegíveis ≥10 | pp |
| Conclusão de feature | concluíram / iniciaram | idem | 30 d | anterior | maior = melhor | iniciaram ≥10 | pp |
| Repetição | repetiram / concluíram (30 d) | idem | 30 d | anterior | maior = melhor | concluíram ≥10 | pp |
| Entrega WhatsApp | delivered / sent | agregados msg | 30 d | anterior | maior = melhor | sent ≥10 | pp |
| p50/p95 latência (WA/agente/OCR) | percentis por evento | agregados | 30 d | anterior | menor = melhor | n≥10 | ms/s |
| Backlog / idade de fila | max(age) e count fila | fila viva | agora | neutro | menor = melhor | — | sempre exibe |
| Custo por sucesso IA | custo atribuível / execuções concluídas | agregados IA | 30 d | anterior | menor = melhor | denom ≥10 | R$ |
| Custo por WVU | custo IA / WVU | agregados | 7 d | anterior | menor = melhor | WVU ≥10 | R$ |
| Receita/despesa/margem | fonte contábil confiável | economia empresa | mensal | mês anterior | maior = melhor | dado real ou "—" | nunca zero falso |

Regras de comparação, polaridade, amostra e anomalia seguem a especificação recebida sem alteração.

**Formato de resposta padrão** (todo RPC de métrica):
`{ value, numerator, denominator, previous, delta_abs, delta_pct_or_pp, sample_size, sufficient_sample, polarity, formula_version, computed_at }`.

---

## 4. Taxonomia de eventos e dados proibidos

**`product_events` (append-only)** — colunas permitidas: `id, occurred_at, pseudonymous_user_id, event_name, channel, feature, status, error_code, latency_ms, model, provider, tokens_in, tokens_out, cost, source, category_slug, attempt_number, app_version, schema_version, bucket_valor?, metadata (allowlisted)`.

**Eventos** — exatamente a lista fechada (user_signed_up … meaningful_session_completed).

**Proibido nesta camada**: conteúdo bruto, descrição livre, Pix, telefone, e-mail, nome, CPF, conta, texto livre, valor individual bruto.

Faixas de valor: apenas buckets `0–50, 50–100, 100–250, 250–500, 500+`.

Contrato: escrita via helper server-side com validação de schema (`schema_version`), rejeitando payloads que contenham chaves fora do allowlist.

---

## 5. Wireframes textuais

**Cockpit — desktop (grid 12 col, fundo Cloud)**
```
[Filtros globais: 7/30/90 · Todos/App/WhatsApp · comparação · atualizado há Xmin]
[KPI WVU][KPI Ativação][KPI Retenção W4][KPI Sucesso]   (linha 1, cada 3 col)
[Gráfico "O que mudou" seletor 4 séries         (8 col)][Feed "Atenção necessária" máx 5 (4 col)]
[Funil de ativação 5 etapas (7 col)][Saúde dos serviços chips (5 col)]
```
Cada KPI: título sentence case, valor 28-32 px, delta com seta e cor por polaridade, comparação explícita ("vs 30 d anteriores"), sparkline 8 pts, meta opcional, ícone info→tooltip com fórmula/denominador/n/computed_at, click → diagnóstico.

**Cockpit — mobile**: filtros compactos, 4 KPIs empilhados, chips de saúde, feed de atenção. Sem gráfico complexo, sem funil detalhado → "Abra no desktop para análise completa".

**Crescimento & Retenção — desktop**
```
[Funil ativação com volume/conversão/perda/tempo] (12 col)
[Heatmap coortes W1/W4/W8 8 col][Linha retenção 4 col]
[App vs WhatsApp comparativo] [Sinais de abandono lista com CTA jornada]
```
**Mobile**: funil resumido + top 3 sinais de abandono.

**Inteligência de Produto — desktop**
```
[Adoção de features tabela com elegível/descobriu/iniciou/concluiu/repetiu + funis]
[Tendências comportamentais (k≥10): heatmap dia×hora, App×WA, intenções, categorias]
[Necessidades não atendidas: distribuição suportado/parcial/não/mal-compreendido/reformulado/abandonado]
[Oportunidades (cards com evidência/n/período/segmento/confiança/experimento/responsável/status)]
```
**Mobile**: apenas oportunidades e adoção resumida.

**Operação · Saúde dos serviços — desktop**
```
[Chips WhatsApp/Agente/OCR/Mensageria/Jobs com regras saudável/atenção/crítico]
[p50/p95 por serviço · backlog · idade máx fila]
[Erros agrupados por error_code: contagem, usuários pseudônimos afetados, 1ª/última ocorrência, tendência, retryable]
[Timeline de incidentes com deploys/config/versão de prompt]
```

**Operação · Mensageria & Entrega**
Tabela padrão: `event_id, pseud_user, direction, channel, type, status, attempts, latency_ms, created_at, error_sanitized`. **Sem** preview, sem busca por conteúdo/telefone. Filtros: status, canal, tipo, error_code, data, ID operacional. Ação "Retry" com permissão e log — não abre conteúdo.

**Operação · IA & OCR, WhatsApp, Assistente/Simulador**: painéis técnicos com p50/p95, sucesso, custo agregado.

**Clientes & Suporte — desktop**
Tabela: `pseud_id, ciclo de vida, ativação+data, último evento significativo, dias com valor 7/30, WhatsApp sim/não, problema técnico recente`. Painel lateral: jornada de eventos, saúde técnica, tickets, ações condicionadas. **Sem** saldo/patrimônio/renda/lançamentos/conversas. Revelação de e-mail: gate por motivo+ticket, auditada.

**Receita & Custos — desktop**
Três blocos separados: A. Economia do negócio (receita/despesa/resultado/MRR/infra/margem — cada um "—" se sem fonte); B. Economia da IA (custo total, custo/sucesso, custo/WVU, por feature/model/provider; tokens como contexto secundário); C. Infraestrutura opcional. OCR **não** aparece aqui.

**Governança**
- Configurações de produto (ex-Produto).
- Segurança & acessos: RBAC, break-glass, sessões admin, revogações. Ações críticas exigem reautenticação ≤5 min.
- Auditoria: log imutável de ações administrativas e acessos break-glass.

---

## 6. Plano de dados, RPCs, agregados e migrations (futuros)

**Tabelas propostas** (apenas planejadas):
- `product_events` (append-only) — colunas do §4. Índices por `(event_name, occurred_at)`, `(pseudonymous_user_id, occurred_at)`, `(feature, occurred_at)`.
- `product_event_daily` (materialized/aggregate): `date, event_name, channel, feature, status, unique_users, events, successes, failures, p50_ms, p95_ms, total_cost, sample_size`.
- `user_lifecycle_daily`: `date, pseud_user, stage (novo/ativado/engajado/em_risco/adormecido/reativado)`.
- `product_activation_cohorts`: coortes por semana e retenção W1/W4/W8.
- `admin_pii_access_log` (imutável): quem, alvo, motivo, ticket, escopo, campos, início, expiração, IP, dispositivo.
- `admin_break_glass_sessions`: escopo/duração ≤15 min.
- `admin_audit_events`: ações críticas.

**RPCs analíticos padrão** (assinatura comum `p_start, p_end, p_compare_start, p_compare_end, p_channel, p_timezone`):
- `admin_metric_wvu`, `admin_metric_activation`, `admin_metric_retention`, `admin_metric_experience_success`, `admin_metric_active_users`
- `admin_feature_funnel(p_feature, …)`, `admin_lifecycle_distribution`
- `admin_ops_health_v2` (p50/p95/backlog/idade fila/error grouping/incidentes)
- `admin_messaging_events` (metadados only), `admin_message_retry` (gate + auditoria)
- `admin_costs_ai`, `admin_costs_business`
- `admin_customer_snapshot(pseud_user)` — sem dados financeiros
- `admin_break_glass_open`, `admin_break_glass_close`, `admin_break_glass_read`
- `admin_opportunities_list`

**Regras**: UTC no storage, timezone `America/Sao_Paulo` na resposta; nenhum select bruto no frontend; toda métrica retorna o envelope canônico.

**Migrations** (sequência futura, uma por fase, com GRANT + RLS + policies por role):
1. `product_events` + índices + GRANT service_role.
2. Materialized views/aggregate tables + jobs de refresh (cron interno).
3. `admin_pii_access_log`, `admin_break_glass_*`, `admin_audit_events`.
4. RPCs por área (métricas → operação → receita).
5. Backfill oportunista dos eventos derivados das tabelas atuais (`transactions`, `goals`, `shared_expenses`, `agent_runs`, `outbound_messages`, `document_imports`) — one-shot, sem PII.

---

## 7. Matriz RBAC e fluxo break-glass

Papéis: `owner, admin, operations, support, product_analyst, finance, security_auditor`.

| Ação | owner | admin | operations | support | product_analyst | finance | security_auditor |
|---|---|---|---|---|---|---|---|
| Cockpit / Crescimento / Produto (agregados) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Operação leitura | ✓ | ✓ | ✓ | ✓ | — | — | ✓ |
| Retry mensagem / rerun job | ✓ | ✓ | ✓ | — | — | — | — |
| WhatsApp connect/disconnect | ✓ (reauth) | ✓ (reauth) | ✓ (reauth) | — | — | — | — |
| Publicar prompt | ✓ (reauth) | ✓ (reauth) | — | — | — | — | — |
| Receita/Custos | ✓ | ✓ | — | — | leitura | ✓ | leitura |
| Cliente snapshot (sem PII) | ✓ | ✓ | ✓ | ✓ | ✓ (pseud) | — | ✓ |
| Revelar e-mail | ✓ (reauth+motivo) | ✓ (reauth+motivo) | — | ✓ (reauth+motivo+ticket) | — | — | ✓ (leitura de log) |
| Break-glass abrir | ✓ | — | — | support-lead (reauth+ticket) | — | — | — |
| Break-glass ler logs | ✓ | ✓ | — | — | — | — | ✓ |
| Governança / roles | ✓ | — | — | — | — | — | leitura |

**Break-glass** (`admin_break_glass_open`): exige owner/support-lead, reautenticação, motivo e ticket obrigatórios, escopo=1 usuário, TTL=15 min, campos limitados, redaction automática de PII/Pix/conta/valor/texto livre, exportação em massa proibida, log imutável (solicitante, alvo, motivo, ticket, campos, início, expiração, IP, device). Banner persistente enquanto sessão está aberta. **Todas as regras aplicadas no servidor via RLS/RPC + revalidadas no client.**

**Sessão admin**: guard próprio — inatividade 20 min, aviso 18 min, sincronização entre abas (BroadcastChannel), revalidação de sessão no retorno. App do usuário permanece com 30 min.

---

## 8. Componentes/arquivos a criar, fundir, remover ou redirecionar

**Criar**
- `src/pages/admin/Cockpit.tsx` (substitui `VisaoGeral.tsx`)
- `src/pages/admin/Crescimento.tsx` (substitui `Engajamento.tsx`)
- `src/pages/admin/ProductIntelligence.tsx`
- `src/pages/admin/operacao/{Saude,Mensageria,IAOcr,WhatsApp,Assistente}.tsx`
- `src/pages/admin/ClientesSuporte.tsx`
- `src/pages/admin/Receita.tsx`
- `src/pages/admin/governanca/{Configuracoes,Seguranca,Auditoria}.tsx`
- `src/components/admin/KpiCard.tsx` (delta, polaridade, sparkline, denominador, tooltip fórmula, freshness, skeleton)
- `src/components/admin/Sparkline.tsx`, `MetricTooltip.tsx`, `AnomalyBadge.tsx`, `IncidentTimeline.tsx`, `ErrorGroupTable.tsx`, `LifecycleChip.tsx`, `BreakGlassBanner.tsx`, `BreakGlassDialog.tsx`
- `src/hooks/useAdminMetric.ts` (envelope canônico + cache 1-5 min por métrica)
- `src/lib/admin/polarity.ts`, `sampleRules.ts`, `anomaly.ts`, `formulas.ts` (versão)
- `src/components/auth/AdminSessionGuard.tsx` (20/18 min)

**Fundir / migrar**
- `StatCard.tsx` → substituído por `KpiCard.tsx` (mantido temporariamente até fim da migração).
- `AdminLayout.tsx` → nova taxonomia de grupos, ícones Phosphor gradualmente, sidebar Deep Ink.
- `permissions.ts` → nova enum `admin_role` e novas actions; espelho de matriz server-side (RLS + funções `has_admin_action`).
- `App.tsx` → novas rotas e redirects temporários.

**Retirar do fluxo comum**
- `IAInteligencia.tsx` como inspetor individual → transformada em página apenas de agregados dentro de `ProductIntelligence`. Perfil individual só via break-glass.
- `Mensagens.tsx` → reduzir a metadados; remover `preview`, `contact`, campo de busca por conteúdo/telefone. `messageCenter.ts` (`ConversationRow.preview`, filtro `search`) deprecados.
- `Usuarios.tsx` e-mail visível → apenas pseud_id + reveal auditado.
- `Financeiro.tsx` → dividida entre `Receita.tsx` (empresa + IA) e `operacao/IAOcr.tsx`.

**Redirects temporários** listados em §2.

---

## 9. Rollout por fases e compatibilidade

- **Fase 0 — Auditoria**: inventariar RPCs, colunas, políticas RLS, permissões efetivas; mapear todas as leituras de PII.
- **Fase 1 — Privacidade emergencial**: remover exposição padrão (`preview`, busca por conteúdo, inspetor individual, e-mail visível), sem depender de novas tabelas. Adicionar `admin_pii_access_log` mínimo.
- **Fase 2 — Instrumentação**: `product_events` + emissores server-side nos pontos existentes; agregados diários; RPCs com envelope canônico.
- **Fase 3 — Cockpit** (KpiCard, gráfico "O que mudou", feed atenção, funil ativação, saúde).
- **Fase 4 — Crescimento/Retenção + Inteligência de Produto**.
- **Fase 5 — Operação v2 + Receita + Governança + Break-glass completo**.

Rotas antigas mantidas com redirects e feature-flag por fase. Sem big-bang. `StatCard` coexiste com `KpiCard` até fase 3 concluída.

---

## 10. Checklist de QA

- **Fórmulas**: cada métrica cobre denom=0 (`—`), numerador=0, amostra <10 (cinza + label), 10-19 ("sinal inicial"), pp para taxas, delta % apenas se anterior>0, "novo" se anterior=0 e atual>0.
- **Timezone**: storage UTC, exibição `America/Sao_Paulo`; teste com virada de dia.
- **Privacidade**: nenhum componente renderiza `preview/contact/email/valor` fora de break-glass; scanner de string por PII em snapshots.
- **RLS**: testes que verificam que role `support` não lê perfil financeiro, `analyst` não roda retry, break-glass expirado não retorna dados.
- **Anomalia**: baseline ≥10 obrigatório; sem alerta abaixo do limiar; severidades 30/50/80.
- **Responsividade**: desktop-first; mobile mostra apenas resumo/alertas/4 KPIs/saúde; heatmap/coortes bloqueadas com mensagem.
- **Acessibilidade**: nunca depender só da cor (ícone + rótulo); contraste AA sobre Cloud; foco visível; navegação por teclado nas tabelas.
- **Performance**: consultas paralelas; cache 1-5 min por métrica; skeletons por card; sem spinner de página inteira; freshness visível.
- **Session guard admin**: 20/18 min, sincronização entre abas, revalidação no retorno.
- **Reautenticação recente ≤5 min** para ações críticas.
- **Audit log** imutável cobre 100% das ações críticas e break-glass.

---

## 11. Riscos, dependências e questões

- **Dependência forte**: fase 2 (instrumentação) é pré-requisito de 3/4. Sem `product_events` populado, KPIs continuam brutos.
- **Backfill**: definir se derivamos eventos históricos das tabelas existentes ou começamos do zero; sem backfill, retenção W4/W8 fica indisponível por 4-8 semanas.
- **Custo IA atribuível**: hoje `agent_runs` tem tokens/cost; para "custo por sucesso" precisamos definir sucesso canônico por intenção — pendente decisão de produto.
- **Break-glass legal**: definir base legal de acesso a dados individuais (LGPD art. 7º/11) e prazo de retenção do log — decisão jurídica.
- **Papéis vs roles atuais**: `platform_owner|platform_admin|support|analyst` → mapa para novos 7 papéis; escolher se `product_analyst` e `finance` são criados agora ou provisoriamente derivados de `analyst`.
- **Migração de ícones**: Phosphor em telas novas; Lucide permanece nas legadas até fase 5 — evitar mistura em tela nova.
- **`admin_engagement_stats` legado**: manter até Cockpit v2 estar 100% verde em produção; depois deprecar.
- **Timezone em RPCs existentes**: alguns retornam datas sem TZ; padronizar em fase 2.
- **Questão aberta**: definir se meta configurável por KPI é global ou por owner — armazenamento e UI dependem disso.

---

## 12. Confirmação

Confirmo explicitamente: **nenhum arquivo foi editado, criado ou removido; nenhuma migration, RPC, view, tabela ou edge function foi criada; nenhum build, teste, comando, migration, commit ou deploy foi executado.** Esta entrega é somente o plano solicitado e aguarda aprovação explícita antes de qualquer implementação.
