
# Patch Final — Experiência do Usuário (App)

Entrega única. Foco: elevar a qualidade percebida do app ao nível de um produto financeiro moderno. Sem alterar regras de negócio, sem tocar no Agent Core, sem remover funcionalidade. As áreas abaixo cobrem os 13 blocos do briefing e as oportunidades adicionais que a auditoria identificou lendo a base atual.

## 1. Lançamentos — edição coletiva e revisão do fluxo

Reescrita da página `src/pages/Lancamentos.tsx` para introduzir **modo de seleção múltipla** com:

- Checkbox em cada item + long-press no mobile para ativar o modo.
- Barra flutuante de ação (sticky, bottom em mobile / top em desktop) mostrando contagem selecionada e ações: **Editar categoria**, **Renomear (prefixo/substituir)**, **Excluir em lote**.
- Botão **Selecionar todos os filtrados** e **Limpar seleção**.
- Proteções: itens com `type === "transfer"` e itens com `shared_expense_id` (Divisão do Rolê) ficam com checkbox desabilitado e tooltip explicando por quê. Nunca são incluídos em "Selecionar todos".
- Alternância rápida "Só sem categoria": chip dedicado no topo (além do select existente), com contador ao lado.
- Substituir o `confirm()` nativo do "Excluir" por `AlertDialog` do shadcn (individual e em lote).
- Ao editar/duplicar/excluir, invalida `["transactions"]`, `["assistant-tip"]`, `["pulse"]`, `["accounts"]` para refletir imediatamente na Home.

Nova RPC pequena `bulk_update_transactions(ids uuid[], patch jsonb)` já implementável no cliente via `supabase.from("transactions").update(...).in("id", ids)` — não precisamos criar RPC nova. Categorias globais editadas seguem a regra clone-on-edit existente sem mudanças.

## 2. Filtros persistentes e claros

- Persistir todos os filtros de `Lancamentos` em `sessionStorage` sob a chave `nc.filters.lancamentos.v1` (busca, tipo, conta, categoria, uncategorized, from, to, ordenação).
- Ao voltar de `/app/lancamentos/:id`, os filtros são restaurados sem flicker (leitura sincrônica no `useState` inicializer).
- Labels visíveis "**De**" e "**Até**" nos inputs de data (hoje não têm label) + ícones de calendário e botão "Limpar período".
- Novo controle de **Ordenação** (data desc/asc, valor desc/asc).
- Chips de filtros ativos com "×" para remover cada um individualmente.

## 3. Experiência mobile

- Todos os `<input>`, `<select>`, `<textarea>` recebem `text-base` (16px) em mobile para eliminar zoom automático do iOS.
- Substituir `min-h-screen` remanescentes por `min-h-dvh` onde ainda houver `h-screen`/`min-h-screen`.
- Modais/Sheets: garantir `max-h-[90dvh]` + scroll interno e `overscroll-contain` para o teclado não empurrar o layout.
- Padding inferior `safe-pb` em barras de ação flutuantes; `env(safe-area-inset-*)` já existe em `index.css`.
- Auditar `overflow-x-hidden`: manter global e revisar tabelas/relatórios que hoje causam scroll horizontal em telas ≤ 375px (uso de `min-w-0` em containers flex).
- Tap targets: elevar botões-ícone críticos a `min-h-11 min-w-11` (bottom tab bar, ações de lançamento, filtros).

## 4. Responsividade

Passagem por todas as rotas em três breakpoints (375, 768, 1440):

- `Home`, `Lancamentos`, `Categorias`, `Contas`, `Cartoes`, `Metas`, `Investimentos`, `Dividas`, `Recorrencias`, `Relatorios`, `Planejamento`, `DivisaoDoRole`, `Emocoes`, `Desafios`, `Importar`, `Perfil`, `Notificacoes`, `MaisMenu`, `Assessor`, `WhatsApp`.
- Correções pontuais: grids que quebram <380px passam a `grid-cols-1` com breakpoint `sm:`; cards de KPI ficam `flex-wrap`; barras de filtros ganham scroll horizontal `no-scrollbar` quando não couberem.

