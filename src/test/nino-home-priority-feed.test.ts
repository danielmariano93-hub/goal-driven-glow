import { describe, expect, it } from "vitest";
import { buildNinoHomeEditorialView } from "@/lib/nino/homeEditorial";
import { parseNinoPriorities } from "@/lib/nino/priorities";

const feed = parseNinoPriorities([
  { rank: 2, fingerprint: "b", kind: "goal_at_risk", severity: "attention", title: "Sua meta Viagem pede aporte", body: "Faltam R$ 8.500,00 até 15/12/2026.", route: "/app/metas", impact_amount: 8500, as_of: "2026-09-29", computed_at: "2026-09-29T18:17:00Z" },
  { rank: 1, fingerprint: "a", kind: "debt_overdue", severity: "critical", title: "Parcela de Celular venceu ontem", body: "São R$ 500,00 com vencimento em 28/09.", route: "/app/dividas", impact_amount: 500, as_of: "2026-09-29", computed_at: "2026-09-29T18:17:00Z" },
  { rank: 3, fingerprint: "c", kind: "data_quality", severity: "info", title: "Sua renda do mês ainda não apareceu", body: "Com ela registrada, consigo dizer quanto sobra.", route: "//evil.example", impact_amount: 0, as_of: "2026-09-29", computed_at: "2026-09-29T18:17:00Z" },
  { rank: 4, fingerprint: "bad", kind: "x", severity: "unknown", title: "inválido" },
]);

describe("Home a partir da fila de prioridades", () => {
  it("descarta item fora do contrato e respeita a ordem da fila", () => {
    expect(feed.map((p) => p.fingerprint)).toEqual(["a", "b", "c"]);
  });

  it("nº 1 vira o destaque e os seguintes viram apoio, sem recalcular nada", () => {
    const view = buildNinoHomeEditorialView({ context: null, diagnosis: null, nextStep: null, priorities: feed });
    expect(view.primary?.headline).toBe("Parcela de Celular venceu ontem");
    expect(view.primary?.tone).toBe("critical");
    expect(view.primary?.primaryAction).toEqual({ kind: "link", label: "Ver dívida", route: "/app/dividas" });
    expect(view.primary?.mainValue).toBeNull();
    expect(view.supporting).toEqual([]);
    expect(view.supportingPool.map((s) => s.title)).toEqual(["Sua meta Viagem pede aporte", "Sua renda do mês ainda não apareceu"]);
    expect(view.primaryPool.map((s) => s.headline)).toEqual(["Parcela de Celular venceu ontem", "Sua meta Viagem pede aporte", "Sua renda do mês ainda não apareceu"]);
    expect(view.totalAvailable).toBe(3);
  });

  it("rota fora do app nunca vira link", () => {
    const view = buildNinoHomeEditorialView({ context: null, diagnosis: null, nextStep: null, priorities: [feed[2]] });
    expect(view.primary?.primaryAction).toBeNull();
    expect(view.primary?.eyebrow).toBe("Falta um dado");
  });

  it("fila vazia mantém o diagnóstico como reserva", () => {
    const view = buildNinoHomeEditorialView({ context: null, diagnosis: null, nextStep: null, priorities: [] });
    expect(view.primary).toBeNull();
  });
});

import { hasEditorialAlternative } from "@/lib/nino/homeEditorial";

describe("Outra orientação com a fila", () => {
  it("os próximos itens da fila ficam disponíveis como alternativa", () => {
    const view = buildNinoHomeEditorialView({ context: null, diagnosis: null, nextStep: null, priorities: feed });
    expect(hasEditorialAlternative({ pool: view.primaryPool, current: view.primary!, displayed: view.supporting, seenIds: new Set() })).toBe(true);
  });
});
