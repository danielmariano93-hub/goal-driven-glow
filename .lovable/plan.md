# Meu Nino Control Center — Plano fechado de correção (Plan Mode)

Status: `AGUARDANDO_AUTORIZACAO_EXECUCAO`
Escopo: correção funcional, semântica, visual e de segurança das páginas admin já em produção interna, elevando‑as ao padrão de produto operacional premium. **Nenhum arquivo funcional, migration, RPC, policy, grant, componente, rota ou configuração foi alterado nesta etapa.**

---

## 1. Diagnóstico executivo

O Control Center v2 subiu com três classes de defeito acumuladas:

1. **Ruptura de vocabulário de permissões** entre `platform_permissions` (banco), RPCs `admin_v2_*` (verificação server‑side) e `AdminLayout.tsx` (menu). Três RPCs pedem ações que não existem na tabela (`ops.read`, `whatsapp.read`) e o menu decide visibilidade com base em uma matriz local desatualizada. Resultado: páginas que **abrem** no menu **falham no RPC** com `42501 permission_denied` — exatamente o comportamento observado em `/admin/operacao/saude`, `/admin/operacao/ia-ocr` e `/admin/operacao/whatsapp`.
2. **Instrumentação incompleta tratada como métrica final.** Não há eventos `live` em `product_events` (0/466). Receipts `delivered_at`/`read_at` em `outbound_messages` estão vazios (0/99). Coortes semanais estão vazias. As páginas exibem “0%”, “baixa conversão” e “taxa 0” como se fossem afirmações estratégicas, quando o correto é declarar ausência de instrumentação.
3. **Design abaixo do padrão da marca:** tabelas técnicas de 6–7 colunas comprimidas em 390 px, chaves internas (`agent`, `entry`, `split_invite`, `other`) expostas na UI, ícones Lucide misturados a Phosphor, amarelo `#FFC46B` fora da paleta, cards gigantes sobre pouca informação, spinner/erro global derrubando página inteira quando um único RPC falha.

Este plano fecha vocabulário, contratos, fórmulas, estados, componentes reutilizáveis, copy e critérios de aceite antes de qualquer execução.

---

## 2. Causa raiz por página com erro

Evidências coletadas exclusivamente por consultas de leitura (registro em §18).

| Página | Causa raiz (confirmada) | Evidência |
|---|---|---|
| `/admin/operacao/saude` | RPC `admin_v2_operations_health` chama `_require_perm('ops.read')`; a ação **não existe** em `platform_permissions` (existe apenas `operations.read`). Nenhum papel — incluindo `platform_owner` — passa no gate. | `pg_get_functiondef` + `SELECT action FROM platform_permissions WHERE action IN ('ops.read','operations.read')` retorna apenas `operations.read`. |
| `/admin/operacao/ia-ocr` | Idem acima (`ops.read` ausente). | Mesma consulta. |
| `/admin/operacao/whatsapp` | RPC `admin_v2_whatsapp_monitor` chama `_require_perm('whatsapp.read')`; a ação não existe. Existe apenas `whatsapp.critical`. | `SELECT action FROM platform_permissions WHERE action LIKE 'whatsapp.%'` → só `whatsapp.critical`. |
| `/admin/crescimento` | **Causa exata não confirmada.** Permissão `growth.read` existe e é concedida ao owner. Os três RPCs (`admin_v2_growth_summary`, `_cohorts`, `_funnel`) executam ok em nível SQL. O código usa `Promise.all` — uma falha isolada derruba a página inteira e mascara qual chamada falhou. **Ação obrigatória do plano:** primeira tarefa da execução será reproduzir com Playwright autenticado como owner, capturar o erro exato do console e da rede, e só então decidir o patch. Nada será presumido. |
| `/admin/governanca/auditoria` | **Causa exata não confirmada.** `audit.read` existe e é concedida ao owner; RPC retorna `[]` ou 1 registro. Suspeitas plausíveis a validar: import de skeleton ausente, exceção ao renderizar `actor_admin_id: uuid` fora de string, ou permissão gate diferente do menu (`security.read` no menu vs. `audit.read` no RPC — se a sessão for de papel sem `security.read` a rota ainda entra, mas se sem `audit.read` o RPC 42501). **Mesma regra:** capturar erro real antes de propor o patch. |

Sub‑ótimos que carregam mas violam requisito (não são erro de runtime, são erro de produto):

