# Dívidas com agenda real, desafios que contam e Nino mais inteligente

Correção de quatro problemas comprovados por leitura do banco e do código: dívida em atraso invisível, tela de dívida sem parcelas, desafio de registro diário que nunca conta, e insights pouco relevantes (sem futuro, sem emoções, sem dívida em atraso, sem WhatsApp).

## O que está errado hoje (verificado)

- **Banco Pan (vence dia 10, 18/35 pagas) não aparece em atraso.** No banco, as três dívidas têm `first_due_date` e `start_date` nulos — só `due_day`. O motor `debt_status.v1` (`anchorFor`) devolve `null` sem `start_date` e classifica a dívida como `indefinido`, sem badge de atraso. O detector SQL `nino_diag_detect_debt_alerts` usa `created_at` como âncora e soma as 18 parcelas já pagas por cima dela, jogando o "próximo vencimento" 18 meses para o futuro — resultado: zero ciclos vencidos, nenhum alerta.
- **Nenhum pagamento registrado.** `debt_payments` está vazio; o progresso vem só de `installments_paid` declarado no cadastro.
- **Desafio "Registrar gastos por 7 dias" preso em 0.** `challenge_progress_add` só é chamado para `aportar-meta` (contribuição de meta), `checkin-emocional` e `antes-de-gastar`. Não existe nenhum produtor de progresso para o desafio `spending_log`.
- **Insights sem relevância editorial.** Os itens ativos hoje são dominados por qualidade de dado ("12 lançamentos sem categoria", "10 possíveis duplicidades", repetidos) e variações genéricas. Não existe detector de "emoções não registradas", nem item de dívida em atraso ativo, e nenhum tipo de dívida/emoção está na lista de kinds liberados para WhatsApp (`WHATSAPP_ALLOWED_KINDS`).

## 1. Agenda de parcelas correta (raiz das dívidas)

Contrato único de agenda, usado igual no App, no motor e no detector SQL:

- A âncora passa a ser derivada do que o usuário realmente informou: quando não há `first_due_date`/`start_date`, a **próxima parcela** é o próximo `due_day` a partir de hoje, e as parcelas já pagas (`installments_paid`) são contadas para trás. Ou seja: a parcela nº `paid+1` é a que vence no `due_day` do ciclo corrente — nunca projetada meses à frente.
- Ciclo corrente vencido e sem pagamento registrado → `em_atraso` com dias de atraso reais; ciclo a vencer em até 7 dias → `vence_em_breve`.
- Dívida sem valor de parcela ou sem `due_day` continua `indefinido` (sem alarme falso).
- A mesma regra é reescrita dentro de `nino_diag_detect_debt_alerts`, para o alerta do Nino e a tela nunca discordarem.

## 2. Tela da dívida com parcelas e progresso

Ao abrir uma dívida, o usuário passa a ver a agenda inteira, não só o saldo:

- Lista de parcelas com número, vencimento, valor e situação (paga / vencida / a vencer / próxima), gerada pela agenda canônica e cruzada com `debt_payments`.
- Cabeçalho de progresso: parcelas pagas de total, barra de avanço, valor já amortizado, saldo restante e data prevista de quitação.
- Ação direta em cada parcela pendente: "Registrar pagamento" já preenchido com valor e competência daquela parcela (grava em `debt_payments` com `installments_covered`), com alvo mínimo de toque de 44px.
- Selo de conquista quando um marco é atingido (25%, 50%, 75%, quitada), no tom de gamificação já usado nos desafios.

## 3. Desafios que realmente computam

- Novo produtor de progresso para `spending_log`: ao confirmar um lançamento de despesa (App, WhatsApp e importação), o progresso do desafio avança **no máximo uma vez por dia**, contando dias distintos com registro — não número de lançamentos.
- Backfill idempotente do desafio em andamento, para que os dias já registrados desde a adesão sejam reconhecidos (o desafio atual do usuário sai de 0 para o valor real).
- Revisão dos outros três desafios do catálogo com o mesmo critério de "dia distinto", para nenhum ficar dependente de clique manual em "Concluir".

## 4. Nino mais inteligente e editorial

- **Dívida em atraso vira insight de destaque**, com valor, dias de atraso e ação "Registrar pagamento" apontando para a parcela certa.
- **Novo detector de emoções**: sinaliza quando não há registro emocional em X dias (e reconhece positivamente quando a sequência está em pé), usando `emotional_checkins`.
- **Insights de futuro**: itens de papel temporal `future` passam a explicar consequência ("essa mudança, mantida, libera R$ X até o fim do mês", "quitar essa parcela adianta a quitação em N meses"), consumindo os motores determinísticos já existentes (evolução, recorrências, previsão) em vez de descrever apenas o passado.
- **Relevância**: qualidade de dado deixa de competir com risco/oportunidade — passa a um bloco secundário consolidado (um único item agregado em vez de vários repetidos), e a pontuação privilegia impacto financeiro, urgência de data e acionabilidade.
- **WhatsApp**: dívida em atraso, parcela vencendo, lembrete emocional e conquista de marco entram nos kinds liberados, respeitando opt-in, horário silencioso, cooldown e limite semanal já existentes.

## Notas técnicas

- Agenda canônica em `src/lib/engine/debtStatus.ts` (+ espelho `finance-core` via `scripts/sync-finance-core.mjs`) e reescrita equivalente em migration para `nino_diag_detect_debt_alerts`.
- Detector de emoções e reclassificação de score no core de situação (`nino_refresh_diagnosis`), com `dedup_key` por competência.
- Progresso de desafio via RPC única chamada nos pontos de commit de lançamento (`finance.commitMovement`, ingestão e WhatsApp), com dedupe por dia.
- Testes: dívida sem `start_date` com 18/35 pagas e `due_day` 10 (atraso esperado), dívida em dia, dívida sem parcela, desafio com 7 dias distintos, detector emocional com e sem registro.
- Redeploy das Edge Functions afetadas (`nino-intelligence-tick`, `agent-proactive-tick`, `agent-chat`, `agent-run`, `whatsapp-webhook`, `pulse-compute`). Sem mudança de identidade visual, autenticação ou publicação em produção.
