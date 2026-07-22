## Correção cirúrgica: PeriodPicker e mensagem "Começa em"

### Bugs identificados

1. **PeriodPicker na Home fica abaixo do card Hero.** Hoje a ordem é `HomeHeader → HeroDisponivelCard → PeriodPicker → RitmoCard`. O seletor deve aparecer **acima** dos cards que ele filtra, logo após o `HomeHeader`.

2. **Meta agendada mostra data errada.** Em `src/lib/engine/metrics.ts:222`, o `case "scheduled"` da função `statusMessage` usa `periodEnd` em vez do início do período:
   ```ts
   return `Começa em ${new Date(periodEnd + "T00:00:00").toLocaleDateString("pt-BR")}.`;
   ```
   Meta cadastrada de 01/08 a 31/08 exibe "Começa em 31/08/2026". A função nem sequer recebe `periodStart` como parâmetro.

3. **Mesmo bug no shared do Agente.** Em `supabase/functions/_shared/engine/metrics.ts:221`, a mensagem `scheduled` usa a variável `start` mas concatena a string ISO crua (`meta começa em 2026-08-01`), sem formatar para pt-BR.

### Mudanças

**`src/pages/Index.tsx`**
- Mover `<PeriodPicker ... />` para logo abaixo de `<HomeHeader />`, antes do `<HeroDisponivelCard />`.

**`src/lib/engine/metrics.ts`**
- Adicionar parâmetro `periodStart: string` em `statusMessage` (antes de `periodEnd`).
- No `case "scheduled"`, formatar `periodStart` em pt-BR: `Começa em ${new Date(periodStart + "T00:00:00").toLocaleDateString("pt-BR")}.`
- Atualizar a chamada em `evaluateCategoryGoal` (linha ~306) para passar `period.start` antes de `period.end`.

**`supabase/functions/_shared/engine/metrics.ts`**
- Trocar `${name}: meta começa em ${start}.` por `${name}: meta começa em ${new Date(start + "T00:00:00").toLocaleDateString("pt-BR")}.` para paridade de exibição.

### Verificação
- Rodar `bunx vitest run src/test/category-goals-metrics.test.ts` para garantir que a suíte de metas segue verde (ajustar assertion de mensagem "scheduled" se existir).
- Conferir visualmente na Home que o PeriodPicker está no topo e que uma meta futura (ex.: 01/09) exibe "Começa em 01/09/2026".

### Fora de escopo
Não alterar lógica de cálculo, RLS, invalidação, migrations ou qualquer outro card da Home.
