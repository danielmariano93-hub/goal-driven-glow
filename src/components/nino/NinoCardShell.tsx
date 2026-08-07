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
    <article className={cn("w-full rounded-2xl border border-border bg-card shadow-sm", compact ? "p-3" : "p-3.5")}>
      <div className={cn("inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide", toneClass)}>{badge}</div>
      <h2 className={cn("break-words font-display font-bold leading-tight text-foreground", compact ? "mt-1.5 text-[14px]" : "mt-2 text-[16px]")}>{title}</h2>
      {metric ? <div className={cn("mt-0.5 break-words text-[12px] font-semibold tabular-nums", toneClass)}>{metric}</div> : null}
      {children ? <div className={cn("mt-1.5 text-[12px] leading-[17px] text-muted-foreground", compact && "line-clamp-2")}>{children}</div> : null}
      {actions || feedback ? <div className="mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-border pt-2">{actions}{feedback}</div> : null}
      {details ? (
        <div className="mt-1.5">
          <Button type="button" variant="ghost" size="sm" onClick={() => setOpen((value) => !value)} aria-expanded={open} className="h-8 px-0 text-[10px] text-muted-foreground">
             Como o Nino chegou aqui <CaretDown className={cn("h-3 w-3 transition", open && "rotate-180")} />
          </Button>
          {open ? <div className="mt-1 rounded-xl bg-muted p-2.5 text-[11px] leading-[16px] text-muted-foreground">{details}</div> : null}
        </div>
      ) : null}
    </article>
  );
}
