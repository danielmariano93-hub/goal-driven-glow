import { describe, it, expect } from "vitest";
import { resolveAppPublicUrl, buildAssessorLink } from "../../supabase/functions/_shared/messaging/appUrl";

describe("resolveAppPublicUrl", () => {
  it("aceita HTTPS válido e normaliza a barra final", () => {
    expect(resolveAppPublicUrl({ APP_PUBLIC_URL: "https://app.exemplo.com/" }))
      .toBe("https://app.exemplo.com");
    expect(resolveAppPublicUrl({ APP_PUBLIC_URL: "https://app.exemplo.com" }))
      .toBe("https://app.exemplo.com");
    expect(resolveAppPublicUrl({ APP_PUBLIC_URL: "https://app.exemplo.com/base///" }))
      .toBe("https://app.exemplo.com/base");
  });

  it("retorna null quando ausente ou vazio", () => {
    expect(resolveAppPublicUrl({})).toBeNull();
    expect(resolveAppPublicUrl({ APP_PUBLIC_URL: "" })).toBeNull();
    expect(resolveAppPublicUrl({ APP_PUBLIC_URL: "   " })).toBeNull();
    expect(resolveAppPublicUrl({ APP_PUBLIC_URL: null })).toBeNull();
  });

  it("rejeita HTTP, localhost, IPs literais e credenciais embutidas", () => {
    expect(resolveAppPublicUrl({ APP_PUBLIC_URL: "http://app.exemplo.com" })).toBeNull();
    expect(resolveAppPublicUrl({ APP_PUBLIC_URL: "https://localhost" })).toBeNull();
    expect(resolveAppPublicUrl({ APP_PUBLIC_URL: "https://127.0.0.1" })).toBeNull();
    expect(resolveAppPublicUrl({ APP_PUBLIC_URL: "https://user:pass@app.exemplo.com" })).toBeNull();
    expect(resolveAppPublicUrl({ APP_PUBLIC_URL: "não é url" })).toBeNull();
  });
});

describe("buildAssessorLink", () => {
  it("monta deep-link com source quando URL é válida", () => {
    expect(buildAssessorLink({ APP_PUBLIC_URL: "https://app.exemplo.com" }, "whatsapp_media"))
      .toBe("https://app.exemplo.com/app/assessor?source=whatsapp_media");
  });

  it("omite query quando source não é informado", () => {
    expect(buildAssessorLink({ APP_PUBLIC_URL: "https://app.exemplo.com" }))
      .toBe("https://app.exemplo.com/app/assessor");
  });

  it("retorna null quando URL base é inválida", () => {
    expect(buildAssessorLink({ APP_PUBLIC_URL: "http://inseguro" }, "whatsapp_media")).toBeNull();
    expect(buildAssessorLink({}, "whatsapp_media")).toBeNull();
  });
});
