# Nino entende antes de executar (`nino_language.v1`)

O Nino te perguntou como você estava, você respondeu "Ansioso", e ele registrou "Atento". Depois você corrigiu ("não foi atento, foi ansioso") e ele repetiu o mesmo erro. Nesse diálogo nenhuma inteligência tentou te entender: uma tabela de sinônimos decidiu por você.

Confirmei no código e nos seus dados, um por um:

- existe a regra literal que transforma ansioso, nervoso, tenso, agitado e apreensivo em "atento", em dois lugares (app e Nino);
- "ansioso" não existe como sentimento próprio no catálogo, então o sistema é obrigado a trocar;
- a detecção de correção reconhece "não foi isso" e "quis dizer", mas não reconhece a forma mais natural: "não foi X, foi Y";
- o validador de números, quando não consegue provar um percentual, refaz a mesma operação — e nesse caso a operação era um registro. Foi por isso que o check-in gravou duas vezes, nos dois turnos;
- nos seus registros, 3 de 5 marcados como "atento" têm texto seu falando de ansiedade, e há registros antigos gravados fora do catálogo ("ansioso", "Ansiedade", "Impulso"). Os padrões do tipo "quando estou atento gasto mais" estão realmente misturados.

## O que vai mudar

**1. Ansioso passa a ser ansioso.** Entra como sentimento próprio, com escala e ícone próprios, no app e no Nino. Nervoso, tenso, agitado e apreensivo passam a apontar para ansioso, não para atento.

**2. Sentimento que não está na lista.** Quando o Nino não reconhecer o que você disse, ele mostra as opções existentes. Se você insistir naquela palavra ("é apatia mesmo"), ele registra o seu sentimento com o nome que você deu, guarda como sentimento seu e volta a oferecê-lo nas próximas vezes. Sentimento personalizado entra na sua lista, não no catálogo dos outros.

**3. Correção natural é entendida.** "Não foi atento, foi ansioso", "não era triste, era cansado", "quis dizer ansioso" passam a ser lidas como correção do registro anterior: o Nino troca o registro do dia em vez de criar um novo, e diz que corrigiu.

**4. Compreender antes de executar — para todos.** Mensagem humana curta (sentimento, correção, conversa) passa a ter uma etapa de compreensão de linguagem antes de qualquer execução. A palavra exata do catálogo continua instantânea; o resto passa pela compreensão. O que a compreensão devolve é sempre estrutura (qual sentimento, é correção ou não), nunca número e nunca texto final. Conta, registro e valor seguem determinísticos, como hoje.

**5. Validador nunca refaz um registro.** Quando faltar prova de um número, o Nino pode recalcular leitura, mas nunca repetir uma operação que grava. Se a única forma de "provar" fosse gravar de novo, ele mostra a leitura sem o percentual.

**6. Seu histórico corrigido, com rastro.** Só corrijo registros em que o seu próprio texto diz claramente ansioso/nervoso/tenso/agitado/apreensivo, e registros gravados fora do catálogo. Cada correção fica marcada como revisada. Depois disso, os padrões de "atento" voltam a falar só de atento.

**7. Padrão comportamental honesto.** Um padrão só é apresentado quando tem registros suficientes daquele sentimento específico. Se ansioso ainda tiver pouca história, o Nino diz isso em vez de reaproveitar o padrão de atento.

## Detalhes técnicos

- `src/lib/emotions/catalog.ts` e `supabase/functions/_shared/intelligence/emotionParse.ts`: nova chave `ansioso` (mood 2), aliases de ansiedade redirecionados, `atento` volta a significar atenção. Catálogo sobe para `emotion_catalog.v3`, com espelho garantido entre app e Nino.
- Sentimento personalizado: tabela nova por usuário (chave normalizada + rótulo + mood declarado, com GRANT e RLS por `auth.uid()`), consultada pelo resolvedor antes do fallback; nunca cria emoção global.
- Correção: `DialogueAct.ts` ganha padrão `não foi/era X, foi/é Y` (multi-label `repair` + valor novo) e o check-in passa a receber `correction: true`, atualizando o registro do dia e gravando a substituição para aprendizado.
- Camada de compreensão: passo semântico curto e barato antes da rota determinística para mensagens não financeiras de até ~8 palavras (sentimento, correção, conversa), com saída estruturada validada; falha ou indisponibilidade cai no determinístico atual (fail-open apenas para leitura de intenção, nunca para número). Telemetria por estágio no ledger de uso.
- Escrita única: `executeDeterministicCapability` passa a receber o cache de turno em todos os pontos de chamada (`AgentCore.ts:1804` hoje não passa), e o cache passa a bloquear ferramenta de escrita por nome, independentemente dos argumentos. O resgate do Truth Gate fica proibido de executar ferramenta de escrita.
- Backfill SQL idempotente em `emotional_checkins`: reclassifica só com evidência textual forte, normaliza chaves fora do catálogo e marca revisão. Recalcula os padrões emocionais depois.
- Testes: correção natural, ansioso ≠ atento, sentimento personalizado, escrita única sob falha do Truth Gate, backfill idempotente e padrões com amostra insuficiente.
- Runtime sobe para `.16`; redeploy atômico das 10 funções apenas com a sua autorização.

## Fora do escopo

Não mexo em fatos financeiros, valores, competência de fatura nem na camada de narrativa recém-criada. As categorias óbvias sem classificação eu trato em seguida, num passo separado, para não misturar com esta correção.
