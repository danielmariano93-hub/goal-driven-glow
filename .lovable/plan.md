
# Patch Final — Painel Administrativo (UX/UI · Produção)

Escopo exclusivo: elevar a experiência do Admin. Nenhuma regra de negócio, comportamento do Agent Core, migration ou funcionalidade nova de IA é alterada. Apenas front-end (`src/pages/admin/*`, `src/components/admin/*`), com uma pequena correção de query cliente na busca por usuário.

---

## Auditoria — problemas identificados

**Bloqueadores**
1. `IAInteligencia.tsx` busca por `profiles.email`, mas `profiles` não tem coluna `email`. Nenhum usuário é encontrado por e-mail hoje. Usa a RPC `admin_users_list` (que já resolve e-mail via `auth.users`) como fonte de verdade.
2. `Configuracoes.tsx` é praticamente vazio ("em desenvolvimento").
3. `Agente.tsx` (531 linhas, painel enorme): editor lateral com todos os campos empilhados, sem agrupamento entre básico/avançado, sem indicação de obrigatoriedade, sem descrições contextuais, sem preview vivo integrado ao fluxo.

**Inconsistências visuais / UX**
4. Cada página usa seu próprio cabeçalho e chips de status em posições diferentes. Sem `PageHeader` compartilhado.
5. Filtros de `Mensagens.tsx` usam `<select>` nativo — quebram no mobile e destoam do resto do app (shadcn `Select` já é usado em outras áreas).
6. Tabela de `Usuarios.tsx` faz `overflow-x-auto` sem versão em cards no mobile: some coluna de papel/whatsapp em telas pequenas.
7. `AgenteSimulador.tsx` mistura `<select>`/`<input>`/`<textarea>` nativos com botões custom e blocos coloridos hardcoded (`bg-yellow-50`, `text-red-700`, `text-green-700`).
8. `Mensagens.tsx` idem — cores `bg-amber-100`, `text-red-600` etc., não usam tokens do design system → falha em dark mode e contraste.
9. Loaders inconsistentes: `Loader2` solto, `Spinner` privado em `VisaoGeral`, "Carregando…" em texto em outros lugares. Nada de skeleton.
10. Estados vazios reescritos em cada tela.
11. Feedback: `toast.success/error` com formatos diferentes; alguns concatenam código de erro (`${title} · ${code}`), outros só mensagem.
12. Botões: mistura de `rounded-full border px-3 py-1.5`, `rounded-xl bg-gradient-brand`, botões nativos sem `Button` do shadcn. Alturas e paddings desiguais entre telas.
13. `AdminLayout.tsx`: no mobile, o header só tem hamburger; falta breadcrumb/título da página atual. Sidebar não agrupa itens (12 links soltos).
14. `AdminErrorBoundary` fallback é seco e não oferece "tentar novamente".
15. Sem `aria-label` em vários botões de ícone (refresh, expandir timeline em Mensagens, etc.).
16. Foco de teclado invisível em vários links da sidebar (falta `focus-visible:ring`).
17. Overflow horizontal em `Mensagens` quando a linha usa grid `[150px_1fr_180px]` em telas 375px.

---

## Entregas (arquivos)

### A. Primitivos admin compartilhados (novos)
- `src/components/admin/PageHeader.tsx` — título, subtítulo, breadcrumb opcional, slot de ações e chips de status. Usado em TODAS as páginas do admin.
- `src/components/admin/Section.tsx` + `SectionHeader` — agrupa cards com título, descrição e ação opcional.
- `src/components/admin/StatCard.tsx` — unifica os "Metric/Stat/Card" (VisaoGeral, Agente, Mensagens, Operação).
- `src/components/admin/EmptyState.tsx` — ícone + título + descrição + CTA opcional.
- `src/components/admin/AdminSkeleton.tsx` — skeletons para lista, tabela, cards, editor.
- `src/components/admin/DataTable.tsx` fino sobre `<table>` responsivo: em `md:` renderiza tabela, no mobile renderiza lista de cards com `label: value`. Usado por `Usuarios`.
- `src/components/admin/FilterBar.tsx` — wrapper que envolve `Select`/`Input` do shadcn, com chips de filtros ativos removíveis e botão "limpar tudo". Usado por `Mensagens`.
- `src/components/admin/adminToast.ts` — helpers `adminToast.success/info/warn/error(msg, opts?)` padronizando formato ("Ação · código" só em erros).

