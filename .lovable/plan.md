# Plano urgente — Motor Central de Categorização do Nino

## Objetivo

Criar um único serviço de categorização para todo lançamento do Meu Nino, independentemente da origem, com inferência progressiva, confiança mensurável, aprendizado por usuário e revisão humana somente quando necessário. Depois da ativação, reprocessar com segurança todos os lançamentos existentes de todos os usuários.

## Diagnóstico confirmado

- Existem **433 lançamentos confirmados de 2 usuários**; **13 estão sem categoria** e **12 são movimentos comuns elegíveis para categorização automática**. O item restante deve permanecer excluído por natureza contábil.
- Há **96 aliases pessoais**, todos com categoria e origem manual, mas a aplicação atual em lote cobre apenas correspondência exata e poucas regras fixas.
- O pipeline híbrido em `supabase/functions/_shared/categorization/pipeline.ts` já prevê escolha explícita, alias, similaridade, histórico, regras e confiança, porém na prática só partes dele são usadas pelo importador documental.
- A criação manual em `useSaveTransaction`, a confirmação do assessor, RPCs contábeis e fluxos auxiliares ainda podem gravar diretamente em `transactions`; não existe uma fronteira única de categorização antes da persistência final.
- O importador documental mantém uma segunda implementação própria e faz a chamada de IA diretamente, com regras e limiares diferentes do pipeline compartilhado.
- `apply_safe_category_suggestions()` roda na Home e na tela de lançamentos, mas atua depois da gravação, não chama o classificador completo e não registra toda a justificativa da decisão.
- Os campos `category_source`, `category_confidence` e `category_reason` já existem, mas a restrição de fontes e os gatilhos atuais não representam revisão, sugestão pendente, versão do motor ou execução de backfill.
- A tabela `categorization_metrics_daily` existe, mas está sem registros; hoje não há visibilidade real de cobertura, precisão aproximada, correções e itens pendentes.

## Arquitetura alvo

```text
App / Assessor / WhatsApp / Documento / Recorrência / Cartão
                            |
                            v
                  Category Engine v1
        normalização -> proteção contábil -> decisão
           | alias | histórico | regra | IA em lote |
                            |
          +-----------------+------------------+
          |                                    |
   confiança alta                         confiança média/baixa
   aplica categoria                       salva sugestão/revisão
          |                                    |
          +-----------------+------------------+
                            v
             commit financeiro canônico e auditado
```

## Implementação em uma única rodada

### 1. Contrato canônico `categorization_contract.v1`

- Consolidar o pipeline em um módulo compartilhado e puro, usado pelo novo serviço e por testes, sem lógica paralela no importador.
- Entrada mínima: usuário autenticado no servidor, tipo, descrição bruta/amigável, natureza contábil, origem, categoria explícita e contexto opcional de estabelecimento/conta/cartão.
- Saída única: `category_id`, `source`, `confidence`, `reason_code`, justificativa curta, `engine_version`, ação (`auto_apply`, `suggest_review`, `leave_unresolved`) e candidatos alternativos quando houver ambiguidade.
- Nunca categorizar transferências, pagamentos de fatura, aplicações/resgates ou movimentos técnicos como consumo comum.
- Nunca aceitar categoria pertencente a outro usuário, arquivada ou incompatível com receita/despesa.

### 2. Microserviço `category-engine`

- Criar uma Edge Function autenticada, server-side, com operações estreitas:
  - `classify`: um lançamento, para app/assessor;
  - `classify_batch`: lote de documentos e backfill;
  - `learn`: confirmação/correção explícita do usuário;
  - `review_status`: contadores de sugestões pendentes.
- Ordem de decisão:
  1. categoria explícita do usuário (`user`, confiança 1,00);
  2. alias pessoal confirmado exato;
  3. alias pessoal semelhante, sem conflito entre categorias;
  4. histórico dominante do próprio usuário com amostra mínima;
  5. regras curadas e sinais contábeis;
  6. IA em lote, restrita às categorias válidas fornecidas pelo backend;
  7. sem decisão quando a evidência for insuficiente.
- Usar o modelo padrão suportado do projeto por meio do Lovable AI Gateway e AI SDK, com schema pequeno, validação do retorno e tratamento explícito de erro/limite/créditos.
- A IA não poderá inventar categoria, alterar natureza contábil nem sobrepor escolha manual.

### 3. Confiança, decisão e revisão humana

- Manter os limiares configuráveis já existentes, com política inicial conservadora:
  - alta confiança: aplicação automática;
  - média confiança: sugestão visível para validação;
  - baixa confiança ou conflito: permanece sem categoria.
- Aplicar limiar também por fonte; aliases confirmados podem ter limiar próprio, enquanto IA e similaridade exigem margem contra o segundo candidato.
- Adicionar estado explícito de revisão, versão do motor, data da classificação e identificador da decisão em cada lançamento.
- Criar histórico imutável de decisões de categoria com categoria anterior/nova, fonte, confiança, motivo, versão, modo (`live`/`backfill`) e autor (`engine`/`user`).
- RLS: cada usuário acessa apenas suas sugestões/decisões; serviço e admin autorizado acessam telemetria agregada.

### 4. Fronteira única antes do registro final

- Fazer todos os fluxos de movimento comum chamarem o motor antes do commit final:
  - criação/edição manual no app;
  - rascunho e confirmação do assessor no app;
  - mensagens e confirmações do WhatsApp;
  - importação documental e revisão em lote;
  - recorrências e lançamentos auxiliares que representem receita/despesa real;
  - gravações canônicas via `commit_movement` e confirmações legadas ainda ativas.
