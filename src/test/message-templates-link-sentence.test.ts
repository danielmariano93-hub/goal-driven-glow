import { describe, it, expect } from "vitest";
import {
  buildLinkSentence,
  renderMessageTemplate,
  DEFAULT_MESSAGE_TEMPLATES,
} from "../../supabase/functions/_shared/agent/messageTemplates";

describe("buildLinkSentence", () => {
  it("usa link do app quando cadastrado", () => {
    expect(buildLinkSentence({
      isRegistered: true,
      appLink: "https://app.x/app/role/1",
      signupLink: "https://app.x/signup",
    })).toBe(" Abra no app: https://app.x/app/role/1");
  });
  it("usa signup quando não cadastrado", () => {
    expect(buildLinkSentence({
      isRegistered: false,
      appLink: null,
      signupLink: "https://app.x/signup?ref=wa",
    })).toBe(" Cadastre-se em segundos: https://app.x/signup?ref=wa");
  });
  it("retorna vazio quando nenhum link válido", () => {
    expect(buildLinkSentence({ isRegistered: true, appLink: null, signupLink: null })).toBe("");
  });
});

describe("renderMessageTemplate com link_sentence", () => {
  it("injeta a sentença de link no convite de rolê", () => {
    const out = renderMessageTemplate("invite", null, {
      participant_name: "Ana",
      owner_name: "João",
      title: "Bar",
      amount: "R$ 50,00",
      due_sentence: "",
      pix_sentence: "",
      link_sentence: " Abra no app: https://app.x/app/role/1",
    });
    expect(out).toContain("Abra no app: https://app.x/app/role/1");
  });

  it("tem template default para convite de meta conjunta", () => {
    expect(DEFAULT_MESSAGE_TEMPLATES.goal_invite).toBeTruthy();
    const out = renderMessageTemplate("goal_invite", null, {
      participant_name: "Ana", owner_name: "João",
      title: "Viagem", amount: "R$ 5.000,00",
      link_sentence: " Abra no app: https://app.x/g/1",
    });
    expect(out).toContain("meta conjunta");
    expect(out).toContain("Viagem");
    expect(out).toContain("Abra no app");
  });

  it("goal_invite_followup existe e usa placeholders", () => {
    const out = renderMessageTemplate("goal_invite_followup", null, {
      participant_name: "Ana", owner_name: "João",
      title: "Viagem",
      link_sentence: " Cadastre-se em segundos: https://app.x/signup",
    });
    expect(out).toContain("lembrar do convite");
    expect(out).toContain("Cadastre-se");
  });
});
