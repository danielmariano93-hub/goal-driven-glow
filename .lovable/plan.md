# Correção E2E da comunicação proativa do Nino

## Diagnóstico confirmado nesta leitura

- O motor proativo monta o alerta de dívida sozinho: em `supabase/functions/_shared/proactive/signals.ts` ele lê apenas `debts` do snapshot (que traz só `id`, `nome`, `valor da parcela`, `saldo` e `dia do vencimento`) e calcula "vence em X dia(s)" com aritmética de dia do mês. Não existe ali nenhuma informação de ciclo pago — por isso uma dívida quitada continua gerando cobrança.
- Em `supabase/functions/_shared/proactive/situations.ts` o título é exatamente o rótulo do sinal e o corpo é o mesmo rótulo + "Confirme o pagamento…". A duplicação nasce na origem, antes de qualquer template.
- Os modelos ativos de dívida no WhatsApp usam a moldura "Lembrete do seu compromisso. / {{body}} / Se já pagou, me avisa aqui…", e a composição final ainda pode acrescentar o título: fato → moldura → mesmo fato.
- A revalidação antes do envio procura o identificador da dívida apenas no primeiro nível da evidência; nos casos reais ele estava aninhado dentro dos sinais, então nada foi bloqueado. E quando a fonte canônica falha, o código hoje libera o envio.
- A regra atual trata "faltam 0 dias" como atraso.
- A fonte canônica existe e está disponível: `debt_obligation_state` (por usuário, data de referência e janela de dias).
- Modelos ativos também repetem o corpo na moldura em outros tipos (caixa, fatura, concentração, revisões), então a auditoria será de todos, não só de dívida.

## O que será feito

### 1. Uma obrigação, uma verdade
- Criar uma camada tipada de obrigações de dívida alimentada exclusivamente pela fonte canônica, com nome, valor da parcela, saldo, situação, status do ciclo atual, data do ciclo, data de pagamento, próximo vencimento, dias até o vencimento, fonte e versão da fórmula.
- O motor proativo passa a consumir essa camada e deixa de recalcular vencimento por dia do mês.
- Ciclo pago não gera sinal, situação, sugestão, lembrete nem mensagem.
- Vencimento hoje com ciclo pendente = "vence hoje" (nunca atraso). Atraso só quando a fonte canônica afirmar atraso.

### 2. Linguagem de prazo em português
- Um único formatador de prazo: hoje, amanhã, em N dias, venceu ontem, há N dias em atraso. A expressão "dia(s)" deixa de existir em qualquer superfície.

### 3. Contrato de comunicação
- Título = síntese única; corpo = complemento (valor, data, consequência); no máximo uma pergunta/ação por mensagem; moldura é só estrutura visual e nunca repete título, corpo ou ação.
- Reescrever os textos de dívida, meta, caixa, fatura e concentração seguindo esse contrato.
- Regra de posse da ação: se o corpo já pergunta, a moldura não pergunta — e vice-versa.

### 4. Defesas finais antes do envio
- Guarda de duplicação que normaliza caixa, pontuação, espaços e marcação e remove a repetição do título ou do primeiro fato, mesmo quando a moldura vem antes do corpo.
- Guarda de ação que impede duas perguntas na mesma mensagem.
- Renderizador único de WhatsApp para mensagens determinísticas e narrativas: título em negrito, valor e data destacados, frases curtas, quebras de linha, emoji só quando ajuda, nenhum marcador técnico.

### 5. Revalidação confiável
- Normalizar a evidência da situação antes da entrega, para que os identificadores canônicos fiquem sempre no mesmo lugar; leitura de evidências antigas aninhadas fica como compatibilidade, num único ponto.
- Se a fonte canônica falhar, lembrete de obrigação é adiado com nova tentativa — nunca enviado sem validação.

### 6. Reconciliação do que já está pendente
- Rotina idempotente, para todos os usuários afetados, que encerra situações, sugestões, lembretes e antecipações de ciclos já pagos. Sem identificador fixo de usuário.

### 7. Observabilidade
- Registrar, por comunicação: título e corpo de origem, modelo e versão, moldura, fonte canônica, resultado e fonte da revalidação, título e corpo renderizados, guardas aplicadas, versão do formatador e mensagem final.

### 8. Auditoria e provas
- Relatório de todos os modelos ativos: tipo, título, corpo, moldura, repete?, ação dupla?, formatação adequada?, ação tomada.
- Testes de dívida A–G (pago, vence hoje, vence amanhã, atrasado de verdade, pago entre geração e envio, identificador aninhado, fonte indisponível), testes de composição e de meta, e uma suíte que renderiza todos os modelos ativos verificando as 10 regras pedidas.
- Varredura read-only de produção antes/depois com as métricas de repetição, ação dupla, marcador técnico, erro de estado de vencimento e supressão de ciclo pago.
- Nenhuma mensagem real será enviada: tudo por leitura, fixture e simulação.

## Entrega final
Causa raiz, tabela de modelos (antes/depois), tabela de dívidas com status canônico e alerta permitido, métricas antes/depois, contagem de testes e ao menos 10 exemplos antes/depois.

## Observação
Nada será publicado sem sua autorização explícita; o redeploy das funções fica para o seu aval no fim.