### B. Layout (`AdminLayout.tsx`)
- Sidebar reorganizada em 4 grupos com label sutil: **Visão**, **Usuários & Engajamento**, **Assistente & Mensageria** (Agente, IA, Mensagens, WhatsApp, Simulador), **Operação & Sistema** (Operação, Financeiro, Produto, Segurança, Configurações).
- Rota do simulador (`/admin/agente/simulador`) passa a aparecer no grupo Assistente (hoje é órfã).
- Header mobile mostra o **título da página atual** (via matches do react-router) além do hamburger.
- Sidebar colapsável em desktop (opcional, `md`) → guarda em `localStorage` `admin.sidebar.collapsed`.
- Foco `focus-visible:ring-2 ring-primary/40` em todos os links/botões da sidebar.
- Fallback do `AdminErrorBoundary` ganha botão "Tentar novamente" (reload da rota) e link "Voltar para Visão Geral".

### C. Refactor por página

- **`VisaoGeral.tsx`** — usa `PageHeader` + `Section` + `StatCard`, skeleton nos cards durante `isLoading`, chips de status agrupados no header e não em card solto.
- **`Usuarios.tsx`** — usa `DataTable` responsivo, debounce 250 ms na busca, `EmptyState` compartilhado, chips coloridos via tokens (`bg-success/10 text-success` já ok, mas padronizado como `<Badge>` shadcn).
- **`Engajamento.tsx` / `Financeiro.tsx` / `Produto.tsx` / `Seguranca.tsx`** — cabeçalho e cards padronizados, skeletons, empty states padronizados. Sem mudança de dados exibidos.
- **`Operacao.tsx`** — cards de job usando `StatCard` + `StatusChip`, botões via `Button` shadcn (`variant="outline"/"secondary"`), estado `busy` por job com spinner inline, texto de impacto usa `bg-warning/10 text-warning-foreground` (tokens). `aria-label` nos botões de ação. Skeleton na lista.
- **`Mensagens.tsx`** —
  - Filtros migrados para shadcn `Select` + `Input` dentro de `FilterBar`, com chips de filtros ativos.
  - Mapa `STATUS` reescrito com tokens semânticos (`bg-warning/15`, `bg-info/15`, `bg-success/15`, `bg-destructive/15`) em vez de `bg-amber-100` etc.
  - Layout da linha de mensagem: grid responsivo com `min-w-0` e `break-words` corretos; no mobile vira card empilhado (data/canal → conteúdo → status/ações).
  - Métricas em `StatCard`. Skeleton dedicado enquanto carrega.
  - `TimelinePanel` — ícones e cores por tipo de evento; foco/aria; `aria-expanded` no toggle.
- **`Agente.tsx`** — reestruturação da tela e do `BehaviorEditor`:
  - Página principal: `PageHeader` com StatusChip + ação "Abrir simulador"; grid de KPIs em `StatCard`; blocos "Em uso / Rascunho / Histórico" com hierarquia clara.
  - `BehaviorEditor` reorganizado em **abas** (shadcn `Tabs`): **Identidade** (nome, objetivo, assinatura), **Tom de voz** (tom, formalidade, emojis, tratamento), **Regras** (do/dont), **Vocabulário** (preferidas/proibidas), **Templates & preview**, **Avançado** (modelo, temperatura, max_steps, notas de versão).
  - Cada campo ganha `<Label>` + microcopy de ajuda + badge "obrigatório" / "opcional" quando aplicável.
  - Preview integrado em painel lateral persistente na aba de templates.
  - Ações fixas no footer sticky: Salvar rascunho / Publicar (com Alert já existente) / Descartar.
  - Componente extraído em `src/pages/admin/agente/BehaviorEditor.tsx` para reduzir o arquivo.
