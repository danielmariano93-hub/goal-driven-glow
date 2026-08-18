# Correção sistêmica: uma única verdade financeira em todos os canais

## Diagnóstico confirmado

- O alerta duplicado não foi uma repetição acidental do mesmo envio: **dois candidatos diferentes** representaram a mesma situação financeira. Um veio diretamente de `financial_situations` e outro de `nino_intelligence_items`; como usavam chaves lógicas diferentes, ambos passaram pela deduplicação e foram entregues no WhatsApp.
- O alerta de meta foi calculado por uma função SQL paralela (`nino_diag_detect_category_goal_alerts`) que soma `transactions` e projeta o mês por conta própria. O app usa `evaluateCategoryGoal` do `financial_snapshot_contract.v8`. Portanto, hoje existem dois caminhos de cálculo para a mesma métrica.
- Os registros confirmam a divergência exibida: o diagnóstico persistiu **R$ 709,56 / R$ 1.222,02**, enquanto a tela mostrou **R$ 688,46 / R$ 1.185,71**.
- A auditoria encontrou outros consumidores obrigatórios ainda lendo tabelas ou remontando fórmulas fora do contrato único, principalmente Relatórios, insights, antecipação, relatórios gerados, tools MCP e partes do assessor/WhatsApp.

## Implementação única

### 1. Tornar o snapshot canônico a única porta de leitura financeira

- Criar uma fachada server-side única para carregar os dados ativos e produzir `financial_snapshot_contract.v8`, com o mesmo `reconciliationId`, `asOf`, período e versões de fórmula usados no app.
- Fazer app, assessor, WhatsApp, proatividade, relatórios, insights e tools MCP consumirem campos desse snapshot, sem somas financeiras locais.
- Manter acesso direto às tabelas apenas nas portas autorizadas: escrita, ingestão, categorização, conciliação e construção interna do snapshot.

### 2. Eliminar o cálculo SQL paralelo das metas por categoria

- Retirar de `nino_diag_detect_category_goal_alerts` a soma/projeção própria sobre `transactions`.
- Gerar situações e itens de inteligência a partir de `active_category_goals` do snapshot canônico, carregando gasto, projeção, limite, período, status e evidências exatamente como o app.
- Persistir em cada alerta `reconciliation_id`, `formula_version`, `as_of`, contagem de lançamentos e período, permitindo comparar qualquer mensagem com a fotografia que a originou.
- Fazer a tela de Metas e o detalhe da meta consumirem `useFinancialSnapshot`, removendo as chamadas locais duplicadas a `evaluateCategoryGoal`.

### 3. Corrigir a duplicidade por identidade de assunto

- Definir uma única chave lógica para meta por categoria: usuário + tipo da situação + meta + início do ciclo.
- Fazer situações, itens de inteligência, sugestões, entregas no app e WhatsApp propagarem essa mesma chave.
- Consolidar candidatos por assunto antes do ranking e reforçar a idempotência no enfileiramento outbound, independentemente da origem técnica do candidato.
- Encerrar ou suprimir candidatos antigos equivalentes quando um candidato canônico for criado, preservando o histórico de auditoria.

### 4. Migrar os consumidores que ainda violam o contrato

Prioridade de migração:

1. Relatórios gerados, insights e antecipação.
2. Tools do assessor/WhatsApp e tools MCP (`monthly_summary`, `financial_position`, metas e categorias).
3. Relatórios e cartões no app, eliminando totais paralelos na própria tela.
4. Estratégias de metas e demais componentes que ainda recalculam ritmo, médias ou projeções.

Cada consumidor receberá somente os campos canônicos necessários; cálculos editoriais poderão classificar ou explicar os fatos, mas não criar novos valores monetários.

### 5. Atualização e consistência após escritas

- Garantir que toda escrita financeira invalide o snapshot central e que respostas imediatas aguardem a nova fotografia antes de exibir ou enviar números.
- Em mensagens proativas, rejeitar snapshot anterior à última alteração financeira relevante do usuário.
- Quando a fotografia estiver parcial ou indisponível, não calcular por fallback: informar indisponibilidade e não enviar alerta monetário.

### 6. Guardas automáticas e observabilidade

- Adicionar teste de paridade app × Edge para o snapshot completo e para metas por categoria.
- Adicionar teste arquitetural que falha quando consumidores obrigatórios acessam tabelas financeiras diretamente ou contêm fórmulas monetárias paralelas.
- Criar cenários de regressão para estorno, lançamento supersedido, cartão, transferência, data de competência, meta mensal e mudança de categoria.
- Registrar divergência quando dois canais tentarem publicar valores diferentes para o mesmo `reconciliationId` e assunto.

## Validação final

- Reproduzir a meta Alimentação com os dados reais e exigir igualdade exata entre app, detalhe da meta, assessor, alerta in-app e WhatsApp.
- Executar um ciclo proativo completo e comprovar apenas um candidato, uma fila e uma mensagem por assunto/canal.
- Validar Home, Relatórios, Cartões, Metas, insights, relatórios gerados, assessor e WhatsApp contra a mesma fotografia.
- Rodar testes de paridade, contrato financeiro, deduplicação e fluxos críticos; depois testar e ler a resposta real das funções implantadas antes de considerar concluído.

## Detalhes técnicos

- Fonte de cálculo: `computeFinancialSnapshot` / `financial_snapshot_contract.v8` no `finance-core` sincronizado.
- Projeção de meta: `evaluateCategoryGoal`; nenhuma reimplementação em SQL, componente ou detector.
- Cartões: `card_exposure.v2`; compromissos: `commitment_agenda.v2`; ritmo: `spending_rhythm.v3`.
- Chaves de deduplicação serão derivadas do domínio, não do ID de situação, item ou sugestão.
- A mudança incluirá migration para substituir as funções de diagnóstico e normalizar ou suprimir filas equivalentes existentes, sem apagar histórico financeiro ou operacional.