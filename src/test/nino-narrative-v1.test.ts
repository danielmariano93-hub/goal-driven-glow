// nino_narrative.v1 — provas determinísticas da camada de narrativa do Nino:
// pacote de evidência tipado, elegibilidade por tipo, guarda de verdade,
// variação sem mudança de fato, agrupamento multissinal e memória com validade.
import { describe, expect, it } from "vitest";
import {
  buildNarrativeEvidencePack,
  numbersInText,
  NARRATIVE_EVIDENCE_PACK_VERSION,
} from "../../supabase/functions/_shared/agent/narrative/NarrativeEvidencePack.ts";
import {
  narrativeEligibility,
  OPERATIONAL_KINDS,
  toneRulesFor,
} from "../../supabase/functions/_shared/agent/narrative/TonePolicy.ts";
import {
  citedNumbers,
  guardNarrative,
  matchesEvidence,
} from "../../supabase/functions/_shared/agent/narrative/NarrativeGuard.ts";
import { chooseVariation } from "../../supabase/functions/_shared/agent/narrative/NarrativeVariation.ts";
import {
  domainOf,
  groupSignals,
  subjectKeyOf,
} from "../../supabase/functions/_shared/agent/narrative/SignalGrouping.ts";
import {
  contextFromReply,
  isActiveContext,
} from "../../supabase/functions/_shared/agent/narrative/NarrativeMemory.ts";
import {
  buildNarrativePrompt,
  deterministicResult,
  formatNarrativeForWhatsapp,
} from "../../supabase/functions/_shared/agent/narrative/NarrativeComposer.ts";

const paceCandidate = {
  kind: "spending_pace_change",
  severity: "attention" as const,
  title: "Ritmo de gastos acima do normal",
  body: "Seus gastos estão R$ 1.240,50 acima do ritmo típico neste mês.",
  evidence: {
    deterministic_body: "Seus gastos estão R$ 1.240,50 acima do ritmo típico neste mês.",
    impact_amount: 1240.5,
    percent: 32,
    confidence: 0.82,
    categories: ["Mobilidade", "Lazer"],
    comparison: { previous_total: 3800 },
    period: { from: "2026-09-01", to: "2026-09-09", label: "setembro" },
  },
};

function pack(overrides: Partial<typeof paceCandidate> = {}) {
  return buildNarrativeEvidencePack({ ...paceCandidate, ...overrides } as any);
}

describe("pacote de evidência narrativa", () => {
  it("versiona o contrato e preserva o corpo determinístico", () => {
    const p = pack();
    expect(p.version).toBe(NARRATIVE_EVIDENCE_PACK_VERSION);
    expect(p.deterministic_body).toContain("R$ 1.240,50");
  });

  it("declara o fato principal a partir do impacto canônico", () => {
    expect(pack().primary_fact).toMatchObject({ kind: "money", value: 1240.5 });
  });

  it("autoriza apenas números presentes na evidência e no texto do motor", () => {
    const p = pack();
    expect(p.allowed_numbers).toContain(1240.5);
    expect(p.allowed_numbers).toContain(32);
    expect(p.allowed_numbers).not.toContain(9999);
  });

  it("lê período canônico e libera as datas do recorte", () => {
    const p = pack();
    expect(p.period?.label).toBe("setembro");
    expect(p.allowed_dates).toContain("2026-09-01");
  });

  it("expõe categorias citáveis sem inventar estabelecimento", () => {
    const p = pack();
    expect(p.entities.categories).toEqual(["Mobilidade", "Lazer"]);
    expect(p.entities.merchants).toEqual([]);
  });

  it("permite comparação quando a evidência traz base de comparação", () => {
    expect(pack().allowed_claims).toContain("comparison");
  });

  it("não permite projeção quando a evidência não projeta", () => {
    expect(pack().allowed_claims).not.toContain("forecast");
  });

  it("sempre proíbe número fora da evidência e menção a modelo de IA", () => {
    const proibido = pack().prohibited_claims.join(" | ");
    expect(proibido).toMatch(/número que não esteja na evidência/);
    expect(proibido).toMatch(/modelo, provedor de IA/);
  });

  it("extrai valores e percentuais escritos pelo motor", () => {
    expect(numbersInText("Subiu R$ 806,40 (12%)")).toEqual([806.4, 12]);
  });
});