## 5. Home reativa

- Centralizar as invalidações em um helper `invalidateFinancialQueries(qc)` em `src/lib/db/finance.ts` (transactions, accounts, pulse, assistant-tip, insights, patrimonio derivados). Todo mutation de save/delete/import/transfer passa a chamá-lo.
- `Index.tsx` continua igual visualmente, mas o `PatrimonioCard`, `PulseHero`, `AssistantTipCard`, `PonteCaixaCard` e `ParaPagarResumo` recebem `refetchOnWindowFocus: true` e ficam atrelados às queryKeys corretas.

## 6. Pulso financeiro

Sem alterar a fórmula (regra de negócio). Ações UX:

- Após save/delete/import, `pulse-compute` é invalidado via helper acima.
- `PulseHero` mostra estado "insufficient_data" com CTA explícito em vez de placeholder cinza.
- Skeleton dedicado enquanto a query carrega (hoje aparece "0" por um instante).

## 7. Dicas inteligentes

- `AssistantTipCard`: botão **Nova dica** força `refetch` com um `nonce` no queryKey; guarda a última dica em memória para evitar repetir consecutiva (rotaciona quando o backend devolver igual, dentro do array de fallbacks).
- Invalida quando `["transactions"]` ou `["accounts"]` mudam (subscribe via `useEffect` no queryClient).
- Estado vazio amigável quando ainda não há dados suficientes.

## 8. Feedbacks padronizados

- Consolidar toasts em `src/lib/ui/feedback.ts` com `notifySuccess/notifyError/notifyInfo/notifyLoading` (wrappers sobre `sonner`) — mensagens em pt-BR, tom NoControle.ia (sem culpa, encorajador). Migrar chamadas diretas `toast.*` em `Lancamentos`, `Contas`, `Cartoes`, `Categorias`, `Metas`, `Investimentos`, `Dividas`, `Importar`, `DivisaoDoRole*`, `Emocoes`, `Perfil`.
- Substituir `alert()`/`confirm()` remanescentes por `AlertDialog`.
- Estados vazios: componente reutilizável `<EmptyState icon title description action />` em `src/components/ui/empty-state.tsx`, aplicado em todas as listas.

## 9. Consistência visual

- Aplicar `surface-card` / `surface-card-lg` uniformemente (ainda há `rounded-2xl border ...` inline em várias telas).
- Padronizar cabeçalho das páginas via `<PageHeading title subtitle actions />` novo componente em `src/components/PageHeading.tsx` (o `PageHeader` do admin fica exclusivo do admin).
- Botões primários usam `.btn-brand`, secundários `.btn-ghost-brand`, destructive via variant do shadcn.
- Tipografia: `font-display` reservada a títulos H1/H2; corpo em Inter. Auditar usos incorretos.
- Ícones: mesmo tamanho (14/16/18) por contexto; remover `size` inconsistentes.

## 10. Performance percebida

- Skeletons dedicados para `Home`, `Lancamentos`, `Relatorios`, `Investimentos`, `Metas` (hoje é só spinner).
- `useTransactions` recebe `placeholderData: keepPreviousData` para trocas de filtro sem flicker.
- Atualização otimista no toggle de categoria em massa e no delete individual.
- `React.memo` nos itens de lista de lançamentos (`LancamentoRow` extraído).
- Lazy-load das rotas pesadas (`Relatorios`, `Importar`, `DivisaoDoRole*`, `Investimentos`) via `React.lazy` no `App.tsx` — reduz o bundle inicial.

## 11. Acessibilidade

- `aria-label` em todos os botões-ícone (barra superior, ações de lista, FAB Assessor, bell).
- `aria-live="polite"` no container de toasts (Sonner já faz, mas garantir no wrapper de status inline do Pulso/Dicas).
- Contraste: revisar `text-muted-foreground/60` remanescentes → subir para `text-muted-foreground`.
- Foco visível: `:focus-visible` já global; revisar componentes custom que desabilitam outline.
- Ordem de tabulação nos modais/sheets (Radix já cobre) — checar componentes hand-rolled em `AssessorAttachButton` e `WhatsAppLinkSheet`.

