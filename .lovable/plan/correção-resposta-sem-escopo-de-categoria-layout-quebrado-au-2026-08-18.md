# Correção: resposta sem escopo de categoria + layout quebrado + auditoria de fontes oficiais

## O que aconteceu (verificado nos registros de execução)

A pergunta das 09:48 foi roteada corretamente para o motor determinístico
(`capability = merchant_distribution`, `path = deterministic_tool`, ferramenta
`merchant_distribution` executada). Ou seja: não houve invenção de número pela IA
neste turno — os valores são reais, mas **do escopo errado**.

Três falhas confirmadas:

1. **Categoria não resolvida.** A frase usava referência anafórica ("naquela
   categoria") e a resolução tentou: (a) categoria citada no texto, (b) categoria
   ativa na memória da conversa. Ambas vazias (o turno anterior foi processado
   como conversa geral, sem gravar categoria ativa). Sem categoria, o motor rodou
   **sem filtro** e devolveu o total de TODAS as categorias (R$ 10.715,54), com
   itens de Moradia, Luz, dízimo, Uber etc. Nada na resposta avisou que o escopo
   era global.
2. **A meta ultrapassada não foi usada como âncora.** O usuário disse
   explicitamente "uma das minhas metas foi ultrapassada". Existe motor de metas
   por categoria com teto estourado; ele não é consultado para descobrir de qual
   categoria se trata.
3. **Layout fora do aprovado.** O texto sai do formatador determinístico com
   linha em branco antes da lista e itens em lista numerada; o humanizador de
   resposta tem um reparo gramatical que colapsa qualquer sequência de espaços
   (inclusive quebras de linha) quando dispara, colando a chamada com o item 1 e
   o parágrafo de cobertura no item 8 — exatamente o que aparece no print.
   A lista também não segue o padrão aprovado (bullets, estabelecimento em
   destaque, valor e share alinhados).

## O que será feito

### 1. Nunca responder distribuição sem escopo definido

- Resolução de categoria em cascata, nesta ordem: categoria citada no texto →
  categoria ativa da memória da conversa → **categoria da meta com teto
  ultrapassado / mais próxima do teto no ciclo atual** (quando a mensagem cita
  meta) → categoria do último resultado de ferramenta do turno anterior.
- Se nada resolver e a mensagem indicar escopo de categoria ("naquela/nessa
  categoria"), o Nino **pergunta qual categoria** em vez de responder global.
- Quando a pergunta é legitimamente global ("onde gastei no mês"), a resposta
  declara isso na primeira linha ("Considerando todas as categorias...").
- Período: quando o escopo vem de uma meta, usar o ciclo da meta em vez da
  janela de 30 dias.

### 2. Memória conversacional que realmente amarra o assunto

- Todo turno que executa motor com categoria/estabelecimento/período passa a
  gravar esses ponteiros na memória da conversa (hoje isso falha em turnos
  atendidos como conversa geral).
- Turnos de "conversa geral" com categoria detectada no texto também gravam a
  categoria ativa, para que o follow-up anafórico funcione.

### 3. Layout aprovado, sem colapso de linhas

- O reparo gramatical deixa de colapsar quebras de linha (passa a atuar por
  linha, nunca no texto inteiro).
- Formatação da distribuição no padrão aprovado: linha de contexto com categoria
  e período, bullets com estabelecimento em destaque, valor, share e nº de
  lançamentos, e um bloco final separado de cobertura/reconciliação.
- Teste automatizado garantindo que a resposta preserva as quebras de linha e
  que nunca declara total de categoria sem nomear a categoria.

### 4. Auditoria de fontes oficiais (todos os fluxos)

Auditoria dirigida, com correção onde houver divergência, em:

- Ferramentas do assessor (app e WhatsApp): toda métrica de valor deve vir de
  `finance-core` / snapshot canônico, sem consulta paralela a `transactions`.
- Home, Relatórios, Metas (financeiras e por categoria), Dívidas,
  Antecipações, Insights e mensagens proativas: mesma fonte canônica de período,
  status e identidade de estabelecimento (`merchant_name` com precedência do
  nome definido pelo usuário).
- Paridade app × edge (o teste de paridade do `finance-core` já existe e será
  estendido para cobrir os módulos usados pelos motores novos).
- Entrega: um documento curto de auditoria listando cada fluxo, a fonte
  consumida e o veredito (conforme / corrigido), mais testes para os casos
  corrigidos.

## Detalhes técnicos

- `CapabilityRouter.ts` / `AgentCore.ts`: cascata de resolução de escopo,
  incluindo consulta a metas por categoria estouradas no ciclo; se não resolver,
  devolver pedido de esclarecimento em vez de argumentos vazios.
- `engineTools.ts` (`merchant_distribution`): quando não há `category_id`,
  marcar o resultado como `scope: "all_categories"` para que a resposta declare
  o escopo.
- `ConversationMemory.ts` + gravação no fim do turno no `AgentCore`.
- `DeterministicAnswers.formatMerchantDistribution`: novo layout.
- `ReplyHumanizer.ts`: reparo gramatical por linha.
- Testes em `src/test/`: escopo obrigatório, layout preservado, paridade
  finance-core.
- Deploy das funções `agent-chat` e `whatsapp-webhook` ao final.
