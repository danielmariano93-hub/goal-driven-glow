
# Revisão completa da experiência — NoControle.ia (app do usuário)

Escopo restrito ao app financeiro autenticado (`/app/*`). Painel `/admin/*` e separação platform_admin permanecem intactos.

## 1. Diagnóstico do estado atual

- **Home (`src/pages/Index.tsx`)**: 4 cards grandes + breakdown + KPIs, empilhados; sem "dica do assistente"; sem CTA WhatsApp; empty states duplicados por card.
- **Copy**: espalhada em ~30 páginas com termos "Aportar", "Aportes", "Recorrências", "Lançamentos", "Cálculo factual do impacto. Sem aprovação ou score.", "Crie sua primeira meta e comece a aportar", etc. Não há fonte central de strings.
- **Aba Mais (`src/pages/MaisMenu.tsx`)**: 13 itens em lista plana única, incluindo WhatsApp e Notificações; ícones multicoloridos sem sistema.
- **WhatsApp**: existe rota `/app/whatsapp`, item na Mais, e link em `MaisMenu` — funciona como módulo, não canal.
- **Divisão do Rolê**: `shared_expense_participants` guarda `name` + `phone_masked`, sem `linked_user_id`, sem convite, sem RLS para participante ver a própria linha. Cobrança não segue o destinatário.
- **Dicas/insights**: inexistentes. Nenhuma tabela, nenhuma edge function.
- **Notificações**: já há sino central (`NotificationBell`) — item duplicado no Mais.

## 2. Fonte central de tom e microcopy

**Novo**: `src/lib/copy/strings.ts` — objeto tipado com todas as strings do app do usuário, agrupadas por página/contexto. Não é i18n completo (single-locale pt-BR), apenas centralização + guardrails de tom.

Substituições aplicadas transversalmente:

| Antes | Depois |
|---|---|
| Aportar em meta / Aportes | Guardar para uma meta / Dinheiro guardado |
| Progresso calculado a partir dos aportes | Você já guardou X% |
| Crie sua primeira meta e comece a aportar | Qual sonho você quer tirar do papel? |
| Recorrências (label UI) | Contas que se repetem |
| Lançamentos (CTA) | Anotar gasto / Adicionar entrada / Movimentações |
| Cálculo factual do impacto. Sem aprovação ou score. | Veja como essa compra pode mexer com o seu mês |
| Aportar | Guardar |

Rota, nome de arquivo e tabelas permanecem (`/app/recorrencias`, `goal_contributions`) — só a UI muda. Tooltips discretos com termos técnicos onde necessário.

Arquivos tocados: `Index.tsx`, `Metas.tsx`, `Recorrencias.tsx`, `Lancamentos.tsx`, `Planejamento.tsx`, `MaisMenu.tsx`, `Emocoes.tsx`, `Desafios.tsx`, `DivisaoDoRole*.tsx`, `Notificacoes.tsx`, `Perfil.tsx`, `Contas.tsx`, `Investimentos.tsx`, `Dividas.tsx`, `Importar.tsx`, `Categorias.tsx`, `Relatorios.tsx`, `BottomTabBar.tsx`, `DesktopSidebar.tsx`, `AppLayout.tsx`.

## 3. Home reestruturada (`src/pages/Index.tsx`)

Nova ordem mobile-first:
1. **Header saudação + patrimônio líquido** (mantém gradiente brand, compactado).
2. **Card "Dica do seu assistente"** (novo componente `AssistantTipCard`) — texto IA, CTA contextual, botões útil/não útil discretos.
3. **Ações rápidas** (3 pílulas): Anotar gasto, Guardar para uma meta, Antes de comprar.
4. **CTA WhatsApp** ("Fale com seu assistente no WhatsApp") — abre `WhatsAppLinkSheet`.
5. **"Para pagar"** (novo): resumo de cobranças recebidas via Divisão do Rolê, quando houver.
6. **Bloco condicional**:
   - Sem dados → **"Comece por aqui"** (máx. 3 passos personalizados: adicionar conta, anotar gasto, criar meta).
   - Com dados → só os 2 cards mais relevantes (heurística: maior variação absoluta no mês) + link "Ver tudo" para submenu.
