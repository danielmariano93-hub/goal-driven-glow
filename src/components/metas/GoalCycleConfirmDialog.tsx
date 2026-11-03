import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatBRL } from "@/lib/engine/facts";
import { historyMonthName, type GoalSeries, type HistoryMonth } from "@/lib/engine/goalHistory";
import { useConfirmGoalCycle } from "@/lib/nino/spendingGoals";

/** "Você tinha uma meta de <categoria> em <mês>?" — para meses importados em lote, sem meta por trás. */
export function GoalCycleConfirmDialog({ target, onClose }: { target: { series: GoalSeries; month: HistoryMonth } | null; onClose: () => void }) {
  const confirm = useConfirmGoalCycle();
  if (!target) return null;
  const { series, month } = target;
  const name = historyMonthName(month.month);

  async function answer(hadGoal: boolean) {
    if (!month.cycle_id) { onClose(); return; }
    try {
      await confirm.mutateAsync({ cycleId: month.cycle_id, hadGoal });
      toast.success(hadGoal ? "Confirmado. Esse mês entra nos cálculos." : "Ok. Esse mês sai dos cálculos.");
      onClose();
    } catch (error) {
      console.error("[goal-cycle:confirm]", error);
      toast.error("Não deu para salvar agora. Tente de novo em instantes.");
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Você tinha meta de {series.category_name} em {name}?</DialogTitle>
          <DialogDescription>
            Esse mês veio do histórico importado{month.limit != null ? `, com teto de ${formatBRL(month.limit)}` : ""}. Você gastou {formatBRL(month.actual)}. Enquanto não confirmar, ele fica fora dos totais.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Button type="button" disabled={confirm.isPending} onClick={() => answer(true)} className="min-h-11 rounded-full">Sim, eu tinha meta</Button>
          <Button type="button" variant="outline" disabled={confirm.isPending} onClick={() => answer(false)} className="min-h-11 rounded-full">Não tinha</Button>
          <Button type="button" variant="ghost" onClick={onClose} className="min-h-11 rounded-full">Decidir depois</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
