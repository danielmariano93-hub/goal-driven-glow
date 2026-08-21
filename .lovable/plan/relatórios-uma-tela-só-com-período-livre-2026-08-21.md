# Relatórios: uma tela só, com período livre

## O problema hoje

A aba "Relatórios" tem duas telas que contam a mesma história:

- **Fechamentos** já gera "o mês em andamento" (números reais até hoje + projeção).
- **Período atual** repete o mês corrente com indicadores de outra fase do produto (ponte de caixa mês a mês, gráficos, blocos patrimoniais soltos), sem a leitura do Nino.

E não existe hoje nenhuma forma de pedir um relatório de um período escolhido por você: os únicos períodos são semana fechada, mês fechado e mês corrente.

## O que passa a existir

Uma **única tela de Relatórios**, sem abas:

```text
Relatórios
Leitura do Nino sobre o período que você escolher

[ Última semana ]  [ Último mês ]  [ Mês em andamento ]
[ Escolher período ▾ ]        (de / até, com atalhos)

Histórico
 8,2  Semana · 10/08 a 16/08         >
 6,1  Mês · julho de 2026            >
 7,4  Período · 01/07 a 15/08        >
```

- Um seletor de período (atalhos + datas "de/até") gera o relatório daquele intervalo exato.
- Todo relatório gerado — inclusive o de período livre — é **salvo no histórico**, com nota de saúde, destaques e leitura do Nino, e pode ser reaberto ou excluído como os demais.
- A comparação é honesta: o período anterior usado na comparação tem a mesma duração em dias, imediatamente antes do intervalo escolhido.
- A tela de detalhe do relatório continua a mesma (nenhuma mudança de layout lá).

## O que sai

A tela "Período atual" e suas abas deixam de existir. Os indicadores que ela mostrava não são perdidos, apenas param de ser duplicados aqui:

- Posição de hoje, patrimônio líquido, cartão a vencer e dívidas continuam na Home e nas telas de Contas/Dívidas.
- Ponte de caixa mês a mês, gráficos de linha e a tabela contábil são removidos desta área (é o material que "não faz mais sentido na nova visão").
- **Exportar CSV** e **Imprimir** são preservados: passam a exportar o período selecionado, dentro da nova tela.

## Detalhes técnicos

1. **Novo tipo de relatório `custom`**
   - Migration: incluir `custom` no check de `financial_reports.report_type` e trocar o índice único `(user_id, report_type, period_start)` por `(user_id, report_type, period_start, period_end)` — dois períodos livres podem começar no mesmo dia.
   - `src/lib/reports/intelligent/periods.ts` (+ espelho em `supabase/functions/_shared/reports-core/`): `resolvePeriods` aceita um período explícito `{start, end}` para o tipo `custom`; `previousOf` devolve o intervalo de mesma duração imediatamente anterior, com rótulo `dd/mm a dd/mm`.
   - `engine.ts` e `narrative.ts`: tratar `custom` como período fechado e arbitrário (sem projeção de mês), rótulo "Período · dd/mm a dd/mm".
   - `financial-reports-generate`: aceitar `{ report_type: "custom", period_start, period_end }`, validar (datas válidas, `end >= start`, `end <= hoje`, janela máxima de 366 dias) e usar `idempotency_key = custom:user:start:end`. O caminho cron não muda.
   - `client.ts`: `generateReportNow(type, period?)` e `periodLabel` cobrindo `custom`.

2. **Frontend**
   - `src/pages/RelatoriosHub.tsx`: deixa de ser um hub com abas e passa a renderizar apenas a tela de relatórios (mantém a rota atual e redireciona `?tab=` legado).
   - `src/pages/RelatoriosInteligentes.tsx`: vira a tela única — cabeçalho novo, três ações rápidas, seletor de período (Sheet reaproveitando o padrão de `PeriodPicker`, com datas limitadas a hoje), histórico com rótulo de período livre, além dos botões CSV/Imprimir migrados de `Relatorios.tsx`.
   - `src/pages/Relatorios.tsx` é removido, junto com o que só ele usava.
   - Rotas em `src/App.tsx` ajustadas; nenhum link existente para relatórios quebra.

3. **Qualidade**
   - Testes de período: duração, período anterior equivalente e rótulos do tipo `custom`.
   - `scripts/sync-finance-core.mjs` executado para manter o espelho das Edge Functions em sincronia.
