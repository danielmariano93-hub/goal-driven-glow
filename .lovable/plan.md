## Correções pontuais de responsividade e filtros

Três correções cirúrgicas, sem mudar lógica de negócio.

### 1. Zoom automático no iOS ao focar campos (LancamentoDetalhe e afins)

**Causa confirmada.** `src/index.css` já tem a regra `@media (max-width: 767px) { input, select, textarea { font-size: 16px } }` dentro de `@layer base`. Porém `.input-base` (usado em quase todos os campos, incluindo `LancamentoDetalhe.tsx`) está em `@layer components` com `@apply text-sm` (14px). No cascade do Tailwind, `components` vence `base` com mesma especificidade → o input renderiza a 14px no mobile e o Safari aplica o zoom automático mostrado no print.

**Correção:** reforçar a regra mobile com maior especificidade/prioridade dentro do próprio `@layer components`, aplicando 16px a `.input-base`, `.split-form .input` e aos `input/select/textarea` nus em ≤767px. Sem `!important` desnecessário; basta declarar depois de `.input-base` no mesmo layer.

### 2. Filtros de data "estourando" a tela em Lançamentos

**Causa.** Os dois `<input type="date">` (linhas 343–359) ficam dentro de um flex-row de filtros; sem `min-w-0` e sem uma largura previsível o campo nativo do iOS empurra o container além dos 100% da viewport (Safari desenha o campo de data com largura intrínseca >= placeholder do formato longo).

**Correção:**
- Envolver o par "De/Até" em um wrapper `flex-1 min-w-0` e dar `w-full min-w-0` aos próprios inputs de data.
- Garantir `flex-wrap` no container-pai dos filtros (verificar linha ~320) para permitir quebra em telas estreitas.
- Nenhuma mudança em estado/filtros; apenas classes.

### 3. Relatórios sempre iniciando em fevereiro, ignorando o filtro da Home

**Causa.** `Relatorios.tsx` inicializa `from` como "1º dia de 6 meses atrás" e `to` como hoje, sem consultar o período usado na Home. Home mantém `period` apenas em `useState` local (`Index.tsx`, linhas 21–31), nada é compartilhado.

**Correção mínima:**
- Criar `src/lib/ui/periodStore.ts`: helper simples (localStorage) com `getPeriod()`/`setPeriod()` guardando `{ period, customStart, customEnd }`.
- Em `Index.tsx`, hidratar `useState` iniciais a partir de `getPeriod()` e persistir a cada mudança via `useEffect`.
- Em `Relatorios.tsx`, inicializar `from`/`to` derivando do mesmo store (usa a mesma função `startDate` que a Home já usa: mês corrente / 30d / 90d / custom). Manter os dois `<input type="date">` como override manual, mas com valor inicial vindo do período compartilhado.
- Sem novas telas nem context providers — persistência local é suficiente e casa com o comportamento por-dispositivo esperado.

### Escopo explícito
- Não altero engine, cálculos, RPC, edge functions, ou schema.
- Não mexo em Home além de persistir seu período atual.
- Não mudo layout da BottomTabBar nem safe-areas (já corretas).

### Aceite
- Focar qualquer campo de "Detalhes do lançamento" no iPhone não muda mais o zoom da página.
- Em Lançamentos no mobile, os campos "De" e "Até" cabem na tela e quebram linha se necessário.
- Selecionar "Últimos 30 dias" na Home e abrir Relatórios: a tela abre já filtrada nos últimos 30 dias.
