# Nino EXTREMAMENTE inteligente e autônomo — camada conversacional real

O print mostra três problemas distintos, todos confirmados no código:

1. **Frase quebrada**: "Fui criado pelo para te ajudar". O `ReplyHumanizer` remove qualquer token de fornecedor de IA (`google|openai|gemini|gpt|claude`) sem reparar a frase — "criado pelo Google" virou "criado pelo". O saneamento antivazamento está corrompendo texto legítimo.
2. **Aviso desnecessário**: o webhook do WhatsApp agenda o "Só um instante…" para **toda** mensagem, inclusive "o que você é exatamente?", que não usa nenhum motor financeiro. O aviso só deveria existir quando o turno realmente vai demorar.
3. **Resposta dura e genérica**: não existe rota conversacional. Toda mensagem entra no pipeline financeiro (roteador de capability + contrato analítico + validador de verdade), por isso perguntas corriqueiras saem rígidas, sem identidade e sem naturalidade.

## O que vou entregar

### 1. Rota conversacional determinística (não-financeira)
Novo `core/Conversational.ts`: classificador em pt-BR das intenções que não precisam de dados — identidade ("o que você é", "quem te criou"), capacidades ("o que você faz", "como te uso"), saudação/despedida, agradecimento, cortesia, off-topic e meta-perguntas sobre o produto.

- Quando classificada, o turno responde direto pela camada de conversa: **sem** tools financeiras, **sem** contrato analítico, **sem** validador de números (não há números), latência de um único passo.
- Respostas de identidade e capacidade vêm de um **card canônico de identidade do Nino** (nome, o que faz, canais, limites reais) para acabar com respostas inventadas, sem citar fornecedor de modelo — assim o saneamento não tem o que apagar.
- Off-topic (ex.: "qual a capital da França") é respondido com naturalidade e uma ponte curta de volta ao dinheiro, sem parecer robô e sem prometer o que não faz.

### 2. Persona separada das regras financeiras
`NINO_PERSONA` (tom, calor humano, jeito de falar, humor leve, respostas curtas e naturais) fica em bloco próprio, sempre presente; as ~90 linhas de regras analíticas só entram quando o turno é financeiro. Prompt menor no smalltalk = resposta mais rápida e mais humana; prompt completo no financeiro = mesma verdade de hoje.

### 3. Fim do aviso indevido + latência percebida
- O aviso passa a ser **decidido pelo plano do turno**: intenção conversacional ou rota determinística rápida ⇒ nenhum aviso, apenas "digitando…".
- Para turnos analíticos, mantém-se o `Acknowledgement` calibrado por p75, mas com piso maior e cancelamento imediato quando a resposta chega antes.

### 4. Qualidade textual: nunca entregar frase quebrada
- `ReplyHumanizer` reescrito na parte de saneamento: remoção de nome de fornecedor passa a apagar o **trecho inteiro coerente** ("criado pelo Google", "modelo da OpenAI") e a reparar preposição/artigo órfão; nada de deixar "pelo para".
- Novo guarda final de sanidade textual: detecta preposição órfã, dupla pontuação, bullet vazio e linha truncada; repara determinísticamente e registra a ocorrência em métricas para auditoria.
- Identidade nunca menciona fornecedor, então a regra dura de não vazar nomes internos continua íntegra.

### 5. Autonomia e inteligência de fato
- Modelo do turno de raciocínio atualizado para a geração atual (mais capacidade de conversa e menor latência), mantendo fallback configurável.
- Roteamento com **ponte proativa**: quando a pergunta é conversacional mas há algo relevante e verdadeiro no snapshot do usuário (ex.: fatura fechando, meta em risco), o Nino pode oferecer o próximo passo em **uma** linha — só com número vindo de motor, nunca inventado.
- Ambiguidade real ⇒ uma pergunta curta, nunca um monólogo.

### 6. Testes
Casos de regressão: identidade/capacidade/saudação/off-topic sem tool e sem aviso; "criado pelo" nunca produz frase quebrada; pergunta financeira continua passando pelo contrato e pelo validador; suíte completa verde.

## Notas técnicas

- Arquivos: novo `_shared/agent/core/Conversational.ts`; ajustes em `AgentCore.ts` (curto-circuito conversacional + decisão de aviso), `prompt.ts` (persona separada + identidade canônica), `ReplyHumanizer.ts` (saneamento seguro + guarda de sanidade), `whatsapp-webhook/index.ts` (aviso condicional), `Acknowledgement.ts` (piso/decisão).
- Sem mudança em migrations, motores financeiros, verdade de caixa, ledger ou autenticação. Nenhum cálculo sai dos motores determinísticos.
- Deploy das funções afetadas (`agent-chat`, `agent-run`, `whatsapp-webhook`).

## Entrega
Relatório com IMPLEMENTADO / TESTADO / NÃO IMPLEMENTADO (+motivo) / ARQUIVOS / TESTES.
