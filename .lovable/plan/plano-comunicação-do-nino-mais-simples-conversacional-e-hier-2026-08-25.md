# Plano — Comunicação do Nino mais simples, conversacional e hierárquica

Objetivo: fazer o Nino parar de “provar inteligência” em blocos densos e passar a entregar entendimento rápido: **o que aconteceu → por que importa → o que fazer**, sem alterar fórmulas financeiras e sem aumentar consumo de IA.

## Diagnóstico verificado no código

1. **Relatórios antigos continuam densos porque a tela lê texto já persistido.**
   - A tela de detalhe do relatório renderiza `report.executive_summary` e `report.closing_text` diretamente.
   - Mesmo com a narrativa determinística mais curta já criada, relatórios existentes podem continuar mostrando o texto antigo até serem recalculados ou reinterpretados na apresentação.

2. **A “Leitura do Nino” ainda não tem separação visual entre conclusão e detalhes.**
   - Hoje o bloco mostra um parágrafo único para `executive_summary` e outro para `closing_text`.
   - Não há nível 1/nível 2 na UI do relatório: conclusão, comparação, categorias e recomendação ficam visualmente no mesmo peso.

3. **Os destaques do relatório ainda competem entre si.**
   - `ReportHighlightList` renderiza todos os destaques como cards equivalentes.
   - O tipo “risk” vira chip “Risco” em todos, então vários riscos aparecem com o mesmo peso.

4. **WhatsApp proativo ainda corta frases analíticas, mas não reescreve por intenção.**
   - `diagnosisToCommunication.ts` usa a primeira frase de `summary`/`explanation`.
   - Se a origem diz “Sem categoria explicou 73,15%…”, o WhatsApp ainda soa como analytics, só mais curto.

5. **A base de comunicação já existe, mas ainda não cobre todas as superfícies.**
   - Existem `numbers.ts`, `ninoVoice.ts` e `commIntent.ts` com regras de jargão, limites e números compactos.
   - Falta aplicar isso de verdade em relatório, destaques e WhatsApp, além de garantir testes contra regressão.

## Resultado esperado

### No app

- Uma tela/card sempre abre com **uma conclusão principal**.
- O primeiro nível mostra no máximo **1–2 números essenciais**.
- Os detalhes ficam em “Como o Nino chegou aqui” ou em seções secundárias.
- Só um alerta aparece como preocupação principal; os demais viram sinais secundários.
- A headline deixa de ser o nome do indicador e passa a ser a conclusão.

Exemplo de leitura alvo:

```text
Você gastou R$ 4,2 mil a mais do que recebeu neste mês.
A boa notícia é que seus gastos caíram bastante em relação a julho.

O ponto que mais merece atenção são os gastos que dão pra ajustar.
Ver detalhes
```

### No WhatsApp

- Mensagens com até 3–4 linhas.
- Sem parágrafo de relatório.
- Sem percentuais com duas casas no primeiro nível.
- Pergunta final específica ao problema.

Exemplo alvo:

```text
Seus gastos aumentaram principalmente por lançamentos sem categoria.
Foram R$ 2,6 mil neste período, contra R$ 167 no anterior.
Antes de concluir que você gastou mais, vale organizar esses lançamentos.
Quer que eu te ajude a revisar?
```

## Plano de implementação

### 1. Corrigir a Leitura do Nino nos relatórios

- Criar uma apresentação de relatório que derive a leitura atual do `payload` do relatório quando ele existir.
- Usar o texto persistido apenas como fallback.
- Separar o bloco em:
  1. conclusão principal;
  2. contexto curto;
  3. próximo passo;
  4. detalhes sob demanda.
- Evitar que receitas, despesas, comparação, categorias, maior gasto e recomendação apareçam todos no mesmo parágrafo.

### 2. Rebaixar alertas secundários no relatório

- Refatorar `ReportHighlightList` para escolher um destaque principal.
- Mostrar os demais como linhas compactas de apoio, não como vários cards de risco equivalentes.
- Trocar “Risco” repetido por linguagem mais humana e contextual:
  - “Atenção principal” para o item principal;
  - “Também vale olhar” para os secundários.

### 3. Transformar WhatsApp de analytics em conversa

- Substituir a lógica atual de “pegar a primeira frase do summary” por um renderer por intenção.
- Para “Sem categoria”, gerar mensagem específica: organização antes de conclusão de gasto real.
- Para categoria que subiu, cartão, dívida, meta e caixa, gerar frases com:
  1. o que aconteceu;
  2. por que importa;
  3. o que fazer;
  4. pergunta final.
- Usar valores compactos e percentuais arredondados no WhatsApp.

### 4. Centralizar vocabulário humano

- Ampliar `ninoVoice.ts` para banir/transformar termos que ainda aparecem nas superfícies:
  - “explicou X%” → “veio principalmente de…”;
  - “gastos flexíveis” → “gastos que dão pra ajustar”;
  - “projeção de caixa” → “como seu mês deve fechar”;
  - “composição” → “de onde veio”;
  - “taxa de sobra” → “quanto sobrou”.
- Aplicar a humanização antes de exibir relatório, destaque e WhatsApp.

### 5. Tratar relatórios já existentes

- Fazer a tela reinterpretar o relatório antigo no cliente quando houver `payload` suficiente.
- Se o relatório não tiver payload suficiente, exibir o texto persistido com quebra em frases e limite visual, para não formar um bloco pesado.
- Opcionalmente, ao recalcular relatório, persistir o novo formato curto para os próximos acessos.

### 6. Testes de contrato de comunicação

Adicionar/ajustar testes garantindo:

- Relatório: nível 1 com no máximo 3 frases e 3 números.
- WhatsApp: no máximo 4 linhas.
- Headline: sem percentuais com duas casas.
- Nenhuma frase “explicou 73,15%” no primeiro nível.
- Nenhuma tela com mais de um card protagonista de risco.
- Detalhes continuam acessíveis sob demanda.
- Fórmulas financeiras não mudam.

## Escopo técnico

Arquivos prováveis:

- `src/pages/RelatorioInteligenteDetalhe.tsx`
- `src/components/relatorios/ReportHighlightList.tsx`
- `src/lib/reports/intelligent/narrative.ts`
- `supabase/functions/_shared/reports-core/narrative.ts`
- `src/lib/copy/commIntent.ts`
- `src/lib/copy/ninoVoice.ts`
- `src/lib/copy/numbers.ts`
- `supabase/functions/_shared/copy/commIntent.ts`
- `supabase/functions/_shared/copy/ninoVoice.ts`
- `supabase/functions/_shared/copy/numbers.ts`
- `supabase/functions/_shared/intelligence/diagnosisToCommunication.ts`
- testes em `src/test/*nino-comm*` e relatórios

## Fora de escopo

- Não mudar cálculo financeiro.
- Não mudar banco, autenticação, integrações ou modelo de dados.
- Não criar novo motor de IA.
- Não aumentar chamadas de IA.
- Não alterar identidade visual, símbolo, wordmark ou paleta.

## Critérios de aceite

1. A “Leitura do Nino” deixa de ser um bloco único denso.
2. Relatórios antigos também ficam legíveis na tela, quando houver payload para reinterpretar.
3. A tela mostra uma preocupação principal e rebaixa as demais.
4. WhatsApp deixa de enviar frases do tipo “Sem categoria explicou 73,15%…”.
5. Percentuais em headline aparecem arredondados.
6. Termos técnicos são traduzidos para linguagem cotidiana.
7. Detalhes continuam disponíveis sob demanda.
8. Testes passam sem mudança de fórmulas financeiras.
