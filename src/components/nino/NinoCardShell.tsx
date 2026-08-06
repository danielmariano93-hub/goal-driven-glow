import { useState, type ReactNode } from "react";
import { CaretDown } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Props = {
  badge: ReactNode;
  title: string;
  metric?: ReactNode;
  children?: ReactNode;
  details?: ReactNode;
  actions?: ReactNode;
  feedback?: ReactNode;
  tone?: "neutral" | "positive" | "attention" | "critical";
  compact?: boolean;
};

export function NinoCardShell({ badge, title, metric, children, details, actions, feedback, tone = "neutral", compact }: Props) {
  const [open, setOpen] = useState(false);
  const toneClass = tone === "critical" ? "text-destructive" : tone === "attention" ? "text-warning" : tone === "positive" ? "text-success" : "text-primary";
  return (
    <article className={cn("w-full rounded-[18px] border border-border bg-card shadow-sm", compact ? "p-3.5" : "p-4")}>
      <div className={cn("inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-[10px] font-bold uppercase", toneClass)}>{badge}</div>
      <h2 className={cn("break-words font-display font-bold leading-tight text-foreground", compact ? "mt-2 text-[15px]" : "mt-2.5 text-[17px]")}>{title}</h2>
      {metric ? <div className={cn("mt-1 break-words text-[13px] font-semibold tabular-nums", toneClass)}>{metric}</div> : null}
      {children ? <div className="mt-2 text-[13px] leading-relaxed text-muted-foreground">{children}</div> : null}
      {actions || feedback ? <div className="mt-4 flex flex-wrap items-center gap-3">{actions}{feedback}</div> : null}
      {details ? (
        <div className="mt-3">
          <Button type="button" variant="ghost" size="sm" onClick={() => setOpen((value) => !value)} aria-expanded={open} className="px-0 text-[11px] text-muted-foreground">
             Como o Nino chegou aqui <CaretDown className={cn("h-3 w-3 transition", open && "rotate-180")} />
          </Button>
          {open ? <div className="mt-2 rounded-2xl bg-muted p-3 text-[11.5px] leading-relaxed text-muted-foreground">{details}</div> : null}
        </div>
      ) : null}
    </article>
  );
}
