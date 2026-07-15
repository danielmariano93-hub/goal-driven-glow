import { z } from "zod";

export const accountTypeEnum = z.enum(["checking", "savings", "cash", "investment", "other"]);
export const accountSchema = z.object({
  name: z.string().trim().min(1, "Informe um nome").max(60, "Nome muito longo"),
  type: accountTypeEnum.default("checking"),
  institution: z.string().trim().max(60).optional().or(z.literal("")),
  opening_balance: z.number({ invalid_type_error: "Valor inválido" }).min(-1_000_000_000).max(1_000_000_000).default(0),
  active: z.boolean().default(true),
});
export type AccountInput = z.infer<typeof accountSchema>;

export const categorySchema = z.object({
  name: z.string().trim().min(1, "Informe um nome").max(40, "Nome muito longo"),
  type: z.enum(["income", "expense"]),
  color: z.string().optional(),
  icon: z.string().optional(),
});
export type CategoryInput = z.infer<typeof categorySchema>;

export const transactionSchema = z.object({
  account_id: z.string().uuid("Conta obrigatória"),
  category_id: z.string().uuid().nullable().optional(),
  type: z.enum(["income", "expense"]),
  status: z.enum(["confirmed", "planned"]).default("confirmed"),
  amount: z.number({ invalid_type_error: "Valor inválido" }).positive("Valor deve ser maior que zero"),
  occurred_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida"),
  description: z.string().trim().max(120).optional().or(z.literal("")),
  notes: z.string().trim().max(500).optional().or(z.literal("")),
});
export type TransactionInput = z.infer<typeof transactionSchema>;

export const transferSchema = z
  .object({
    from_account_id: z.string().uuid("Conta origem obrigatória"),
    to_account_id: z.string().uuid("Conta destino obrigatória"),
    amount: z.number().positive("Valor deve ser maior que zero"),
    occurred_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida"),
    description: z.string().trim().max(120).optional().or(z.literal("")),
  })
  .refine((v) => v.from_account_id !== v.to_account_id, {
    path: ["to_account_id"],
    message: "Contas devem ser diferentes",
  });
export type TransferInput = z.infer<typeof transferSchema>;

export const goalSchema = z.object({
  name: z.string().trim().min(1).max(60),
  target_amount: z.number().positive(),
  target_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  priority: z.number().int().min(1).max(5).default(3),
  notes: z.string().trim().max(500).optional().or(z.literal("")),
});
export type GoalInput = z.infer<typeof goalSchema>;

export const contributionSchema = z.object({
  goal_id: z.string().uuid(),
  amount: z.number().positive(),
  occurred_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  account_id: z.string().uuid().nullable().optional(),
  notes: z.string().trim().max(300).optional().or(z.literal("")),
});
export type ContributionInput = z.infer<typeof contributionSchema>;

export const investmentSchema = z.object({
  name: z.string().trim().min(1).max(60),
  category: z.string().trim().min(1).max(40),
  institution: z.string().trim().max(60).optional().or(z.literal("")),
  invested_amount: z.number().min(0),
  current_value: z.number().min(0),
  reference_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  goal_id: z.string().uuid().nullable().optional(),
  notes: z.string().trim().max(300).optional().or(z.literal("")),
});
export type InvestmentInput = z.infer<typeof investmentSchema>;

export const debtSchema = z.object({
  name: z.string().trim().min(1).max(60),
  creditor: z.string().trim().max(60).optional().or(z.literal("")),
  original_amount: z.number().positive(),
  outstanding_balance: z.number().min(0),
  installment_amount: z.number().min(0).nullable().optional(),
  due_day: z.number().int().min(1).max(31).nullable().optional(),
  interest_rate_pct: z.number().min(0).max(1000).nullable().optional(),
  notes: z.string().trim().max(300).optional().or(z.literal("")),
});
export type DebtInput = z.infer<typeof debtSchema>;
