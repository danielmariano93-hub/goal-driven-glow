import { describe, it, expect } from "vitest";
import {
  buildSharedExpenseUrl,
  buildSharedGoalUrl,
  buildSignupUrl,
} from "../../supabase/functions/_shared/messaging/appUrl";

const ENV = { APP_PUBLIC_URL: "https://app.meunino.com.br" };

describe("buildSharedExpenseUrl", () => {
  it("monta URL com id e query ref", () => {
    expect(buildSharedExpenseUrl(ENV, "abc-123", { ref: "wa_split" }))
      .toBe("https://app.meunino.com.br/app/role/abc-123?ref=wa_split");
  });
  it("retorna null quando base é inválida", () => {
    expect(buildSharedExpenseUrl({ APP_PUBLIC_URL: "http://x" }, "id")).toBeNull();
  });
  it("retorna null quando id é vazio", () => {
    expect(buildSharedExpenseUrl(ENV, "")).toBeNull();
  });
});

describe("buildSharedGoalUrl", () => {
  it("monta URL do detalhe da meta conjunta", () => {
    expect(buildSharedGoalUrl(ENV, "g-1"))
      .toBe("https://app.meunino.com.br/app/metas/conjunta/g-1");
  });
  it("inclui token quando informado", () => {
    expect(buildSharedGoalUrl(ENV, "g-1", { token: "tok" }))
      .toBe("https://app.meunino.com.br/app/metas/conjunta/g-1?t=tok");
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
});
