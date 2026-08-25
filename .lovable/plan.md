# Nino Efficiency V2 — fechamento + correção P0 de contexto e degradação

Rodada única de implementação. Escopo: Agent Core (App + WhatsApp), eficiência de IA, contexto conversacional e sanitização de erro. Nenhuma fórmula financeira é alterada.

## O que a auditoria confirmou agora

- Vazamento de infraestrutura ao usuário existe em 3 pontos reais: `_shared/aiCircuit.ts` (duas mensagens citando "créditos"), `agent/core/ErrorRecovery.ts` (`ai_blocked` diz que "o responsável pelo app precisa reativá-la") e `_shared/messaging/wahaMedia.ts` (áudio: "precisa reativar os créditos"). Foi exatamente uma dessas frases que o usuário recebeu no print.
- Já existe uma camada de expectativa conversacional (`ConversationExpectation.ts`) com os tipos `emotional_checkin`, `entry_slot`, `category_scope`, mas ela é derivada por regex do texto do Nino e **não** guarda o `transaction_id` do lançamento recém-criado. Por isso "Beleza" após o recibo cai no caminho de confirmação genérico e responde "não encontrei nada pendente".
- `pending_confirmations` cobre apenas confirmação de rascunho (executar/cancelar), não preenchimento de slot pós-registro.
- O webhook do WhatsApp normaliza id/ack, mas não extrai contexto de resposta citada (`quotedMsg` / `context.message_id` / `_data.quotedStanzaID`).

## Entrega

### A. Pending Action Memory (determinística, curta duração)
Novo módulo `PendingAction.ts` no Agent Core, com estado persistido em `agent_sessions.state.pending_action` (curta duração, TTL de 30 min, nunca em memória permanente):

```text
pending_action = {
  type: "complete_transaction",
  transaction_id, awaiting: "category" | "amount" | "date" | "account" | "confirmation",
  merchant, amount, created_at, expires_at, source_message_id
}
```

- Gravado no mesmo ponto onde o recibo do lançamento é emitido, quando a categoria sai indefinida/inferida.
- Consumido **antes** do roteamento normal: se há `pending_action` fresca com `awaiting: "category"`, a próxima mensagem curta é lida como nome de categoria (`"Beleza"`, `"beleza"`, `"coloca em lazer"`), nunca como acknowledgement.
- Resolve categoria existente (case/acento-insensitive) ou cria conforme a política atual de criação de categoria, vincula à transação por `transaction_id`, confirma: `"Pronto, coloquei essa despesa em Beleza. ✅"`. Zero chamadas de LLM.
- Separação explícita das camadas de memória: working (turno), semantic (fatos estáveis), episodic (correções/histórico), pending action (workflow). Guardas para nunca promover `pending_action` a memória permanente.

### B. Intent determinístico `create_category_and_assign`
Parser determinístico para "Nino crie a categoria beleza e registre", "cria a categoria X", "categoriza como X": extrai nome, encontra/cria categoria, vincula à transação pendente (ou à última despesa sem categoria da conversa), confirma. Sem LLM.

### C. Reply context do WhatsApp como sinal estruturado
Extrair no webhook, de todas as variantes de payload (WAHA e Meta Cloud): `quoted_message_id`, `quoted_body`. Passar por `orchestrator → AgentCore` como:

```text
reply_context = { message_id, semantic_action: "awaiting_category", related_transaction_id }
```

O `semantic_action` e o `related_transaction_id` são resolvidos consultando `outbound_messages` pelo `provider_message_id` citado e o `pending_action`/recibo correspondente. A mensagem citada **não** é despejada no prompt.

### D. UserSafeErrorMapper (P0.4 / P0.6)
Novo módulo `UserSafeError.ts`: classifica em `INTERNAL_ERROR | AI_TEMPORARY_UNAVAILABLE | VALIDATION_ERROR | BUSINESS_RULE_ERROR | NOT_FOUND | PERMISSION_ERROR` e devolve texto neutro. Único caminho autorizado para texto de erro ao usuário; `aiCircuit`, `ErrorRecovery`, `wahaMedia` e o `ResponseValidator` passam a usar. Guarda de saída (denylist: crédito/credits/Lovable/OpenAI/Gemini/gateway/provider/API/402/token) aplicada a toda resposta antes de enfileirar. Detalhe completo continua em `agent_runs`, logs e painel admin.

### E. Degradation mode real
Hierarquia FULL AI → DETERMINISTIC + TEMPLATE → DETERMINISTIC ONLY. Com circuito aberto (402/403/provider down), o turno **não** aborta: roteia para capabilities determinísticas (registro, categorização, saldo, fatura, metas, parcelas, merchant, dia da semana, simulação) e só cai na mensagem neutra quando a resposta exigir de fato LLM.

### F. Fechamento Efficiency V2
- **Context Budget V2**: passar de medir para **aplicar** por camada (system/policy, current turn, working, semantic, episodic, evidence, tool schema, evidence pack), com alvo de 4–5k tokens; nunca truncar a mensagem atual nem evidência financeira crítica.
- **Tool schema telemetry**: medir o schema real enviado pós-progressive-disclosure (`tool_schema_chars`, `tool_schema_estimated_tokens`), não o nome das tools.
- **`document_efficiency_v1`**: a flag passa a controlar de fato `assistant-ingest-document` (ON = text-first + parser determinístico + tier `document_text`, Vision só nas páginas necessárias; OFF = caminho anterior). Sem truncamento silencioso.
- **Read models nas tools analíticas**: performance, categoria, merchant, weekday, tendência e projeção passam a ler `financial_daily_facts`, `financial_daily_category_facts`, `financial_current_snapshots`, `financial_derived_cache` e behavioral facts quando estes já contêm a mesma verdade; ledger bruto permanece onde é necessário. Nenhuma fórmula muda, nenhuma segunda verdade criada.
- **Flags / model routing / paralelismo**: validação ON/OFF das 6 flags, confirmação dos tiers 0–3 + Vision e do fallback, concorrência máxima 3 preservada e writes dependentes fora do paralelismo.
- **Telemetria final**: preenchimento real dos campos de `agent_runs` listados; `provider_cost_usd` fica NULL quando o provedor não informa custo.

### G. Testes (obrigatórios, suíte verde)
Testes A–F do pedido (Beleza direto, Beleza via quoted reply, criar categoria + atribuir, 402 com operação determinística funcionando, 402 com "quanto gastei este mês?", 402 em pergunta consultiva com mensagem neutra e denylist de termos), mais E2E factual/follow-up/analítico/consultivo, paridade App×WhatsApp e documentos. Investigo `nino-home-rotation` e corrijo **somente** se for teste stale — não altero comportamento correto para passar teste.

### H. Deploy e validação
Migration (colunas de telemetria/rota que faltarem), deploy das Edge Functions alteradas (`whatsapp-webhook`, `agent-run`, `assistant-ingest-document` e o que compartilhar `_shared`), execução da suíte, E2E em produção e benchmark contra o baseline (1,46M in / 21,6k out / 68:1 / 4,9s média / 9,1s P95), separado por deterministic / LLM simples / analítico / documentos. Sem percentual inventado se a amostra for insuficiente.

### Fora de escopo
Verdade financeira intocada (receita, despesa, saldo, cartão, fatura, parcelamento, refund, transferência, patrimônio, investimentos, dívidas, metas, data comportamental, projeção). Qualquer problema financeiro encontrado é documentado, não corrigido nesta rodada.

Ao final, entrego a tabela ITEM | STATUS | EVIDÊNCIA com ✅ só onde estiver implementado + ativo + testado.
