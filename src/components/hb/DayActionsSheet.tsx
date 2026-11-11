import { useState } from "react";
import { toast } from "sonner";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { hbErrorMessage, useLogHabit, useUnlogHabit, type HabitView } from "@/lib/habits/api";
import { weekStart, type LogRow, type LogStatus } from "@/lib/habits/engine";
import { OUTCOME_LABEL } from "@/components/hb/outcomeStyles";
import { dayOutcome } from "@/lib/habits/engine";

const dayLabel = (date: string, today: string) => {
  if (date === today) return "Hoje";
  const d = new Date(`${date}T12:00:00Z`);
  const t = new Date(`${today}T12:00:00Z`);
  if (Math.round((t.getTime() - d.getTime()) / 86_400_000) === 1) return "Ontem";
  return d.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit", timeZone: "UTC" });
};

/** Folha "Como foi?" para um dia de um hábito (hoje ou dias recentes). Todas as ações vão por RPC. */
export function DayActionsSheet({
  view, date, today, logs, open, onOpenChange,
}: { view: HabitView; date: string; today: string; logs: LogRow[]; open: boolean; onOpenChange: (o: boolean) => void }) {
  const log = useLogHabit();
  const unlog = useUnlogHabit();
  const [qty, setQty] = useState("");
  const { habit, def, summary } = view;
  const current = logs.find((l) => l.habit_id === habit.id && l.local_date === date);
  const outcome = dayOutcome(def, current, date, today);
  const weekly = summary.model === "weekly";
  const isQuantity = habit.kind === "do_quantity";
  const sameWeek = weekStart(date) === weekStart(today);
  const busy = log.isPending || unlog.isPending;

  const send = async (status: LogStatus, quantity?: number) => {
    try {
      await log.mutateAsync({ habit_id: habit.id, date, status, quantity });
      onOpenChange(false);
    } catch (e) {
      toast.error(hbErrorMessage(e));
    }
  };
  const undo = async () => {
    try {
      await unlog.mutateAsync({ habit_id: habit.id, date });
      onOpenChange(false);
    } catch (e) {
      toast.error(hbErrorMessage(e));
    }
  };

  const Btn = ({ label, sub, onClick, disabled, tone = "default" }: { label: string; sub?: string | null; onClick: () => void; disabled?: boolean; tone?: "default" | "primary" }) => (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      className={cn(
        "flex min-h-[52px] w-full flex-col items-start justify-center rounded-2xl border px-4 py-2 text-left transition-colors disabled:opacity-50",
        tone === "primary" ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card hover:bg-muted",
      )}
    >
      <span className="text-[15px] font-medium leading-5">{label}</span>
      {sub ? <span className={cn("text-[13px] leading-[18px]", tone === "primary" ? "text-primary-foreground/80" : "text-muted-foreground")}>{sub}</span> : null}
    </button>
  );

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <div className="mx-auto w-full max-w-md pb-[calc(env(safe-area-inset-bottom)+1rem)]">
          <DrawerHeader className="text-left">
            <DrawerTitle className="font-display text-[22px] font-semibold tracking-[-0.02em]">{habit.title}</DrawerTitle>
            <DrawerDescription>
              {dayLabel(date, today)} · {OUTCOME_LABEL[outcome]}
            </DrawerDescription>
          </DrawerHeader>
          <div className="flex flex-col gap-2 px-4">
            {isQuantity ? (
              <div className="flex gap-2">
                <Input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="any"
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                  placeholder={`Quanto? (meta ${habit.quantity_target ?? ""} ${habit.quantity_unit ?? ""})`}
                  aria-label="Quantidade"
                  className="h-[52px] rounded-2xl"
                />
                <button
                  type="button"
                  disabled={busy || qty === "" || Number.isNaN(Number(qty))}
                  onClick={() => void send("quantity", Number(qty))}
                  className="min-h-[52px] shrink-0 rounded-2xl bg-primary px-5 text-[15px] font-medium text-primary-foreground disabled:opacity-50"
                >
                  Salvar
                </button>
              </div>
            ) : null}
            <Btn label="Feito" tone="primary" onClick={() => void send("done")} />
            <Btn label="Versão mínima" sub={habit.minimum_text} onClick={() => void send("minimum")} />
            {!weekly ? (
              <Btn
                label="Folga"
                sub={sameWeek ? `${summary.rests_left_this_week} ${summary.rests_left_this_week === 1 ? "folga restante" : "folgas restantes"} esta semana · não quebra a sequência` : "Não quebra a sequência"}
                disabled={sameWeek && summary.rests_left_this_week === 0 && current?.status !== "rest"}
                onClick={() => void send("rest")}
              />
            ) : null}
            <Btn label={date === today ? "Hoje não" : "Não fiz"} sub="Sem culpa: amanhã é outro dia" onClick={() => void send("skipped")} />
            {current ? <Btn label="Desfazer registro" onClick={() => void undo()} /> : null}
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
