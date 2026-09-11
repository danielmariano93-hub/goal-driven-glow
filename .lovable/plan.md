# Correção definitiva — gasto mensal típico e latência do Nino

## Diagnóstico confirmado no caso real

A pergunta “Nino quanto que eu gasto aproximadamente por mês com transporte?” chegou corretamente com a categoria Transporte, mas o compilador classificou “por mês” como tendência do mês atual. Isso acionou uma comparação, não o cálculo mensal típico. Como o resultado não declarou o recorte realmente executado, a proteção de verdade bloqueou o número — corretamente — porém entregou uma falha em vez da resposta pedida.

O pedido levou cerca de 18,6 segundos entre recebimento e envio. Dentro do agente, foram 7,4 segundos: compilação semântica 2,25 s, leitura de histórico 672 ms e ferramenta errada 1,33 s. Nas últimas 24 horas, turnos sem IA tiveram média de 1,32 s; com uma chamada, 7,14 s. Portanto, este formato precisa sair antes do compilador e seguir caminho determinístico.

## Implementação

### 1. Reconhecer hábito mensal antes da IA

**`FinancialQueryIR.ts`**
- Ampliar o fast path financeiro para reconhecer perguntas de gasto típico por mês em pt-BR: “quanto gasto por mês”, “aproximadamente por mês”, “em média por mês” e variações equivalentes.
- Preservar a entidade textual de categoria no filtro, sem inventar ou aproximar nomes.
- Emitir uma única consulta canônica de gasto mensal típico, nunca `trend` ou comparação.

**`periodResolver.ts`**
- Tornar a detecção habitual a autoridade temporal para esse formato.
- Manter a regra já definida: seis meses completos, mês corrente excluído; mediana por padrão e média somente quando explicitamente pedida.

### 2. Corrigir qualquer IR errado antes da escolha da ferramenta

**`SemanticAspectOverlay.ts`**
- Permitir que o aspecto temporal determinístico substitua um `trend` incorreto produzido pelo compilador quando o texto atual contém sinal inequívoco de hábito mensal.
- Não substituir período nomeado, projeção, janela móvel ou pedido real de evolução.

**`SemanticTurnPipeline.ts`**
- Executar o reconhecimento temporal e a normalização habitual antes do mapeamento de ferramenta.
- Despachar imediatamente para o handler mensal típico quando o formato estiver completo.
- Registrar `early_exit_stage=typical_monthly` e impedir passagem por compilador, comparação e segunda narrativa.
- Manter o bloqueio de preservação para qualquer incompatibilidade verdadeira.

### 3. Garantir entidade e resposta corretas

**`TypicalMonthlyHandler.ts`**
- Resolver “Transporte” contra categorias globais e pessoais com igualdade normalizada.
- Rejeitar categoria ausente ou ambígua com pergunta específica, sem mensagem genérica de período.
- Retornar `executed_ir` completo com categoria, seis meses fechados, competência financeira e estatística usada.
- Entregar valor típico, média de apoio e cobertura real dos meses, sem incluir setembro parcial.

### 4. Reduzir latência estrutural sem enfraquecer a inteligência

**`SemanticCompiler.ts`**
- Remover timeout automático incompatível com chamadas de raciocínio.
- Migrar chamadas server-side editadas para o modelo obrigatório `openai/gpt-6-astra`, via Responses API com streaming e esforço baixo para compilação.
- Reduzir o prompt do compilador ao contrato estrito necessário; não enviar catálogo textual redundante quando o fast path ou shape determinístico já resolveu o turno.
- Preservar ledger real de tokens e latência, com erros do gateway expostos conforme o status.

**`AgentCore.ts`**
- Evitar carregar contexto extenso para turnos resolvidos pelo fast path mensal típico.
- Não realizar humanização por IA quando o handler já devolve narrativa canônica pronta.
- Propagar a etapa de saída antecipada e tempos separados de histórico, resolução, cálculo e envio.

### 5. Regressão e evidência

**`nino-semantic-authority.test.ts`**
- Cobrir “aproximadamente por mês com transporte”, “em média por mês”, “quanto gastei este mês” e “evolução mensal”, provando que apenas os dois primeiros são hábito.

**`nino-semantic-authority-pipeline.test.ts`**
- Reproduzir exatamente a mensagem real e uma pergunta anterior sobre Alimentação.
- Exigir: categoria Transporte, seis meses completos, handler mensal típico, zero compilador, zero ferramenta de comparação e preservação compatível.
- Cobrir categoria inexistente e ambígua com resposta específica.

**Novo teste de orçamento de turno**
- Provar por contadores instrumentados que o caso executa com `llm_calls=0`, uma leitura financeira e sem carregamento de contexto narrativo.

**Validação final**
- Rodar testes focados, suíte completa, guardas de colunas/dependentes/performance, verificação de tipos e build.
- Incrementar a versão do runtime e preparar o lote atômico das 10 funções dependentes.
- Fazer smoke test controlado da frase exata e comparar caminho, valor e latência com o run que falhou.

## Critérios de aceite

1. A frase exata responde ao gasto típico de Transporte usando março–agosto de 2026; setembro parcial fica fora.
2. O caminho registra `typical_monthly_handler`, `llm_calls=0`, `executed_ir` completo e preservação compatível.
3. `compare_financial_metric` nunca é chamado nesse formato.
4. Pergunta sem categoria, categoria inexistente e categoria ambígua recebem clarificação específica; nenhum número de outro recorte é mostrado.
5. O fast path não altera pedidos de mês atual, média explícita, tendência, projeção ou comparação.
6. Meta do agente para esse formato: até 2 segundos em condição normal, medida ponta a ponta separadamente do tempo de entrega do WhatsApp.
7. Nenhuma alteração em lançamentos, categorias ou valores reais.
8. Código e testes serão concluídos primeiro; produção só será atualizada após autorização explícita para este novo patch.