- `/admin/inteligencia-produto`: renderiza “0 iniciados, 3 concluídos, 0% conclusão” como “oportunidade de baixa conversão”. Fonte: `feature_funnel_daily` traz `entry.completed` sem `entry.initiated` (evento `financial_entry_created` mapeia direto para `completed` no backfill).
- `/admin/operacao/mensageria`: interpreta ausência de `delivered_at`/`read_at` como taxa 0%. Fonte: `outbound_messages` — 20 in‑app `delivered`, 78 waha `sent`, 1 waha `dead`, timestamps de recibo zerados.
- `/admin/clientes`: tabela de 6 colunas espremida no mobile; lista atual é pseudonimizada e não permite nenhuma administração real, apesar de owner/admin/support poderem legitimamente ver nome e e‑mail.

---

## 3. Inconsistência de permissões — atual vs canônica

### 3.1 Ações usadas por RPC (confirmadas)
```
admin_v2_cockpit              → cockpit.read           ✅ existe
admin_v2_growth_*             → growth.read            ✅ existe
admin_v2_product_features     → product_intel.read     ✅ existe
admin_v2_product_opportunities→ product_intel.read     ✅ existe
admin_v2_clients_list         → clients.read           ✅ existe (mas sem gradação identity)
admin_v2_revenue_summary      → revenue.read           ✅ existe
admin_v2_operations_health    → ops.read               ❌ AUSENTE (banco tem operations.read)
admin_v2_ia_ocr_metrics       → ops.read               ❌ AUSENTE
admin_v2_messaging_activity   → messaging.read         ✅ existe
admin_v2_whatsapp_monitor     → whatsapp.read          ❌ AUSENTE (banco só tem whatsapp.critical)
admin_v2_assistant_health     → (verificar; provável agent.read) ✅
admin_v2_audit_list           → audit.read             ✅ existe
admin_v2_governance_summary   → governance.read        ✅ existe
```

### 3.2 Ações usadas pelo menu vs pelo RPC
```
Menu (AdminLayout.tsx)        RPC exige                Ação
──────────────────────────────────────────────────────────────
overview.read (Cockpit)       cockpit.read             renomear no menu
overview.read (Crescimento)   growth.read              renomear
product.read                  product_intel.read       renomear
users.read (Clientes)         clients.read             renomear
agent.read (Mensageria)       messaging.read           renomear
security.read (Auditoria)     audit.read               renomear
ops.read (Saúde/IA-OCR)       ops.read (❌ no banco)   ambos → operations.read
whatsapp.read                 whatsapp.read (❌ banco) criar ação no banco
```

### 3.3 Vocabulário canônico final (única fonte de verdade)
```
cockpit.read
growth.read
product_intel.read
clients.read              (existência do cliente + jornada, sem PII)
clients.identity.read     (nome + e-mail completos, auditado)
clients.identity.masked   (nome + e-mail mascarados, sem auditoria)
revenue.read
operations.read           (renomeia ops.read; janela de compat curta)
operations.write
messaging.read
messaging.reprocess
whatsapp.read             (NOVA; leitura de monitoramento sem PII)
whatsapp.critical         (permanece; ações de configuração/reconexão)
agent.read
agent.write
governance.read
audit.read
security.read
security.manage_admins
settings.read
settings.critical
break_glass.open
break_glass.read
```
Ações a **deprecar** após 1 release: `overview.read`, `product.read`, `users.read` (mantidas com `allowed=false` durante transição para não quebrar clientes antigos).

### 3.4 Matriz canônica alvo (todos allowed=true salvo indicação)
```
                         owner  admin  support  analyst
cockpit.read              ✓      ✓      ✓        ✓
growth.read               ✓      ✓      ·        ✓
product_intel.read        ✓      ✓      ·        ✓
clients.read              ✓      ✓      ✓        ·
clients.identity.read     ✓      ✓      ·        ·
clients.identity.masked   ✓      ✓      ✓        ·
revenue.read              ✓      ✓      ·        ·
operations.read           ✓      ✓      ✓        ✓
operations.write          ✓      ✓      ·        ·
messaging.read            ✓      ✓      ✓        ✓
messaging.reprocess       ✓      ✓      ·        ·
whatsapp.read             ✓      ✓      ✓        ✓
whatsapp.critical         ✓      ✓      ·        ·
agent.read                ✓      ✓      ✓        ✓
agent.write               ✓      ✓      ·        ·
governance.read           ✓      ✓      ·        ·
audit.read                ✓      ✓      ·        ✓
security.read             ✓      ✓      ·        ·
security.manage_admins    ✓      ·      ·        ·
settings.read             ✓      ✓      ·        ·
settings.critical         ✓      ·      ·        ·
break_glass.open          ✓      ·      ·        ·
break_glass.read          ✓      ✓      ·        ✓
```

