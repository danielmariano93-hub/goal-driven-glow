---
name: Nino conversacional
description: Rota casual do Nino (identidade, saudação, conversa geral) fora do pipeline financeiro, aviso de espera condicional e saneamento de fornecedor sem quebrar frase
type: feature
---
- `agent/core/Conversational.ts` é a fonte única da persona (`NINO_PERSONA`) e da identidade (`NINO_IDENTITY`). Nunca duplicar identidade em prompt.
- Identidade/capacidade/social vencem sinais financeiros fracos; qualquer outro sinal financeiro devolve o turno ao pipeline analítico.
- Conversa casual NÃO recebe aviso "só um instante" (`shouldAcknowledge`) e não chama ferramentas financeiras.
- `ReplyHumanizer` remove a oração de autoria inteira ("criado pelo Google") e repara preposição órfã; `findBrokenPhrases` valida.
- Nino nunca menciona fornecedor de IA nem nomes internos de motores/ferramentas.
