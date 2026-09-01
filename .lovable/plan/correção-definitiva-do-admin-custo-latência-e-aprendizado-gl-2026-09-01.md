# Correção definitiva do Admin: custo, latência e aprendizado global

## Diagnóstico confirmado

Há dois erros independentes no backend e um erro de arquitetura da tela:

1. **Histórico de IA quebrado:** `admin_v3_ai_history` chama `admin_v2_ai_history`, que consulta `agent_runs.error_message`. Essa coluna não existe no contrato atual; existem `error_sanitized` e `error_masked`. Por isso o bloco inteiro retorna “Não foi possível carregar o histórico”.
2. **Aprendizado global quebrado:** `admin_nino_learning_overview(NULL, 30)` monta o ranking global usando `user_pseudonyms.pseudonym`, mas a coluna real é `pseudo_id`. A visão por usuário não passa por esse trecho; a global passa e falha.
3. **Domínios misturados:** a aba “Custo e uso” renderiza, no mesmo fluxo, gráficos globais, busca/inspeção por usuário e aprendizado. O aprendizado global ainda aparece condicionado ao estado vazio da busca, reforçando a confusão vista no print.

Os dados existem: nos últimos 30 dias há **60 chamadas registradas**, **94.965 tokens**, **60 amostras de latência**, **19 eventos de aprendizado aplicados em 3 usuários** e **316 execuções do agente**. Portanto, o estado atual é erro de leitura/apresentação, não ausência total de dados.

## Nova arquitetura do Nino & IA

Criar três destinos de primeiro nível, sem abas internas conflitantes:

- **Custo e latência** — consumo de tokens, chamadas, custo e latências por período/workload.
- **Aprendizado global** — o que o Nino aprendeu no conjunto da operação, sem selecionar usuário e sem PII.
- **Inspetor de usuário** — busca por e-mail/UUID, memória, decisões, sugestões, runs e aprendizado individual.

A aba atual “Custo e uso” deixa de ser um contêiner genérico. “Aprendizado global” será sempre carregado diretamente, nunca escondido atrás da busca de cliente.

## Implementação

### 1. Reparar os contratos administrativos

- Substituir a referência inválida de `agent_runs.error_message` pela fonte sanitizada canônica disponível.
- Substituir `user_pseudonyms.pseudonym` por `pseudo_id`, serializado como identificador pseudônimo.
- Manter `SECURITY DEFINER`, `_require_perm('cockpit.read')`, grants apenas para papéis autenticados autorizados e nenhuma exposição de nome/e-mail.
- Remover qualquer fallback que misture latência do modelo com latência ponta a ponta: cada série terá campo, legenda e cobertura próprios.
- Aplicar a correção por migration versionada, sem alterar dados existentes.

### 2. Separar as telas

- `NinoIA.tsx`: adicionar abas independentes **Custo e latência**, **Aprendizado global** e **Inspetor**.
- `IAInteligencia.tsx`: deixar de concentrar os três domínios; extrair a inspeção por usuário para componente/página própria.
- `AiEfficiencyHistoryBoard.tsx`: ficar exclusivamente com observabilidade global de IA.
- `NinoLearningBoard.tsx`: modo global como tela principal; modo por usuário somente dentro do Inspetor.
- Ajustar títulos e descrições para dizer exatamente o que cada área mostra.

### 3. Tornar os gráficos semanticamente honestos

- Gráfico de **tokens por dia** baseado exclusivamente em `ai_usage_ledger`.
- Gráfico de **latência da IA** baseado exclusivamente nas chamadas com `latency_ms` no ledger.
- Bloco separado para **latência ponta a ponta** das execuções do agente, sem coalesce ou substituição silenciosa.
- Preservar dias zerados, pontos únicos visíveis e estado vazio específico por filtro.
- Métricas de cobertura informam desde quando cada fonte está disponível e quantas chamadas não reportaram tokens.

### 4. Fazer o aprendizado global responder à pergunta certa

Exibir, para todo o Nino:

- eventos capturados, aplicados e usuários pseudonimizados alcançados;
- distribuição por tipo de aprendizado e origem;
- evolução recente em linguagem clara;
- correções, dispensas, recomendações, compromissos e acompanhamentos;
- saúde do pipeline comparando execuções recentes com eventos realmente aprendidos;
- estado honesto quando uma categoria ainda não possui amostra.

O painel não apresentará “estratégia atual” global, pois estratégia é individual. Esse bloco permanece apenas no Inspetor.

## Validação e prevenção de regressão

- Testes SQL das duas RPCs com escopo global e individual, incluindo retorno sem PII e execução com dados vazios.
- Testes de contrato para impedir referência a colunas inexistentes nas RPCs administrativas.
- Testes de UI garantindo que cada aba carregue apenas seu domínio e que aprendizado global não dependa de usuário selecionado.
- Verificação autenticada em desktop e mobile: números, dois gráficos de latência separados, tokens visíveis e aprendizado global carregado.
- Conferir erros de rede/runtime e build antes de concluir.

## Limite operacional

Aplicar migration e código após aprovação. Não publicar em produção sem autorização explícita.