---

## 4. Migrations necessárias (ordem, sem SQL executado)

1. **M1 — permissões canônicas.**
   - Inserir/upsert em `platform_permissions` as ações que faltam: `whatsapp.read`, `clients.identity.read`, `clients.identity.masked`, alinhamento de `operations.read` para todos os papéis previstos.
   - Marcar como `allowed=false` (mantendo linha) as ações depreciadas: `overview.read`, `product.read`, `users.read` — janela de compat de 1 release.
2. **M2 — renomear gates dos RPCs.**
   - `admin_v2_operations_health`, `admin_v2_ia_ocr_metrics` → passar a exigir `operations.read`.
   - `admin_v2_whatsapp_monitor` → continuar exigindo `whatsapp.read` (agora existente).
3. **M3 — hardening de EXECUTE.**
   - `REVOKE EXECUTE ON FUNCTION admin_v2_* FROM PUBLIC, anon;`
   - `GRANT EXECUTE ON FUNCTION admin_v2_* TO authenticated, service_role;`
   - Aplicar a todos os 15 RPCs listados.
4. **M4 — clients (contratos separados).** Criar três RPCs distintos (§5), com gates diferentes; a `admin_v2_clients_list` atual passa a ser somente pseudonimizada.
5. **M5 — auditoria de identidade.** Trigger/handler para gravar `platform_admin_audit` sempre que `admin_v2_clients_identity_read` for chamado (ator, alvo pseudo_id, campos revelados, motivo se aplicável).
6. **M6 — dicionário de eventos válidos por step.** Migration ajustando `feature_funnel_daily` para popular somente combinações válidas (`initiated | completed | value_delivered`), com **backfill idempotente** que não recria `entry.completed` sem `entry.initiated` — na dúvida grava como `value_delivered` conforme contrato definitivo.
7. **M7 — job de recomputo de `product_cohorts_weekly`** já existe; agendar rebuild antes de habilitar a aba coortes.
8. **M8 — telemetria de receipts.** Não altera schema; requer instrumentação em Edge Functions (fora do escopo desta rodada de UI, listada em §13).

Cada migration deve ser reversível e possuir teste RLS/permission antes/depois.

---

## 5. RPCs a alterar/criar — contratos

Todos retornam `jsonb` no envelope canônico (`value, previous, delta_abs, delta_pct, sample_size, sufficient_sample, polarity, formula_version, timezone, measurement_started_at, data_quality, source_kind`) quando aplicável.

### Alterar
- `admin_v2_operations_health(_hours int = 24)` → gate `operations.read`. Retorna `services[]` (job_key, status ∈ {healthy, attention, critical, never_ran}, last_run_at, cadence_seconds, processed, failed, next_expected_at).
- `admin_v2_ia_ocr_metrics(_days int = 30)` → gate `operations.read`. Retorna KPIs de `document_imports` (uploaded, confirmed, partially_confirmed, partial, failed, canceled), taxas com regra de denominador zero, série diária, top causas de falha (quando coluna disponível), backlog atual.
- `admin_v2_whatsapp_monitor(_days int = 7)` → gate `whatsapp.read`. Retorna `session_status`, `last_inbound_at`, `last_outbound_at`, contagens por status, `receipts_available: bool`, série diária, latências quando disponíveis. **Nunca** telefone/conteúdo.
- `admin_v2_messaging_activity(_days int = 30)` → adicionar campos `receipts_available` e `channels[]` (aplicativo/whatsapp/sistema), série diária de tentativas/enviadas/falhas.
- `admin_v2_growth_summary` → adicionar `data_quality` e `source_kind='backfill'` até haver eventos live.
- `admin_v2_growth_funnel` → devolver apenas combinações válidas; incluir `qualified: bool` (min 20 usuários), `instrumentation: complete|partial|proxy`.
- `admin_v2_product_features` → incluir `retention_rate` e `frequency_avg`, marcar `instrumentation`.
- `admin_v2_product_opportunities` → **omitir linhas com `initiated=0`**, marcar `qualified` por amostra (10/20).
- `admin_v2_audit_list(_limit, _cursor, _filters)` → adicionar filtros (período, ação, ator, resultado), retornar nome do ator via join com `profiles` — só se caller tiver `security.read`; senão devolve `actor_label='—'`. Ação em português via mapping server‑side.

