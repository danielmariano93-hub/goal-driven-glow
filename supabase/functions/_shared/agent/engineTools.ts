// Fachada semântica dos engine tools.
// Mantém a implementação original isolada e corrige somente linguagem/escopo
// sem duplicar os cálculos financeiros canônicos do motor.
import * as legacy from "./engineToolsImpl.ts";

export * from "./engineToolsImpl.ts";

export async function analyze_financial_evolution(
  ...args: Parameters<typeof legacy.analyze_financial_evolution>
): Promise<Awaited<ReturnType<typeof legacy.analyze_financial_evolution>>> {
  const execution = await legacy.analyze_financial_evolution(...args);
  if (!execution.ok) return execution;

  const result = execution.result as any;
  const headline = String(result?.answer_format?.headline ?? "")
    .replace("entraram ", "as receitas da rotina somaram ")
    .replace(" e saíram ", " e os gastos da rotina somaram ")
    .replace("(resultado ", "(resultado operacional ");

  return {
    ok: true,
    result: {
      ...result,
      answer_format: {
        ...(result?.answer_format ?? {}),
        headline,
      },
    },
  };
}

function normalizeEntity(value: unknown): string {
  return String(value ?? "").toLowerCase().normalize("NFD")
    .replace(/\p{Diacritic}/gu, "").replace(/[^a-z0-9]+/g, " ").trim();
}

function brl(value: unknown): string {
  const n = Number(value ?? 0);
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number.isFinite(n) ? n : 0);
}

function datePt(value: unknown): string {
  const raw = String(value ?? "").slice(0, 10);
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : raw;
}

/**
 * `get_debt_status` continua calculando tudo no motor canônico. Esta fachada
 * apenas reduz o envelope JÁ calculado quando o Grounding Engine provou que
 * "essa dívida" aponta para uma única dívida. Assim uma referência singular
 * nunca degrada silenciosamente para o total de todas as dívidas.
 */
export async function get_debt_status(
  ctx: Parameters<typeof legacy.get_debt_status>[0],
  args: Parameters<typeof legacy.get_debt_status>[1] & { debt_name?: string },
): Promise<Awaited<ReturnType<typeof legacy.get_debt_status>>> {
  const execution = await legacy.get_debt_status(ctx, args);
  if (!execution.ok) return execution;

  const wanted = normalizeEntity(args?.debt_name);
  if (!wanted) return execution;

  const result = execution.result as any;
  const items = Array.isArray(result?.breakdown) ? result.breakdown : [];
  const exact = items.filter((item: any) =>
    normalizeEntity(item?.name) === wanted || normalizeEntity(item?.creditor) === wanted
  );
  const matches = exact.length ? exact : items.filter((item: any) => {
    const name = normalizeEntity(item?.name);
    const creditor = normalizeEntity(item?.creditor);
    return (name && (name.includes(wanted) || wanted.includes(name)))
      || (creditor && (creditor.includes(wanted) || wanted.includes(creditor)));
  });

  if (matches.length === 0) return { ok: false, error: "debt_not_found" } as any;
  if (matches.length > 1) return { ok: false, error: "debt_reference_ambiguous" } as any;

  const item = matches[0] as any;
  const overdue = item.situation === "em_atraso";
  const dueSoon = item.situation === "vence_em_breve";
  const undefinedSchedule = item.situation === "indefinido";
  const nextDue = item.next_due_date ? item : null;
  const installment = Number(item.installment_amount ?? 0);
  const outstanding = Number(item.outstanding_balance ?? 0);

  let headline = `${item.name}: saldo de ${brl(outstanding)}.`;
  if (overdue) {
    headline += ` Há ${Number(item.overdue_installments ?? 0)} parcela(s) vencida(s), somando ${brl(item.overdue_amount)}.`;
  } else if (item.next_due_date) {
    headline += ` A próxima parcela é de ${brl(installment)} em ${datePt(item.next_due_date)}.`;
  } else if (undefinedSchedule) {
    headline += " Não há uma agenda de parcelas completa cadastrada para calcular o próximo vencimento.";
  } else if (item.situation === "quitada") {
    headline = `${item.name} está quitada.`;
  }

  return {
    ok: true,
    result: {
      ...result,
      facts: {
        debts_analyzed: 1,
        overdue_count: overdue ? 1 : 0,
        overdue_amount: overdue ? Number(item.overdue_amount ?? 0) : 0,
        due_soon_count: dueSoon ? 1 : 0,
        due_soon_amount: dueSoon ? installment : 0,
        total_outstanding: outstanding,
        worst: overdue ? item : null,
        next_due: nextDue,
        undefined_count: undefinedSchedule ? 1 : 0,
      },
      breakdown: [item],
      drivers: (overdue || dueSoon) ? [item] : [],
      applied_reference_scope: { target: "debt", entity_labels: [String(item.name)] },
      answer_format: {
        ...(result?.answer_format ?? {}),
        headline,
      },
    },
  } as any;
}
