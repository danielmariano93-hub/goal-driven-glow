# Auditoria dos contratos Admin — 2026-07-26

## Causa confirmada do painel vazio

O banco possui clientes, transações, eventos e mensagens. Portanto, o estado
vazio não era causado por ausência de dados.

O frontend chamava `admin_v2_cockpit` com `_from`, `_to` e `_tz`, enquanto a
assinatura ativa no banco aceita somente `_from` e `_to`. O PostgREST resolve
RPCs pela assinatura dos argumentos; o argumento extra impedia a resolução.

Também havia acoplamento indevido por `Promise.all`: falhas em evolução diária,
coortes, funil ou inteligência de mensagens apagavam o conteúdo principal da
tela, mesmo quando a RPC principal havia respondido corretamente.

## Correções

- contrato específico para RPCs com e sem `_tz`;
- Cockpit chama a assinatura real do banco;
- cargas complementares usam isolamento de falhas;
- identidade de clientes deixa de derrubar a listagem;
- erros PostgREST exibem mensagem, detalhes, hint e código;
- RPC administrativa de diagnóstico sem PII;
- teste de regressão dos argumentos dos contratos;
- reforço da revogação de execução anônima.

## Escopo de produto já existente e preservado

O patch não duplica estruturas já presentes para roteamento de modelos,
registro de métricas de inteligência e entregas de comunicação.

## Próximas evoluções de produto, fora deste hotfix

Itens abaixo exigem desenho de jornada e homologação própria; não devem ser
adicionados como tabelas ou telas vazias:

- gestão visual de feature flags e rollout;
- referral e atribuição ponta a ponta;
- deep links temporários com expiração e telemetria;
- central unificada de notificações;
- inteligência semântica de conversas;
- tracing ponta a ponta e dead-letter queue formal;
- expansão da gamificação;
- homologação multiusuário de Metas Conjuntas e Divisão do Rolê.

Esses itens devem virar patches verticais, cada um com contrato, interface,
telemetria, testes e rollback.