### Criar
- `admin_v2_clients_list(_page, _filters)` → gate `clients.read`. Sem PII: pseudo_id, cadastro, última atividade, status ciclo de vida, canal principal, etapa da jornada.
- `admin_v2_clients_identity(_pseudo_id[])` → gate `clients.identity.read`. Retorna `{pseudo_id, display_name, email}` para até N pseudos por chamada. **Grava audit** por chamada.
- `admin_v2_clients_identity_masked(_pseudo_id[])` → gate `clients.identity.masked`. Retorna nome truncado e e‑mail mascarado (`joao.***@gmail.com`).
- `admin_v2_current_menu()` → utilitário que devolve permissões efetivas + versão canônica do menu (chave, label, action, path). Menu passa a ser server‑driven.
- (opcional) `admin_v2_whatsapp_config_status()` gate `whatsapp.critical`.

Todos com `SECURITY DEFINER`, `SET search_path=public`, `_require_perm(...)` no topo, retorno de envelope canônico onde aplicável.

---

## 6. Frontend — arquivos a criar/alterar

### Criar
- `src/lib/admin/displayDictionary.ts` — mapeamento único de chaves técnicas → labels em português (features, superfícies, etapas, status de cliente, jobs, ações de auditoria). Tipado, com fallback seguro `unknown → "Não identificado"`.
- `src/lib/admin/formulas.ts` — funções puras: `rate(n, d)` (retorna `null` se `d=0`), `deltaPct`, `deltaPp`, `qualifySample(n)` retornando `'insufficient'|'signal'|'ok'`, `polarityLabel`.
- `src/components/admin/AdminSectionSkeleton.tsx`
- `src/components/admin/AdminSectionError.tsx` (mensagem humana + botão “Tentar novamente” + disclosure técnico)
- `src/components/admin/AdminNoDataState.tsx` (distingue “sem dados” de “instrumentação ausente”)
- `src/components/admin/AdminDataQualityBadge.tsx` (`live | backfill | proxy | partial`)
- `src/components/admin/AdminMetricTooltip.tsx` (fórmula, período, fonte, amostra, atualização)
- `src/components/admin/AdminResponsiveDataList.tsx` (tabela ≥1024 px, cards <768 px, drawer para detalhe)
- `src/hooks/useAdminSection.ts` — wrapper que dá `{data, loading, error, refetch}` por seção, com **retry individual** e sem `Promise.all`.

### Alterar
- `src/components/admin/AdminLayout.tsx` — **fonte de verdade passa a ser `usePlatformPermissions()`**. Chaves de menu passam a usar as ações canônicas do RPC correspondente. Ícones migrados para Phosphor.
- `src/lib/admin/permissions.ts` — reduzir a tipagem/fallback conservador (`PlatformAction` = union de ações canônicas). Removida qualquer decisão de autorização baseada em matriz local; comentário explicando “apenas tipagem”.
- `src/hooks/usePlatformPermissions.ts` — expor `can(action)`, `loading`, `roleHint`. Sem cache agressivo (`staleTime` curto) para refletir mudanças rápidas.
- `src/lib/admin/adminRpc.ts` — mapear erros `42501` para mensagem humana “Você não tem permissão para esta área.” e distinguir de erro genérico.
- Páginas (reescrever seguindo §§7–12):
  - `src/pages/admin/Cockpit.tsx`
  - `src/pages/admin/Crescimento.tsx`
  - `src/pages/admin/InteligenciaProduto.tsx`
  - `src/pages/admin/Clientes.tsx`
  - `src/pages/admin/Receita.tsx`
  - `src/pages/admin/operacao/Saude.tsx`
  - `src/pages/admin/operacao/Mensageria.tsx`
  - `src/pages/admin/operacao/IaOcr.tsx`
  - `src/pages/admin/operacao/WhatsApp.tsx`
  - `src/pages/admin/operacao/Assistente.tsx`
  - `src/pages/admin/GovernancaSeguranca.tsx`
  - `src/pages/admin/GovernancaAuditoria.tsx`
