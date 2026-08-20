# Conclusão do Nino Agente Financeiro Autônomo (rodada única)

Fecha os itens que ficaram pendentes depois das Ondas A/B, sem abrir novas ondas.

## 1. Planejador orientado a objetivo (multi-step)
- Novo `GoalPlanner` no núcleo do agente: recebe o pedido do usuário, consulta o Registro de Capacidades e decompõe em passos ordenados (ler verdade → calcular → escrever → confirmar).
- Cada passo carrega capacidade, risco e pré-condições; passos de escrita só entram no plano se a política de autonomia permitir.
- Plano persistido nos registros de execução do agente (passos e decisões), para auditoria e retomada.
- Integração no fluxo principal: pedidos compostos ("pague a fatura e ajuste minha meta") passam a virar um plano único em vez de respostas parciais.

## 2. Política de autonomia aplicada de ponta a ponta
- Ligar a política já criada ao fluxo de execução: leitura automática; escrita de risco médio/alto, valor ≥ R$ 1.000 e qualquer ação disparada proativamente exigem confirmação explícita.
- Toda escrita passa pela prova de persistência (leitura de volta) antes de virar recibo.
- Bloqueio honesto: se a política nega, o Nino explica o que precisa da sua confirmação, sem inventar sucesso.

## 3. Recibos de ação
- Padronizar o recibo de qualquer escrita: o que foi feito, valor, data de competência, conta/cartão, e como desfazer/corrigir (supersede, nunca exclusão).
- Recibo só é emitido com prova de escrita; caso contrário, mensagem de falha específica.

## 4. Links curtos
- Rota curta pública para ações compartilhadas (divisão de despesa, convite de meta) com registro de auditoria de acesso.
- Substitui URLs longas nas mensagens de WhatsApp, mantendo as permissões atuais.

## 5. Relatório do mês atual com narrativa
- Habilitar relatório parcial do mês corrente (marcado claramente como "em andamento", com dias decorridos e projeção).
- Camada de narrativa: abertura com o fato mais relevante, evolução vs. mês anterior, o que mudou de comportamento, riscos e próximo passo — sempre a partir das fontes determinísticas já existentes (fatos canônicos, ciclo de cartão, metas por categoria).

## 6. Observabilidade agentic no painel admin
- Novo painel do agente: execuções, passos, decisões, chamadas de ferramenta, taxa de sucesso de escrita, quantas ações exigiram confirmação e quantas foram concluídas.
- Funil: pedido → plano → ferramenta → escrita provada → recibo, com filtro por período e por cliente.
- Lista de falhas recentes com o motivo específico, para diagnóstico rápido.

## Notas técnicas
- Núcleo: novos `GoalPlanner.ts` e ajustes em `AgentCore.ts`, `ToolRuntime.ts`, `ReceiptBuilder.ts`, `ResponseValidator.ts`, usando `CapabilityRegistry.ts`, `AutonomyPolicy.ts` e `PersistenceProof.ts` já entregues.
- Relatórios: `supabase/functions/_shared/reports-core` + `src/lib/reports/intelligent` (períodos, engine, cliente) para o mês parcial e a narrativa.
- Admin: nova página em `src/pages/admin/agente` alimentada por RPC admin de observabilidade agentic (agregação sobre execuções/passos/decisões/chamadas de ferramenta), com GRANTs e checagem de permissão de admin.
- Links curtos: tabela de links com token, alvo e expiração + rota pública no app; auditoria de cliques.
- Migrations necessárias: RPC de observabilidade agentic, tabela de links curtos e colunas de plano nos registros de execução.
- Testes: cobertura para o planejador (decomposição e negação por política), recibo sem prova e período parcial do relatório; suíte completa ao final.
- Sem alteração de identidade visual, paleta ou marca; nada é publicado em produção.