7. Removido: grid 2x2 de 4 cards fixos vazios.

Componentes novos: `src/components/home/AssistantTipCard.tsx`, `src/components/home/ComecePorAqui.tsx`, `src/components/home/ParaPagarResumo.tsx`, `src/components/home/QuickActions.tsx`, `src/components/whatsapp/WhatsAppLinkSheet.tsx`.

## 4. Dicas IA reais (Lovable AI Gateway)

### Tabela `user_insights`
```
id, user_id, type (habit|alert|celebration|onboarding|opportunity),
title, body, cta_label, cta_route, evidence jsonb,
model, prompt_version, generated_at, expires_at,
status (active|dismissed|expired), feedback (null|useful|not_useful),
created_at
```
- RLS: `user_id = auth.uid()` em SELECT/UPDATE (feedback/dismiss). INSERT/DELETE apenas via service_role (edge function).
- GRANT SELECT, UPDATE ON user_insights TO authenticated; GRANT ALL TO service_role.
- Índice `(user_id, status, expires_at)`.

### Edge function `insights-generate`
- Auth por JWT do usuário.
- Rate limit: máx. 1 geração por 6h por usuário + regenera se `agent_event_since_last >= 3` (transações/aportes/débitos).
- Recolhe agregados server-side (facts.ts server-side já existente): saldo, receita/despesa mês, top categorias, metas, dívidas — sem PII bruta.
- Chama `google/gemini-3.5-flash` via `createLovableAiGatewayProvider` com `Output.object` (schema Zod: type, title, body, cta_label, cta_route, evidence).
- Onboarding (poucos dados): retorna tipo `onboarding` com CTA sugerindo primeira ação; deixa explícito "ainda estou te conhecendo".
- Falha/402/429: fallback editorial fixo em pt-BR curto ("Dica de hoje: registre um gasto para eu te conhecer melhor.") — persistido como `type=onboarding` com `model=fallback`.
- Escreve em `user_insights` com `expires_at = now() + 24h`.

### Cliente
- `useAssistantTip()` (React Query): lê `user_insights` ativo mais recente; se `expires_at < now()` chama edge function.
- Feedback: PATCH direto na row (RLS permite). Feedback alimenta `evidence` da próxima geração via prompt context, sem que o usuário reescreva prompt.

## 5. WhatsApp como canal

- **Remoções**: rota `/app/whatsapp` do menu Mais; item da `BottomTabBar` (se houver); link em `DesktopSidebar`. Rota React continua registrada como deep link/fallback.
- **Componente novo**: `WhatsAppLinkSheet` (bottom sheet Drawer/Dialog responsivo):
  - Não vinculado: explica em 2 linhas finalidade + privacidade + consentimento checkbox; botão "Gerar código e abrir WhatsApp" → chama `whatsapp_generate_link_code` (RPC existente, hash+TTL) → `window.open("https://wa.me/<numero-oficial>?text=VINCULAR%20<code>")`.
  - Vinculado: mostra número mascarado + botão "Abrir conversa" (`wa.me`).
  - Gerenciamento/revogação: link para `Perfil > Conexões`.
- **Perfil**: nova seção "Conexões" com estado de vínculo + botão revogar (usa `whatsapp_revoke_link` existente).
- **Copy**: "assistente" em toda UI; nunca "assessor".
- Estados: loading (spinner no botão), erro (toast pt-BR), sucesso (toast + fechamento), a11y (foco no primeiro elemento, ESC fecha).

## 6. Aba Mais redesenhada (`src/pages/MaisMenu.tsx`)

Nova composição:
- Título "Mais" + subtítulo "Tudo que pode te ajudar".
- **Destaque topo**: grid 2 colunas com cards compactos ilustrados: Divisão do Rolê, Desafios.
- **Seções agrupadas** (headings pequenos, cards compactos em grid 2 col mobile / 3 col desktop):
  - *Organizar meu dinheiro*: Contas, Contas que se repetem, Categorias, Investimentos.
  - *Entender melhor*: Relatórios, Emoções.
  - *Minha conta*: Perfil, Importar dados.
