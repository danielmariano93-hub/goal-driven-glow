import { Link } from "react-router-dom";
import { PlusCircle, Target, Calculator } from "lucide-react";
import { copy } from "@/lib/copy/strings";

export function QuickActions() {
  return (
    <div className="grid grid-cols-3 gap-2">
      <QuickAction to="/app/lancamentos" label={copy.actions.logExpense} icon={<PlusCircle />} />
      <QuickAction to="/app/metas" label={copy.actions.saveForGoal} icon={<Target />} />
      <QuickAction to="/app/planejamento" label={copy.actions.beforeBuying} icon={<Calculator />} />
    </div>
  );
}

function QuickAction({ to, label, icon }: { to: string; label: string; icon: React.ReactNode }) {
  return (
    <Link
      to={to}
      className="flex flex-col items-center gap-1.5 rounded-2xl border border-border bg-card p-3 text-center text-[11px] font-medium leading-tight text-foreground shadow-card transition-colors hover:border-primary/40"
    >
      <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary/10 text-primary [&>svg]:h-4 [&>svg]:w-4">{icon}</span>
      {label}
    </Link>
  );
}