- Categoria informada pelo usuário entra como escolha explícita e não é inferida novamente.
- Para resiliência, adicionar uma fila idempotente de categorização para qualquer escrita elegível que ainda chegue sem decisão; um worker em lote processa a pendência sem bloquear o lançamento nem duplicar custo de IA.
- O fallback não deve transformar falha do classificador em falha financeira: o movimento é preservado, marcado para revisão e processado novamente de forma controlada.

### 5. Unificação dos fluxos existentes

- Remover a implementação duplicada de regras/IA de `assistant-ingest-document` e fazê-la consumir `classify_batch` antes de montar os itens de revisão.
- Substituir `apply_safe_category_suggestions()` pelo novo contrato ou mantê-la apenas como wrapper compatível durante a transição.
- Ajustar `learn_transaction_category()` para registrar a decisão humana, atualizar alias canônico e alimentar o histórico sem criar chaves contaminadas por frases completas do chat.
- Corrigir a normalização do estabelecimento: remover valores, datas, conta, meio de pagamento, identificadores e prefixos bancários antes de criar a chave; preservar a descrição original para auditoria.
- Revisar a restrição `category_source` para as novas fontes sem perder compatibilidade com registros legados.

### 6. UX de validação

- Em criação manual e confirmação do assessor, preencher automaticamente a categoria quando a confiança for alta e mostrar discretamente “Identificado pelo Nino”; o usuário pode trocar antes de salvar.
- Para confiança média, mostrar a melhor sugestão e alternativas, sem exigir busca manual da categoria.
- Na revisão documental, exibir fonte/confiança/motivo e destacar somente os itens realmente pendentes; remover o `confirm()` nativo e usar confirmação acessível no fluxo existente.
- Na tela “Sem categoria”, executar o motor em lote, separar “identificados automaticamente” de “precisam de você” e permitir confirmar/corrigir rapidamente no mobile e desktop.
- Toda correção explícita deve ensinar o alias pessoal e resolver futuras ocorrências equivalentes.

### 7. Backfill global seguro e automático

- Criar uma execução versionada e idempotente para **reavaliar todos os 433 lançamentos atuais**, em lotes pequenos por usuário, com checkpoint, heartbeat, tentativas limitadas e custo controlado.
- Preservar integralmente escolhas `user` e movimentos contábeis excluídos.
- Para registros sem categoria: aplicar automaticamente apenas decisões acima do limiar; os demais entram na fila de validação.
- Para categorias legadas/importadas: reavaliar todos, mas só substituir automaticamente quando a nova decisão tiver confiança alta, categoria válida e ganho mínimo de confiança; caso contrário, manter a categoria atual e registrar apenas o diagnóstico.
- Capturar snapshot anterior em auditoria para rollback por execução, usuário ou decisão.
- Rodar primeiro em `dry_run`, comparar cobertura e mudanças propostas, executar o lote real e depois reconciliar contagens por usuário.

### 8. Observabilidade e operação

- Alimentar `categorization_metrics_daily` com cobertura, autoaplicação, sugestões, sem categoria, fonte, confiança média e correções em 7 dias.
- Registrar duração, quantidade, custo/chamadas de IA, cache/alias hit rate, falhas e versão do motor.
- Expor no Admin: cobertura total, pendentes, precisão aproximada por fonte, taxa de correção, evolução diária, última execução e status do backfill.
- Alertar quando aumentar o percentual sem categoria, a taxa de correção ou a fila parada.

## Migração e segurança

- Evoluir `transactions` apenas com metadados de classificação/revisão necessários e índices para fila/pendências.
- Criar tabelas de decisões e execuções com `GRANT`, RLS e políticas no mesmo migration; não expor prompts, credenciais nem dados entre usuários.
- O serviço deriva `user_id` do JWT/contexto confiável; operações administrativas de backfill usam função server-side e não aceitam usuário arbitrário do cliente.
- Escritas e backfill serão idempotentes e concorrentes com `expected_version`/checagem da categoria atual, evitando sobrescrever uma correção feita enquanto o lote roda.

## Testes e critérios de aceite

- Unitários: normalização, aliases exatos/fuzzy, conflito, histórico dominante, regras, estorno, incompatibilidade de tipo, limiares e proteção de escolhas humanas.
- Integração: cada origem de lançamento chega ao mesmo contrato e persiste `source`, `confidence`, `reason` e versão coerentes.
- Segurança: usuário não usa categorias/aliases/decisões de outro usuário; backfill não altera transferências nem escolhas manuais.
- E2E app/WhatsApp/documento: categoria alta é aplicada antes da confirmação; média pede validação; baixa permanece pendente; correção ensina a próxima ocorrência.
- Backfill: 433 linhas inspecionadas, 78 escolhas atuais de usuário preservadas, relatório antes/depois por usuário e rollback testado.
- Métricas: tabela diária deixa de ficar vazia e o Admin mostra cobertura e correções reais.
- Regressão financeira: saldos, faturas, transferências, investimentos, divisão do rolê e deduplicação permanecem inalterados.

## Ordem de execução

1. Migration de contrato, auditoria, fila e índices.
2. Motor compartilhado e microserviço com testes.
3. Integração em todos os pontos de escrita e remoção das implementações paralelas.
4. UX de sugestão/revisão e painel operacional.
5. Deploy das funções afetadas e validação real de cada origem.
6. Backfill `dry_run`, conferência dos deltas, execução automática global e reconciliação final.
7. Publicação somente mediante autorização explícita.