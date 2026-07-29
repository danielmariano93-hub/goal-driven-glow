## Causa-raiz confirmada

O "código de registro" (`!ja`) do Lucas está ativo e correto (`user_ai_preferences.fast_log_token = '!ja'`). O que quebrou foi o reconhecimento da conta.

As notificações que ele encaminha terminam com uma linha isolada `Conta corrente` (sem o nome do banco). O extrator já entende essa linha e devolve `payment_method = "account"` com `account_hint = ""` — vazio de propósito, significando "usa a conta única do usuário" (o resolvedor já trata isso: com 1 conta ativa, resolve sozinho; ele tem exatamente uma, "Conta Corrente").

Só que o FastLog rejeita a string vazia antes de chegar no resolvedor:

```
if (!isCard && !accountHint) → "Em qual conta eu registro?"
```

Evidência: nos 4 turnos de 29/07 (11:16, 11:21, 11:31, 11:33) o run entrou em `path = fast_log`, terminou `done` e **não gerou nenhuma tool call** — ou seja, saiu na pergunta antes de criar o rascunho. Nos dias 27 e 28 o mesmo texto caía no caminho antigo (livre) e registrava. O outro usuário não sente o problema porque a notificação dele traz `Conta Corrente Itaú` (hint não-vazio).

Consequência: 4 lançamentos do Lucas nunca foram gravados (nem rascunho pendente sobrou — expiraram).

## Correção

1. **`supabase/functions/_shared/agent/core/FastLog.ts`**
   - Distinguir "sem método de pagamento" de "conta genérica/única": quando `spans.payment_method === "account"`, seguir para o rascunho mesmo com hint vazio, deixando a resolução para `resolveAccountId`.
   - Só perguntar a conta quando o rascunho falhar de verdade (`account_not_found`, ambiguidade com várias contas) — a pergunta passa a listar as contas reais do usuário em vez do exemplo fixo "Nubank, Itaú, Carteira".
   - Mesmo tratamento para cartão (hint vazio já significa "cartão único").

2. **`supabase/functions/_shared/agent/core/DeterministicFallback.ts`** — aplicar a mesma regra (hoje depende de `spans.payment_method` truthy, mas repassa hint vazio de forma inconsistente), para o caminho sem LLM ter o mesmo comportamento.

3. **Caminho LLM** — quando o usuário tem só uma conta ativa, injetar essa informação no contexto do turno para o modelo não perguntar algo já determinado (foi o que aconteceu às 11:21 e 11:22, quando ele respondeu "Carteira"/"Santander", contas que nem existem).

4. **Testes** (`src/test/agent-fast-log.test.ts` + caso novo): mensagem bancária real terminando em `Conta corrente`, com conta única → registra sem perguntar; com 2+ contas e hint genérico → pergunta listando as contas; `Conta Corrente Itaú` → continua resolvendo pelo nome.

5. **Deploy** das funções `whatsapp-webhook`, `agent-run` e `agent-chat` (compartilham o core).

## Reprocesso dos lançamentos perdidos

Registrar os 4 gastos do Lucas na conta "Conta Corrente", com data de ocorrência 29/07, origem `agent`, marcados para não duplicar caso ele reenvie:

| Valor | Estabelecimento |
|---|---|
| R$ 20,00 | Maria Malha Co |
| R$ 7,99 | Mercado Du Bairro |
| R$ 7,50 | Estação do Café |
| R$ 5,40 | Autopass S.A. - ATM Tmob |

Verificação prévia contra duplicidade já feita: nenhum desses valores existe em `transactions` em 29/07 para ele.

## Verificação final

- Replay dos 4 textos originais pelo pipeline (simulador) → esperado: 4 recibos, 0 perguntas.
- Conferir `agent_tool_calls` mostrando `create_transaction_draft` + `confirm_pending_action` ok em cada turno.
- Conferir na Home/Lançamentos que os 4 valores aparecem em 29/07.

Nada será publicado em produção sem sua autorização; o deploy fica restrito às Edge Functions necessárias para o fluxo voltar a funcionar (posso segurar também, se preferir).
