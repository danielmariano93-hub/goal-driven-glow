## O que encontrei

Os números estão certos (o motor `finance_contract.v4` já usa despesa comportamental e pontes reconciliadas). O problema está em **duas camadas**:

### 1. Vocabulário antigo de "resultado negativo"
O motor v4 definiu a regra: nunca expor resultado negativo isolado — usar "gastos acima das receitas" (`operationalGap`, em `bridges.ts` → `explainBalanceChange`). Mas estes pontos ainda usam a linguagem antiga:

- `src/lib/reports/intelligent/highlights.ts` (detector `negative_result`): título "O mês fechou negativo em R$ X".
- `src/lib/reports/intelligent/narrative.ts`: "...fechando positivo/negativo em R$ X" (resumo do relatório e mensagem de WhatsApp com "Resultado: -R$ X").
- Espelhos em `supabase/functions/_shared/reports-core/highlights.ts` e `.../narrative.ts` (arquivos gerados por `scripts/sync-finance-core.mjs`).
- `src/lib/insights/fallbacks.ts` e `supabase/functions/_shared/insights/fallbacks.ts`: "Você fechou R$ X no positivo" (assimetria de linguagem com o caso de gap).
- `supabase/functions/_shared/agent/core/UserProfile.ts`: tag comportamental `deficit` alimenta o prompt do assessor e induz a fala de "déficit/mês negativo".
- `supabase/functions/insights-generate/index.ts` já tem a instrução correta no prompt, mas ela não cobre a palavra "fechou negativo" nem o vocabulário canônico.

### 2. Patrimônio líquido inconsistente
- **Cálculo divergente**: `UserProfile.ts` (perfil que o Nino usa no app e no WhatsApp) calcula `net_worth` como saldos de conta + investimentos − dívidas da tabela `debts`, **sem a fatura de cartão em aberto**. O canônico `computeNetWorth` (`src/lib/engine/facts.ts`, espelhado em `_shared/finance-core/facts.ts`) subtrai cheque especial + fatura de cartão + outras dívidas. Resultado: o Nino fala um patrimônio diferente do que a Home/Relatórios mostram.
- **Copy contraditória**: em `src/components/home/PatrimonioSheet.tsx` o texto diz "dívida não reduz o que você já guardou" logo acima de uma linha chamada **"Patrimônio líquido"** que subtrai justamente as dívidas. A frase é sobre "Seus recursos hoje", mas lida na sequência parece dizer que o número final ignora dívidas.
- **Labels sem definição** em `src/components/finance/FinanceBlocks.tsx` (`PositionBlock`), `src/pages/AssessorAcompanhamento.tsx` e `src/pages/admin/IAInteligencia.tsx`: só "Patrimônio"/"Patrimônio líquido", sem dizer que já está líquido de fatura e dívidas.

## Correções propostas

### A. Dicionário único de resultado (novo `src/lib/copy/resultWording.ts`, espelhado para as functions)
Funções puras de copy, sem cálculo:
- `resultHeadline(income, expense, periodWord)` → sobra: "Sobraram R$ X de R$ Y recebidos"; gap: "Gastos acima das receitas: R$ X"; zero: "Receitas e gastos empatados".
- `resultSentence(...)` para narrativa: "Você registrou R$ Y de receitas e R$ Z de gastos — **gastou R$ X acima do que recebeu** neste mês" (nunca "fechou negativo").
- Regra fixa: nada de "negativo", "déficit", "no vermelho" na copy de usuário.

Aplicar em:
1. `highlights.ts` — detector `negative_result` passa a título "Você gastou R$ X acima do que recebeu" e corpo já existente sobre categorias flexíveis (mantendo `detectorKey`, `family` e `dedupKey` para não quebrar dedup/telemetria e testes).
2. `narrative.ts` — `deterministicSummary` e `whatsappMessage` (linha "Resultado" vira "Sobra" ou "Gastos acima das receitas", sempre valor absoluto).
3. `fallbacks.ts` (app + function) — títulos simétricos ("Sobraram R$ X este mês" / "Você gastou R$ X acima do que recebeu").
4. `UserProfile.ts` — renomear a tag `deficit` para `gasto_acima_da_receita` e ajustar onde ela é lida no prompt.
5. Reforçar no `SYSTEM_PROMPT` do assessor (`_shared/agent/prompt.ts`) e no prompt do `insights-generate`: proibição explícita de "fechou negativo/déficit/no vermelho"; usar sempre a formulação de gap.

### B. Patrimônio líquido: uma fonte, um label
1. `UserProfile.ts` passa a usar o canônico `computeNetWorth` (`_shared/finance-core/facts.ts`), incluindo fatura de cartão em aberto e cheque especial — mesmo número da Home.
2. `PatrimonioSheet.tsx`: reescrever o texto explicativo para eliminar a contradição — deixar claro que "Seus recursos hoje" = conta + investido (bruto) e que "Patrimônio líquido" = recursos − fatura em aberto − outras dívidas; incluir a conta na própria linha final ("R$ recursos − R$ obrigações").
3. `FinanceBlocks.PositionBlock`: adicionar hint curto em "Patrimônio líquido" ("já descontadas fatura e dívidas") e em "Seus recursos hoje" ("antes das obrigações").
4. `AssessorAcompanhamento.tsx` e `admin/IAInteligencia.tsx`: label "Patrimônio líquido" + tooltip/legenda com a mesma definição.
5. Glossário do assessor: definir `net_worth` como líquido de fatura e dívidas, para o Nino nunca dizer que não considera dívidas.

### C. Sincronização e validação
- Rodar `scripts/sync-finance-core.mjs` para regenerar os espelhos em `supabase/functions/_shared/*` (os arquivos gerados não são editados à mão).
- Novos testes: (a) nenhum texto de highlight/narrativa/fallback contém "negativo|déficit|vermelho"; (b) `UserProfile.net_worth` == `computeNetWorth().net` no mesmo conjunto de dados; (c) simetria de copy para sobra e gap.
- Rodar a suíte completa (~954 testes) e o typecheck.

## Detalhes técnicos
- Nenhuma alteração de motor, schema, migration ou RPC: só camada de copy + troca do cálculo divergente do `UserProfile` pelo canônico já existente.
- `detectorKey`/`dedupKey`/`family` preservados para não invalidar relatórios já gerados nem a telemetria de utilidade.
- Relatórios já publicados continuam com o texto antigo até o próximo `REPORT_TEMPLATE_VERSION`; proponho incrementar essa versão para o auto-heal reescrever os textos na próxima abertura.
- Deploy das Edge Functions afetadas (`financial-reports-generate`, `insights-generate`, `agent-chat`, `whatsapp-webhook`) e publicação só com sua autorização.
