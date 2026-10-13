import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  daysPhrase, greetingForHour, LATE_AFTER_DAYS, OVERDUE_VARIANT_TEXTS, overdueVariantFor, renderOverdueMessage,
} from "../../supabase/functions/_shared/agent/messageTemplates";

const values = {
  participant_name: "Lucas", owner_name: "Daniel Assis", title: "Ingresso Anitta - Parcela 1", amount: "R$ 291,33",
  installment_label: "parte do rolê", due_date: "01/10/2026", partial_sentence: "", remaining_sentence: "",
  pix_sentence: "\n\nPix: 11977992569", link_sentence: "",
};
const msg = (days: number, seq: number, hour = 9) => renderOverdueMessage(null, values, { daysOverdue: days, seqToday: seq, sendHour: hour });

describe("cobrança em atraso — textos (split_overdue_copy.v1)", () => {
  it("toda mensagem depois do vencimento diz há quantos dias está em atraso", () => {
    for (const d of [1, 2, 3, 5, 12, 40]) {
      for (const seq of [1, 2]) {
        const { text } = msg(d, seq);
        expect(text, `d=${d} seq=${seq}`).toContain(daysPhrase(d));
        expect(text).not.toMatch(/\{\{|undefined/);
      }
    }
    expect(daysPhrase(1)).toBe("1 dia");
    expect(daysPhrase(12)).toBe("12 dias");
  });

  it("até 2 dias de atraso: 1 mensagem por dia; acima disso a 2ª do dia usa outro conjunto de textos", () => {
    expect(LATE_AFTER_DAYS).toBe(2);
    for (let d = 3; d <= 60; d++) {
      expect(msg(d, 1).text, `d=${d}`).not.toBe(msg(d, 2).text);
      expect(msg(d, 1).variant.startsWith("first_")).toBe(true);
      expect(msg(d, 2).variant.startsWith("second_")).toBe(true);
    }
    expect(msg(1, 1).variant.startsWith("recent_")).toBe(true);
    expect(msg(2, 1).variant.startsWith("recent_")).toBe(true);
  });

  it("a 2ª do dia nunca é igual à 1ª, nem em estrutura (assunto e abertura diferentes)", () => {
    for (let d = 3; d <= 60; d++) {
      const first = msg(d, 1).text.split("\n")[0];
      const second = msg(d, 2).text.split("\n")[0];
      expect(second, `d=${d}`).not.toBe(first);
    }
  });

  it("dias seguidos não saem iguais (o texto gira)", () => {
    for (let d = 1; d <= 60; d++) {
      expect(msg(d, 1).text, `d=${d} seq1`).not.toBe(msg(d + 1, 1).text.replace(daysPhrase(d + 1), daysPhrase(d)));
      expect(msg(d, 1).variant, `d=${d}`).not.toBe(msg(d + 1, 1).variant);
    }
  });

  it("tom: cordial e amigável — sem pressão, culpa, ameaça ou rótulos; sempre com uma saída fácil", () => {
    for (const v of OVERDUE_VARIANT_TEXTS) {
      expect(v.text, v.id).not.toMatch(/inadimpl|amea[çc]|protesto|serasa|\bspc\b|process|juros|multa|vergonha|calote|devendo|obrigad[oa] a pagar|urgente|imediat/i);
      expect(v.text, v.id).toMatch(/me (responder|avisa|conta|manda)|é só chamar|fala com|combin/i);
      expect(v.text, v.id).toMatch(/[😉🙌💛🙂😅🤝🙏👋]/u);
      expect(v.text, v.id).toContain("{{days_phrase}}");
    }
  });

  it("mantém as informações que a pessoa precisa: valor, vencimento, parcela, quem criou e o Pix", () => {
    const { text } = msg(12, 1);
    expect(text).toContain("R$ 291,33");
    expect(text).toContain("01/10/2026");
    expect(text).toContain("Daniel Assis");
    expect(text).toContain("Pix: 11977992569");
  });

  it("saudação conforme a hora de envio", () => {
    expect(greetingForHour(9)).toBe("Bom dia");
    expect(greetingForHour(14)).toBe("Boa tarde");
    expect(greetingForHour(20)).toBe("Boa noite");
    expect(msg(12, 1, 9).text).toContain("Bom dia");
    expect(msg(12, 1, 15).text).toContain("Boa tarde");
  });

  it("cabe no WhatsApp mesmo com pagamento parcial, saldo total e link", () => {
    const long = renderOverdueMessage(null, {
      ...values,
      partial_sentence: "\n\n💰 *Pagamento parcial:* já foram pagos *R$ 100,00*. Restam *R$ 191,33*.",
      remaining_sentence: "\n\nTotal ainda a receber de você: *R$ 400,00*.",
      link_sentence: " Abra no app: www.meunino.com.br/r/abc123",
    }, { daysOverdue: 30, seqToday: 2, sendHour: 19 });
    expect(long.text.length).toBeLessThan(900);
  });

  it("um texto próprio definido pelo administrador tem precedência (e recebe os dias em atraso)", () => {
    const persona = { contexts: { split_overdue: { template: "{{participant_name}}, faz {{days_phrase}} que venceu." } } };
    const r = renderOverdueMessage(persona, values, { daysOverdue: 5, seqToday: 1, sendHour: 9 });
    expect(r.variant).toBe("custom");
    expect(r.text).toBe("Lucas, faz 5 dias que venceu.");
  });

  it("overdueVariantFor é determinístico", () => {
    expect(overdueVariantFor(7, 1).id).toBe(overdueVariantFor(7, 1).id);
  });
});

describe("cobrança em atraso — agendamento e worker (contratos)", () => {
  const sql = readFileSync("supabase/migrations/20261013100000_split_late_two_messages_per_day.sql", "utf8");
  const worker = readFileSync("supabase/functions/split-reminders-dispatch-v2/index.ts", "utf8");

  it("política: limiar de atraso, máximo por dia, horário da 2ª e intervalo mínimo", () => {
    for (const col of ["late_after_days", "late_messages_per_day", "late_second_send_hour", "late_min_gap_hours"]) expect(sql).toContain(col);
    expect(sql).toMatch(/late_messages_per_day integer NOT NULL DEFAULT 2 CHECK \(late_messages_per_day BETWEEN 1 AND 2\)/);
    expect(sql).toMatch(/late_second_send_hour integer NOT NULL DEFAULT 19/);
  });

  it("2ª do dia só depois da 1ª enviada, com intervalo mínimo, até as 22h; senão, amanhã", () => {
    expect(sql).toContain("v_sent_today > 0 AND v_sent_today < v_eff_max");
    expect(sql).toContain("late_min_gap_hours");
    expect(sql).toContain("split_due_timestamp(v_today, 22)");
    expect(sql).toContain("split_due_timestamp(v_today + v_repeat, cfg.send_hour)");
  });

  it("nunca passa do máximo diário (depende dos dias de atraso naquela data)", () => {
    expect(sql).toContain("(v_eff_date - r.due_date) > coalesce(cfg.late_after_days, 2)");
    expect(sql).toContain("v_sent_eff >= v_eff_max");
  });

  it("segue elegibilidade (pagamento, pausa, opt-out, cancelamento) e continua restrita ao service_role", () => {
    expect(sql).toContain("split_installment_is_eligible(rv.installment_id)");
    expect(sql).toMatch(/REVOKE EXECUTE ON FUNCTION public\.schedule_split_due_reminders\(uuid\) FROM PUBLIC, anon/);
  });

  it("worker: dias de atraso em data civil de São Paulo, 1ª/2ª do dia e metadados de medição", () => {
    expect(worker).toContain("civilDaysBetween");
    expect(worker).toContain('timeZone: SP_TZ');
    expect(worker).toContain("seqToday: Math.min(2, sentToday + 1)");
    expect(worker).toContain("renderOverdueMessage");
    expect(worker).toMatch(/message_variant: composed\.variant/);
    expect(worker).toMatch(/days_overdue: overdueInfo\.daysOverdue/);
  });
});