- **`AgenteSimulador.tsx`** — padronizado com `Card`, `Button`, `Textarea`, `Select`, `Badge` do shadcn; blocos de "Rascunho pendente", "Última execução", "Recibos" em `Section`; classes hardcoded substituídas por tokens (`text-success`, `text-destructive`, `text-warning-foreground`). Bolhas de mensagem responsivas (max-w em % com fallback mobile).
- **`IAInteligencia.tsx`** — **corrige a busca**:
  - Substitui `.from("profiles").ilike("email", ...)` por `supabase.rpc("admin_users_list", { p_search: term, p_limit: 5, p_offset: 0 })` e resolve `user_id` do primeiro match; aceita UUID direto (mantém).
  - `EmptyState` claro para "usuário não encontrado" (mensagem amigável em pt-BR), tratamento de erro dedicado, busca com Enter e botão, debounce 250 ms.
  - Reorganizada em **abas** shadcn: **Resumo** (snapshot + preferências), **Memória**, **Sugestões proativas**, **Decisões**, **Runs recentes** — evita paredão de informação.
  - Cada aba tem seu próprio skeleton e `EmptyState`. `Kpi`/`Section`/`sevClass` migrados para tokens.
  - Botão "Rodar scan proativo" vira `Button` com estado de progresso e toast padronizado.
- **`WhatsApp.tsx` / `WhatsAppSessionPanel.tsx`** — sem mudança de fluxo; apenas `PageHeader`, botões shadcn, `adminToast`, `aria-label` nos ícones. (Painel existente é grande; refactor mantém estrutura.)
- **`Configuracoes.tsx`** — passa a agrupar de verdade: seção **Conta administrativa** (dados atuais), **Preferências do painel** (toggle "sidebar recolhida por padrão", "modo denso" salvo em `localStorage`), **Integrações & secrets** (texto explicativo mantido), **Sobre** (versão do build + link para docs internas). Nada altera o backend.

### D. Consistência global
- Sweep para remover cores `text-red-*`, `bg-amber-*`, `bg-emerald-*`, `bg-blue-*` das telas admin trocando pelos tokens `warning`, `info`, `success`, `destructive` já definidos em `index.css`.
- Todos os botões de ícone recebem `aria-label`.
- Todos os inputs de busca recebem `type="search"` + `autoComplete="off"` + Enter para submeter.
- Toasts unificados via `adminToast`.
- `title` do documento por rota admin ("Admin · Mensagens", etc.) via pequeno hook `useAdminDocumentTitle` no `AdminLayout`.

### E. Testes
- `src/test/admin-ia-user-search.test.ts` — garante que a busca chama `admin_users_list` e trata "não encontrado" com mensagem amigável.
- `src/test/admin-page-header.test.tsx` — smoke do `PageHeader` (título, ações, breadcrumb).
- `src/test/admin-data-table.test.tsx` — smoke do `DataTable` responsivo (renderiza tabela em desktop, cards no mobile via mock de viewport).
- `src/test/admin-filter-bar.test.tsx` — filtros ativos como chips removíveis.
- Rodar suíte completa (`vitest run`) e typecheck.

---

## Fora de escopo (não altera nesta rodada)
- Nenhuma migration.
- Nenhuma Edge Function nova nem alteração em `agent-run`, `agent-chat`, `admin-ai-inspect` etc. (a correção da busca é 100% no cliente).
- Nada em `src/pages/` fora de `admin/`, nem em `src/components/` fora de `admin/` (exceto uso dos shadcn já existentes).
- Sem mudança de rotas exceto adicionar `/admin/agente/simulador` ao menu (rota já existe).

## Critério de aceite
- Todas as páginas admin usam os primitivos compartilhados (PageHeader/Section/StatCard/EmptyState/Skeleton).
- Busca por e-mail na IA & Inteligência retorna resultado real ou "usuário não encontrado".
- Nenhuma tela quebra em 375 px (sem overflow horizontal, sem componentes deslocando ao digitar).
- Foco visível em todos os links/botões navegáveis; `aria-label` em botões de ícone.
- Zero cor hardcoded fora dos tokens no admin.
- `vitest run` + `tsgo` + build passando.