- `src/index.css` (ou token file admin dedicado) — adicionar tokens Deep Ink, Cloud, Nino Violet, Coral, Mint, cinzas — **sem** amarelo `#FFC46B`. Substituição do amarelo atual em `Crescimento.tsx` (barra “Dormentes”) por cinza + coral leve para “Em risco”.

### Depreciar (mover para `/admin/_legacy/` por 1 release, sem link no menu)
- `src/pages/admin/VisaoGeral.tsx`, `IAInteligencia.tsx`, `Engajamento.tsx`, `Financeiro.tsx`, `Mensagens.tsx`, `Operacao.tsx`, `Produto.tsx`, `Seguranca.tsx`, `Usuarios.tsx` — apenas se ainda existirem sem uso ativo.

---

## 7. Wireframes textuais

Convenção: `[card]` = superfície branca 16–20 px radius; `[chip]` = pill; `→ drawer` = abre detalhe lateral desktop / bottom sheet mobile.

### 7.1 Cockpit
```
Desktop (≥1024 px)                       Mobile (390 px)
────────────────────────────────         ────────────────────
Header: “Cockpit”                        Header compacto
Filtros: 7/30/90d, Atualizado em ...     Filtro único
[KPI][KPI][KPI][KPI]  (4x)               [KPI] (4 empilhados)
[Gráfico WVU 60/40]                      [Gráfico WVU full]
[Atenção]   [Instrumentação]             [Atenção]
[Funil topo] [Coortes resumo]            [Funil topo]
                                          Coortes: “Abra no desktop”
```

### 7.2 Crescimento
```
Header: “Crescimento e retenção”
Filtros: 7/30/90d + personalizado
KPIs: Novos | Ativados | Ativação 7d | WVU | W1 | Em risco   (2x3 mobile)
[Evolução — linha suave, toggle Novos/Ativados/WVU/Em risco]
[Funil de ativação — 4 etapas, com perda absoluta e %]
[Coortes W1/W4/W8 — heatmap desktop; mobile: “Ainda sem histórico”]
[Distribuição de ciclo de vida — barras horizontais com labels PT]
```

### 7.3 Inteligência de Produto
```
Header + filtros 7/30/90d + badge instrumentação
Visão geral: 4 chips (maior alcance, maior repetição, melhor entrega, medição incompleta)
[Ranking de experiências] — cards horizontais com barra de participação
  • “Lançamentos financeiros” · 1 usuário · 264 usos · Instrumentação parcial
  • “Conversas com o Nino” · 1 usuário · 139 usos · ...
[Oportunidades] — só linhas com initiated ≥ 10; senão chip “Base pequena”
  Card: título PT, iniciado→concluído→valor, com barras, sem afirmação forte
  “Ver detalhe” → drawer com funil por usuário e tendência
```

### 7.4 Clientes
```
Desktop:
Filtros: busca (se identity.*), status, cadastro, última atividade, canal
Tabela: [avatar][nome/e-mail][status chip][cadastro][última atividade][canal][etapa][ações]
Ações: “Ver jornada”, “Suspender”, “Reset senha”, “Processar exclusão”

Mobile: card por cliente
  [avatar]  Nome (ou pseudo)
            e-mail (ou —)
  [chip status]  [chip canal]
  Última atividade: há 3 dias
  “Ver detalhes” →
```

### 7.5 Saúde da operação
```
Resumo: [Saudáveis N] [Atenção N] [Críticos N] [Última atualização]
Grid de cards de serviço:
  ┌───────────────────────────────┐
  │ Atualização de métricas       │
  │ ● Saudável                    │
  │ Última execução: há 12 min    │
  │ Cadência: 15 min              │
  │ Processados: 466 · Falhas: 0  │
  │ [Ver diagnóstico]             │
  └───────────────────────────────┘
Assessor: KPIs runs, sucesso, p50, p95 + tabela por superfície (App/WhatsApp)
```

### 7.6 IA & OCR
```
KPIs: Enviados 33 · Confirmados 9 · Parciais 8 (5+3) · Falhas 13 · Cancelados 3
      Taxa confirmação 30% · Taxa falha 43% · Backlog 0
Gráfico diário empilhado (confirmados, parciais, falhas)
Causas de falha (quando disponível) — barras horizontais, sem imagem/OCR
```

