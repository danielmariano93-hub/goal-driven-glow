import type { Outcome } from "@/lib/habits/engine";

export const OUTCOME_LABEL: Record<Outcome, string> = {
  done: "Feito",
  minimum: "Versão mínima",
  rest: "Folga",
  missed: "Não fiz",
  unlogged: "Em aberto",
  not_expected: "Sem registro",
};

export const OUTCOME_CELL: Record<Outcome, string> = {
  done: "bg-primary",
  minimum: "bg-primary/45",
  rest: "bg-primary/20",
  missed: "bg-muted-foreground/20",
  unlogged: "border border-muted-foreground/40",
  not_expected: "border border-dashed border-muted-foreground/25",
};
