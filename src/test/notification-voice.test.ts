// Régua de voz das mensagens que o Nino inicia. Referência: notificação de um app de hábitos que a pessoa admira.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { checkNotificationVoice } from "../../supabase/functions/_shared/copy/notificationVoice";
import { detectEngagementDrop, detectRecurringPattern } from "../../supabase/functions/_shared/agent/core/ProactiveDetectors";

describe("a referência passa na régua", () => {
  it("'Eu fico de olho 👀 — Mas o hábito é seu. Já deixei tudo preparado. Vamos revisar juntos?'", () => {
    const r = checkNotificationVoice({ title: "Eu fico de olho 👀", body: "Mas o hábito é seu.\nJá deixei tudo preparado. Vamos revisar juntos?" });
    expect(r.issues).toEqual([]);
  });
});

describe("textos reais do Nino que a régua reprova (antes)", () => {
  it("conta que se repete: jargão, 3 'ocorrências', sem assunto", () => {
    const r = checkNotificationVoice({
      subject: "Claro",
      body: "Tem um comportamento se repetindo: as despesas ocorrem periodicamente. O valor típico é R$ 202,59 e foram registradas 3 ocorrências. Faz sentido pra você esse padrão?",
    });
    expect(r.ok).toBe(false);
    expect(r.issues).toEqual(expect.arrayContaining(["jargon", "missing_subject"]));
  });

  it("queda de engajamento: frase longa e números demais", () => {
    const r = checkNotificationVoice({
      body: "Percebi uma tendência sua: há 25 dias sem atualizar ou consultar seus dados, e nos últimos 30 dias você registrou apenas 6 atividades. Faz sentido pra você esse padrão?",
    });
    expect(r.ok).toBe(false);
    expect(r.issues).toEqual(expect.arrayContaining(["long_sentence", "too_many_numbers", "jargon"]));
  });

  it("número cru e várias perguntas são barrados", () => {
    expect(checkNotificationVoice({ body: "A parcela é de R$ 1316.16. Quer ver? Ou prefere pagar?" }).issues).toEqual(expect.arrayContaining(["raw_decimal", "multiple_questions"]));
  });
});

describe("textos do Nino que seguem a régua (depois)", () => {
  it("conta que se repete diz o quê, quanto e convida", () => {
    const rows = ["2026-07-10", "2026-08-10", "2026-09-10"].map((d, i) => ({
      id: String(i), amount: [202.59, 199.9, 205.2][i], description: "Claro", occurred_at: `${d}T12:00:00Z`, type: "expense", movement_kind: "transaction",
    }));
    const [insight] = detectRecurringPattern(rows);
    const r = checkNotificationVoice({ title: insight.title, body: insight.body, subject: "Claro" });
    expect(r.issues).toEqual([]);
  });

  it("queda de engajamento: curto, dono da decisão é a pessoa, convite único", () => {
    const [insight] = detectEngagementDrop({ last_30_days: 6, previous_30_days: 40, days_since_last_activity: 25, last_activity_at: "2026-09-20T12:00:00Z" });
    expect(insight.title).not.toMatch(/perdeu ritmo/i);
    const r = checkNotificationVoice({ body: insight.body });
    expect(r.issues).toEqual([]);
    expect(insight.body).toMatch(/controle é seu/i);
  });

  it("check-in emocional no app é um convite curto", () => {
    const sql = readFileSync("supabase/migrations/20261015200000_checkin_template_voice.sql", "utf8");
    const body = /body_template = '([^']+)'/.exec(sql)![1];
    expect(checkNotificationVoice({ body }).issues).toEqual([]);
  });
});

describe("honestidade da voz: 'já deixei pronto' só com algo realmente pronto", () => {
  const composer = readFileSync("supabase/functions/_shared/agent/narrative/NarrativeComposer.ts", "utf8");
  it("o prompt proíbe prometer preparo sem PREPARADO na evidência", () => {
    expect(composer).toContain("NUNCA diga que já deixou algo pronto");
    expect(composer).toContain("PREPARADO (aqui pode dizer que já deixou pronto)");
  });
});
