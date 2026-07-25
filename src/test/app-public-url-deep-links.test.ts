import { describe, it, expect } from "vitest";
import {
  buildSharedExpenseUrl,
  buildSharedGoalUrl,
  buildSignupUrl,
} from "../../supabase/functions/_shared/messaging/appUrl";

const ENV = { APP_PUBLIC_URL: "https://app.meunino.com.br" };

describe("buildSharedExpenseUrl", () => {
  it("monta URL com rota canônica /app/divisao-do-role/:id e query ref", () => {
    expect(buildSharedExpenseUrl(ENV, "abc-123", { ref: "wa_split" }))
      .toBe("https://app.meunino.com.br/app/divisao-do-role/abc-123?ref=wa_split");
  });
  it("retorna null quando base é inválida", () => {
    expect(buildSharedExpenseUrl({ APP_PUBLIC_URL: "http://x" }, "id")).toBeNull();
  });
  it("retorna null quando id é vazio", () => {
    expect(buildSharedExpenseUrl(ENV, "")).toBeNull();
  });
});

describe("buildSharedGoalUrl", () => {
  it("monta URL do detalhe da meta conjunta com rota canônica", () => {
    expect(buildSharedGoalUrl(ENV, "g-1"))
      .toBe("https://app.meunino.com.br/app/metas-conjuntas/g-1");
  });
  it("inclui token quando informado", () => {
    expect(buildSharedGoalUrl(ENV, "g-1", { token: "tok" }))
      .toBe("https://app.meunino.com.br/app/metas-conjuntas/g-1?t=tok");
  });
});

describe("buildSignupUrl", () => {
  it("monta URL de signup com ref e phone", () => {
    expect(buildSignupUrl(ENV, { ref: "wa_split", phone: "+5511999" }))
      .toBe("https://app.meunino.com.br/signup?ref=wa_split&phone=%2B5511999");
  });
  it("retorna base pura sem params", () => {
    expect(buildSignupUrl(ENV)).toBe("https://app.meunino.com.br/signup");
  });
  it("aceita next com rota relativa e codifica corretamente", () => {
    expect(buildSignupUrl(ENV, { next: "/app/metas-conjuntas/g-1", ref: "wa_goal" }))
      .toBe("https://app.meunino.com.br/signup?next=%2Fapp%2Fmetas-conjuntas%2Fg-1&ref=wa_goal");
  });
  it("suporta next para rolê", () => {
    expect(buildSignupUrl(ENV, { next: "/app/divisao-do-role/abc", ref: "wa_split", phone: "+55" }))
      .toBe("https://app.meunino.com.br/signup?next=%2Fapp%2Fdivisao-do-role%2Fabc&ref=wa_split&phone=%2B55");
  });
  it("descarta next absoluto (open redirect guard)", () => {
    expect(buildSignupUrl(ENV, { next: "https://evil.com/x", ref: "r" }))
      .toBe("https://app.meunino.com.br/signup?ref=r");
    expect(buildSignupUrl(ENV, { next: "//evil.com/x" }))
      .toBe("https://app.meunino.com.br/signup");
  });
});
