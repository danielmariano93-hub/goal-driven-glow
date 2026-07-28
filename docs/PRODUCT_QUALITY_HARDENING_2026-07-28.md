# Meu Nino — Product Quality Hardening

Este patch fecha lacunas encontradas na auditoria do produto real. Ele não cria um segundo sistema financeiro nem substitui as filas existentes.

## Escopo

- Divisão do Rolê: agenda D-1, D0, D+1, D+3 e D+7, cria catch-up para vencimentos recentes, entrega no app para participantes cadastrados e mantém WhatsApp na fila canônica.
- Acompanhamento: revisão semanal e mensal usam janelas e comparações diferentes, distinguem despesas possivelmente fixas de ajustáveis e geram ações com valor, motivo, evidência e impacto estimado.
- Nino Contexto: remove edição por JSON, agrupa memórias, esconde conteúdo técnico e reconcilia categorias desatualizadas.
- Proatividade: corrige o cron, implementa dry-run sem persistência, cria detalhes acionáveis e feedback de falso positivo.
- Comunicações Admin: adiciona templates versionados, validação de variáveis, prévia, fila, bloqueios e simulação por usuário.
- Categorização: melhora aprendizado por histórico/alias, registra origem e confiança e executa backfill seguro sem tocar movimentos especiais.
- Dicas antigas: preenche família/dedup, incorpora feedback histórico e elimina ativas repetidas.

## Segurança e rollout

1. O canal global continua `app` até validação manual.
2. O WhatsApp só é usado se estiver liberado globalmente, permitido no catálogo e autorizado pelo usuário.
3. Migrations são aditivas, com funções substituídas de forma idempotente.
4. Nenhuma recategorização automática atinge transferências, faturas, investimentos ou transações de rolê.
5. O dry-run do motor não grava perfil, hipótese, revisão, sugestão, entrega ou mensagem.

## Critérios de aceite

- Um rolê ativo com vencimento gera jobs de vencimento e pós-vencimento; pagamento/cancelamento/opt-out cancela jobs futuros.
- Semanal e mensal não exibem o mesmo conjunto de indicadores e ações por construção.
- Moradia concentrada não gera recomendação automática de corte; a análise procura primeiro gastos ajustáveis.
- Alerta de duplicidade mostra os lançamentos comparados e aceita “duplicidade” ou “são diferentes”.
- Admin permite editar e versionar templates e simular um usuário sem envio.
- `agent_settings.last_tick_at` é atualizado após execução automática autenticada.
- Memórias de revisão e chaves técnicas não aparecem na tela do usuário.