### 7.7 Mensageria
```
KPIs: Tentativas · Enviadas · Entregues confirmadas · Lidas confirmadas · Falhas
      Taxa envio · Taxa entrega · Taxa leitura
Aviso amarelo (Coral suave, não amarelo puro):
  “O envio está registrado, mas o provedor ainda não retorna
   confirmações de entrega e leitura. Essas taxas ficarão
   indisponíveis até a instrumentação ser concluída.”
Gráfico diário: Tentativas / Enviadas / Falhas
Breakdown por canal (Aplicativo, WhatsApp, Sistema) + por experiência
```

### 7.8 WhatsApp (monitoramento)
```
Estado da sessão: [chip ativa/desconectada]
Últimos: inbound / outbound (relativo)
KPIs (mesma regra receipts_available)
Gráfico diário + lista resumida por experiência
Ações críticas → separadas em página de Configuração (whatsapp.critical)
```

### 7.9 Governança — Auditoria
```
Filtros: período · ação · ator · resultado
Linha (desktop):
  DD/MM HH:mm · Ação em PT · Ator (nome/e-mail se security.read) · Alvo · Resultado
Mobile: card por evento, drawer “Ver detalhes técnicos” com UUIDs e payload sanitizado
Estado vazio: “A auditoria detalhada começou recentemente. Ainda não há
              ações administrativas suficientes para formar um histórico.”
```

### 7.10 Governança — Segurança
```
Cards: administradores ativos, papéis por administrador
Bloco Break-glass: estado (ativo?), TTL, motivo, escopo; ação “Abrir acesso excepcional”
                   com reautenticação + campo motivo (≥20 chars) + ticket
Histórico das últimas aberturas de break-glass (via audit)
```

---

## 8. Copy e labels finais

Reutilizar §3 do briefing (dicionário obrigatório). Labels centralizadas em `displayDictionary.ts`. Regras:
- Nunca mostrar `agent`, `entry`, `ocr`, `split`, `split_invite`, `other`, `initiated` etc. na tela principal — só em tooltip técnico.
- Estados vazios sempre explicativos, jamais “nenhum resultado”.
- Erro global proibido; usar `AdminSectionError` por bloco.

---

## 9. Fórmulas e regras de exibição

- **Denominador zero** → `—` (nunca `0%`).
- **Amostra insuficiente** (`n<10`) → `Amostra insuficiente`; `10–19` → `Sinal inicial`; `≥20` → cálculo normal.
- **Delta de taxas** em pontos percentuais (`pp`).
- **Ativação 7d** = usuários com primeira entrega canônica de valor em `[cadastro, cadastro+7d]` / usuários elegíveis da coorte.
- **WVU** = usuários únicos com evento de entrega de valor nos últimos 7 dias corridos.
- **W1/W4/W8** sobre coorte de ativados.
- **Funil de experiência**: `iniciado → concluído (após iniciar) → valor entregue (após concluído|iniciado, conforme contrato)`.
- **Ciclo de vida** — precedência excludente: `excluído > novo > ativo > em risco (8–21d) > inativo (22–30d) > abandonou (>30d)`.
- **Receipts indisponíveis**: distinguir `Sem volume` vs `Confirmação indisponível` vs `0 confirmado`.
- **Backfill/proxy**: badge `AdminDataQualityBadge` obrigatório em KPI derivado.

---

## 10. Estratégia de identidade de clientes

- `admin_v2_clients_list` = **jornada + status**, zero PII, gate `clients.read`.
- `admin_v2_clients_identity` = **nome + e-mail completos**, gate `clients.identity.read`. **Auditado** em `platform_admin_audit` (`action='clients.identity.read'`, `target_kind='profile'`, `target_id=pseudo_id`, motivo opcional).
- `admin_v2_clients_identity_masked` = **mascarado**, gate `clients.identity.masked`, sem auditoria.
- **Break-glass NÃO é usado** para leitura básica de identidade (apenas para conteúdo financeiro/conversa, que continua fora do Control Center).
- Nenhum RPC de cliente retorna: saldo, patrimônio, renda, lançamentos, categorias, metas individuais, conversas, telefone (exceto fluxo de suporte autorizado, fora desta rodada).

---

## 11. Receipts indisponíveis (Mensageria/WhatsApp)

