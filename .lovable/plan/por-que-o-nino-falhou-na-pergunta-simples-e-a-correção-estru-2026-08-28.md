# Por que o Nino falhou na pergunta simples — e a correção estrutural

Auditei o turno real de hoje (28/08, 10:51) ponta a ponta: mensagem recebida, rota escolhida, chamada de modelo, resposta enviada. A falha tem quatro causas independentes, e nenhuma delas se resolve com regex nova.

## O que aconteceu de fato

```text
10:51:12  você: "Oi nino"                                        -> saudação respondida (rota casual, sem IA)
10:51:43  você: "Quero saber como o mês está indo, de forma detalhada"
10:51:46  Nino: capability=general -> precisou de LLM -> gateway 403 -> path=deterministic_fallback, status=error
10:51:52  Nino: "Estou com uma limitação temporária para analisar isso agora..."
```

### Causa 1 — a pergunta não foi reconhecida como leitura do mês (P0)
O roteador determinístico reconhece intenção por **lista enumerada de frases**. Ele cobre "como foi o mês", "como está o mês", "relatório do mês", mas não cobre **"como o mês está indo"**. Sem correspondência, o turno caiu em `general`, que exige modelo — para uma pergunta que os motores canônicos respondem sozinhos, sem IA.

Classe do problema: **intenção por enumeração**, não por compreensão. Cada frase nova que o usuário inventa é um buraco novo.

### Causa 2 — a inteligência estava bloqueada por crédito, e o Nino ficou muda em vez de determinístico
O gateway devolveu **403 por limite de crédito do workspace** (bloqueio administrativo, não falha transitória). Existe circuit breaker, mas ele não é consultado **antes** de escolher a rota: o turno tenta o modelo, toma 403 e cai num texto genérico de indisponibilidade. Numa pergunta cujos números já estão prontos nos motores, o certo é responder com os motores e só omitir a parte interpretativa.

### Causa 3 — o Nino não lembra do que ele mesmo disse (WhatsApp)
No WhatsApp, só a mensagem **do usuário** é gravada em `conversation_messages`; a resposta do Nino vai para `outbound_messages`. O histórico que alimenta o prompt lê apenas `conversation_messages` — desde 22/08 não há nenhuma fala do assistente lá. Resultado: o Nino conversa lendo só metade do diálogo. É a raiz de soar repetitivo, reapresentar o que já disse e perder o fio quando a continuidade não é capturada por contrato explícito.

### Causa 4 — o crédito foi consumido por trabalho que ninguém recebeu
Nos logs do gateway há chamadas recorrentes de `gemini-2.5-pro` (geração de insights) de ~20 s **canceladas** (499) a cada duas horas: os tokens são cobrados e nada é entregue. Esse gasto silencioso é o que empurrou o workspace para o bloqueio que quebrou seu turno.

### Sobre "não responde como humano"
As respostas determinísticas hoje saem em formato de relatório: "Seu recorte atual está melhor que o período comparado. • Avanço: Gasto abaixo do período comparado…". Já existe a camada de fala do Nino (voz, tradução de jargão, hierarquia de leitura), mas ela **não é aplicada às narrativas que vêm dos motores** — só ao texto do modelo. Por isso a resposta é correta e soa como planilha.

## O que será construído

### 1. Reconhecimento de intenção por significado, não por frase
Um classificador determinístico de intenção: **verbo/ação + objeto financeiro + recorte de período + escopo**, resolvido em cima do catálogo de capacidades existente, com desempate por similaridade contra exemplos canônicos de cada capacidade. As listas atuais viram atalho rápido, não a única porta. Meta explícita: perguntas de leitura ("como o mês está indo", "e as minhas contas?", "tô indo bem?", "me explica meu mês") resolvem em rota determinística, com zero chamada de modelo.
`capability=general` passa a ser tratado como **defeito medido**: cada ocorrência grava a frase normalizada e entra num painel de cobertura de intenção, com teste que trava regressão de cobertura.

### 2. Modo determinístico honesto quando a IA está bloqueada
Antes de rotear, o turno consulta o circuito. Bloqueado:
- perguntas com resposta canônica são respondidas pelos motores, em linguagem humana, sem o verniz interpretativo do modelo;
- só quando a pergunta realmente exige modelo o usuário recebe o aviso de indisponibilidade — e o aviso diz o que ele **pode** fazer agora;
- nunca mais um turno com `status=error` para uma pergunta que os motores sabiam responder.

### 3. Memória de diálogo completa
A resposta do Nino no WhatsApp passa a ser gravada como turno do assistente na mesma linha de conversa (sem duplicar entrega, sem tocar na fila de envio), e o leitor de histórico passa a reconciliar os turnos já existentes em `outbound_messages` para não perder as últimas semanas. Com isso o prompt recebe diálogo de verdade, e continuidade deixa de depender só do contrato de oferta.

### 4. Camada de fala aplicada a toda resposta
Toda narrativa determinística passa pela voz do Nino antes de sair: conclusão primeiro, uma leitura principal, número depois, jargão traduzido, sem bullets de relatório em resposta curta, convite final único. Vale para app e WhatsApp, com limites por superfície já definidos. Testes de estilo (frases, densidade de números, jargão proibido) rodam sobre as saídas dos motores, não só sobre o texto do modelo.

### 5. Fim do gasto que ninguém recebe
Geração de insights deixa de usar o modelo de raciocínio mais caro por padrão, passa a ter execução única por janela (idempotente) e a **não** ser cobrada duas vezes pelo mesmo trabalho: chamada cancelada não é reexecutada às cegas. Trabalho em segundo plano respeita o circuito de crédito antes de começar.

### 6. Regressões
- "como o mês está indo", "me explica meu mês", "e as minhas contas?", "tô indo bem?" → rota determinística, zero LLM.
- Circuito bloqueado + pergunta canônica → resposta com números, nunca `status=error`.
- Turno do assistente aparece no histórico do turno seguinte.
- Resposta de motor passa nos testes de voz (sem jargão, conclusão antes do número).
- Cobertura de intenção não pode cair.

## Detalhes técnicos
- Novo `IntentResolver.ts` (ação/objeto/período/escopo + similaridade sobre exemplos canônicos) consultado por `CapabilityRouter.ts` antes do fallback `general`.
- `AgentCore.ts`: consulta de `ai_runtime_circuit` antes do planejamento; rota determinística preservada sob bloqueio; telemetria de intenção não resolvida em `agent_runs`.
- `whatsapp-webhook/index.ts` + `ConversationHistory.ts`: gravação do turno do assistente e reconciliação com `outbound_messages`.
- Narrativas de `DeterministicAnswers.ts`/motores passam por `ninoVoice`/`commIntent` antes de responder.
- `insights-generate/index.ts`: modelo padrão mais barato, execução idempotente por janela, respeito ao circuito.
- Preservados: deterministic-first, Evidence Pack, Truth Gate, orçamento de contexto e tiers de modelo. Nenhum número novo nasce aqui — nenhuma verdade financeira paralela.

## Fora de escopo
Landing page, identidade visual, autenticação, schema financeiro. Nada será publicado em produção sem sua autorização.

Observação operacional: enquanto o limite de crédito do workspace continuar bloqueado, as respostas que exigem modelo seguirão indisponíveis — a correção garante que as perguntas de leitura funcionem mesmo assim.
