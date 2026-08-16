# Nino consultor financeiro — fim do aviso prévio e camada de consultoria real

Dois problemas confirmados no código.

## 1. O aviso "só um instante" ainda aparece — e não deveria

No `whatsapp-webhook`, todo turno considerado analítico agenda uma mensagem extra (`planAcknowledgement` + `sendEphemeralText`). A regra `shouldAcknowledge` classifica como analítico qualquer texto com "simula", "projeç", "média", "quanto eu gastei", valores etc. — exatamente as perguntas de consultoria que você fez por áudio. Resultado: quase toda pergunta boa recebe um "só um instante" antes da resposta, o que dá cara de chatbot.

O que muda:
- O aviso de texto é **desligado** como comportamento padrão. Fica só o "digitando…", renovado enquanto o turno roda (já existe e é o suficiente).
- Único caso remanescente de mensagem prévia: turno **muito** longo, acima de ~25 segundos reais (documento/extrato/áudio grande em processamento), onde o silêncio seria pior que o aviso. Ainda assim, uma única mensagem por turno e sem "só um instante" genérico — texto ligado ao que está sendo lido.
- `Acknowledgement.ts` passa a ser usado apenas nesse caso extremo; `shouldAcknowledge` deixa de disparar por pergunta analítica.

## 2. O Nino responde como assistente, não como consultor

Hoje existem motores certos (`run_before_spending`, `find_savings_opportunities`, `forecast_month_close`, `analyze_cost_structure`, dívidas, metas), mas:
- Perguntas de **redução** só são roteadas quando o texto usa "economizar/escapando/cortar gasto". "Quanto eu conseguiria reduzir em outras categorias" não casa com nenhuma regra do roteador — cai no caminho genérico e vira resposta vaga.
- A simulação de parcela responde o impacto do mês corrente; não entrega a **linha do tempo da parcela** (quantos meses, em quais meses aperta, o que sobra depois de compromissos).
- Não existe formato consultivo: as respostas param no número, sem recomendação nem próxima decisão.

O que vou entregar:

### a) Roteamento de consultoria (determinístico)
Novas intenções reconhecidas em pt-BR e ligadas ao motor certo:
- **Capacidade/afordabilidade**: "consigo pagar", "cabe no meu mês", "vale a pena parcelar", "em quantas vezes" ⇒ simulação com linha do tempo.
- **Redução**: "quanto consigo reduzir", "onde dá pra cortar", "como faço para sobrar mais", "preciso liberar R$ X por mês" ⇒ oportunidades reais por categoria/estabelecimento/recorrência, com valor em R$ por frente.
- **Trade-off**: "se eu cortar X, consigo Y?" ⇒ combina redução + simulação.

### b) Motor de decisão parcelada (novo, determinístico)
Um único módulo que, dado valor, nº de parcelas e meio de pagamento, calcula com dados reais: parcela mensal, meses afetados, folga projetada mês a mês (renda estimada + compromissos + faturas + dívidas já agendadas), quais meses ficam negativos e o valor exato que precisaria ser liberado para caber. Nenhum cálculo no texto do modelo — tudo vem do motor, com período e base declarados.

### c) Resposta em formato de consultor
Padrão fixo para turnos de consultoria, curto e humano:
1. veredito direto (cabe / cabe apertado / não cabe);
2. os dois ou três números que sustentam o veredito, com período;
3. recomendação concreta com valores reais ("cortar R$ 180 em delivery e R$ 90 em assinaturas resolve os dois meses apertados");
4. uma pergunta de decisão ("quer que eu acompanhe esse limite este mês?").

Sem repetir saudação, sem lista genérica, sem número que não venha de motor.

### d) Continuidade da consulta
O turno de consultoria fica na memória curta da conversa: perguntas de acompanhamento ("e se fosse em 12x?", "e se eu cortar delivery?") reaproveitam valor, data e meio já informados, em vez de reabrir a coleta.

### e) Testes e liberação
Testes de regressão: nenhuma mensagem prévia em pergunta analítica; "quanto consigo reduzir" roteia para o motor de economia; parcela em 10x devolve meses apertados corretos; follow-up mantém contexto. Deploy das funções afetadas (`agent-chat`, `agent-run`, `whatsapp-webhook`) e recurso ativo para todos os usuários.

## Notas técnicas
- Arquivos: `whatsapp-webhook/index.ts` e `Conversational.ts` (fim do aviso padrão), `Acknowledgement.ts` (só caso extremo), `CapabilityRouter.ts` (novas intenções), novo `_shared/agent/core/AdvisorConsult.ts` (motor de decisão parcelada + composição de redução), `engineTools.ts`/`tools.ts` (exposição da rota), `prompt.ts` (formato consultivo), `ConversationMemory.ts` (slots da consulta).
- Sem alteração em migrations, ledger, verdade de caixa, autenticação ou backend financeiro. Nada é publicado em produção.

## Entrega
Relatório com IMPLEMENTADO / TESTADO / NÃO IMPLEMENTADO (+motivo) / ARQUIVOS / TESTES.
