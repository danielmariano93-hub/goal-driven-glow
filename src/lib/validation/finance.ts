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
  payment_method: z.enum(["account", "credit_card"]).default("account"),
  account_id: z.string().uuid().nullable().optional(),
  credit_card_id: z.string().uuid().nullable().optional(),
  category_id: z.string().uuid().nullable().optional(),
  type: z.enum(["income", "expense"]),
  status: z.enum(["confirmed", "planned"]).default("confirmed"),
  amount: z.number({ invalid_type_error: "Valor inválido" }).positive("Valor deve ser maior que zero"),
  occurred_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida"),
  purchase_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data da compra inválida").nullable().optional(),
  installments_total: z.number().int().min(1).max(48).default(1),
  installment_number: z.number().int().min(1).max(48).default(1),
  description: z.string().trim().max(120).optional().or(z.literal("")),
  notes: z.string().trim().max(500).optional().or(z.literal("")),
}).superRefine((value, ctx) => {
  if (value.type === "income" && !value.account_id) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["account_id"], message: "Escolha a conta que recebeu o valor" });
  }
  if (value.type === "expense" && value.payment_method === "account" && !value.account_id) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["account_id"], message: "Escolha a conta de saída" });
  }
  if (value.type === "expense" && value.payment_method === "credit_card" && !value.credit_card_id) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["credit_card_id"], message: "Escolha o cartão utilizado" });
  }
  if (value.installment_number > value.installments_total) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["installment_number"], message: "A parcela atual não pode superar o total de parcelas" });
  }
  if (value.payment_method !== "credit_card" && value.installments_total > 1) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["installments_total"], message: "Parcelamento exige cartão de crédito" });
  }
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

export const goalSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    target_amount: z.number().positive(),
    target_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    priority: z.number().int().min(1).max(5).default(3),
    notes: z.string().trim().max(500).optional().or(z.literal("")),
    /** "savings" = guardar para si; "donation" = doação recorrente. */
    kind: z.enum(["savings", "donation"]).default("savings"),
    donation_mode: z.enum(["fixed", "income_percent"]).nullable().optional(),
    donation_percent: z.number().min(0.1).max(100).nullable().optional(),
    monthly_target: z.number().positive().nullable().optional(),
  })
  .refine((v) => v.kind !== "donation" || !!v.donation_mode, {
    path: ["donation_mode"],
    message: "Escolha se a doação é valor fixo ou percentual da receita",
  })
  .refine(
    (v) => v.kind !== "donation" || v.donation_mode !== "income_percent" || (v.donation_percent ?? 0) > 0,
    { path: ["donation_percent"], message: "Informe o percentual da receita" },
  )
  .refine(
    (v) => v.kind !== "donation" || v.donation_mode !== "fixed" || (v.monthly_target ?? 0) > 0,
    { path: ["monthly_target"], message: "Informe o valor mensal da doação" },
  );
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
  installments_total: z.number().int().min(1).max(600).nullable().optional(),
  installments_paid: z.number().int().min(0).max(600).default(0),
  contract_total_amount: z.number().positive().optional(),
  principal_amount: z.number().positive().optional(),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  first_due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  amount_was_inferred: z.boolean().default(false),
  due_day: z.number().int().min(1).max(31).nullable().optional(),
  interest_rate_pct: z.number().min(0).max(1000).nullable().optional(),
  notes: z.string().trim().max(300).optional().or(z.literal("")),
}).superRefine((value, ctx) => {
  if (value.installments_total != null && value.installments_paid > value.installments_total) {
    ctx.addIssue({ code: "custom", path: ["installments_paid"], message: "Parcelas pagas não podem superar o total." });
  }
  if (value.installments_total != null && !value.installment_amount) {
    ctx.addIssue({ code: "custom", path: ["installment_amount"], message: "Informe o valor da parcela." });
  }
});
export type DebtInput = z.infer<typeof debtSchema>;
