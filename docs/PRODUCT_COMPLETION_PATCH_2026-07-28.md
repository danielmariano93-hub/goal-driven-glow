# Patch de conclusão do produto — Meu Nino

Base esperada: `main` no commit `8ffc21011227d6122640241215e0dc2237be99de` ou descendente sem conflitos nos arquivos alterados.

## Escopo

- memória do Nino visível, corrigível, apagável e exportável;
- hipóteses comportamentais explicáveis e confirmadas pelo usuário;
- revisões semanais e mensais do assessor com ações acompanháveis;
- detectores proativos de queda de engajamento e padrões recorrentes;
- deduplicação de 14 dias, limite diário e opt-out por tipo;
- feedback de utilidade e falso positivo;
- métricas administrativas de qualidade;
- contratos SQL, TypeScript e testes de regressão.

O patch não substitui as tabelas financeiras canônicas e não cria uma segunda fila de mensagens.

## Ordem de implantação

1. Aplicar o patch em uma branch.
2. Executar testes, TypeScript e build.
3. Aplicar a migration em homologação.
4. Publicar o frontend em homologação.
5. Fazer deploy de `agent-proactive-tick`, `agent-chat` e funções que importem o Agent Core compartilhado.
6. Executar o smoke test abaixo.
7. Somente depois repetir banco, functions e frontend em produção.

## Smoke test obrigatório

### Banco

- `select to_regprocedure('public.my_nino_context()');`
- `select to_regprocedure('public.admin_v2_nino_quality_summary(integer)');`
- confirmar RLS em `behavior_hypotheses` e `advisor_reviews`;
- confirmar colunas novas em `notification_preferences` e `communication_deliveries`.

### Usuário

- abrir `/app/nino-contexto`;
- corrigir e apagar uma memória de teste;
- confirmar e rejeitar hipóteses de teste;
- alterar limite diário e silenciar um tipo;
- abrir `/app/assessor/acompanhamento`;
- marcar uma ação como concluída;
- abrir `/app/emocoes` e validar o card comportamental.

### Proatividade

Invocar `agent-proactive-tick` com `force=true` e um `user_id` de teste. Conferir:

- `pending_proactive_suggestions`;
- `communication_deliveries`;
- `behavior_hypotheses`;
- `advisor_reviews`;
- `notifications`;
- `outbound_messages`, quando WhatsApp estiver habilitado.

Repetir o tick e confirmar que o mesmo `dedup_key` não é entregue novamente no mesmo canal durante 14 dias.

## Critérios de rollback

O patch é aditivo. Para rollback operacional:

1. desativar `agent_settings.proactive_enabled`;
2. republicar o frontend anterior;
3. republicar as Edge Functions anteriores;
4. manter tabelas e colunas novas, pois não interferem nos contratos financeiros;
5. não remover dados até concluir a análise do incidente.

## Limites da validação local

A suíte automatizada valida regras puras e contratos de arquivos. Entrega real no WhatsApp, sessão autenticada do Admin e execução do cron precisam ser comprovadas no ambiente conectado.