describe("política de tom", () => {
  it("mantém tipos operacionais fora da narrativa", () => {
    for (const kind of ["debt_due_soon", "split_payment_pending", "categorize_transaction"]) {
      expect(OPERATIONAL_KINDS.has(kind)).toBe(true);
      expect(narrativeEligibility(kind)).toEqual({ eligible: false, reason: "operational_kind" });
    }
  });

  it("habilita leitura interpretativa com tom por tipo", () => {
    expect(narrativeEligibility("spending_pace_change")).toMatchObject({ eligible: true });
    expect(narrativeEligibility("goal_at_risk")).toMatchObject({ eligible: true, rules: { tone: "goal" } });
    expect(narrativeEligibility("financial_discipline")).toMatchObject({ rules: { tone: "achievement" } });
  });

  it("tipo desconhecido não vira narrativa por acidente", () => {
    expect(narrativeEligibility("tipo_que_nao_existe")).toEqual({ eligible: false, reason: "unknown_kind" });
  });

  it("cada tom tem limite de frases e de números", () => {
    for (const tone of ["risk", "attention", "achievement", "behavior", "goal", "opportunity", "report"] as const) {
      const rules = toneRulesFor(tone);
      expect(rules.maxSentences).toBeGreaterThan(1);
      expect(rules.maxNumbers).toBeLessThanOrEqual(3);
      expect(rules.question.endsWith("?")).toBe(true);
    }
  });
});

describe("guarda de verdade", () => {
  const rules = toneRulesFor("attention");
  const p = pack();
  const guard = (text: string, extra?: string[]) =>
    guardNarrative({ text, pack: p, rules, forbiddenTerms: extra });

  it("aprova leitura humana que só usa número canônico", () => {
    const result = guard("Seu mês mudou de ritmo: você está R$ 1.240,50 acima do seu padrão. Isso foi planejado?");
    expect(result.ok).toBe(true);
  });

  it("bloqueia número que não existe na evidência", () => {
    const result = guard("Você gastou R$ 4.900,00 acima do normal.");
    expect(result.violations).toContain("number_not_in_evidence");
  });

  it("aceita valor compacto do mesmo fato", () => {
    expect(matchesEvidence(1200, [1240.5])).toBe(true);
    expect(matchesEvidence(1900, [1240.5])).toBe(false);
  });

  it("bloqueia data fora do recorte", () => {
    expect(guard("Isso começou em 03/01.").violations).toContain("date_not_in_evidence");
  });

  it("bloqueia projeção quando a evidência não projeta", () => {
    expect(guard("Do jeito que vai, seu mês vai fechar apertado.").violations).toContain("forecast_not_allowed");
  });

  it("bloqueia julgamento moral", () => {
    expect(guard("Você gastou demais e devia ter segurado.").violations).toContain("moral_judgement");
  });

  it("bloqueia menção a provedor de IA", () => {
    expect(guard("Analisei com o Gemini seus gastos.").violations).toContain("provider_mentioned");
  });

  it("bloqueia vocabulário proibido do produto", () => {
    expect(guard("Seu mês fechou negativo.").violations).toContain("banned_word");
  });

  it("bloqueia mais de uma pergunta", () => {
    const result = guard("Você está acima do padrão. Foi planejado? Quer ajustar?");
    expect(result.violations).toContain("multiple_questions");
  });

  it("bloqueia texto longo demais para o tom", () => {
    const result = guard("Uma. Duas. Três. Quatro. Cinco frases aqui.");
    expect(result.violations).toContain("too_many_sentences");
  });

  it("bloqueia excesso de números", () => {
    const result = guard("Foram R$ 1.240,50, 32% e R$ 1.240,50 e 32% no período.");
    expect(result.violations).toContain("too_many_numbers");
  });

  it("bloqueia termo proibido vindo do catálogo", () => {
    expect(guard("Isso é um descontrole seu.", ["descontrole"]).violations).toContain("forbidden_term");
  });

  it("bloqueia texto vazio", () => {
    expect(guard("   ").violations).toContain("empty_text");
  });

  it("lê valores compactos citados no texto", () => {
    expect(citedNumbers("cerca de R$ 1,2 mil")[0].value).toBeCloseTo(1200);
  });

  it("permite causa quando a evidência declara os responsáveis", () => {
    const withCause = buildNarrativeEvidencePack({
      ...paceCandidate,
      evidence: { ...paceCandidate.evidence, cause_summary: "Mobilidade puxou a alta." },
    } as any);
    const result = guardNarrative({
      text: "Seu ritmo subiu porque Mobilidade puxou a alta. Quer ver o detalhe?",
      pack: withCause,
      rules,
    });
    expect(result.ok).toBe(true);
  });
});

