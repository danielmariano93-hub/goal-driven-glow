# Implantação integral — Nino Diagnosis v1.1

## Objetivo

Concluir em uma única rodada o plano já aprovado, fazendo `financial_situations` alimentar diretamente Home, Nino, Relatórios e AgentCore com a mesma conclusão causal, ações específicas, antecipações reais, timeline e uma família visual compartilhada.

## Estado confirmado antes da execução

- O backend publicado responde apenas `nino_diagnosis_contract.v1`.
- `financial_situations` existe, mas ainda não possui `narrative_role` nem `one_line_summary`.
- `financial_situation_events` ainda não existe.
- Existem zero situações futuras ativas; portanto, “Prepare-se” ainda não recebe faturas, parcelas, recorrências, dívidas ou metas futuras.
- Não há chaves duplicadas atualmente em `(user_id, run_mode, situation_key)`; a implantação deve impedir recorrência, sem executar limpeza destrutiva.
- `src/pages/Nino.tsx` ainda usa `useNinoContext()` e componentes da projeção legada.
- A Home (`AssistantTipCard`) ainda usa `useNinoHomeItem()` da projeção; Relatórios já usa `useNinoDiagnosisContext()`.
- O contrato TypeScript em `src/lib/nino/diagnosis.ts` aceita somente v1.
- O AgentCore já recebe um diagnóstico básico, mas ainda não recebe narrativa, contraponto, papéis dos suportes ou timeline.
- O CTA genérico “Resolver agora”, o truncamento de `NinoChangeRow` e a navegação horizontal suscetível a corte continuam no código.

## Execução

### 1. Evoluir o domínio e impedir contradições

- Criar migration aditiva para:
  - adicionar `narrative_role` (`primary`, `support`, `counterpoint`, `operational`) e `one_line_summary` em `financial_situations`;
  - criar unicidade por `(user_id, run_mode, situation_key)`;
  - ajustar `nino_diag_put_situation` para upsert real e idempotente;
  - criar `nino_diag_resolve_conflicts`, preservando sinais positivos como contraponto em vez de descartá-los;
  - registrar no `rationale` como cada conflito foi resolvido.
- Se uma duplicidade surgir entre a auditoria e a aplicação, preservar a leitura de menor prioridade como contraponto antes de criar o índice.

### 2. Montar diagnóstico causal e ação determinística

- Evoluir `nino_assemble_diagnosis` para cruzar:
  - conclusão principal;
  - causa dominante;
  - contraponto relevante;
  - consequência;
  - previsão;
  - ação recomendada;
  - até três suportes, ordenados por papel narrativo.
- Criar `nino_diag_select_action` por `situation_type + status + evidência`, com rota, explicação e impacto estimado.
- Remover o conceito de CTA universal. Situações resolvidas/expiradas não terão CTA; padrões observados terão ação de entendimento; riscos terão ações específicas do domínio.
- Validar todas as rotas no frontend com fallback seguro, sem produzir “Resolver agora”.

### 3. Criar antecipações financeiras reais

- Adicionar evaluators determinísticos para:
  - faturas a vencer;
  - parcelas futuras;
  - recorrências e ocorrências previstas;
  - pagamentos de dívidas;
  - janela de aporte em metas;
  - pressão futura de caixa.
- Gerar situações com `temporal_scope='future'`, janela, validade, impacto e chave idempotente.
- Converter padrão comportamental em antecipação apenas com maturidade, amostra e confiança mínimas; padrões imaturos permanecem em “Aprendizados”.
- Revalidar e encerrar automaticamente antecipações vencidas, sem ativar novos envios proativos no WhatsApp nesta rodada.

### 4. Implantar lifecycle e Histórico em timeline

- Criar `public.financial_situation_events` com GRANTs, RLS por usuário, índices e eventos `detected`, `confirmed`, `worsened`, `improved`, `resolved`, `expired`, `superseded`, `acted` e `feedback`.
- Criar trigger idempotente para registrar mudanças reais de estado/impacto, evitando eventos em atualizações sem alteração semântica.
- Fazer backfill de um evento inicial `detected` por situação existente.
- Expor `timeline` agrupada por situação e `closings` como marcos separados no diagnóstico.

### 5. Publicar `nino_diagnosis_contract.v1.1`

- Evoluir snapshot/contexto com campos aditivos: `narrative`, `narrative_role`, `one_line_summary`, lifecycle, timeline, closings e ação enriquecida.
- Atualizar `nino_refresh_diagnosis` para executar avaliação, resolução de conflitos e montagem nessa ordem.
- Manter v1 como fallback temporário e `nino_project_diagnosis` apenas como projeção de compatibilidade/telemetria.
- Atualizar `src/lib/nino/diagnosis.ts` para validar v1 e v1.1 de forma tolerante, tornando-o a fonte canônica das superfícies.

