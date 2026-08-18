# Correção definitiva: nenhuma resposta do Nino com número inventado

## O que realmente aconteceu (verificado)

Consultei os dois turnos do print (09:08 e 09:11, horário de SP) no registro de execução do assessor:

- Capacidade escolhida: `general`
- Ferramentas usadas: **nenhuma** (`tools_used` vazio nos dois turnos)
- Modelo: chat genérico, caminho `llm`

Ou seja: o Nino **não consultou o motor financeiro**. Os valores "iFood R$ 250,00", "Supermercado R$ 180,00" e "Restaurante R$ 100,00" foram inventados pelo modelo — não existem no seu banco.

Os dados reais de Alimentação entre 01/08 e 18/08 (lançamentos confirmados) são outros. Os três maiores estabelecimentos, com o motor canônico:

- 99 Food — R$ 190,05 (3 compras: 70,35 + 66,15 + 53,55)
- iFood — R$ 151,02
- Souk4u — R$ 90,00

Confirmando o que você percebeu: 99 Food é o **maior** gasto da categoria e foi omitido. A normalização de estabelecimento (`99 Food` a partir de "PAY 99Foo 02/08" e "PIX WHATS QRCODE 99 FOOD02/08") funciona corretamente no motor — o problema é que o motor nunca foi chamado.

## Causas raiz (três, todas confirmadas em código)

1. **Roteamento perdeu a pergunta.** A capacidade determinística `merchant_distribution` só é acionada por expressões como "quais estabelecimentos" ou "onde mais gastei em X". A sua frase — "quais os locais onde eu mais tive gasto naquela categoria, com valor e quanto representou do total" — não casa com nenhum padrão, então caiu na rota genérica de conversa.
2. **O portão factual não bloqueia quando não há evidência nenhuma.** O validador de verdade (`TruthValidator`) detecta corretamente "número sem evidência", mas o núcleo só substitui a resposta quando existe uma headline canônica de alguma ferramenta. Sem ferramenta executada, ele apenas **registra o problema no log e envia a resposta inventada**. É exatamente esse buraco que produziu o print.
3. **Referência à categoria anterior não é resolvida.** "naquela categoria" depende do turno anterior (alerta da meta de Alimentação). Na rota determinística de distribuição, nenhuma categoria e nenhum período são preenchidos a partir da memória da conversa nem do alerta de meta que originou a pergunta.

## Correção proposta

### 1. Portão factual sem escapatória (`truth_gate.v2`)
Regra nova e absoluta: **se a resposta contém valor em R$ ou percentual e nenhuma ferramenta determinística foi executada com sucesso no turno, a resposta não é enviada.** O Nino, em vez disso:
- executa a ferramenta correspondente à pergunta quando ela é identificável (retentativa dirigida), ou
- responde com honestidade curta ("Deixa eu puxar seus números reais dessa categoria" + o resultado do motor), ou
- pede a informação que falta, sem citar nenhum número.

O mesmo vale para números que existem na resposta mas contradizem a evidência: hoje isso só é trocado quando há headline; passará a ser sempre trocado pelo texto determinístico do motor.

Isso vale para todas as categorias e todos os tipos de pergunta, não só metas — é uma regra do núcleo, aplicada no app, no WhatsApp e no simulador.

### 2. Cobertura de roteamento para "onde/quais locais gastei"
Ampliar o reconhecimento da capacidade `merchant_distribution` para as formas naturais em que a pergunta aparece: "locais", "lugares", "onde", "em que estabelecimentos", "quem mais pesou", "com valor e percentual do total", "quanto representou do total". Também cobrir a variação "analise novamente" (reexecução do mesmo pedido do turno anterior), que no print gerou uma segunda alucinação.

### 3. Resolução da categoria e do período pela conversa
Ao entrar em `merchant_distribution` sem categoria explícita, preencher automaticamente:
- categoria a partir da memória da conversa (tópico/categoria ativa) e, na falta dela, a partir do alerta de meta de categoria mais recente que o Nino enviou;
- período a partir do ciclo da meta quando a pergunta é derivada de um alerta de meta; caso contrário, o mês corrente.

