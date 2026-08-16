# Correção: o Nino interrompeu a conversa propondo um lançamento que ninguém pediu

## O que aconteceu (verificado nos dados reais)

Sequência real do WhatsApp de hoje:

1. 20:19 — você pediu consultoria: "se a partir de setembro eu tivesse mais um gasto fixo de aproximadamente 3 mil reais por mês...".
2. 20:19/20:20 — o Nino respondeu bem (simulação + categorias a reduzir) e terminou com "Quer que eu te ajude a explorar onde cortar?".
3. 20:20 — você respondeu "Quero"; ele respondeu certo de novo, e perguntou "Quer que eu veja seus maiores gastos nessa categoria?".
4. 20:21 — você respondeu "Sim" e recebeu, do nada:

```text
Deixa eu confirmar antes de salvar:
• Despesa: R$ 3,00
• Descrição: setembro eu tivesse mais
• Conta: Banco Itau
• Categoria: eu classifico depois
```

## Causa raiz confirmada

Três defeitos somados, todos no núcleo do agente:

1. **Rota de recuperação de confirmação sem trava de intenção.** Em `AgentCore.ts`, quando o usuário diz "Sim"/"Quero" e não existe rascunho pendente, o sistema varre as últimas 4 mensagens do usuário e tenta transformar cada uma em rascunho de lançamento (`deterministicFallback`). Ela pegou a frase de consultoria e virou despesa. Essa recuperação foi criada para o caso "o LLM alucinou o cartão e não criou o rascunho" — mas hoje ela se aplica a qualquer "Sim", inclusive quando a última pergunta do Nino era analítica.
2. **Falta de guarda de hipótese.** Frases condicionais/simuladas ("se eu tivesse", "se eu quisesse", "a partir de setembro", "aproximadamente", "por mês", "conseguiria pagar?") não são pedido de registro, mas o extrator de spans as trata como lançamento.
3. **Leitura errada de valor por multiplicador.** "3 mil reais" foi lido como R$ 3,00 — o extrator numérico não entende `mil`/`milhão` depois de dígito (só entende por extenso: "três mil").

## Correção proposta

### 1. Recuperação de confirmação só quando o contexto é de lançamento
`AgentCore.ts`: antes de tentar remontar rascunho a partir do histórico, exigir todas as condições:
- a última mensagem do assistente pedia confirmação de lançamento (contém cartão de rascunho: "Deixa eu confirmar", "Pode salvar?", "• *Despesa:*"/"• *Receita:*") **ou** a última mensagem do usuário antes do "Sim" tinha intenção explícita de registro;
- a mensagem candidata tem intenção de registro (verbo de lançamento ou cartão colado), não é pergunta e não é hipótese;
- nunca concatenar mensagens diferentes num texto único (o `join(". ")` atual mistura consultoria com confirmação) — remover esse último recurso.

Se nada disso valer, o "Sim" segue para a rota conversacional/analítica: o Nino continua a conversa anterior (no caso real, mostrar os maiores gastos de Alimentação) em vez de abrir rascunho.

### 2. Guarda determinística de hipótese/consultoria
Novo detector compartilhado (`HypotheticalGuard`) usado por `extract.ts`/`DeterministicFallback.ts` e pelo roteador de capacidade: se o texto for condicional/simulação/pergunta de decisão, é proibido gerar rascunho de lançamento; a rota correta é consultoria (`advisor_consult` / simulação), nunca `create_transaction_draft`.

### 3. Valor com multiplicador
`parseBrAmount`/`extract.ts` passam a entender "3 mil", "3,5 mil", "2 milhões", inclusive com "reais" no meio, e o valor por extenso continua funcionando. Testes cobrindo "3 mil reais" = 3000 e "R$ 3,00" = 3.

### 4. Reforço de prompt (barato e complementar)
`prompt.ts`: regra explícita de que "sim/quero/pode" respondendo a uma pergunta analítica é continuação de análise, jamais gatilho de lançamento; e que valores em frases hipotéticas nunca viram rascunho.

### 5. Cancelamento educado
Quando o rascunho indevido ainda escapar e o usuário disser "Não", manter a mensagem atual de cancelamento (já está correta) e registrar o evento como falso positivo de intenção para observabilidade (`agent_runs.metrics`).

## Testes
- Unitários: guarda de hipótese (8 frases reais), multiplicador de valor, e recuperação de confirmação (deve retornar "sem rascunho" para a sequência real de hoje).
- Reprodução da sequência de hoje ponta a ponta pelo core (consultoria → "Quero" → "Sim") sem nenhum rascunho criado.

## Escopo técnico
Arquivos: `_shared/agent/core/AgentCore.ts`, `_shared/agent/core/DeterministicFallback.ts`, `_shared/agent/core/CapabilityRouter.ts`, `_shared/agent/extract.ts`, `_shared/agent/parser.ts`, novo `_shared/agent/core/HypotheticalGuard.ts`, `_shared/agent/prompt.ts`, testes em `supabase/functions/_shared/agent/`. Deploy de `agent-chat`, `agent-run` e `whatsapp-webhook`. Sem mudança de banco, de UI ou de autenticação.