describe("variação sem mudança de fato", () => {
  it("é estável para o mesmo usuário e assunto", () => {
    const a = chooseVariation({ userId: "u1", subjectKey: "mobilidade", tone: "attention" });
    const b = chooseVariation({ userId: "u1", subjectKey: "mobilidade", tone: "attention" });
    expect(a).toEqual(b);
  });

  it("muda a abertura quando o assunto já foi comunicado", () => {
    const first = chooseVariation({ userId: "u1", subjectKey: "mobilidade", tone: "attention", recentSameSubject: 0 });
    const second = chooseVariation({ userId: "u1", subjectKey: "mobilidade", tone: "attention", recentSameSubject: 1 });
    expect(second.opening).not.toBe(first.opening);
  });
});

describe("agrupamento multissinal", () => {
  const signals = [
    { kind: "spending_pace_change", dedup_key: "pace:1", severity: "attention", evidence: { impact_amount: 1200 } },
    { kind: "growing_category", dedup_key: "grow:1", severity: "attention", evidence: { impact_amount: 400 } },
    { kind: "goal_at_risk", dedup_key: "goal:1", severity: "critical", evidence: { goal_id: "g1" } },
  ] as any[];

  it("reúne sinais do mesmo domínio numa leitura só", () => {
    const groups = groupSignals(signals);
    const spending = groups.find((g) => g.group_key === "domain:spending");
    expect(spending?.primary.kind).toBe("spending_pace_change");
    expect(spending?.supporting).toHaveLength(1);
  });

  it("mantém assunto próprio separado", () => {
    expect(groupSignals(signals).some((g) => g.group_key === "subject:g1")).toBe(true);
    expect(subjectKeyOf(signals[2])).toBe("g1");
    expect(domainOf("card_bill_pressure")).toBe("cards");
  });
});

describe("memória contextual com validade", () => {
  it("reconhece contexto declarado pelo usuário", () => {
    expect(contextFromReply("estou viajando esse mês")).toMatchObject({ validDays: 21 });
    expect(contextFromReply("isso é do trabalho, vou pedir reembolso")).not.toBeNull();
    expect(contextFromReply("beleza")).toBeNull();
  });

  it("deixa de valer depois de expirar", () => {
    expect(isActiveContext({ expires_at: "2020-01-01T00:00:00Z" })).toBe(false);
    expect(isActiveContext({ expires_at: null })).toBe(true);
  });
});

describe("composição e canais", () => {
  it("o prompt entrega evidência e proibições, nunca acesso a dados", () => {
    const prompt = buildNarrativePrompt({
      pack: pack(),
      rules: toneRulesFor("attention"),
      variation: chooseVariation({ userId: "u1", subjectKey: "s", tone: "attention" }),
      channel: "app",
    });
    expect(prompt.system).toMatch(/Não calcule/);
    expect(prompt.user).toMatch(/NÚMEROS PERMITIDOS/);
    expect(prompt.user).toMatch(/1240.5/);
    expect(prompt.user).not.toMatch(/select |from transactions/i);
  });

  it("fallback determinístico devolve o texto do motor com motivo", () => {
    const result = deterministicResult(pack(), "ai_not_configured");
    expect(result.mode).toBe("deterministic");
    expect(result.body).toContain("R$ 1.240,50");
    expect(result.fallback_reason).toBe("ai_not_configured");
  });

  it("WhatsApp fica escaneável com título e pergunta destacados", () => {
    const text = formatNarrativeForWhatsapp("Ritmo acima do normal", "Você está R$ 1.240,50 acima do padrão.\nIsso foi planejado?");
    expect(text.startsWith("*Ritmo acima do normal*")).toBe(true);
    expect(text).toContain("*Isso foi planejado?*");
  });
});

describe("guarda contra texto cortado", () => {
  it("rejeita narrativa interrompida no meio da frase", () => {
    const result = guardNarrative({
      text: "Seu caixa pode ficar negativo e os compromissos já conhecidos, o",
      pack: pack(),
      rules: toneRulesFor("attention"),
    });
    expect(result.violations).toContain("truncated_text");
  });

  it("aceita fecho com emoji depois da pontuação", () => {
    const result = guardNarrative({
      text: "Você está R$ 1.240,50 acima do padrão. Isso foi planejado? 👀",
      pack: pack(),
      rules: toneRulesFor("attention"),
    });
    expect(result.ok).toBe(true);
  });
});