- **Removidos**: WhatsApp, Notificações (sino já cobre; preferências vão para Perfil).
- Ícones em cinza/roxo tokenizado (não multicolorido); espaçamento maior; sem card branco gigante.
- Bottom padding aumentado para não colidir com safe-area do Safari (`pb-[max(7rem,env(safe-area-inset-bottom))]`).

## 7. Divisão do Rolê — Cobranças recebidas

### Migração de schema (reversível)
```
ALTER TABLE shared_expense_participants
  ADD COLUMN linked_user_id uuid REFERENCES auth.users(id),
  ADD COLUMN phone_e164 text,                    -- normalizado, opcional
  ADD COLUMN invite_token_hash text,
  ADD COLUMN invite_expires_at timestamptz,
  ADD COLUMN invite_status text
    DEFAULT 'none' CHECK (invite_status IN ('none','pending','claimed','revoked')),
  ADD COLUMN dispute_status text
    DEFAULT 'none' CHECK (dispute_status IN ('none','reported_paid','disputed'));

CREATE INDEX ON shared_expense_participants (phone_e164) WHERE phone_e164 IS NOT NULL;
CREATE INDEX ON shared_expense_participants (linked_user_id) WHERE linked_user_id IS NOT NULL;
```
`phone_masked` mantido para compatibilidade; novo campo `phone_e164` populado quando criador informa telefone válido.

### RLS refinada
- Criador (dono do `shared_expense`): SELECT/UPDATE/DELETE completos na row (mantém política atual).
- Participante vinculado (`linked_user_id = auth.uid()`): SELECT restrito via VIEW `my_shared_charges` que expõe apenas: `id, shared_expense_id, se.title, se.occurred_at, amount_due, amount_paid, status, dispute_status, criador (display_name), created_at`. Nunca telefone de outros, nunca lista de outros participantes.
- UPDATE do participante: apenas `dispute_status` (report_paid/dispute) via RPC dedicada `split_participant_report(p_participant_id, p_action)` — SECURITY DEFINER com check `linked_user_id = auth.uid()`.

### Match e convite
- RPC `split_create` (já existe com `p_owner_amount`) estendida: aceita array com `{name, phone_e164, amount_due}`.
  - Normaliza phone server-side (função pl/pgsql `normalize_br_phone`).
  - Match imediato: `linked_user_id := (SELECT id FROM auth.users u JOIN whatsapp_links wl ON wl.user_id=u.id WHERE wl.phone_e164 = p_phone AND wl.verified_at IS NOT NULL LIMIT 1)`. **Apenas telefone verificado** — nunca comparar dígitos parciais, nome, email.
  - Sem match e com phone: gera `invite_token` (32 bytes), guarda hash + `expires_at = now() + 30 dias`, `invite_status='pending'`.
- Edge function `split-invites-dispatch` (chamada dentro de `split_create` via trigger AFTER INSERT) envia WhatsApp com deep link `nocontrole://claim/<token>` + web fallback.
- RPC `split_claim_pending()` — chamada após verificação de telefone no onboarding/perfil: encontra participantes `invite_status='pending'` com `phone_e164 = my_verified_phone`, seta `linked_user_id = auth.uid()`, `invite_status='claimed'`, idempotente.
- Trigger `on_whatsapp_verified` chama `split_claim_pending()` automaticamente.

### UI
- **Nova página** `src/pages/CobrancasRecebidas.tsx` em `/app/cobrancas`, item topo em Mais quando houver pendências (ou apenas quando não vazia).
- Home: `ParaPagarResumo` com contagem + total pendente + CTA.
- Ações do participante: "Já paguei" (report), "Contestar" (com motivo curto). Não pode editar valor.
- Criador (em `DivisaoDoRoleDetalhe`): novas colunas mostram status do participante ("Informou pago", "Contestou") + botões "Confirmar recebido", "Corrigir", "Cancelar/perdoar".
- Notificações in-app (via tabela `notifications` existente): "[Nome] incluiu você no rolê [título]. Sua parte é R$ X." — dedup key `split_new:<participant_id>`.
- Nunca duplica em `debts` automaticamente; conversão apenas por ação explícita (botão "Adicionar como dívida").

