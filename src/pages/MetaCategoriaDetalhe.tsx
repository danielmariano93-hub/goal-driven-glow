import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  useCategories,
  useLedgerWindow,
  useCategorySpendingGoals,
  useSaveCategorySpendingGoal,
  useDeleteCategorySpendingGoal,
  useUpdateCategorySpendingGoalStatus,
} from "@/lib/db/finance";
import { useFinancialSnapshot } from "@/lib/hooks/useFinancialSnapshot";
import { buildStrategyForCategoryGoal } from "@/lib/goals/strategyInputs";
import { CategoryGoalCard } from "@/components/metas/CategoryGoalCard";
import { CategoryGoalStrategyCard } from "@/components/metas/CategoryGoalStrategyCard";
import { CategoryGoalForm } from "@/components/metas/CategoryGoalForm";
import { formatBRL, effectiveCategoryId, buildRefundAttribution, isRealMonthlyMovement, reportingCompetenceDate, todayISO } from "@/lib/engine/facts";

export default function MetaCategoriaDetalhe() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: catGoals, isLoading } = useCategorySpendingGoals();
  const { data: categories } = useCategories();
  const { data: txs } = useLedgerWindow({ monthsBack: 3, monthsAhead: 1 });
  const currentMonth = todayISO().slice(0, 7);
  const { data: financialSnapshot } = useFinancialSnapshot({
    start: `${currentMonth}-01`,
    end: todayISO(),
  });
  const saveCatGoal = useSaveCategorySpendingGoal();
  const delCatGoal = useDeleteCategorySpendingGoal();
  const toggleCatGoal = useUpdateCategorySpendingGoalStatus();
  const [openForm, setOpenForm] = useState(false);

  const goal = (catGoals ?? []).find((g) => g.id === id) ?? null;
  const numericTxs = useMemo(() => (txs ?? []).map((t) => ({ ...t, amount: Number(t.amount) })), [txs]);
  const categoryName = useMemo(
    () => (categories ?? []).find((c) => c.id === goal?.category_id)?.name,
    [categories, goal],
  );

  const evaluation = useMemo(
    () => financialSnapshot?.activeCategoryGoals.find((item) => item.goal.id === goal?.id) ?? null,
    [financialSnapshot, goal?.id],
  );

  const strategy = useMemo(
    () => (evaluation ? buildStrategyForCategoryGoal(evaluation, numericTxs as never) : null),
    [evaluation, numericTxs],
  );

  // Mesma lente do teto (`reporting_competence.v1`): compra de cartão pertence
  // ao mês da fatura. Sem isso a lista somava por data da compra e mostrava um
  // total diferente do card logo acima dela.
  const periodTxs = useMemo(() => {
    if (!evaluation) return [];
    const attribution = buildRefundAttribution(numericTxs as never);
    return numericTxs
      .filter((t) => String(t.status ?? "confirmed") === "confirmed")
      .filter((t) => effectiveCategoryId(t as never, attribution) === evaluation.goal.category_id)
      .filter((t) => {
        const day = reportingCompetenceDate(t as never);
        return day >= evaluation.period.start && day <= evaluation.period.end;
      })
      .filter((t) => String(t.movement_kind ?? "") === "refund" || (t.type === "expense" && isRealMonthlyMovement(t as never)))
      .sort((a, b) => (reportingCompetenceDate(a as never) < reportingCompetenceDate(b as never) ? 1 : -1));
  }, [evaluation, numericTxs]);


  if (isLoading) {
    return <div className="grid place-items-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  if (!goal || !evaluation || !strategy) {
    return (
      <div className="pt-2">
        <Link to="/app/metas" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><ArrowLeft size={14} /> Metas</Link>
        <div className="mt-4 rounded-2xl border border-dashed border-border bg-card p-8 text-center">
          <p className="text-sm font-medium">Esta meta não está mais disponível.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="pb-8 pt-2">
      <Link to="/app/metas" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><ArrowLeft size={14} /> Metas</Link>
      <h1 className="mt-2 font-display text-2xl font-bold tracking-tight">{categoryName ?? "Meta por categoria"}</h1>
      <p className="mb-4 text-sm text-muted-foreground">Teto de gasto, projeção do período e o plano do Nino.</p>

      <ul className="space-y-3">
        <CategoryGoalCard
          evaluation={evaluation}
          clickable={false}
          onEdit={() => setOpenForm(true)}
          onDelete={() => {
            if (confirm("Excluir esta meta?")) {
              delCatGoal.mutate(goal.id, { onSuccess: () => { toast.success("Excluída"); navigate("/app/metas"); } });
            }
          }}
          onToggleStatus={() => toggleCatGoal.mutate({ id: goal.id, status: goal.status === "active" ? "paused" : "active" })}
        >
          <CategoryGoalStrategyCard strategy={strategy} defaultOpen />
        </CategoryGoalCard>
      </ul>

      <section className="mt-5 rounded-2xl border border-border bg-card p-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold">Lançamentos considerados</p>
          <span className="text-[11px] text-muted-foreground">{periodTxs.length} no período</span>
        </div>
        {periodTxs.length === 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">Nenhum gasto registrado nesta categoria dentro do período.</p>
        ) : (
          <ul className="mt-3 divide-y divide-border">
            {periodTxs.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-3 py-2">
                <Link to={`/app/lancamentos/${t.id}`} className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium">{t.merchant_name || t.description || "Sem descrição"}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {new Date(t.occurred_at + "T00:00:00").toLocaleDateString("pt-BR")}
                    {reportingCompetenceDate(t as never) !== String(t.occurred_at).slice(0, 10)
                      ? ` · fatura de ${new Date(reportingCompetenceDate(t as never) + "T00:00:00").toLocaleDateString("pt-BR", { month: "long" })}`
                      : ""}
                    {String(t.movement_kind ?? "") === "refund" ? " · estorno" : ""}
                  </p>
                </Link>
                <span className={`shrink-0 text-xs font-semibold tabular-nums ${String(t.movement_kind ?? "") === "refund" ? "text-success" : ""}`}>
                  {formatBRL(Number(t.amount))}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {openForm && (
        <CategoryGoalForm
          initial={goal as never}
          categories={categories ?? []}
          txs={numericTxs as never}
          saving={saveCatGoal.isPending}
          onClose={() => setOpenForm(false)}
          onSubmit={(values) => saveCatGoal.mutate({ ...values, id: goal.id } as never, {
            onSuccess: () => { setOpenForm(false); toast.success("Meta atualizada"); },
            onError: (e: unknown) => toast.error((e as Error).message),
          })}
        />
      )}
    </div>
  );
}