## 12. Auditoria automática — problemas adicionais identificados

Lendo a base atual, incluímos na entrega:

1. `Lancamentos.tsx`: `useState<TxFilters>` inicial ignora URL/sessionStorage → resolvido no bloco 2.
2. `AppLayout.tsx`: usa `key={valuesHidden ? "priv-on" : "priv-off"}` remontando a rota inteira ao alternar olho — substituir por observação reativa nos componentes que formatam valor (já lêem `usePrivacyMode`), evitando reset de scroll/estado.
3. `BottomTabBar` (a confirmar na leitura): garantir 44×44, safe-area, contraste do estado ativo.
4. `DesktopSidebar`: adicionar `aria-current="page"` no item ativo.
5. `NotFound`: página com layout pobre → reformular com CTA de voltar para Home.
6. `Login`/`Signup`/`ForgotPassword`/`ResetPassword`: revisar labels, autoComplete, e feedback de erro.
7. `Onboarding`: skeleton entre passos, botão desabilitado durante submit.
8. `Importar`: barra de progresso real (hoje só spinner) e resumo pós-importação.
9. `Relatorios`: gráficos com `ResponsiveContainer` corrigido para telas pequenas; legenda quebra em duas linhas.
10. `DivisaoDoRole*`: mensagens de erro humanizadas; empty state.
11. `Emocoes`: espaçamento inconsistente entre cards.
12. `Metas`, `Investimentos`, `Dividas`, `Cartoes`, `Contas`: cabeçalhos e cards migram para `PageHeading` + `surface-card`.
13. `WhatsAppLinkSheet`: input com `text-base`, botão copiar com feedback tátil.
14. `AssessorPanel`: rolagem interna no mobile quando teclado abre.
15. `Categorias`: chip visual do ícone/cor da categoria, ordem alfabética estável.

## 13. Limpeza técnica

- Remover componentes não referenciados após a refatoração (`ResumoContas` se não usado, aliases `ios-card*` migrados para `surface-card`).
- Consolidar utilidades duplicadas de datas (`isoDate` em `Index.tsx` → mover para `engine/facts.ts` se ainda não existir equivalente).
- Padronizar imports absolutos `@/…`.
- Atualizar `README.md` breve seção "UI conventions".

## Testes

- Novos testes em `src/test/`:
  - `lancamentos-bulk-edit.test.tsx` — seleção múltipla, proteção de transfer/split, edição em lote de categoria e nome.
  - `lancamentos-filters-persistence.test.tsx` — sessionStorage restore.
  - `assistant-tip-nova-dica.test.tsx` — clicar "Nova dica" retorna dica diferente.
  - `home-invalidation.test.ts` — helper `invalidateFinancialQueries` invalida as chaves esperadas.
  - `empty-state.test.tsx` — componente compartilhado.
- Rodar toda a suíte (`bunx vitest run`) — meta: todos os testes existentes + novos passando.
- `tsgo` para type-check.

## Restrições respeitadas

- Nada é alterado em `supabase/functions/_shared/agent/*` nem em `_shared/engine/facts.ts` (regras contábeis).
- Nenhuma mudança em migrations/schema — o bulk update roda pelas RLS já em vigor.
- Nenhuma funcionalidade removida.

## Escopo desta entrega (transparência)

Este patch cobre **frontend do app** (não o admin, que é outra entrega). É extenso mas focado em UI/UX/estado/feedback — não expande produto. Se durante a implementação surgir um item de auditoria que exija mudança de regra de negócio, ele será apontado no relatório final em vez de silenciosamente alterado.

## Entregáveis do relatório final

Ao concluir vou reportar: resumo técnico, telas revisadas, arquivos alterados, achados adicionais da auditoria, correções extras aplicadas, testes adicionados, total de testes executados/aprovados, e eventuais limitações de plataforma.