### Copy
"Cobrança recebida" / "Você foi incluído neste rolê" — nunca "dívida obrigatória".

## 8. Ordem de implementação (rodada única)

1. **Migração DB** (`user_insights` + campos `shared_expense_participants` + RPCs `split_participant_report`, `split_claim_pending`, `normalize_br_phone` server, trigger claim, view `my_shared_charges`).
2. **Regeneração de tipos** Supabase (automática após migração).
3. **Fonte central copy** `src/lib/copy/strings.ts`.
4. **Edge functions**: `insights-generate`, ajuste `split_create` + `split-invites-dispatch`.
5. **Componentes home**: `AssistantTipCard`, `ComecePorAqui`, `QuickActions`, `ParaPagarResumo`, `WhatsAppLinkSheet`.
6. **Home refatorada** consumindo componentes.
7. **Página `CobrancasRecebidas`** + integração `DivisaoDoRoleDetalhe`.
8. **MaisMenu** redesenhado.
9. **Perfil** com seção Conexões (WhatsApp + revogar).
10. **Aplicar copy central** em todas as páginas listadas.
11. **Remover** WhatsApp da nav; manter rota como fallback.
12. **Testes** + typecheck + build.

## 9. Riscos e mitigação

- **Migração `shared_expense_participants`**: colunas nullable, sem NOT NULL, backfill não necessário. Reversível via `DROP COLUMN`.
- **RLS quebrada**: view `my_shared_charges` + policy explícita testada; teste automatizado com 2 usuários confirma isolamento.
- **Custo IA**: cache 24h + throttle por eventos evita chamadas em render; fallback editorial em 402/429.
- **Colisão phone**: match só com `verified_at IS NOT NULL` (whatsapp_links). Duplicidade evitada por `linked_user_id UNIQUE (shared_expense_id, linked_user_id)` parcial onde não nulo.
- **Rota WhatsApp legada**: mantida registrada; qualquer link antigo continua funcionando.
- **Copy**: fonte central importada onde usada; strings não migradas permanecem em pt-BR legado sem quebra.

## 10. Critérios de aceite

- [ ] Home mostra saudação, patrimônio, dica IA real, 3 ações rápidas, CTA WhatsApp, "Para pagar" (se houver), bloco condicional dados-ou-onboarding — sem grid de 4 cards vazios.
- [ ] Nenhuma string listada na tabela §2 aparece na UI do app do usuário.
- [ ] `AssistantTipCard` consome `user_insights` real; feedback grava; fallback exibido em falha.
- [ ] `LOVABLE_API_KEY` não aparece no bundle client (`grep` no build).
- [ ] Aba Mais sem WhatsApp e sem Notificações; 3 seções agrupadas + 2 destaques.
- [ ] `/app/whatsapp` não é acessível pela nav; sheet abre da home; vínculo funciona; revogação em Perfil.
- [ ] Divisão do Rolê: criar com telefone verificado gera `linked_user_id`; participante vê `/app/cobrancas` com sua linha; não vê telefone/valores dos outros; pode "informar pago"/"contestar"; criador confirma.
- [ ] Convite pendente é reivindicado após verificação de telefone (teste automatizado).
- [ ] Cobrança não vira `debts` automaticamente.
- [ ] Notificações in-app dedupadas por `dedup_key`.
- [ ] Testes RLS 2-user passam; typecheck limpo; `bun test` verde; `bun run build` sem erros.
- [ ] Responsivo 390x844 e 430x932 sem colisão com safe-area.
- [ ] Painel `/admin/*` inalterado; testes de permissão continuam verdes.
