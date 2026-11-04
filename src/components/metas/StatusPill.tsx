import type { ReactNode } from "react";

// Visual de estado da tela do Ticket Alimentação, reaproveitado em Metas: etiqueta tingida com ponto, chip de valor,
// caixa de leitura e indicador (número com legenda). Cor só onde significa algo; estado nunca é só cor (sempre rótulo).

export type PillTone = "success" | "warning" | "danger" | "muted";

export const PILL_TONE: Record<PillTone, { cls: string; dot: string; bar: string }> = {
  success: { cls: "bg-success/15 text-success", dot: "bg-success", bar: "bg-success" },
  warning: { cls: "bg-warning/20 text-foreground", dot: "bg-warning", bar: "bg-warning" },
  danger: { cls: "bg-destructive/15 text-destructive", dot: "bg-destructive", bar: "bg-destructive" },
  muted: { cls: "bg-muted text-muted-foreground", dot: "bg-muted-foreground", bar: "bg-muted-foreground/60" },
};

/** Etiqueta de estado: "● Em risco", "● Funcionando". */
export function StatusPill({ tone, children, className = "" }: { tone: PillTone; children: ReactNode; className?: string }) {
  const t = PILL_TONE[tone];
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${t.cls} ${className}`}>
      <span aria-hidden className={`h-2 w-2 rounded-full ${t.dot}`} />
      {children}
    </span>
  );
}

/** Chip de valor/variação, sem ponto: "R$ 656,29 acima", "−19%". */
export function ValueChip({ tone, children, className = "" }: { tone: PillTone; children: ReactNode; className?: string }) {
  return <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold tabular-nums ${PILL_TONE[tone].cls} ${className}`}>{children}</span>;
}

/** Caixa de leitura: frase em destaque + complemento (como "No ritmo de R$ 44,98/dia, o Ticket cobre até 23/11"). */
export function InsightBox({ title, children, testId }: { title?: ReactNode; children?: ReactNode; testId?: string }) {
  return (
    <div data-testid={testId} className="rounded-xl bg-muted/50 p-3 text-[13px] leading-5">
      {title ? <strong className="font-semibold">{title}</strong> : null}
      {children ? <div className={title ? "mt-0.5 text-muted-foreground" : "text-muted-foreground"}>{children}</div> : null}
    </div>
  );
}

/** Indicador: rótulo, valor e legenda, no formato do trio Ritmo / Ideal / Cobertura. */
export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: PillTone }) {
  return (
    <div className="rounded-xl bg-muted/50 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`mt-1 text-base font-bold tabular-nums ${tone === "success" ? "text-success" : tone === "danger" ? "text-destructive" : ""}`}>{value}</div>
      {hint ? <div className="text-[11px] text-muted-foreground">{hint}</div> : null}
    </div>
  );
}
