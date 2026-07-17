# Diagnóstico minucioso: por que o assessor entra em loop e falha no PDF

## Evidências confirmadas

1. O problema atual não é mais upload físico.
   - Os documentos recentes chegam ao backend e entram no pipeline.
   - A falha recorrente agora acontece na extração por IA.

2. As tentativas recentes falham por JSON inválido causado por truncamento da resposta do modelo.
   - Documento `910e5d1a-8874-420b-86bd-4a228b0eb6bc`: `status='failed'`, `error='extraction:invalid_json|cid=10be2264-2431-4709-8ee2-2b3b7886fb56'`, `tokens_out=8000`, `extraction_ms=31914`, `extracted_count=0`.
   - Documento `f36e4728-895e-450d-8eba-3de5bab440c6`: `status='failed'`, `error='extraction:invalid_json|cid=f645c27a-83dc-44c5-80de-010102431da5'`, `tokens_out=8000`, `extraction_ms=34209`, `extracted_count=0`.
   - Documento `31e950a0-13c1-463a-9843-0be10dd06581`: `status='failed'`, `error='extraction:invalid_json|cid=7f14dd05-ffbd-4f08-9705-cdf1d736072f'`, `tokens_out=8000`, `extraction_ms=33923`, `extracted_count=0`.
   - O padrão `tokens_out=8000` exatamente igual ao limite configurado indica saída cortada antes de fechar o JSON.

3. O pipeline já conseguiu extrair esse tipo de documento antes, mas com custo/tempo inviável.
   - Documento `703108bb-e07c-4c2e-8df6-97b6a225dd50`: `extracted_count=235`, `tokens_out=43074`, `extraction_ms=166132`, `status='canceled'`.
   - Isso prova que o documento é interpretável, mas a abordagem atual exige resposta longa demais.

4. O usuário vê mensagem ruim porque `invalid_json` vira erro genérico de “documento confuso”.
   - Na prática, o problema não é o PDF ser confuso; é o contrato de saída da IA ser grande demais e frágil.

5. O loop vem da combinação de falha retentável + retomada/polling + processamento sem checkpoint útil.
   - Quando a IA falha antes de gravar `extracted_items`, o documento fica sem resultado útil.
   - Reprocessar o documento inteiro repete a mesma chamada longa e volta a bater no limite.

## Causa raiz

A extração está tentando transformar um PDF inteiro em um único JSON grande, com objetos verbosos por lançamento. Em extratos densos, o modelo gera muitos itens e atinge o teto de saída (`8000` tokens), deixando JSON incompleto. Como a gravação só acontece após parsear o JSON inteiro, qualquer truncamento descarta tudo.

# Plano de correção definitiva

## 1. Trocar a extração monolítica por extração em lotes com checkpoint

Implementar no `assistant-ingest-document` um modo de processamento por páginas/faixas:

- Detectar PDF e dividir o trabalho em janelas pequenas.
- Processar cada janela separadamente com limite rígido de itens por lote.
- Persistir os itens válidos imediatamente após cada lote.
- Atualizar `counters`, `updated_at` e metadados de progresso a cada lote.
- Se um lote falhar, marcar apenas aquele trecho como falho e preservar os lançamentos já extraídos.

Resultado esperado: um erro em uma parte do PDF não joga fora tudo que já foi extraído.

## 2. Reduzir drasticamente o tamanho do contrato de resposta da IA

Alterar o prompt e o parser para aceitar resposta compacta, com menos tokens:

```json
{
  "k":"statement",
  "n":"observações curtas",
  "i":[
    ["expense","2026-07-16",9.93,"Uber","account",null,null,"transaction"]
  ]
}
```

Mapear internamente para o contrato canônico atual (`ExtractedItem`).

Manter compatibilidade com o formato antigo durante a transição.

## 3. Usar fallback de recuperação de JSON parcial

Quando o modelo retornar JSON truncado:

- Tentar extrair o maior prefixo válido do array `i`.
- Salvar os itens recuperáveis.
- Marcar o documento como `needs_review` com nota de extração parcial, em vez de `failed` total quando houver itens aproveitáveis.

Resultado esperado: `invalid_json` deixa de ser erro fatal quando há lançamentos úteis na resposta.

## 4. Prompt mais operacional, menos interpretativo

Substituir instruções subjetivas por regras mecânicas:

- Extrair somente linhas transacionais.
- Ignorar saldo, limite, total, cabeçalho, rodapé, fatura paga, resumo e propaganda.
- Não resumir o documento.
- Não explicar raciocínio.
- Não preencher categoria se não estiver clara.
- Preservar descrição literal quando não houver merchant conhecido.
- Retornar no máximo N itens por lote.
- Se houver mais itens no trecho, sinalizar `has_more=true`/nota curta.

## 5. Melhorar a UX de erro/progresso no painel do assessor

No `AssessorPanel`:

- Mostrar estados distintos: `enviado`, `lendo arquivo`, `extraindo lançamentos`, `salvando revisão`, `revisão parcial`, `falhou`.
- Trocar “documento confuso” por mensagens técnicas amigáveis:
  - “Consegui ler parte do arquivo. Revise os lançamentos encontrados.”
  - “A extração ficou grande demais. Vou tentar por partes.”
  - “Não consegui acessar o arquivo enviado” apenas quando for upload/storage real.
- Não disparar reprocessamento automático imediato após `invalid_json`; usar botão “Tentar novamente por partes”.

## 6. Anti-loop real no processamento de documentos

Adicionar proteção por documento:

- Registrar tentativa atual com `cid`, modo e janela processada.
- Se o mesmo documento falhar pelo mesmo erro duas vezes seguidas, mudar estratégia automaticamente para lote menor.
- Se falhar três vezes, parar e pedir ação do usuário, sem continuar reprocessando sozinho.
- Não chamar `resume` em documento com erro terminal recente.

## 7. Validação E2E com evidências

Depois da implementação, validar com o documento real recente:

- Reprocessar `910e5d1a-8874-420b-86bd-4a228b0eb6bc` ou novo upload equivalente.
- Confirmar no banco:
  - `status='needs_review'` ou `status='completed'`.
  - `extracted_items > 0`.
  - `tokens_out` por chamada abaixo do teto.
  - `counters.total_items` coerente.
- Confirmar nos logs:
  - nenhuma chamada bate exatamente `tokens_out=8000`.
  - sem `extraction:invalid_json` fatal.
- Confirmar na UI:
  - painel abre revisão em lote.
  - usuário consegue editar e confirmar.

# Arquivos previstos

- `supabase/functions/assistant-ingest-document/index.ts`
  - Extração compacta, lotes, checkpoints, fallback de JSON parcial e anti-loop.
- `supabase/functions/_shared/documents/types.ts`
  - Parser compatível com formato compacto e formato antigo.
- `src/components/assessor/AssessorPanel.tsx`
  - Estados e mensagens de erro/progresso mais precisos.
- Testes em `src/test/assistant-ingest-retry.test.ts` ou novo teste de parser compacto.

# Fora do escopo

- Não mexer em WhatsApp webhook, WAHA, sessão ou infraestrutura de WhatsApp.
- Não publicar frontend.
- Não alterar o schema principal sem necessidade.
- Não apagar dados antigos automaticamente.

# Resultado esperado

O assessor deixa de depender de uma única resposta gigante da IA. PDFs densos passam a ser processados por partes, com salvamento incremental, mensagens corretas e proteção contra loop. Mesmo quando a IA produzir saída parcial, o usuário deve conseguir revisar os lançamentos extraídos em vez de receber uma falha genérica.