# Ticket Alimentação no Nino — produto, design e arquitetura (rascunho para decisão)

Status: proposta. Nada implementado. Escrito em 03/11/2026 a partir do pedido do dono do produto.
Legenda: **[verificado]** = conferido no código/banco hoje; **[inferido]** = dedução; **[não verificado]** = precisa checar antes de construir.

## 1. Problema e objetivo

O dono usa um cartão de benefício (Ticket Alimentação) que o Nino não vê, porque o dinheiro não sai de conta nem de cartão. Quando o saldo acaba no meio do mês, a alimentação passa a sair do bolso e aparece no Nino como "gasto de comida subiu", sem causa.

Objetivo da tela: responder, em 10 segundos, **de onde veio o dinheiro, para onde foi, se fecha o mês, o que fazer para fechar e quando eu gasto mais**.

## 2. Decisão de modelagem (a mais importante)

**Recomendação: contexto separado (tabelas próprias), não lançamentos no livro-razão.**

Por quê:
- O livro-razão tem muitos consumidores (relatórios, diagnóstico, Mapa, snapshot da Home, ferramentas do agente). Hoje só entra em totais mensais o que tem `movement_kind = 'transaction'` [verificado em `isRealMonthlyMovement`]. Os kinds existentes em produção: adjustment, card_payment, debt_payment, external_transfer_in/out, internal_transfer, investment_application/redemption/yield, refund, transaction [verificado].
- Benefício não pode virar renda (inflaria taxa de poupança e a base de renda do diagnóstico) nem caixa livre (não paga aluguel).
- O dono já decidiu excluí-lo das métricas principais; a tela nova respeita isso.
- Tipos de conta hoje: checking, savings, cash, investment, other [verificado]. Não há "carteira restrita". Reusar `other` arrastaria o saldo para onde contas são somadas (Disponível/patrimônio) [não verificado como entra].

Custo da escolha: alimentação total (Ticket + bolso) só existe dentro da tela do Ticket, com uma leitura somente-leitura do livro-razão. Aceitável.

## 3. Modelo de dados (aditivo, reversível)

- `benefit_wallets`: id, user_id, name, kind ('food'), monthly_credit (numeric, opcional), credit_day (int 1–31), carries_over (bool), active, created_at.
- `benefit_entries`: id, wallet_id, user_id, kind ('credit' | 'spend' | 'balance_reading' | 'adjustment'), amount, occurred_on (date), occurred_at_time (opcional), merchant (texto), source ('manual' | 'whatsapp' | 'document'), source_document_id (opcional), created_at. Índice (wallet_id, occurred_on). RLS: só o dono.
- Volume: dezenas de linhas por mês por carteira. Sem retenção necessária; sem job novo.
- Flag por usuário (`benefit_wallet`), piloto só na conta do dono.

## 4. Indicadores (motor puro em `finance-core/benefitWallet.ts`, espelhado nas Edge Functions)

Entrada: carteira + lançamentos + hoje. Saída determinística, sem LLM.

| Indicador | Definição |
|---|---|
| Saldo agora | última leitura de saldo + créditos − gastos lançados depois dela |
| Frescor | dias desde a última leitura (se > 7, o saldo é "estimado") |
| Ritmo diário | gasto médio por dia nos últimos 14 dias (mediana semanal para não distorcer por um dia grande) |
| Ritmo ideal | saldo ÷ dias restantes até o próximo crédito |
| Data de esgotamento | hoje + saldo ÷ ritmo |
| Falta projetada | max(0, ritmo × dias restantes − saldo): o que sai do bolso |
| Dias descobertos | dias entre o esgotamento e o próximo crédito |
| Por dia da semana | gasto total e média por dia, por dia da semana (últimos 8 a 12 semanas) |
| Pico | dia da semana e/ou faixa (fim de semana vs úteis) com maior peso |
| Por estabelecimento | ranking e participação |
| Vazamento | despesa de alimentação no livro-razão depois da data de esgotamento, mês a mês (leitura somente-leitura, mapeamento de categorias de alimentação **[não verificado]**) |
| E se eu gastar R$ X/dia | recalcula esgotamento e falta |

**Limite honesto:** o padrão por dia da semana e por estabelecimento exige **lançamentos individuais**. Só com leituras de saldo, o Nino calcula ritmo médio e data de esgotamento, mas o dia da semana fica fraco (inferência por diferença entre leituras). Isso empurra a leitura do extrato (print/PDF) para cedo no plano.

## 5. Esboço da tela `/app/ticket` (mobile)

