import { z } from "zod";

export const creditCardSchema = z.object({
  name: z.string().trim().min(1, "Informe um nome").max(40, "Nome muito longo"),
  brand: z.string().trim().max(30).optional().or(z.literal("")),
  last_four: z
    .string()
    .trim()
    .regex(/^\d{4}$/, "4 dígitos")
    .optional()
    .or(z.literal("")),
  total_limit: z.number({ invalid_type_error: "Valor inválido" }).min(0, "Não pode ser negativo").max(1_000_000_000),
  closing_day: z.number().int().min(1).max(31),
  due_day: z.number().int().min(1).max(31),
  color: z.string().optional().or(z.literal("")),
  statement_goal: z.number().min(0).max(1_000_000_000).nullable().optional(),
  active: z.boolean().default(true),
});
export type CreditCardInput = z.infer<typeof creditCardSchema>;

/**
 * Retorna a data (primeiro dia do mês) da competência da fatura para uma compra.
 * Se dia da compra <= closing_day → fatura do mês atual (fecha agora).
 * Senão → fatura do próximo mês.
 */
export function computeCompetenceDate(purchase: Date, closingDay: number): Date {
  const day = purchase.getDate();
  const y = purchase.getFullYear();
  const m = purchase.getMonth();
  if (day <= closingDay) return new Date(y, m, 1);
  return new Date(y, m + 1, 1);
}

export function computeCompetenceDateISO(purchaseISO: string, closingDay: number): string {
  const d = new Date(purchaseISO + "T12:00:00");
  const c = computeCompetenceDate(d, closingDay);
  return `${c.getFullYear()}-${String(c.getMonth() + 1).padStart(2, "0")}-01`;
}

/** Data de fechamento (dia específico) para um mês/ano. */
export function closingDateFor(year: number, month0: number, closingDay: number): Date {
  const last = new Date(year, month0 + 1, 0).getDate();
  return new Date(year, month0, Math.min(closingDay, last));
}
