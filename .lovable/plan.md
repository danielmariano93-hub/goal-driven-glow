# Plano — Editar padrões (clone-on-edit) + Deploy solicitado

Duas frentes, executadas na mesma rodada, sem migration.

---

## Parte 1 — Editar categorias "padrão do sistema" (clone-on-edit)

**Regra confirmada:** ao editar uma padrão, o app cria uma **cópia pessoal** (`user_id = auth.uid()`) com as alterações. A padrão original permanece intocada no banco e some da visão do usuário que criou o override. Nenhum outro usuário é afetado. Sem alteração de schema, sem migration, sem mudar RLS (as políticas atuais já permitem: `SELECT own_or_global`, `INSERT own`, `UPDATE own`).

### Mecânica do "override"
- Cada override pessoal herda o `slug` da global.
- Na leitura, filtramos: se existir categoria pessoal ativa (`archived_at IS NULL`) com o mesmo `slug` de uma global, a global é ocultada para aquele usuário.
- Isso é 100% client-side. Nada muda no banco além da inserção normal na tabela `categories`.

### Alterações de código (mínimas)

1. **`src/lib/db/finance.ts`**
   - `useSaveCategory`: aceitar opcionalmente `sourceGlobalId` / seed com `slug` da global. Ao salvar clone, forçar `user_id = auth.uid()` e reusar o `slug` original (para o filtro de ocultação funcionar).
   - Novo helper puro `resolveVisibleCategories(rows, userId)` que aplica a regra "pessoal com mesmo slug oculta global". Usado por `Categorias.tsx` e reexportado para `CategorySelect`.

2. **`src/components/CategorySelect.tsx`**
   - `filterCategoryOptions` passa a chamar `resolveVisibleCategories` antes de aplicar filtro por tipo/arquivada, garantindo que o override apareça no lugar da padrão em toda a UI (Lançamentos, Recorrências, ReviewSheet, Divisão do Rolê).

3. **`src/pages/Categorias.tsx`**
   - Na seção "Padrões do sistema", exibir botão **Editar** ao lado de cada global.
   - Ao clicar, abrir o `CatModal` pré-preenchido com nome/tipo/cor da global e uma flag `sourceGlobal`.
   - Submit dispara `save.mutate({ ...values, sourceGlobalId: c.id, slug: c.slug })` → cria pessoal.
   - Após sucesso, toast: "Padrão personalizada — só vale para você."
   - A padrão desaparece automaticamente da grade (filtrada pelo helper) e a pessoal aparece em "Minhas categorias".
   - Manter globais como não-deletáveis (não expor Trash em global; só via arquivamento indireto do override).

4. **Testes (Vitest)**
   - Estender `src/test/category-select-filter.test.ts` com:
     - global + pessoal de mesmo slug → global some, pessoal aparece.
     - global sozinha → aparece.
     - override arquivado → global reaparece.
   - Novo `src/test/categories-clone-on-edit.test.ts` cobrindo `resolveVisibleCategories` + payload gerado por `useSaveCategory` quando `sourceGlobalId` está presente (user_id derivado do auth, slug preservado, id não enviado).

5. **Aceite**
   - `bun run test`, `tsgo` e build limpos.
   - Regressão manual: editar "Mercado" (padrão) → vira pessoal; a original some da lista e do seletor; outras contas continuam vendo a padrão original (validado no banco: nenhum UPDATE em linha com `user_id IS NULL`).

### Fora de escopo
- Nenhuma nova tabela, RPC, migration ou mudança em Edge Function.
- Sem alteração em RLS.
- Sem edição real da global (impedimento continua garantido pela política `categories_update_own`).

---

## Parte 2 — Deploy solicitado (sem alterações de código)

Executar exatamente:

1. Confirmar que a `main` está sincronizada e localizar o commit **"Corrige Pulso dicas e categorizacao automatica"** (reportar SHA).
2. Deploy da Edge Function `pulse-compute` (versão atual da main).
3. Deploy da Edge Function `insights-generate` (versão atual da main).
4. Publicar o frontend do commit atual da main.
5. Reportar:
   - SHA sincronizado
   - Status da publicação do frontend
   - Horário do deploy de `pulse-compute`
   - Horário do deploy de `insights-generate`
   - Qualquer erro encontrado

Sem migrations, sem alterações em banco/secrets/prompts/outras funções.

---

## Ordem de execução no build mode
1. Aplicar as mudanças da Parte 1 (código + testes).
2. Rodar test + typecheck + build.
3. Executar os deploys da Parte 2 em paralelo (`pulse-compute` e `insights-generate`) e publicar o frontend já com a Parte 1 embarcada.
4. Devolver o relatório consolidado.
