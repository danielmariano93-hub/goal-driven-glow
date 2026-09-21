// Fachada semântica dos engine tools.
// Mantém a implementação original isolada e corrige somente linguagem que
// confundia renda/consumo da rotina com fluxo bancário de caixa.
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