### 6. Unificar a família visual do Nino

- Criar `NinoCardShell` com slots compartilhados para badge, título, métrica, corpo, evidência recolhível, ações e feedback.
- Derivar do shell os cards de situação principal, suporte/contraponto, padrão, antecipação, tarefa operacional, evento histórico e fechamento.
- Padronizar largura, borda, raio, padding, hierarquia, semântica de severidade e CTA usando tokens existentes.
- Resumir fechamentos em até três linhas e deixar causas/detalhes em seção recolhida.
- Remover truncamento de títulos; limitar apenas corpo secundário quando necessário.
- Corrigir a faixa de abas com padding simétrico, `scroll-padding` e snap, mantendo primeiro e último chips inteiros em mobile.

### 7. Migrar todas as superfícies para a mesma fonte

- `src/pages/Nino.tsx`: trocar `useNinoContext()` por `useNinoDiagnosisContext()` e mapear as cinco abas diretamente do diagnóstico v1.1.
- `AssistantTipCard`: usar a situação/ação primária do mesmo snapshot, preservando refresh, exposição e feedback.
- `Relatorios.tsx`: manter o hook canônico e remover qualquer interpretação local da conclusão.
- Manter `intelligence.ts` somente para projeção, operação e telemetria durante a compatibilidade.
- Garantir que Home, Nino e Relatórios exibam o mesmo `snapshot_id`, conclusão e ação.

### 8. Enviar diagnóstico completo ao AgentCore

- Enriquecer `[DIAGNÓSTICO FINANCEIRO CANÔNICO DO NINO]` com conclusão, causa, contraponto, consequência, forecast, ação e suportes com papel narrativo.
- Proibir recalcular, reordenar ou inventar conclusões no modelo.
- Manter App e WhatsApp com a mesma fonte, sem mudar autenticação, fila, política de confirmação ou comportamento de escrita financeira.

### 9. Testar e homologar

- Testes de contrato v1/v1.1 e fallback.
- Testes de conflito, unicidade, ordem narrativa e ActionSelector; nenhuma saída pode conter “Resolver agora”.
- Testes dos cinco evaluators futuros, validade, deduplicação e expiração.
- Testes de lifecycle/timeline e de não duplicação de eventos.
- Teste estrutural garantindo `useNinoDiagnosisContext()` em Home, Nino e Relatórios.
- Testes da família de cards: todos usam `NinoCardShell`, nenhum título usa `truncate`, nenhum componente cria cores fora dos tokens.
- Cenários integrados: déficit com melhora como contraponto; meta inviável; fatura com parcelas próximas; padrão imaturo; antecipação madura; evolução detectada → piorou → melhorou.
- Verificação visual em 360px, 440px e desktop: abas sem corte, meta sem truncamento, detalhes recolhíveis e sem overflow.
- Executar testes/lint/build, aplicar migrations, publicar somente as Edge Functions afetadas e validar o contexto real após deploy. Não publicar o frontend em produção sem autorização explícita.

## Ordem segura de implantação

```text
Schema aditivo + unicidade
  -> conflito + ActionSelector
  -> evaluators futuros
  -> lifecycle/timeline
  -> assembler + contrato v1.1
  -> tipos/hooks frontend
  -> NinoCardShell e cards
  -> Nino/Home/Relatórios
  -> AgentCore
  -> testes e homologação
  -> migrations e Edge Functions
  -> validação real
```

## Critérios de aceite

- Contrato corrente `nino_diagnosis_contract.v1.1`, mantendo leitura de v1 durante rollback.
- Zero duplicidade por usuário, modo e `situation_key`.
- Uma narrativa causal coerente, com contrapontos incorporados e não apresentados como conclusões concorrentes.
- Zero CTA “Resolver agora”; toda ação é específica, válida e compatível com o estado.
- “Prepare-se” recebe compromissos futuros reais quando existirem e mostra empty state verdadeiro quando não existirem.
- Histórico é timeline de evolução, não arquivo de cards soltos.
- Home, Nino, Relatórios, App e WhatsApp compartilham conclusão e ação do mesmo snapshot.
- Cards consistentes, metas sem truncamento, fechamentos recolhíveis e abas sem corte.
- Nenhuma mudança na verdade contábil, autenticação ou políticas de comunicação proativa.
- Testes, lint e build aprovados; banco e funções validados após implantação.

## Rollback

- Migrations aditivas, sem remover tabelas ou projeções legadas.
- Feature/configuração do assembler permite voltar temporariamente ao v1.
- Frontend aceita v1 e v1.1 durante a transição.
- `nino_project_diagnosis` permanece disponível para compatibilidade.
- Publicação do frontend fica separada e depende de autorização explícita.