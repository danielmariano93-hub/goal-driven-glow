# Correção final do Admin de IA

## Objetivo
Eliminar o erro restante no painel de custo e manter custo/latência, aprendizado global e inspeção individual como áreas independentes.

## Implementação
1. Criar e aplicar uma migration corretiva para `admin_v3_ai_history`, substituindo a coluna inexistente `agent_runs.total_latency_ms` pela coluna canônica `agent_runs.latency_ms` em todos os cálculos diários e totais.
2. Manter métricas distintas: latência do modelo vem de `ai_usage_ledger.latency_ms`; latência ponta a ponta vem de `agent_runs.latency_ms`, sem fallback entre elas.
3. Preservar filtros, séries sem dias artificiais e os dados globais de aprendizado já carregados.
4. Atualizar a regressão para impedir retorno de referências a `total_latency_ms` e garantir as três áreas separadas.

## Validação
- Executar a RPC autenticada e confirmar resposta sem erro.
- Abrir as três abas no painel: custo com gráficos/dados, aprendizado global sem busca de usuário e inspetor isolado.
- Rodar a suíte focal e confirmar build verde.

## Fora de escopo
Sem deploy/publicação e sem alteração do motor do Nino ou dos dados financeiros.