- Todo RPC de mensagens/whatsapp devolve `receipts_available: bool` calculado a partir de `count(delivered_at) > 0` na janela.
- Frontend exibe:
  - `receipts_available=false` **e volume>0** → aviso factual + KPIs de entrega/leitura como `—`.
  - `receipts_available=false` **e volume=0** → estado vazio “Sem volume”.
  - `receipts_available=true` → KPIs normais.

---

## 12. Backfill/proxy vs live

- Hoje: 466 eventos, 0 live. Toda página de produto/crescimento mostra `AdminDataQualityBadge` `Histórico reconstruído`.
- Oportunidades e afirmações fortes ficam bloqueadas até `source_kind='live'` ter volume suficiente.
- Envelope canônico já contém `source_kind` e `data_quality` — usar em toda UI.

---

## 13. Instrumentação live futura (fora desta rodada, mas listada)

Emitir `product_events` (`event_source='live'`) nas Edge Functions:
- `assistant-ingest-document`: `ocr_document_uploaded`, `ocr_document_confirmed`, `ocr_document_failed` (novo tipo).
- `agent-chat` / `agent-run`: `agent_response_delivered`, `personalized_response_delivered`, `insight_delivered`, `forecast_delivered`, `goal_progress_explained`.
- `whatsapp-webhook`: `whatsapp_message_delivered`, `whatsapp_message_read` — a partir dos receipts reais do provedor, populando também `outbound_messages.delivered_at`/`read_at`.
- `split-reminders-dispatch`: `split_reminder_prepared`, `split_result_delivered`.
- Frontend/BFF: `financial_entry_created/edited/categorized`, `goal_created/progress_recorded`, `split_created/participant_paid`.

Cada emissão via helper único server‑side, com idempotency_key derivado do domínio (`<event>:<pseudo_id>:<domain_id>:<yyyy-mm-dd>`).

---

## 14. Matriz de testes por papel e rota

| Rota | owner | admin | support | analyst |
|---|---|---|---|---|
| /admin/cockpit | 200 | 200 | 200 | 200 |
| /admin/crescimento | 200 | 200 | 403 menu-oculto | 200 |
| /admin/inteligencia-produto | 200 | 200 | 403 | 200 |
| /admin/clientes (list) | 200 c/ identidade | 200 c/ identidade | 200 c/ mascarado | 403 |
| /admin/clientes/:id identity | 200 auditado | 200 auditado | 200 mascarado | 403 |
| /admin/receita | 200 | 200 | 403 | 403 |
| /admin/operacao/saude | 200 | 200 | 200 | 200 |
| /admin/operacao/ia-ocr | 200 | 200 | 200 | 200 |
| /admin/operacao/mensageria | 200 | 200 | 200 | 200 |
| /admin/operacao/whatsapp | 200 | 200 | 200 | 200 |
| /admin/operacao/assistente | 200 | 200 | 200 (sem ações) | 200 (sem ações) |
| /admin/governanca/seguranca | 200 | 200 | 403 | 403 |
| /admin/governanca/auditoria | 200 | 200 | 403 | 200 |

Testes adicionais:
- Todos RPCs `admin_v2_*` chamados como `anon`/`PUBLIC` → devem falhar (grants revogados).
- Fórmulas: denom zero, sample<10, sample 10–19, delta pp, funil sem `initiated`, receipts=false.
- Privacidade: analyst nunca recebe nome/e‑mail; nenhum RPC retorna saldo/telefone/conteúdo.
- Responsividade: snapshots visuais em 390/768/1024/1440 px.
- A11y: navegação por teclado, foco visível, contraste AA nos novos cards.

---

## 15. Critérios de aceite mensuráveis

1. As 5 páginas com erro carregam para owner sem `permission_denied` e sem crash de render.
2. Menu do `AdminLayout` é 100% derivado de `usePlatformPermissions()`; matriz local não decide autorização.
3. Cada RPC `admin_v2_*` sem `EXECUTE` para `PUBLIC`/`anon`; teste automatizado provando.
4. Nenhuma chave técnica (`agent`, `entry`, `ocr`, `split_invite`, `other`, `initiated`, `value_delivered`) aparece na UI principal — verificado por teste de snapshot.
5. Nenhum KPI mostra `0%` quando `receipts_available=false` ou denominador é zero.
6. Oportunidades não listam feature com `initiated=0`.
7. Tabelas com >4 colunas viram cards no `<768 px` (teste visual em 3 páginas).
8. Skeleton por bloco; falha de um RPC não derruba a página.
9. `platform_admin_audit` recebe registro para toda chamada de `admin_v2_clients_identity`.
10. Build, typecheck e todos os testes existentes verdes + suíte nova de fórmulas verde.
11. Ícones do Control Center 100% Phosphor nas páginas reescritas.
12. Paleta: nenhum uso de `#FFC46B` ou cores fora dos tokens definidos.

