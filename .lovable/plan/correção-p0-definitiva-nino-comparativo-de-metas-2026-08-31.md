# Correção P0 definitiva — Nino comparativo de metas

## Diagnóstico confirmado

O print corresponde aos runs de produção de **31/08/2026 às 14:17 e 14:43 UTC**. Eles:

- chamaram a ferramenta correta (`assess_goal_performance`), mas executaram um **bundle antigo**;
- usaram período principal de **julho** e comparação de **31/05 a 30/06**, embora a pergunta pedisse mês atual contra o mesmo período do mês anterior;
- falharam no gate antigo `goal_current_consistent`, que já não existe no código atual;
- não registraram `runtime_version`; há **zero runs** com a versão nova `nino-agent-p0.2026-08-31.1`.

Portanto, a repetição da resposta do print não prova falha do patch local novo: prova que o WhatsApp ainda estava atendido pelo runtime anterior. Além disso, a auditoria encontrou lacunas reais no patch que precisam ser fechadas antes de atualizar produção.

## Implementação

### 1. Tornar a rota protegida realmente fail-closed

- Fazer qualquer exceção inesperada de `runCompositeAnalysis` preservar o estado de consulta protegida e responder com falha honesta; hoje o `guard()` pode convertê-la em `not_applicable` e liberar o fluxo legado.
- Resolver a classificação e o plano protegido antes dos atalhos capazes de retornar sem análise.
- Impedir por contrato que uma consulta de desempenho de metas disponibilize à LLM `compare_financial_metric`, `assess_financial_performance` ou `get_financial_snapshot`.
- Manter como único desfecho válido: `assess_goal_performance` com escopo/período exatos ou falha fechada — nunca agregado global.

### 2. Corrigir e endurecer o contrato temporal e de entidades

- Usar o período principal calculado para o mês atual até a data corrente e derivar a comparação com `samePeriodPreviousMonth`; o período citado como comparação nunca poderá substituir o período principal.
- Exigir identidade exata entre IDs planejados e categorias devolvidas pelo motor, sem categorias ausentes ou extras.
- Validar competência financeira canônica, categorias pessoais e globais, metas com ciclos heterogêneos e agregados aritmeticamente reconciliados.
- Diferenciar de forma auditável falha de consulta, escopo vazio, período divergente, conjunto divergente e inconsistência aritmética.

### 3. Eliminar drift invisível de runtime

- Incrementar `AGENT_RUNTIME_VERSION` para esta correção.
- Gravar `runtime_version` e `analytical_contract_version` em **todos** os caminhos de `agent_runs`, inclusive fast log e retornos determinísticos atualmente sem carimbo.
- Centralizar a criação/finalização do run para que conversa casual, confirmação, categorização e análise também provem qual bundle respondeu.
- Acrescentar ao contrato de deploy uma verificação que falhe se `_shared/agent`, `_shared/analytics` ou `_shared/finance-core` mudar sem atualização de versão e sem a lista completa dos dependentes.

### 4. Testes de regressão executáveis, não apenas inspeção de código

Adicionar testes que executem o fluxo real:

1. a **frase completa do print**, em um único turno, deve usar somente `assess_goal_performance`, mês atual e mesmo recorte do mês anterior;
2. fluxo de dois turnos (`overview` → anáfora) deve preservar exatamente os mesmos IDs;
3. memória ausente deve falhar fechado, nunca responder `scope=overall`;
4. exceção, timeout, resultado vazio e gate bloqueado devem impedir qualquer fallback para LLM;
5. evidência com julho contra maio/junho deve ser rejeitada;
6. categorias globais, competência de cartão, metas heterogêneas e múltiplas metas na mesma categoria devem manter cálculo e nomes corretos;
7. telemetria deve registrar ferramenta, períodos, IDs, gates, caminho final e versão;
8. nenhum runtime novo pode emitir `goal_current_consistent`.

Executar a suíte completa, typecheck, validação de selects de transações e contrato de dependentes.

## Atualização controlada das funções

Como a causa imediata é drift de bundle, corrigir apenas o repositório não muda o WhatsApp. Após todos os testes locais passarem, preparar a atualização atômica das 9 funções dependentes:

- `whatsapp-webhook`
- `agent-run`
- `agent-chat`
- `agent-proactive-tick`
- `anticipation-tick`
- `financial-reports-generate`
- `shared-goal-notify-invite`
- `split-reminders-dispatch-v2`
- `user-ai-preferences`

**Não atualizar produção sem autorização explícita.** A aprovação deste plano autoriza a implementação e os testes; a atualização das funções será apresentada separadamente para confirmação.

## Prova de correção pós-atualização

Depois da autorização de produção:

- atualizar as 9 funções no mesmo lote;
- executar o caso completo por `agent-run` e pelo caminho real do WhatsApp;
- confirmar em `agent_runs` a nova `runtime_version`;
- exigir `final_path=composite_answered`, `tools_used=[assess_goal_performance]`, escopo de categorias, período atual correto e comparação no mesmo recorte do mês anterior;
- verificar que não existe ferramenta concorrente nem novo run com gate legado;
- se qualquer prova falhar, interromper a validação e não considerar o incidente encerrado.

## Critérios de aceite

- A frase do print jamais produz `scope=overall`.
- Jamais compara julho contra maio/junho nesse contexto.
- A LLM jamais escolhe entre ferramentas conflitantes para essa intenção.
- Falha do motor não cai no fluxo legado.
- Todo run prova a versão do runtime que o respondeu.
- Suíte completa, typecheck e contratos estáticos passam.
- Produção só é considerada corrigida após smoke test real com o novo carimbo de runtime.
