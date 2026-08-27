# Revisão estrutural da inteligência do Nino

Auditoria feita sobre o tráfego real dos últimos 14 dias (WhatsApp + app) e sobre o código do pipeline. As duas falhas relatadas foram reproduzidas e têm causa-raiz confirmada — nenhuma delas se resolve com regex nova.

## O que aconteceu de fato (evidência)

Sequência real de 27/08:

```text
15:33  usuário: "!ja ... Valor R$ 5.40 ... Data 27 de ago. de 2026 ... Conta corrente"   -> FastLog OK
15:38  usuário: "Na categoria transporte ... aumentei ou reduzi?"                        -> resposta correta, terminou com "Quer ver o detalhamento completo?"
15:38  usuário: "Quero ver"                                                              -> "Estou processando ainda... pode me contar de novo?"
15:44  usuário: "Passar relatório do mês"                                                -> CARTÃO DE DESPESA R$ 8,00, descrição "ago"
18:54  usuário: "estou melhorando ou piorando?"                                          -> 2 linhas com um único destaque (R$ 7.632,73)
```

### Causa-raiz 1 — pergunta virou lançamento (P0)
Quando o validador de resposta rejeita a saída do modelo, o núcleo cai no fallback determinístico **concatenando as últimas 4 mensagens do usuário** com a mensagem atual e reextraindo lançamento desse texto colado. Aí não existe mais nenhum gate de intenção: fragmentos de data e de período viram valor e descrição (reproduzido: `"ago 8"` → `R$ 8,00`, descrição `ago`; concatenar a notificação bancária antiga reinjeta valor, conta e estabelecimento de um gasto já registrado). O `HypotheticalGuard` não protege porque o texto colado passa a conter verbo de registro vindo de outra mensagem.

Classe do problema: **texto reconstruído sem procedência**. A intenção do turno é decidida sobre um texto que o usuário nunca escreveu.

### Causa-raiz 2 — "Quero ver" não continuou a conversa
O `ContinuationContract` detectou a oferta ("quer ver o detalhamento"), mas a aceitação é comparada contra uma **lista fechada de 20 respostas exatas** que contém `quero` e `mostra`, e não `quero ver`. Qualquer variação ("pode mandar", "quero sim", "isso mesmo, manda") cai fora e o turno perde o assunto.

Classe do problema: **continuidade por lista, não por contrato**. A oferta guarda o que reexecutar, mas não guarda como reconhecer o aceite.

### Causa-raiz 3 — conclusão global a partir de um destaque
"Estou melhorando ou piorando?" foi para `assess_financial_performance`, que rankeia destaques e devolve o primeiro. A resposta virou um veredito global apoiado em um único sinal, sem renda, caixa, dívida, metas, recorrência nem qualidade do dado — e sem dizer que 37 lançamentos estavam sem categoria.

Classe do problema: **não existe capability de avaliação holística**. Existem 40+ ferramentas de recorte e nenhuma que responda "como eu estou".

### Causa-raiz 4 — fila do WhatsApp com 401
`whatsapp_send_dispatch_tick()` chama `whatsapp-send` só com `x-cron-secret`/`x-internal-secret`, mas essa função está com `verify_jwt = true`: o gateway rejeita antes do código. Toda entrega proativa depende de outro gatilho.

## O que será construído

### 1. Procedência de texto (fecha a causa 1)
Todo texto que chega ao roteador passa a carregar origem: `user_current`, `continuation_restated`, `slot_answer` ou `system_reconstructed`.
- Rascunho de lançamento só pode nascer de `user_current` ou de `slot_answer` cujo slot pendente é de lançamento.
- Fica proibido concatenar mensagens do usuário para reextrair lançamento. O caminho de recuperação de slot passa a usar o slot que faltava, não a colagem de histórico.
- A extração de valor ignora fragmentos de data/período (`27 de ago`, `08/2026`, `ago 8`) e só aceita valor com âncora monetária, rótulo (`Valor:`), verbo de registro ou resposta direta a uma pergunta de valor.

### 2. Contrato de continuidade semântico (fecha a causa 2)
A oferta persistida passa a guardar o que reexecutar **e** como reconhecer o aceite: aceite curto afirmativo, aceite parcial ("só a parte de transporte") e recusa. O reconhecimento passa a ser por normalização + núcleo afirmativo + ausência de assunto novo, com a lista atual servindo apenas de atalho rápido. Aceite reconhecido reexecuta a operação determinística ofertada, sem novo LLM quando o motor já basta.

### 3. Capability `holistic_assessment` (fecha a causa 3)
Nova capability determinística que responde "estou melhorando ou piorando", "como estou", "faz um raio-x". Ela **não cria número novo**: agrega os motores canônicos já existentes (snapshot, performance, projeção de fechamento, dívidas, metas, recorrentes, patrimônio, qualidade do dado) em um veredito com dimensões, cada uma com direção, peso e evidência. Regras:
- veredito só quando há dimensões suficientes; caso contrário diz o que falta;
- cobertura de dado (lançamentos sem categoria, período incompleto) entra como ressalva obrigatória;
- separação explícita entre fato, destaque, interpretação e diagnóstico — a LLM recebe os fatos já fechados e só comunica.

### 4. Hierarquia de roteamento explícita e auditável
Ordem única, declarada em um só lugar e testada: escrita pendente → continuação pendente → resposta de slot → FastLog → capability determinística → capability com escopo de LLM → conversa. Cada turno grava a camada vencedora e o motivo.

### 5. Comunicação humana (nino_comm.v1 aplicado ao assessor)
Conclusão primeiro, número depois, uma leitura principal por resposta, ressalva de qualidade de dado quando existir, convite final único e reconhecível pelo contrato de continuidade.

### 6. Fila do WhatsApp
`whatsapp-send` passa a aceitar a chamada interna (`verify_jwt = false` com validação em código do segredo interno, mesmo padrão já usado em `home-snapshot`), mantendo JWT para chamadas de usuário. Sem número hardcoded, sem alteração de credenciais.

### 7. Testes de regressão
- "Passar relatório do mês", "quanto gastei?", "como foi agosto?" logo depois de uma notificação bancária: nunca gera rascunho.
- "Quero ver", "pode mandar", "quero sim", "manda o detalhamento" após oferta: reexecuta a operação ofertada.
- Meses e datas nunca viram valor.
- Avaliação holística exige mais de uma dimensão e declara cobertura de dado.
- Ordem de roteamento e fila do WhatsApp (dispatch autorizado).

## Detalhes técnicos

- Novos módulos: `TextProvenance.ts`, `HolisticAssessment.ts` (motor) + tool `assess_financial_health`, extensão de `ContinuationContract.ts` com `acceptance_contract`.
- Alterados: `AgentCore.ts` (fallback sem concatenação, ordem de roteamento explícita, telemetria da camada vencedora), `DeterministicFallback.ts` (exige procedência), `extract.ts` (guarda de fragmento de data/período), `CapabilityRouter.ts` + `CapabilityRegistry.ts` + `ToolBudget.ts` (nova capability), `prompt.ts` (fatos fechados, comunicação hierárquica).
- Migration: coluna de procedência/camada em `agent_runs` para auditoria, e correção do dispatcher do WhatsApp.
- Preservado: deterministic-first, Evidence Pack, Truth Gate, orçamento de contexto, tiers de modelo. A nova capability é determinística, então tende a reduzir chamadas de LLM nas perguntas de veredito.
- Nada de nova verdade financeira: o motor holístico apenas compõe saídas canônicas existentes.

## Fora de escopo
Landing page, identidade visual, autenticação e schema financeiro. Nada será publicado em produção sem sua autorização.
