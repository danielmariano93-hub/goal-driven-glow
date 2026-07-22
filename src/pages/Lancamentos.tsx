import { useEffect, useMemo, useState } from "react";
import {
  Plus, Loader2, ArrowLeftRight, MoreHorizontal, Pencil, Copy, Trash2, Search,
  WandSparkles, X, CheckSquare, Square, FolderTree, FileText, AlertTriangle,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import {
  useAccounts,
  useCategories,
  useTransactions,
  useSaveTransaction,
  useDeleteTransaction,
  useCreateTransfer,
  type TransactionRow,
  type TxFilters,
} from "@/lib/db/finance";
import { useCreditCards } from "@/lib/db/creditCards";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { transactionSchema, transferSchema } from "@/lib/validation/finance";
import { formatBRL, todayISO } from "@/lib/engine/facts";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { CategorySelect } from "@/components/CategorySelect";
import { EmptyState } from "@/components/ui/empty-state";
import { notifySuccess, notifyError, notifyInfo, humanizeError } from "@/lib/ui/feedback";
import { invalidateFinancialQueries } from "@/lib/db/invalidation";

type SortMode = "date_desc" | "date_asc" | "amount_desc" | "amount_asc";
type PersistedFilters = TxFilters & { sort?: SortMode };

const FILTERS_KEY = "nc.filters.lancamentos.v1";

function loadFilters(): PersistedFilters {
  try {
    const raw = sessionStorage.getItem(FILTERS_KEY);
    if (!raw) return { type: "all", sort: "date_desc" };
    const parsed = JSON.parse(raw) as PersistedFilters;
    return { type: "all", sort: "date_desc", ...parsed };
  } catch {
    return { type: "all", sort: "date_desc" };
  }
}

function saveFilters(f: PersistedFilters) {
  try { sessionStorage.setItem(FILTERS_KEY, JSON.stringify(f)); } catch { /* ignore */ }
}

export default function Lancamentos() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const { data: accounts } = useAccounts();
  const { data: categories } = useCategories();
  const [filters, setFilters] = useState<PersistedFilters>(() => {
    // Deep link vindo de Metas / dicas / highlights: aplica category+start+end
    // por cima dos filtros persistidos. Ex.: ?category=UUID&start=2026-07-01&end=2026-07-31
    try {
      const sp = new URLSearchParams(window.location.search);
      const category = sp.get("category") ?? undefined;
      const start = sp.get("start") ?? undefined;
      const end = sp.get("end") ?? undefined;
      const base = loadFilters();
      if (category || start || end) {
        return {
          ...base,
          categoryId: category ?? base.categoryId,
          from: start ?? base.from,
          to: end ?? base.to,
        };
      }
      return base;
    } catch {
      return loadFilters();
    }
  });
  // Passa somente a fatia de filtros do backend para o hook (sort é local).
  const backendFilters = useMemo<TxFilters>(() => {
    const { sort: _sort, ...rest } = filters;
    void _sort;
    return rest;
  }, [filters]);
  const { data: txs, isLoading } = useTransactions(backendFilters);
  const save = useSaveTransaction();
  const transfer = useCreateTransfer();
  const del = useDeleteTransaction();
  const [openTx, setOpenTx] = useState(false);
  const [openTransfer, setOpenTransfer] = useState(false);
  const [editing, setEditing] = useState<TransactionRow | null>(null);
  const [categorizing, setCategorizing] = useState(false);

  // Persiste filtros para restaurar ao voltar de /lancamentos/:id.
  useEffect(() => { saveFilters(filters); }, [filters]);


  // === Seleção múltipla ===
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkCatOpen, setBulkCatOpen] = useState(false);
  const [bulkRenameOpen, setBulkRenameOpen] = useState(false);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<TransactionRow | null>(null);
  const [bulkCategoryId, setBulkCategoryId] = useState<string | null>(null);
  const [bulkName, setBulkName] = useState("");
  const [bulkRunning, setBulkRunning] = useState(false);

  useEffect(() => {
    if (!selectMode) setSelected(new Set());
  }, [selectMode]);

  const { data: cards } = useCreditCards();
  const catName = (id: string | null) =>
    id ? categories?.find((c) => c.id === id)?.name ?? "—" : "—";
  const accName = (t: TransactionRow) => {
    if (t.payment_method === "credit_card" && t.credit_card_id) {
      return cards?.find((c) => c.id === t.credit_card_id)?.name ?? "Cartão";
    }
    if (t.account_id) return accounts?.find((a) => a.id === t.account_id)?.name ?? "—";
    return "—";
  };

  // Regra: transferências e itens da Divisão do Rolê não podem entrar
  // em edição em lote (mantém integridade contábil e do split).
  const isProtected = (t: TransactionRow) => t.type === "transfer" || !!t.shared_expense_id;
  const eligibleIds = useMemo(() => (txs ?? []).filter((t) => !isProtected(t)).map((t) => t.id), [txs]);

  const sortedTxs = useMemo(() => {
    const arr = [...(txs ?? [])];
    const mode = filters.sort ?? "date_desc";
    arr.sort((a, b) => {
      if (mode === "amount_desc") return Number(b.amount) - Number(a.amount);
      if (mode === "amount_asc") return Number(a.amount) - Number(b.amount);
      const cmp = String(b.occurred_at).localeCompare(String(a.occurred_at));
      return mode === "date_asc" ? -cmp : cmp;
    });
    return arr;
  }, [txs, filters.sort]);

  const grouped = useMemo(() => {
    const g: Record<string, TransactionRow[]> = {};
    for (const t of sortedTxs) (g[t.occurred_at] ||= []).push(t);
    return Object.entries(g).sort(([a], [b]) =>
      (filters.sort ?? "date_desc") === "date_asc" ? a.localeCompare(b) : b.localeCompare(a),
    );
  }, [sortedTxs, filters.sort]);

  const hasAccounts = (accounts?.length ?? 0) > 0;
  const uncategorizedCount = useMemo(
    () => (txs ?? []).filter((t) => !t.category_id && t.type !== "transfer").length,
    [txs],
  );

  const toggleSelect = (id: string) => {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };

  const selectAllFiltered = () => setSelected(new Set(eligibleIds));
  const clearSelection = () => setSelected(new Set());

  const runBulkCategory = async () => {
    if (selected.size === 0) return;
    setBulkRunning(true);
    try {
      const ids = Array.from(selected);
      const { error } = await supabase.from("transactions").update({ category_id: bulkCategoryId }).in("id", ids);
      if (error) throw error;
      notifySuccess(
        `${ids.length} lançamento${ids.length === 1 ? "" : "s"} atualizado${ids.length === 1 ? "" : "s"}`,
        bulkCategoryId ? "Categoria aplicada em lote." : "Categoria removida em lote.",
      );
      setBulkCatOpen(false);
      setSelectMode(false);
      setBulkCategoryId(null);
      invalidateFinancialQueries(qc);
    } catch (e) {
      notifyError("Não consegui aplicar em lote", humanizeError(e));
    } finally {
      setBulkRunning(false);
    }
  };

  const runBulkRename = async () => {
    if (selected.size === 0 || !bulkName.trim()) return;
    setBulkRunning(true);
    try {
      const ids = Array.from(selected);
      const { error } = await supabase.from("transactions").update({ description: bulkName.trim() }).in("id", ids);
      if (error) throw error;
      notifySuccess(`${ids.length} lançamento${ids.length === 1 ? "" : "s"} renomeado${ids.length === 1 ? "" : "s"}`);
      setBulkRenameOpen(false);
      setSelectMode(false);
      setBulkName("");
      invalidateFinancialQueries(qc);
    } catch (e) {
      notifyError("Não consegui renomear em lote", humanizeError(e));
    } finally {
      setBulkRunning(false);
    }
  };

  const runBulkDelete = async () => {
    if (selected.size === 0) return;
    setBulkRunning(true);
    try {
      const ids = Array.from(selected);
      const { error } = await supabase.from("transactions").delete().in("id", ids);
      if (error) throw error;
      notifySuccess(`${ids.length} lançamento${ids.length === 1 ? "" : "s"} excluído${ids.length === 1 ? "" : "s"}`);
      setBulkDeleteOpen(false);
      setSelectMode(false);
      invalidateFinancialQueries(qc);
    } catch (e) {
      notifyError("Não consegui excluir em lote", humanizeError(e));
    } finally {
      setBulkRunning(false);
    }
  };

  return (
    <div>
      <header className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">Lançamentos</h1>
          <p className="text-sm text-muted-foreground">Receitas, despesas e transferências.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setSelectMode((v) => !v)}
            disabled={!hasAccounts}
            className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-sm font-medium disabled:opacity-50 ${
              selectMode ? "border-primary bg-primary/10 text-primary" : "border-border bg-card"
            }`}
            aria-pressed={selectMode}
          >
            <CheckSquare size={14} /> {selectMode ? "Sair da seleção" : "Selecionar"}
          </button>
          <button
            onClick={() => setOpenTransfer(true)}
            disabled={!hasAccounts || (accounts?.length ?? 0) < 2}
            className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-2 text-sm font-medium disabled:opacity-50"
          >
            <ArrowLeftRight size={14} /> Transferência
          </button>
          <button
            onClick={() => { setEditing(null); setOpenTx(true); }}
            disabled={!hasAccounts}
            className="btn-brand inline-flex items-center gap-2 disabled:opacity-50"
          >
            <Plus size={14} /> Novo
          </button>
        </div>
      </header>

      {!hasAccounts ? (
        <EmptyState
          title="Cadastre uma conta antes"
          description="Você precisa de pelo menos uma conta para registrar lançamentos."
        />
      ) : (
        <>
          <div className="mb-3 flex min-w-0 items-center gap-2 rounded-2xl border border-border bg-card px-3 py-2">
            <Search size={15} className="shrink-0 text-muted-foreground" aria-hidden />
            <input
              value={filters.search ?? ""}
              onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value || undefined }))}
              placeholder="Buscar por nome ou descrição"
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              aria-label="Buscar lançamentos"
            />
            {filters.search ? (
              <button
                type="button"
                onClick={() => setFilters((f) => ({ ...f, search: undefined }))}
                aria-label="Limpar busca"
                className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground hover:text-foreground"
              >
                <X size={14} />
              </button>
            ) : null}
          </div>

          <div className="mb-3 flex flex-wrap items-end gap-2">
            <button
              type="button"
              onClick={() => setFilters((f) => ({ ...f, uncategorized: f.uncategorized ? undefined : true, categoryId: undefined }))}
              aria-pressed={!!filters.uncategorized}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium ${
                filters.uncategorized ? "border-primary bg-primary/10 text-primary" : "border-border bg-card text-muted-foreground"
              }`}
            >
              <FolderTree size={13} /> Sem categoria
              {uncategorizedCount > 0 && (
                <span className={`ml-1 rounded-full px-1.5 text-[10px] font-semibold ${filters.uncategorized ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"}`}>
                  {uncategorizedCount}
                </span>
              )}
            </button>

            <select
              value={filters.type ?? "all"}
              onChange={(e) => setFilters((f) => ({ ...f, type: e.target.value as TxFilters["type"] }))}
              className="rounded-full border border-border bg-card px-3 py-1.5 text-xs"
              aria-label="Tipo de lançamento"
            >
              <option value="all">Todos os tipos</option>
              <option value="income">Receitas</option>
              <option value="expense">Despesas</option>
              <option value="transfer">Transferências</option>
            </select>

            <select
              value={filters.accountId ?? ""}
              onChange={(e) => setFilters((f) => ({ ...f, accountId: e.target.value || undefined }))}
              className="rounded-full border border-border bg-card px-3 py-1.5 text-xs"
              aria-label="Conta"
            >
              <option value="">Todas as contas</option>
              {accounts?.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>

            <select
              value={filters.uncategorized ? "__uncategorized__" : filters.categoryId ?? ""}
              onChange={(e) => setFilters((f) => ({
                ...f,
                categoryId: e.target.value && e.target.value !== "__uncategorized__" ? e.target.value : undefined,
                uncategorized: e.target.value === "__uncategorized__" || undefined,
              }))}
              className="rounded-full border border-border bg-card px-3 py-1.5 text-xs"
              aria-label="Categoria"
            >
              <option value="">Todas as categorias</option>
              <option value="__uncategorized__">Sem categoria</option>
              {categories?.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>

            <select
              value={filters.sort ?? "date_desc"}
              onChange={(e) => setFilters((f) => ({ ...f, sort: e.target.value as SortMode }))}
              className="rounded-full border border-border bg-card px-3 py-1.5 text-xs"
              aria-label="Ordenação"
            >
              <option value="date_desc">Mais recentes</option>
              <option value="date_asc">Mais antigos</option>
              <option value="amount_desc">Maior valor</option>
              <option value="amount_asc">Menor valor</option>
            </select>

            <label className="flex min-w-0 flex-1 basis-[140px] flex-col text-[10px] font-medium uppercase tracking-wide text-muted-foreground sm:flex-none sm:basis-auto">
              De
              <input
                type="date"
                value={filters.from ?? ""}
                onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value || undefined }))}
                className="mt-1 w-full min-w-0 rounded-full border border-border bg-card px-3 py-1.5 text-xs normal-case tracking-normal text-foreground"
                aria-label="Data inicial"
              />
            </label>
            <label className="flex min-w-0 flex-1 basis-[140px] flex-col text-[10px] font-medium uppercase tracking-wide text-muted-foreground sm:flex-none sm:basis-auto">
              Até
              <input
                type="date"
                value={filters.to ?? ""}
                onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value || undefined }))}
                className="mt-1 w-full min-w-0 rounded-full border border-border bg-card px-3 py-1.5 text-xs normal-case tracking-normal text-foreground"
                aria-label="Data final"
              />
            </label>

            {(filters.from || filters.to) && (
              <button
                type="button"
                onClick={() => setFilters((f) => ({ ...f, from: undefined, to: undefined }))}
                className="inline-flex items-center gap-1 self-end rounded-full border border-border bg-card px-3 py-1.5 text-[11px] text-muted-foreground hover:text-foreground"
              >
                <X size={12} /> Limpar período
              </button>
            )}

            {filters.uncategorized ? (
              <button
                type="button"
                disabled={categorizing}
                onClick={async () => {
                  setCategorizing(true);
                  try {
                    const { data, error } = await (supabase.rpc as unknown as (fn: string) => Promise<{ data: unknown; error: { message: string } | null }>)("apply_safe_category_suggestions");
                    if (error) throw error;
                    const count = Number((data as { updated?: number } | null)?.updated ?? 0);
                    if (count) {
                      notifySuccess(
                        `${count} lançamento${count === 1 ? "" : "s"} categorizado${count === 1 ? "" : "s"}`,
                        "Aplicamos apenas correspondências de alta confiança.",
                      );
                    } else {
                      notifyInfo("Nenhuma sugestão segura encontrada", "Os demais continuam para sua revisão.");
                    }
                    invalidateFinancialQueries(qc);
                  } catch (e) {
                    notifyError("Não consegui aplicar as sugestões", humanizeError(e));
                  } finally {
                    setCategorizing(false);
                  }
                }}
                className="inline-flex items-center gap-1.5 rounded-full border border-primary/25 bg-primary/5 px-3 py-1.5 text-xs font-medium text-primary disabled:opacity-50"
              >
                {categorizing ? <Loader2 size={13} className="animate-spin" /> : <WandSparkles size={13} />} Categorizar com segurança
              </button>
            ) : null}
          </div>

          {selectMode && (
            <div className="mb-3 flex flex-wrap items-center gap-2 rounded-2xl border border-primary/30 bg-primary/5 px-3 py-2 text-xs">
              <span className="font-medium text-primary">
                {selected.size} selecionado{selected.size === 1 ? "" : "s"}
              </span>
              <button type="button" onClick={selectAllFiltered} className="rounded-full border border-primary/30 bg-card px-3 py-1 font-medium text-primary">
                Selecionar todos ({eligibleIds.length})
              </button>
              <button type="button" onClick={clearSelection} disabled={selected.size === 0} className="rounded-full border border-border bg-card px-3 py-1 disabled:opacity-50">
                Limpar
              </button>
              <div className="ml-auto flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={selected.size === 0}
                  onClick={() => { setBulkCategoryId(null); setBulkCatOpen(true); }}
                  className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-3 py-1 disabled:opacity-50"
                >
                  <FolderTree size={12} /> Categoria
                </button>
                <button
                  type="button"
                  disabled={selected.size === 0}
                  onClick={() => { setBulkName(""); setBulkRenameOpen(true); }}
                  className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-3 py-1 disabled:opacity-50"
                >
                  <FileText size={12} /> Renomear
                </button>
                <button
                  type="button"
                  disabled={selected.size === 0}
                  onClick={() => setBulkDeleteOpen(true)}
                  className="inline-flex items-center gap-1 rounded-full border border-destructive/30 bg-destructive/5 px-3 py-1 text-destructive disabled:opacity-50"
                >
                  <Trash2 size={12} /> Excluir
                </button>
              </div>
            </div>
          )}

          {isLoading ? (
            <div className="space-y-2" aria-busy="true">
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="flex items-center gap-3 rounded-2xl border border-border bg-card p-3">
                  <div className="h-9 w-9 animate-pulse rounded-full bg-muted" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
                    <div className="h-2 w-1/3 animate-pulse rounded bg-muted/70" />
                  </div>
                  <div className="h-4 w-16 animate-pulse rounded bg-muted" />
                </div>
              ))}
            </div>
          ) : !txs || txs.length === 0 ? (
            <EmptyState
              title="Nenhum lançamento encontrado"
              description="Ajuste os filtros ou registre um novo."
            />
          ) : (
            <div className="space-y-4">
              {grouped.map(([date, items]) => (
                <div key={date}>
                  <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {new Date(date + "T00:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" })}
                  </p>
                  <ul className="space-y-2">
                    {items.map((t) => {
                      const isTransfer = t.type === "transfer";
                      const isCard = t.payment_method === "credit_card";
                      const isInstallment = (t.installments_total ?? 1) > 1;
                      const canDuplicate = !isTransfer && !isInstallment;
                      const protectedItem = isProtected(t);
                      const isChecked = selected.has(t.id);
                      const openDetail = () => nav(`/app/lancamentos/${t.id}`);
                      const openEdit = () => nav(`/app/lancamentos/${t.id}?edit=1`);
                      const doDuplicate = async () => {
                        if (!canDuplicate) return;
                        try {
                          const base: Record<string, unknown> = {
                            user_id: t.user_id,
                            type: t.type,
                            status: "confirmed",
                            amount: Number(t.amount),
                            occurred_at: todayISO(),
                            description: t.description ?? null,
                            category_id: t.category_id ?? null,
                            payment_method: t.payment_method ?? "account",
                            origin: "manual",
                          };
                          if (isCard) {
                            if (!t.credit_card_id) { notifyError("Não é possível duplicar: cartão ausente."); return; }
                            base.credit_card_id = t.credit_card_id;
                            base.account_id = null;
                            base.purchase_date = todayISO();
                            base.competence_date = t.competence_date ?? todayISO();
                          } else {
                            if (!t.account_id) { notifyError("Não é possível duplicar: conta ausente."); return; }
                            base.account_id = t.account_id;
                            base.credit_card_id = null;
                          }
                          const { error } = await supabase.from("transactions").insert(base as never);
                          if (error) throw error;
                          notifySuccess("Lançamento duplicado");
                          invalidateFinancialQueries(qc);
                        } catch (e) {
                          notifyError("Erro ao duplicar", humanizeError(e));
                        }
                      };
                      const askDelete = () => {
                        if (t.shared_expense_id) {
                          nav(`/app/divisao-do-role/${t.shared_expense_id}`);
                          notifyInfo("Ajuste este gasto pela Divisão do Rolê", "Assim os valores compartilhados ficam sincronizados.");
                          return;
                        }
                        setPendingDelete(t);
                      };
                      return (
                        <li
                          key={t.id}
                          className={`group flex items-center justify-between rounded-2xl border p-3 shadow-card transition-colors focus-within:ring-2 focus-within:ring-primary/40 ${
                            isChecked ? "border-primary bg-primary/5" : "border-border bg-card hover:bg-secondary/50"
                          }`}
                        >
                          {selectMode && (
                            <button
                              type="button"
                              onClick={() => !protectedItem && toggleSelect(t.id)}
                              disabled={protectedItem}
                              aria-label={protectedItem ? "Este lançamento não pode ser editado em lote" : isChecked ? "Remover da seleção" : "Adicionar à seleção"}
                              title={protectedItem ? (isTransfer ? "Transferências não entram em edição em lote" : "Gastos da Divisão do Rolê não entram em edição em lote") : undefined}
                              className="mr-2 grid h-9 w-9 shrink-0 place-items-center rounded-lg text-primary disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              {isChecked ? <CheckSquare size={18} /> : <Square size={18} />}
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={selectMode && !protectedItem ? () => toggleSelect(t.id) : openDetail}
                            className="flex min-w-0 flex-1 items-center gap-3 text-left min-h-[48px]"
                            aria-label={`${selectMode ? "Selecionar" : "Abrir"} lançamento: ${t.description || (isTransfer ? "Transferência" : catName(t.category_id))}`}
                          >
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium">
                                {t.description || (isTransfer ? "Transferência" : catName(t.category_id))}
                              </p>
                              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                                {accName(t)} · {t.type === "income" ? "Receita" : t.type === "expense" ? "Despesa" : "Transferência"}
                                {t.status === "planned" ? " · Planejado" : ""}
                                {!t.category_id && !isTransfer ? " · Sem categoria" : ""}
                              </p>
                            </div>
                            <span
                              className={`font-semibold tabular-nums ${
                                t.type === "income" ? "text-success" : t.type === "expense" ? "text-destructive" : "text-foreground"
                              }`}
                            >
                              {t.type === "expense" ? "−" : t.type === "income" ? "+" : ""}
                              {formatBRL(Number(t.amount))}
                            </span>
                          </button>
                          {!selectMode && (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <button
                                  type="button"
                                  onClick={(e) => e.stopPropagation()}
                                  className="ml-2 grid h-11 w-11 place-items-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
                                  aria-label="Ações do lançamento"
                                >
                                  <MoreHorizontal size={18} />
                                </button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-44">
                                <DropdownMenuItem onClick={openEdit} disabled={isTransfer} className="gap-2">
                                  <Pencil size={14} /> Editar
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={doDuplicate} disabled={!canDuplicate} className="gap-2" title={isInstallment ? "Não é possível duplicar compra parcelada em bloco" : undefined}>
                                  <Copy size={14} /> Duplicar{isInstallment ? " (parcelado)" : ""}
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={askDelete} className="gap-2 text-destructive focus:text-destructive">
                                  <Trash2 size={14} /> Excluir
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* === Modais existentes de criação/edição/transferência === */}
      {openTx && (
        <TxModal
          initial={editing}
          accounts={accounts ?? []}
          cards={(cards ?? []).filter((card) => card.active)}
          categories={categories ?? []}
          saving={save.isPending}
          onClose={() => setOpenTx(false)}
          onSubmit={(v) =>
            save.mutate(
              { ...v, id: editing?.id },
              {
                onSuccess: () => {
                  notifySuccess(editing ? "Atualizado" : "Registrado");
                  invalidateFinancialQueries(qc);
                  setOpenTx(false);
                },
                onError: (e: unknown) => notifyError("Erro ao salvar", humanizeError(e)),
              },
            )
          }
        />
      )}

      {openTransfer && (
        <TransferModal
          accounts={accounts ?? []}
          saving={transfer.isPending}
          onClose={() => setOpenTransfer(false)}
          onSubmit={(v) =>
            transfer.mutate(v, {
              onSuccess: () => {
                notifySuccess("Transferência registrada");
                invalidateFinancialQueries(qc);
                setOpenTransfer(false);
              },
              onError: (e: unknown) => notifyError("Erro na transferência", humanizeError(e)),
            })
          }
        />
      )}

      {/* === Diálogos de confirmação e edição em lote === */}
      <AlertDialog open={!!pendingDelete} onOpenChange={(o) => !o && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir este lançamento?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete?.type === "transfer"
                ? "As duas pernas da transferência serão removidas."
                : "Essa ação não pode ser desfeita."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!pendingDelete) return;
                const row = pendingDelete;
                setPendingDelete(null);
                del.mutate(row, {
                  onSuccess: () => { notifySuccess("Excluído"); invalidateFinancialQueries(qc); },
                  onError: (e: unknown) => notifyError("Erro ao excluir", humanizeError(e)),
                });
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={bulkCatOpen} onOpenChange={(o) => !o && !bulkRunning && setBulkCatOpen(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Categoria em lote</AlertDialogTitle>
            <AlertDialogDescription>
              Aplicar categoria a {selected.size} lançamento{selected.size === 1 ? "" : "s"} selecionado{selected.size === 1 ? "" : "s"}.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="py-2">
            <CategorySelect
              value={bulkCategoryId}
              onChange={setBulkCategoryId}
              type={(() => {
                const types = new Set((txs ?? []).filter((t) => selected.has(t.id)).map((t) => t.type));
                return types.has("income") && !types.has("expense") ? "income" : "expense";
              })()}
              allowEmpty
            />
            <p className="mt-2 text-[11px] text-muted-foreground">Deixe em branco para <strong>remover</strong> a categoria dos selecionados.</p>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkRunning}>Cancelar</AlertDialogCancel>
            <AlertDialogAction disabled={bulkRunning} onClick={runBulkCategory}>
              {bulkRunning ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null} Aplicar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={bulkRenameOpen} onOpenChange={(o) => !o && !bulkRunning && setBulkRenameOpen(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Renomear em lote</AlertDialogTitle>
            <AlertDialogDescription>
              Substituir o nome/descrição de {selected.size} lançamento{selected.size === 1 ? "" : "s"}.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="py-2">
            <label htmlFor="bulk-rename" className="mb-1 block text-xs font-medium">Novo nome</label>
            <input
              id="bulk-rename"
              value={bulkName}
              onChange={(e) => setBulkName(e.target.value)}
              placeholder="Ex.: Almoço no restaurante X"
              className="input-base"
              autoFocus
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkRunning}>Cancelar</AlertDialogCancel>
            <AlertDialogAction disabled={bulkRunning || !bulkName.trim()} onClick={runBulkRename}>
              {bulkRunning ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null} Renomear
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={bulkDeleteOpen} onOpenChange={(o) => !o && !bulkRunning && setBulkDeleteOpen(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle size={16} className="text-destructive" /> Excluir {selected.size} lançamento{selected.size === 1 ? "" : "s"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Essa ação não pode ser desfeita. Os lançamentos serão removidos do seu histórico e dos indicadores.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkRunning}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={bulkRunning}
              onClick={runBulkDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {bulkRunning ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null} Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ============================================================
// Modais preservados: mesmo comportamento anterior (form manual).
// ============================================================

function TxModal({
  initial, accounts, cards, categories, saving, onClose, onSubmit,
}: {
  initial: TransactionRow | null;
  accounts: { id: string; name: string }[];
  cards: { id: string; name: string }[];
  categories: { id: string; name: string; type: "income" | "expense" }[];
  saving: boolean;
  onClose: () => void;
  onSubmit: (v: ReturnType<typeof transactionSchema.parse>) => void;
}) {
  const [type, setType] = useState<"income" | "expense">((initial?.type as "income" | "expense") ?? "expense");
  const [accountId, setAccountId] = useState(initial?.account_id ?? accounts[0]?.id ?? "");
  const [paymentMethod, setPaymentMethod] = useState<"account" | "credit_card">(
    initial?.payment_method === "credit_card" ? "credit_card" : "account"
  );
  const [creditCardId, setCreditCardId] = useState(initial?.credit_card_id ?? cards[0]?.id ?? "");
  const [categoryId, setCategoryId] = useState<string | "">(initial?.category_id ?? "");
  const [amount, setAmount] = useState(initial ? String(initial.amount) : "");
  const [occurredAt, setOccurredAt] = useState(initial?.occurred_at ?? todayISO());
  const [description, setDescription] = useState(initial?.description ?? "");
  const [status, setStatus] = useState<"confirmed" | "planned">(initial?.status ?? "confirmed");
  const [error, setError] = useState<string | null>(null);

  void categories; // filtrado dentro do CategorySelect

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = transactionSchema.safeParse({
      payment_method: type === "income" ? "account" : paymentMethod,
      account_id: type === "income" || paymentMethod === "account" ? accountId : null,
      credit_card_id: type === "expense" && paymentMethod === "credit_card" ? creditCardId : null,
      category_id: categoryId || null,
      type,
      status,
      amount: Number(amount.replace(",", ".")),
      occurred_at: occurredAt,
      description,
    });
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? "Dados inválidos"); return; }
    onSubmit(parsed.data);
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4 overflow-y-auto" onClick={onClose}>
      <form onClick={(e) => e.stopPropagation()} onSubmit={submit} className="my-4 w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-card max-h-[90dvh] overflow-y-auto">
        <h2 className="font-display text-lg font-bold">{initial ? "Editar lançamento" : "Novo lançamento"}</h2>
        <div className="mt-4 space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setType("expense")} className={`rounded-xl border px-3 py-2 text-sm font-medium ${type === "expense" ? "border-destructive bg-destructive/10 text-destructive" : "border-border bg-background text-muted-foreground"}`}>Despesa</button>
            <button type="button" onClick={() => setType("income")} className={`rounded-xl border px-3 py-2 text-sm font-medium ${type === "income" ? "border-success bg-success/10 text-success" : "border-border bg-background text-muted-foreground"}`}>Receita</button>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">Valor (R$)</label>
            <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="input-base" placeholder="0,00" />
          </div>
          {type === "expense" && cards.length > 0 ? (
            <div>
              <label className="mb-1 block text-xs font-medium">De onde saiu?</label>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => setPaymentMethod("account")} className={`rounded-xl border px-3 py-2 text-sm ${paymentMethod === "account" ? "border-primary bg-primary/10 text-primary" : "border-border"}`}>Conta</button>
                <button type="button" onClick={() => setPaymentMethod("credit_card")} className={`rounded-xl border px-3 py-2 text-sm ${paymentMethod === "credit_card" ? "border-primary bg-primary/10 text-primary" : "border-border"}`}>Cartão de crédito</button>
              </div>
            </div>
          ) : null}
          {(type === "income" || paymentMethod === "account") ? (
            <div>
              <label className="mb-1 block text-xs font-medium">{type === "income" ? "Conta que recebeu" : "Conta de saída"}</label>
              <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className="input-base">
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
          ) : (
            <div>
              <label className="mb-1 block text-xs font-medium">Cartão utilizado</label>
              <select value={creditCardId} onChange={(e) => setCreditCardId(e.target.value)} className="input-base">
                <option value="">Selecione um cartão</option>
                {cards.map((card) => <option key={card.id} value={card.id}>{card.name}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="mb-1 block text-xs font-medium">Categoria</label>
            <CategorySelect value={categoryId || null} onChange={(id) => setCategoryId(id ?? "")} type={type} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-xs font-medium">Data</label>
              <input type="date" value={occurredAt} onChange={(e) => setOccurredAt(e.target.value)} className="input-base" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Status</label>
              <select value={status} onChange={(e) => setStatus(e.target.value as "confirmed" | "planned")} className="input-base">
                <option value="confirmed">Confirmado</option>
                <option value="planned">Planejado</option>
              </select>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">Descrição (opcional)</label>
            <input value={description ?? ""} onChange={(e) => setDescription(e.target.value)} className="input-base" />
          </div>
        </div>
        {error && <p className="mt-3 text-xs text-destructive">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-full border border-border bg-card px-4 py-2 text-sm">Cancelar</button>
          <button type="submit" disabled={saving} className="btn-brand inline-flex items-center gap-2">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Salvar"}
          </button>
        </div>
      </form>
    </div>
  );
}

function TransferModal({
  accounts, saving, onClose, onSubmit,
}: {
  accounts: { id: string; name: string }[];
  saving: boolean;
  onClose: () => void;
  onSubmit: (v: ReturnType<typeof transferSchema.parse>) => void;
}) {
  const [from, setFrom] = useState(accounts[0]?.id ?? "");
  const [to, setTo] = useState(accounts[1]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayISO());
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = transferSchema.safeParse({
      from_account_id: from,
      to_account_id: to,
      amount: Number(amount.replace(",", ".")),
      occurred_at: date,
      description,
    });
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? "Dados inválidos"); return; }
    onSubmit(parsed.data);
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4 overflow-y-auto" onClick={onClose}>
      <form onClick={(e) => e.stopPropagation()} onSubmit={submit} className="my-4 w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-card max-h-[90dvh] overflow-y-auto">
        <h2 className="font-display text-lg font-bold">Transferência entre contas</h2>
        <p className="mt-1 text-xs text-muted-foreground">Não conta como receita nem despesa.</p>
        <div className="mt-4 space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium">De</label>
            <select value={from} onChange={(e) => setFrom(e.target.value)} className="input-base">
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">Para</label>
            <select value={to} onChange={(e) => setTo(e.target.value)} className="input-base">
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-xs font-medium">Valor</label>
              <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="input-base" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Data</label>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="input-base" />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">Descrição (opcional)</label>
            <input value={description} onChange={(e) => setDescription(e.target.value)} className="input-base" />
          </div>
        </div>
        {error && <p className="mt-3 text-xs text-destructive">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-full border border-border bg-card px-4 py-2 text-sm">Cancelar</button>
          <button type="submit" disabled={saving} className="btn-brand inline-flex items-center gap-2">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Transferir"}
          </button>
        </div>
      </form>
    </div>
  );
}
