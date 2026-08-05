import { Link } from "react-router-dom";
import { ArrowRight, CheckCircle, Circle, Path } from "@phosphor-icons/react";
import { copy } from "@/lib/copy/strings";

type Step = { key: string; label: string; to: string; done: boolean };

export function ComecePorAqui({
  hasAccount,
  hasTransaction,
  hasGoal,
}: {
  hasAccount: boolean;
  hasTransaction: boolean;
  hasGoal: boolean;
}) {
  const steps: Step[] = [
    { key: "acc", label: copy.startHere.addAccount, to: "/app/contas", done: hasAccount },
    { key: "tx", label: copy.startHere.logExpense, to: "/app/lancamentos", done: hasTransaction },
    { key: "goal", label: copy.startHere.createGoal, to: "/app/metas", done: hasGoal },
  ];

  return (
    <section className="rounded-[20px] border border-primary/15 bg-gradient-brand-soft p-5 shadow-sm animate-fade-in">
      <div className="flex items-center gap-2 text-xs font-semibold text-primary">
        <Path className="h-3.5 w-3.5" weight="duotone" /> {copy.startHere.header}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{copy.startHere.subtitle}</p>
      <ul className="mt-4 space-y-2">
        {steps.map((s) => (
          <li key={s.key}>
            <Link
              to={s.to}
              className="flex min-h-11 items-center gap-3 rounded-xl border border-border bg-card px-3 py-2.5 text-sm transition-colors hover:border-primary/40"
            >
              {s.done ? (
                <CheckCircle size={16} weight="fill" className="text-success" />
              ) : (
                <Circle size={16} className="text-muted-foreground" />
              )}
              <span className={`flex-1 ${s.done ? "line-through text-muted-foreground" : ""}`}>{s.label}</span>
              <ArrowRight size={14} className="text-muted-foreground" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