---

## 16. Rollback e feature flags

- `admin_v2_menu_source = 'server' | 'local'` (flag em `platform_public_config`): default `server`, permite reverter em incidente para matriz local.
- Ações depreciadas (`overview.read`, `product.read`, `users.read`) mantidas em `platform_permissions` com `allowed=false` por 1 release para não quebrar clientes antigos.
- Migrations M1–M7 reversíveis; script `DOWN` documentado.
- Rotas legadas mantidas como redirect por 1 release (já em `App.tsx`).

---

## 17. Decisões realmente pendentes

1. Confirmar se `support` deve ver **e‑mail completo** no detalhe do cliente após reautenticação (recomendação técnica: **sim**, com auditoria) ou permanecer sempre mascarado.
2. Confirmar retenção de `product_events` (briefing sugere raw 90d; manter?).
3. Confirmar cadências esperadas por job (chumbar em `job_heartbeats.expected_cadence_seconds` ou em config central `src/lib/admin/opsCadence.ts`).
4. Confirmar se filtros de auditoria e a tela de configuração do WhatsApp entram nesta rodada ou em rodada seguinte (recomendação: filtros sim, configuração WhatsApp em rodada dedicada com `whatsapp.critical`).

Sem essas confirmações, adotarei as recomendações marcadas acima ao entrar em Build Mode.

---

## 18. Consultas e comandos somente leitura executados

- `SELECT proname FROM pg_proc WHERE proname LIKE 'admin_v2_%'` → 15 funções.
- `pg_get_functiondef` das 15 funções → coleta de `_require_perm`.
- `SELECT role, action, allowed FROM platform_permissions` → matriz atual.
- `information_schema.routine_privileges` para `admin_v2_*` → todas com `EXECUTE` a `PUBLIC`.
- `SELECT event_source, count(*) FROM product_events` → 79 backfill_proxy, 387 backfill, 0 live.
- `SELECT event_name, count(*) FROM product_events GROUP BY 1` → distribuição por evento.
- `SELECT feature, outcome, count(*) FROM product_events GROUP BY 1,2` → distribuição por feature/outcome.
- `SELECT feature, step, users, events, day FROM feature_funnel_daily` → 19 linhas, `entry.completed` sem `entry.initiated`, `split_invite/split_reminder` só `other`.
- `SELECT provider, status, count(*), sum(delivered_at IS NOT NULL), sum(read_at IS NOT NULL) FROM outbound_messages WHERE created_at > CURRENT_DATE-30` → 99 mensagens, 0 receipts.
- `SELECT status, count(*) FROM document_imports GROUP BY 1` → 33 (9 conf, 13 fail, 5 partial, 3 partially_confirmed, 3 canceled).
- `SELECT job_key, last_ok, last_run_at, next_run_at FROM job_heartbeats` → 5 jobs (1 nunca executado).
- `SELECT action, count(*) FROM platform_admin_audit GROUP BY 1` → 1 bootstrap.
- `SELECT count(*) FROM product_cohorts_weekly` → 0.
- `SELECT min(day), max(day), count(*) FROM product_daily_value` → 21–24/07/2026, 4 linhas.
- Leitura de `\d product_events`, `\d job_heartbeats`, `\d profiles`, `\d feature_funnel_daily`, `\d user_lifecycle_daily`, `\d product_cohorts_weekly`.
- `rg` em `AdminLayout.tsx`, `permissions.ts`, `PlatformAdminRoute.tsx` para mapear ações do menu.

Nenhum comando de escrita foi executado.

---

## 19. Confirmação final

Esta etapa realizou somente inspeção e planejamento em Plan Mode. Nenhum arquivo funcional, migration, tabela, RPC, policy, grant, componente, rota ou configuração foi alterado. Nenhum build, teste mutável, commit, push, deploy ou publicação foi realizado. O arquivo `.lovable/plan.md` foi atualizado exclusivamente para armazenar o plano. A implementação permanece aguardando autorização explícita.
