
# Nino: por que parou de responder e por que os gastos não entraram

## O que a investigação mostrou (dados reais)

**1. Nenhuma mensagem chegou desde 28/07 15:28**
- Última mensagem recebida (`inbound_messages`): 28/07 15:28. Última resposta enviada: 28/07 15:56.
- Depois disso o webhook só recebeu eventos de **status da sessão** do WhatsApp: 220 registros `event_ignored` (todos `session.status`), com uma rajada entre 22:05 e 22:07 de 28/07.
- Os robôs de envio e os agendamentos continuam rodando normalmente (crons ativos, funções iniciando a cada minuto). Ou seja: **o problema não é o app nem a fila — é a sessão do WhatsApp, que caiu/desconectou** e desde então nenhuma mensagem do usuário é entregue ao Nino.
- Hoje não existe nenhum alerta quando isso acontece: o número simplesmente fica mudo e ninguém é avisado.

**2. Quando as mensagens chegavam, o valor era registrado errado**
Os lançamentos criados pelo atalho `!ja` gravaram valores truncados e descrição suja:

| Mensagem recebida | Registrado |
|---|---|
| Valor R$ 5.40 – Autopass | R$ 5,00 — "esse novo valor Valor .40 Estabelecimento Autopass..." |
| Valor R$ 8.99 – Pão de Açúcar | R$ 8,00 — descrição suja |
| Valor R$ 5.40 (2ª vez) | R$ 5,00 — descrição suja |

Causa raiz (confirmada no código `_shared/agent/extract.ts`):
- Os rótulos só são reconhecidos **com dois-pontos** (`Valor:`). As notificações do banco chegam como `Valor R$ 5.40` (sem `:`), então o caminho confiável é ignorado.
- A regra genérica de valor prefere o formato brasileiro e casa `5` antes de `5.40` — decimal com **ponto** sem milhar não é tratado. O resto (`.40`) sobra e vira descrição.

**3. A fatura do Itaú (27/07) nunca foi registrada**
Em 28/07 o usuário enviou a lista completa da fatura Itaú (competência 2026-07, ~40 lançamentos, total R$ 5.209,73) pedindo registro em 27/07. O agente pediu esclarecimento de conta/cartão duas vezes e a conversa terminou em "Cancela" — **zero lançamentos gravados**.

**4. Ruído de telemetria**
Todo turno `!ja` fica com execução "órfã" marcada como erro (`orphan_sweep:running_over_5min`), porque o caminho FastLog nunca fecha o registro da execução. Isso polui as métricas do admin.

---

# Plano de correção

## A. Sessão do WhatsApp (voltar a responder)
1. Verificar o estado real da sessão e reconectar (novo pareamento/QR pelo painel admin em Operação → WhatsApp).
2. Persistir o estado da sessão: hoje os eventos `session.status` são descartados sem guardar o valor. Passar a gravar o status em `provider_health_events` e expor no admin "Sessão conectada / desconectada desde X".
3. Alerta automático: se não houver nenhuma mensagem recebida e a sessão não estiver `WORKING` por mais de 30 minutos, gerar um aviso no painel admin (e notificação para o dono).

## B. Leitura correta de valor e descrição
1. Aceitar rótulos **sem dois-pontos** (`Valor R$ 5.40`, `Estabelecimento Pão de Açúcar`, `Data 27 de jul...`, `Conta corrente`).
2. Corrigir a regra de valor para tratar decimal com ponto (`5.40`, `1234.56`) sem quebrar o formato brasileiro (`1.234,56`).
3. Descrição: quando houver rótulo de estabelecimento, usar só ele; nunca deixar sobras como "esse novo valor Valor .40".
4. Testes cobrindo exatamente os formatos reais das notificações Itaú/Autopass/Pão de Açúcar que falharam.

## C. Registro em lote (fatura / lista de lançamentos)
1. Reconhecer quando a mensagem traz **vários lançamentos** (lista ou JSON) e, em vez de perguntar item a item, gerar um resumo único: "42 lançamentos, total R$ 5.209,73, em 27/07 — em qual cartão/conta?" e registrar tudo após um único CONFIRMAR.
2. Itens sem valor não bloqueiam o lote: são separados e listados no fim para o usuário completar.

## D. Telemetria
Fechar a execução do FastLog ao final do turno (sucesso ou erro), eliminando os falsos "erros" no painel.

## E. Registro retroativo do que ficou de fora
1. **Corrigir os 3 lançamentos truncados** (5,00→5,40; 8,00→8,99; 5,00→5,40) e limpar as descrições para o nome do estabelecimento.
2. **Registrar a fatura Itaú de 27/07**: todos os lançamentos da lista enviada, como despesas no cartão Itaú, com data 27/07, descrição e categoria informadas (inclusive o estorno de −1,46 como crédito), com chave de idempotência para não duplicar caso o usuário reenvie.
3. Ao final, o Nino envia uma mensagem de recibo com o total registrado.

## Detalhes técnicos
- Arquivos: `supabase/functions/_shared/agent/extract.ts` (rótulos + valor), `_shared/agent/core/FastLog.ts` (fechamento de run, descrição), `_shared/agent/core/AgentCore.ts` + `tools.ts` (lote), `whatsapp-webhook/index.ts` (persistir `session.status`), painel `src/pages/admin/operacao/WhatsApp.tsx`.
- Backfill via ferramenta de dados (UPDATE dos 3 registros + INSERT da fatura), sem migration de schema.
- Reconexão da sessão do WhatsApp exige uma ação sua no painel (leitura do QR) — o resto é automático.

## Ponto que preciso confirmar antes do backfill
A fatura Itaú deve ser lançada como **uma despesa por item na data 27/07** (recomendado, mantém categorias e o total de R$ 5.209,73), ou você prefere um único lançamento consolidado de fatura? Se não responder, sigo com uma despesa por item.
