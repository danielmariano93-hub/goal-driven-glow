// Mensagem automática precisa dizer DO QUE fala, em linguagem simples (caso real: notificação "Claro" R$ 202,59).
import { describe, expect, it } from "vitest";
import { detectRecurringPattern } from "../../supabase/functions/_shared/agent/core/ProactiveDetectors";
import { buildNarrativeEvidencePack } from "../../supabase/functions/_shared/agent/narrative/NarrativeEvidencePack";
import { buildNarrativePrompt } from "../../supabase/functions/_shared/agent/narrative/NarrativeComposer";
import { guardNarrative } from "../../supabase/functions/_shared/agent/narrative/NarrativeGuard";
import { renderCommunicationTemplate } from "../../supabase/functions/_shared/agent/core/CommunicationDispatcherV3";
import { toneRulesFor, narrativeEligibility } from "../../supabase/functions/_shared/agent/narrative/TonePolicy";
import { chooseVariation } from "../../supabase/functions/_shared/agent/narrative/NarrativeVariation";

const rows = ["2026-07-10", "2026-08-10", "2026-09-10"].map((d, i) => ({
  id: String(i), amount: [202.59, 199.9, 205.2][i], description: "Claro", occurred_at: `${d}T12:00:00Z`, type: "expense", movement_kind: "transaction",
}));
const nb = (t: string) => t.replace(/ /g, " ");

describe("detector de conta que se repete (caso Claro)", () => {
  const [insight] = detectRecurringPattern(rows);

  it("nomeia o item no título e no corpo, em linguagem simples", () => {
    expect(insight.title).toContain("Claro");
    expect(insight.body).toContain("Claro");
    expect(nb(insight.body)).toMatch(/R\$ 20\d,\d{2}/);
    expect(insight.body).not.toMatch(/ocorr[eê]ncias|periodicamente|comportamento/i);
    expect(insight.body.trim().endsWith("?")).toBe(true);
  });

  it("declara o assunto na evidência (o redator e a guarda dependem disso)", () => {
    expect(insight.evidence.subject).toBe("Claro");
  });
});

describe("pacote, prompt e guarda: o assunto é obrigatório", () => {
  const [insight] = detectRecurringPattern(rows);
  const pack = buildNarrativeEvidencePack({ kind: "recurring_pattern", severity: "info", title: insight.title, body: insight.body, evidence: insight.evidence });
  const rules = toneRulesFor("behavior");

  it("o prompt entrega o ASSUNTO e exige citá-lo na primeira frase, sem jargão", () => {
    const { system, user } = buildNarrativePrompt({ pack, rules, variation: chooseVariation({ userId: "u", subjectKey: "claro", tone: rules.tone }), channel: "app" });
    expect(user).toContain("ASSUNTO (cite pelo nome na primeira frase): Claro");
    expect(system).toContain("A PRIMEIRA frase diz DO QUE se trata");
    expect(system).toMatch(/ocorrências/);
  });

  it("rejeita exatamente o texto da notificação que a pessoa recebeu", () => {
    const real = "Tem um comportamento se repetindo: as despesas ocorrem periodicamente. O valor típico é R$ 202,59 e foram registradas 3 ocorrências. Faz sentido pra você esse padrão?";
    const g = guardNarrative({ text: real, pack, rules });
    expect(g.ok).toBe(false);
    expect(g.violations).toContain("missing_subject");
    expect(g.violations).toContain("internal_jargon");
  });

  it("aceita a versão que diz o quê, quanto e o próximo passo", () => {
    const good = "“Claro” apareceu 3 vezes, sempre perto de R$ 202,59. Quer que o Nino registre isso sozinho todo mês?";
    expect(guardNarrative({ text: good, pack, rules }).violations).not.toContain("missing_subject");
  });
});

describe("título do template não apaga o assunto", () => {
  const candidate = { kind: "recurring_pattern", severity: "info", title: "“Claro” parece se repetir todo mês", body: "corpo", dedup_key: "k", evidence: { subject: "Claro" } } as any;
  it("template com título fixo cede ao título do motor quando ele nomeia o assunto", () => {
    const out = renderCommunicationTemplate({ title_template: "Isso parece acontecer todo mês", body_template: "{{body}}" }, candidate, null);
    expect(out.title).toContain("Claro");
  });
  it("sem assunto declarado, o título do template continua valendo", () => {
    const out = renderCommunicationTemplate({ title_template: "Título fixo", body_template: "{{body}}" }, { ...candidate, evidence: {} }, null);
    expect(out.title).toBe("Título fixo");
  });
});

import { readFileSync } from "node:fs";
describe("mensagens do diagnóstico em SQL: dinheiro em pt-BR e dívida com nome", () => {
  const sql = readFileSync("supabase/migrations/20261015190000_diag_messages_money_and_debt_name.sql", "utf8");
  it("troca o to_char em locale inglês pelo formatador pt-BR", () => {
    expect(sql).toContain("public.nino_diag_brl(r.amount)");
    expect(sql).toContain("FM999G999G999D00");
  });
  it("nomeia a dívida e acerta o plural de dias", () => {
    expect(sql).toContain("r.name");
    expect(sql).toContain("case when v_days = 1 then");
  });
});