```
┌─────────────────────────────────────┐
│ ←  Ticket Alimentação        [ + ]  │
├─────────────────────────────────────┤
│  Saldo agora                        │
│  R$ 312,40        🟡 vai faltar     │
│  lido há 2 dias · estimado hoje     │
│  ▓▓▓▓▓▓▓░░░░░░░  62% do crédito usado│
│                                     │
│  No ritmo atual acaba em 22/11.     │
│  Faltam 8 dias: ~R$ 330 do seu bolso│
├──────────┬───────────┬──────────────┤
│ Ritmo    │ Ideal     │ Cobertura    │
│ R$ 41/dia│ R$ 30/dia │ 15 de 23 dias│
├─────────────────────────────────────┤
│ COMO O MÊS FECHA                    │
│  saldo ao longo do mês              │
│  ╲___ real                          │
│     ╲___╲  ideal ─ ─ ─              │
│  [ E se eu gastar R$ 30/dia? ▢▢▢ ]  │
│  → fecha no dia 30, sobra R$ 4      │
├─────────────────────────────────────┤
│ DE ONDE VEIO                        │
│  Crédito dia 5        + R$ 900,00   │
│  Sobra do mês passado + R$ 12,00    │
├─────────────────────────────────────┤
│ PARA ONDE FOI                       │
│  Mercado Extra   ▓▓▓▓▓▓▓▓  R$ 310   │
│  Restaurante X   ▓▓▓▓▓     R$ 190   │
│  iFood           ▓▓▓       R$ 120   │
├─────────────────────────────────────┤
│ QUANDO EU GASTO                     │
│  seg ▓▓   ter ▓▓▓  qua ▓▓  qui ▓▓▓  │
│  sex ▓▓▓▓▓▓▓▓ ← 31%   sáb ▓▓▓▓  dom ▓│
│  Sexta pesa 31% · fim de semana 2,1x│
├─────────────────────────────────────┤
│ COMO REDUZIR                        │
│  • Sexta: teto de R$ 35 → +R$ 54/mês│
│  • Delivery 4x/sem → 2x: ~R$ 96/mês │
│  • Teto semanal sugerido: R$ 190    │
├─────────────────────────────────────┤
│ QUANDO ACABOU, SAIU DO SEU BOLSO    │
│  set: acabou dia 21 · R$ 240        │
│  out: acabou dia 24 · R$ 180        │
├─────────────────────────────────────┤
│ Lançamentos        [editar] [excluir]│
└─────────────────────────────────────┘
```

Registro rápido (folha inferior), 3 ações: **Saldo agora** (1 campo), **Gastei** (valor + estabelecimento), **Entrou crédito**. Sem categoria obrigatória.

Estados: sem carteira (convite para criar), saldo desatualizado (pergunta pelo saldo), sem lançamentos (só ritmo médio, aviso de que o dia da semana precisa de lançamentos), mês virando (fechamento).

Semáforo: 🟢 cobre até o próximo crédito · 🟡 sobra pouco (< 3 dias de folga) · 🔴 vai faltar.

## 6. Mensagens (WhatsApp/push), todas por modelo fixo, sem LLM

| Mensagem | Gatilho | Limite |
|---|---|---|
| Leitura de saldo | sem leitura há 7 dias | 1 por semana |
| Crédito do mês | dia do crédito | 1 por mês |
| Ritmo | passa de faixa (verde→amarelo→vermelho) | histerese; 1 a cada 5 dias |
| Projeção de falta | esgotamento em ≤ 7 dias do crédito seguinte | 1 por faixa |
| Saldo crítico | saldo < 3 dias de ritmo | 1 por ciclo |
| Resumo semanal | domingo, só se houve lançamentos | 1 por semana |
| Padrão | 1 vez por mês, quando o pico passa de 25% | 1 por mês |
| Fechamento | virada do mês | 1 por mês |

Regras: no máximo 2 mensagens de Ticket por semana; silêncio 21h–8h; passa pelo governador único de atenção; usuário pode silenciar. Perguntas no chat: "quanto tenho no ticket?", "quando acaba?", "que dia da semana gasto mais?", "gastei 45 no mercado com o ticket".

## 7. Arquitetura e mudanças no Nino

| Camada | Mudança | Risco |
|---|---|---|
| Banco | 2 tabelas + RLS + flag; migração aditiva | baixo |
| `finance-core` | `benefitWallet.ts` puro + espelho + teste de paridade + casos de ouro | baixo |
| App | rota `/app/ticket`, folha de registro, item no menu; cálculo no cliente com o mesmo motor (poucos dados, sem função nova) | médio (UI) |
| Home | card opcional "Ticket: R$ X · acaba dia Y" como campo **aditivo** do `home-snapshot` (sem segunda leitura na Home; consulta só se o usuário tem carteira) | médio |
| Agente | ferramentas `benefit_status` e `benefit_register` (escrita com confirmação), mapeadas no adaptador de capacidades; regras no contrato de intenção | médio |
| Entrada por extrato | perfil novo no pipeline de documentos para print/PDF do extrato do Ticket (precisa de amostras reais) | alto até ver o formato **[não verificado]** |
| Proativo | novos sinais no tick horário **já existente** + governador; sem cron novo | médio |
| Livro-razão | só leitura (vazamento); não alterar movement_kind | baixo |
| Custo | por usuário/dia: 0 jobs novos; escrita só ao lançar; sem LLM em caminho recorrente; avaliação só de quem tem carteira ativa | baixo |
| Testes/CI | motor, mensagens, gatilhos e telas entram na lista do gate | baixo |

## 8. Fases

1. **P1** — tabelas, motor, tela, registro manual rápido, ferramentas básicas do agente, flag só do dono.
2. **P2** — extrato por print/PDF (traz os lançamentos individuais: dia da semana e estabelecimento de verdade).
3. **P3** — mensagens proativas e resumo semanal pelo governador.
4. **P4** — card na Home; avaliar conector direto (depende de confirmar se existe conector, ver doc de conexão).

## 9. Perguntas em aberto para o dono

1. O crédito é fixo? Qual valor e dia? O saldo acumula para o mês seguinte?
2. O app do Ticket mostra extrato com data, estabelecimento e valor? Dá para tirar print/baixar PDF?
3. Quais categorias do livro-razão contam como "alimentação" para medir o vazamento?
4. Prefere teto semanal ou diário como meta?
5. Quantas mensagens de Ticket por semana são aceitáveis?
