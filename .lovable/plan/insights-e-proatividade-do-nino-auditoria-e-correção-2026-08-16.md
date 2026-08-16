# Insights e proatividade do Nino — auditoria e correção

## O que eu verifiquei nos dados reais (não é suposição)

Rodei consultas no banco e li o código dos dois motores. Estado atual:

- O motor de diagnóstico (`nino_diagnosis_runs`) roda de 30 em 30 minutos e está saudável: última execução hoje 17:30, 3.292 execuções, 18 itens ativos com números reais (dívida vencida de R$ 74,54, consumo acima da renda, meta inviável, resgates de investimento sustentando o caixa).
- A comunicação proativa **não usa esse motor**. Ela usa um segundo motor mais fraco (`ProactiveEngineV2` + `InsightsEngine`), que gera outra lista de candidatos.
- Nos últimos 14 dias: 20 entregas e **66 supressões**. Do total de sugestões criadas, `duplicate_expense` responde por 34 — e o usuário **descartou 23 delas**. Mesmo assim o tipo continua sendo gerado.
- A fila de envio é **FIFO** (`order by created_at`), não por importância. Com o limite de 1 comunicação por dia e 3 por semana (valor atual de todos os 6 usuários), quem chega primeiro consome a cota. Resultado: "confira 2 lançamentos iguais" ganha de "sua parcela venceu e não há pagamento registrado".
- Nunca houve uma única entrega de `debt_overdue`, `debt_due_soon` ou `forgotten_bill`, embora esses tipos existam no catálogo e o diagnóstico detecte atraso de dívida.
- Qualidade editorial dos itens ativos hoje: itens contraditórios convivendo ("gastos caíram R$ 5.455" junto de "consumo supera a renda"), o mesmo assunto duplicado (dois itens de "consumo supera a renda", dois de "Sem categoria", dois de "sem categoria" em qualidade de dados), textos genéricos ("Compromisso identificado nos seus dados financeiros") e padrões com impacto irrelevante (R$ 14,23, R$ 9,51) ocupando espaço.
- Existem colunas de eficácia (`acted_at`, `interacted_at`, `false_positive`, `user_feedback`) que **ninguém lê**: nenhum ranking aprende do que o usuário descartou ou usou.

Diagnóstico em uma frase: o Nino já sabe as coisas importantes, mas quem fala com o usuário é o motor errado, na ordem errada, com texto genérico e sem aprender.

## O que vou entregar

### 1. Uma única fonte de verdade para proatividade
A comunicação proativa passa a consumir os itens do diagnóstico canônico (`nino_intelligence_items` / `financial_situations`), que já têm número, período, confiança, impacto em R$ e ação. O motor antigo deixa de criar candidatos próprios de conteúdo financeiro; permanece apenas para lembretes operacionais (check-in emocional, queda de uso).

### 2. Seleção por valor, não por ordem de chegada
Cota diária/semanal passa a ser disputada por um score explícito: severidade x impacto financeiro relativo à renda x urgência (dias até o vencimento) x confiança x acionabilidade. Só o melhor item do dia vai para o WhatsApp; o resto fica no app.

### 3. Fim do ruído
- Duplicidade e "sem categoria" saem da comunicação proativa e passam a ser **tarefas no app** (lista de revisão), nunca mensagem.
- Piso de materialidade: nada é comunicado abaixo de um percentual da renda mensal (ou valor mínimo absoluto), o que elimina padrões de R$ 9 a R$ 14.
- Um assunto por dia: guarda de coerência que impede itens contraditórios ou redundantes ativos ao mesmo tempo (consolidação por tópico lógico, mantendo o de maior impacto).

### 4. Insights que realmente ajudam
Prioridade de comunicação, nesta ordem:
1. dívida/parcela vencida ou vencendo sem pagamento registrado;
2. fatura de cartão que não cabe no caixa projetado até o vencimento;
3. compromisso recorrente chegando sem caixa suficiente;
4. consumo acima da renda operacional no ciclo, com a categoria que explica a diferença;
5. resgate de investimento sustentando o caixa;
6. meta inviável no ritmo atual, com o aporte que a tornaria viável;
7. aceleração de gasto na categoria certa, com valor e comparação de período;
8. conquistas reais (dívida reduzida, meta batida) — reforço positivo, no app.

Cada mensagem passa a responder sempre: o que aconteceu, quanto em R$, em que período, o que fazer agora e qual o efeito de fazer. Textos genéricos como "Compromisso identificado nos seus dados financeiros" são substituídos por nome, valor e data reais do compromisso.

### 5. Aprendizado real
- Descartar duas vezes o mesmo tipo reduz o score daquele tipo para aquele usuário e aplica silêncio prolongado.
- Agir (abrir, classificar, pagar, ajustar meta) aumenta o score do tipo.
- Marcação de "não fez sentido" grava falso positivo e retira o tipo da rotação por um período.

### 6. Medir se está ajudando
Painel administrativo com taxa de entrega, taxa de ação, descarte e falso positivo por tipo de insight, para desligar rapidamente o que não gera valor.

## Detalhes técnicos

- `supabase/functions/_shared/agent/core/CommunicationDispatcherV3.ts`: substituir a seleção FIFO por seleção ranqueada; aplicar piso de materialidade e a guarda de um assunto por dia antes da política de canal.
- Novo `supabase/functions/_shared/intelligence/insightValue.ts`: função pura de score (severidade, impacto/renda, urgência, confiança, acionabilidade, penalidade de histórico) com testes unitários.
- Novo `supabase/functions/_shared/intelligence/diagnosisToCommunication.ts`: converte item do diagnóstico em candidato de comunicação com evidência e ação preservadas.
- `ProactiveEngineV2.ts`: remover geração de `duplicate_expense` e dos detectores redundantes de conteúdo financeiro; manter check-in emocional e sinais de uso.
- Migration: consolidação por `logical_topic_key` com guarda de contradição, piso de materialidade nos detectores de padrão, texto real nos itens de compromisso/parcela, e tabela/colunas de aprendizado por tipo (`kind`) por usuário.
- `communication_catalog`: mover `duplicate_expense`, `categorize_transaction` e qualidade de dados para `app`, com `min_severity_for_whatsapp` alinhado.
- Admin: novo bloco de eficácia por tipo lendo `communication_deliveries`.
- Testes: score, materialidade, coerência, aprendizado e um cenário fim a fim de dívida vencida ganhando da duplicidade.

Nada é publicado sem sua autorização.
