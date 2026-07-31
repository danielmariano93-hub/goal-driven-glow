# MeuNino — pacote completo de produto (31/07/2026)

Base validada: `origin/main` no commit `961256098682d904cf1766eff3442fa627f05156`.

Este patch é incremental. Não reaplica migrations financeiras anteriores e não substitui os contratos MCP já publicados.

## O que muda

### 1. Cartões e faturas

- Cada fatura passa a abrir um detalhe mobile-first com total, pago, em aberto, itens e histórico de pagamentos.
- Descrição e categoria de lançamentos confirmados podem ser corrigidas sem criar outra despesa.
- O pagamento é feito na fatura específica e continua sendo baixa de caixa/obrigação, não nova despesa de consumo.
- Pagamentos podem ser desfeitos de forma atômica. A baixa, a alocação e a transação são revertidas; o estado da fatura e das parcelas é recalculado; uma fotografia auditável é preservada.
- Se a fatura já recebeu pagamento, alterações econômicas ficam bloqueadas até a reversão. Categorias e descrições permanecem corrigíveis.

### 2. Experiência única do Nino

- `Acompanhamento` e `O que o Nino sabe` deixam de competir no menu.
- O menu passa a ter apenas `Meu Nino`.
- A mesma tela possui duas visões: `Meu plano` (mudanças, impacto e ações) e `O que aprendeu` (dados que personalizam a análise e podem ser corrigidos/apagados).
- A rota antiga redireciona para a visão correta, preservando links existentes.

### 3. Admin, IA e comunicações

- Novo destino `Nino & IA` para configurar modelos por tarefa, fallback, limites e conhecimento oficial.
- Conhecimento inicial inclui site oficial, funcionamento da divisão do rolê e regra de privacidade do participante.
- Comunicações ganham nomenclatura orientada à operação: `Jornadas`, `Mensagens` e `Entregas e regras`.
- Régua da cobrança da divisão do rolê fica visual e editável: antecedência, vencimento, atraso, repetição, limite, horário e pausa após resposta.
- Participante não vinculado que responde no WhatsApp recebe contexto útil do próprio rolê, sem exposição de dados do responsável.
- Extração/classificação de documentos passa a respeitar o roteamento de modelos configurado no admin.

## Implantação na Lovable

Executar em Plan Mode e confirmar a ordem antes de alterar produção:

1. Aplicar as migrations novas, em ordem cronológica:
   - `20260731013000_nino_admin_knowledge_communication.sql`
   - `20260731213000_statement_detail_edit_and_payment_reversal.sql`
2. Regenerar os tipos do Supabase se o pipeline da Lovable exigir.
3. Implantar as Edge Functions alteradas:
   - `assistant-ingest-document`
   - `whatsapp-webhook`
4. Não substituir nem remover a função `mcp` já publicada. O patch é compatível com os contratos MCP atuais.
5. Executar testes e build.
6. Fazer smoke test autenticado em staging.
7. Só então publicar o frontend.

## Smoke test obrigatório

### Fatura

1. Abrir Cartões → Histórico de faturas → Ver e editar fatura.
2. Alterar categoria e descrição de um item e recarregar a página; a edição deve persistir no item e na transação vinculada.
3. Registrar pagamento parcial; conferir conta, fatura e histórico.
4. Desfazer o pagamento; conferir restauração do saldo, status e valor em aberto.
5. Repetir o comando de reversão; deve responder de forma idempotente, sem duplicar saldo.

### Nino

1. Em Mais, confirmar que existe apenas `Meu Nino`.
2. Alternar entre `Meu plano` e `O que aprendeu` sem navegar para telas concorrentes.
3. Acessar `/app/nino-contexto`; deve redirecionar para a visão de aprendizado.

### Admin

1. Abrir `Nino & IA`; listar e editar uma rota de modelo, salvar e recarregar.
2. Criar/editar conhecimento oficial e verificar persistência.
3. Em Comunicações → Jornadas, alterar a régua do rolê, salvar e confirmar reagendamento da fila.
4. Em Mensagens, editar um template e simular sem envio real.

## Validação local realizada

- `npm run build`: aprovado.
- 24 testes dirigidos em 5 arquivos: aprovados.
- `git diff --check`: aprovado.
- A suíte completa foi iniciada, mas o executor local solicitou acesso de rede em testes não relacionados e cancelou a execução. A Lovable deve executar a suíte integral no ambiente do projeto antes de publicar.

## Rollback

- Frontend/Functions: restaurar o commit anterior.
- Não apagar as tabelas de auditoria em rollback.
- Desativar as novas jornadas pelo admin, se necessário.
- As RPCs novas são aditivas e não alteram assinaturas das RPCs financeiras já publicadas.