Com isso, "naquela categoria" passa a significar exatamente Alimentação no ciclo da meta, e o denominador do percentual é o total real da categoria (não a soma dos três primeiros).

### 4. Transparência de cobertura na resposta
A resposta determinística já sabe declarar cobertura. Passará a sempre mostrar, quando houver gasto sem estabelecimento reconhecido, quanto ficou fora — para que você nunca precise adivinhar se algo foi descartado. E o total da categoria é sempre exibido junto ao ranking.

### 5. Auditoria visível
Registrar por turno: capacidade, ferramentas usadas, e a lista de números com/sem proveniência. No painel admin, um indicador de "respostas bloqueadas por falta de evidência" para que uma regressão dessas apareça no dia seguinte, não semanas depois.

## Verificação antes de fechar

- Reexecutar a pergunta exata do print e conferir que a resposta traz 99 Food como líder, com o total real da categoria e percentuais do motor.
- Rodar a mesma pergunta com outras categorias (Transporte, Mercado) e com frases variadas ("onde mais gastei", "quais lugares pesaram", "analise novamente").
- Forçar um caso sem ferramenta disponível e confirmar que nenhum número é inventado.

### 6. Renomear um lançamento passa a valer nos relatórios

Confirmei o problema no código: ao renomear (individual ou em lote), o app grava **apenas** o campo de descrição. Mas a identidade do estabelecimento usada por relatórios, rankings e pelo Nino segue a precedência `merchant_name` → `normalized_description` → descrição. Como o nome do banco continua em `merchant_name`, o relatório mostra o nome antigo e o seu novo nome é ignorado.

Correção:
- renomear passa a gravar o nome escolhido também como identidade canônica do estabelecimento (`merchant_name` + normalização), marcando a origem como "definido pelo usuário";
- nome definido pelo usuário tem **precedência máxima** — nenhuma reimportação, alias global ou categorização automática pode sobrescrevê-lo;
- opcionalmente, ao renomear, o Nino pergunta se deve aplicar o mesmo nome aos lançamentos futuros do mesmo estabelecimento (aprendizado de alias já existente no produto);
- vale para renomeio individual e em lote, e o efeito aparece imediatamente nos relatórios, na Home, nas metas por categoria e nas respostas do assessor.

## Detalhes técnicos

- `src/pages/Lancamentos.tsx` (renomeio individual e `runBulkRename`): passar a gravar `merchant_name`, `normalized_description` e a marca de origem do usuário, além de `description`.
- `src/lib/engine/merchant.ts` (e a cópia sincronizada em `supabase/functions/_shared/finance-core/merchant.ts`): respeitar nome definido pelo usuário como verdade absoluta na precedência.
- Alias de estabelecimento (`merchant_aliases`) atualizado quando o usuário confirma aplicar o novo nome aos próximos lançamentos.


- `supabase/functions/_shared/agent/core/AgentCore.ts`: bloqueio duro quando `truth.issues` inclui `no_evidence`/`value_not_in_evidence` — retentativa dirigida à ferramenta da capacidade, e fallback textual sem número.
- `supabase/functions/_shared/agent/core/CapabilityRouter.ts`: novos padrões para `merchant_distribution` + preenchimento de `tool_args` (`category_name`, `from`, `to`) a partir de `ConversationMemory` e do alerta de meta (`financial_situations` / `nino_intelligence_items` de tipo meta).
- `supabase/functions/_shared/agent/core/DeterministicAnswers.ts`: reforço do texto de cobertura e total da categoria em `formatMerchantDistribution`.
- `supabase/functions/_shared/agent/core/TruthValidator.ts`: separar veredito "sem evidência" (bloqueante) de "derivado" (aceito) e devolver a capacidade sugerida para retentativa.
- Sem mudança de schema; apenas telemetria já existente em `agent_runs` / `agent_turn_events`.
