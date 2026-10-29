# Conjunto dourado ao vivo do Nino

Mede o Nino de verdade (orquestrador real, dados reais da conta de teste, canal `simulator`: nada é enviado a ninguém).

- Casos: `scripts/e2e/nino-golden-cases.mjs` (≈86 perguntas: gasto/receita/categoria/ranking/comparação/série, estado, análise, conselho, conversa, limites, segurança, seguimentos).
- Gabarito: `scripts/e2e/golden-truth.sql` — SQL independente do código do Nino (competência da Home). Gera `truth.json`; nunca versionamos valores reais.
- Corretor: `nino-golden-score.mjs` (testado em CI por `src/test/nino-golden-score.test.ts`). Veredito: CORRECT, CORRECT_REFUSAL, MISS (recusou onde havia resposta), WRONG (número errado/inventado), INFRA, UNVERIFIED.
- Runner: `nino-golden-run.mjs` fala com uma função temporária (`nino-human-harness.template.ts`) implantada com o SHA sob teste e um token da rodada; depois, trocar por stub 410.

## Regra de produto
**WRONG = 0** (a rodada sai com código 2 se houver). Meta de acerto-ou-recusa-correta ≥ 90%. Uma recusa honesta custa uma pergunta; número errado custa confiança.

## Como rodar
`NINO_E2E_URL=… NINO_E2E_TOKEN=… NINO_E2E_TRUTH=truth.json node scripts/e2e/nino-golden-run.mjs --concurrency=1 --out=resultado.json`

Use concorrência 1 para conferir WRONG: a memória é por pessoa, então casos paralelos contaminam o recorte uns dos outros (artefato do teste, não do produto). Antes de cada release do agente, rode e anexe o resumo ao PR.

## CI
A CI offline garante o corretor e a integridade dos casos; a rodada ao vivo exige harness + token e é feita manualmente antes de mudanças de agente.
