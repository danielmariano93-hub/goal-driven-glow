import { z } from "zod";
import { displayNameSchema } from "./auth";

export const incomeFrequencyValues = ["mensal", "quinzenal", "semanal", "variavel"] as const;
export type IncomeFrequency = (typeof incomeFrequencyValues)[number];

export const onboardingSchema = z.object({
  displayName: displayNameSchema,
  approximateMonthlyIncome: z
    .number({ invalid_type_error: "Informe um valor numérico" })
    .min(0, "Não pode ser negativo")
    .max(9_999_999, "Valor muito alto")
    .optional(),
  incomeFrequency: z.enum(incomeFrequencyValues).default("mensal"),
  incomeDay: z
    .number()
    .int()
    .min(1)
    .max(31)
    .optional(),
  timezone: z.string().default("America/Sao_Paulo"),
  currency: z.literal("BRL").default("BRL"),
});

export type OnboardingInput = z.infer<typeof onboardingSchema>;
