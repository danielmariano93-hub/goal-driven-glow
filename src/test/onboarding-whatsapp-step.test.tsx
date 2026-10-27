import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";

let linkRows: unknown[] = [];
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: vi.fn(() => Promise.resolve({ data: linkRows })) },
}));
vi.mock("@/components/whatsapp/WhatsAppLinkSheet", () => ({
  WhatsAppLinkSheet: ({ open }: { open: boolean }) => (open ? <div data-testid="sheet">sheet</div> : null),
}));

import { OnboardingWhatsAppStep } from "@/components/onboarding/OnboardingWhatsAppStep";

describe("passo de WhatsApp no onboarding", () => {
  beforeEach(() => { linkRows = []; });
  afterEach(cleanup);

  it("mostra os benefícios, abre o vínculo e permite fazer depois", async () => {
    const onContinue = vi.fn();
    render(<OnboardingWhatsAppStep onBack={() => undefined} onContinue={onContinue} />);
    expect(screen.getByText(/texto ou áudio/i)).toBeTruthy();
    expect(screen.getByText(/divisões de rolê/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Conectar WhatsApp/i }));
    expect(screen.getByTestId("sheet")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Fazer depois/i }));
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it("quando o vínculo se completa, mostra conectado e troca o botão para Continuar", async () => {
    linkRows = [{ status: "active", phone_masked: "+55 ** *****-5698" }];
    render(<OnboardingWhatsAppStep onBack={() => undefined} onContinue={() => undefined} />);
    await waitFor(() => expect(screen.getByText(/WhatsApp conectado/i)).toBeTruthy());
    expect(screen.queryByRole("button", { name: /Conectar WhatsApp/i })).toBeNull();
    expect(screen.getByRole("button", { name: /^Continuar/i })).toBeTruthy();
  });

  it("vínculo pendente (código gerado, mensagem não enviada) não conta como conectado", async () => {
    linkRows = [{ status: "pending", phone_masked: "" }];
    render(<OnboardingWhatsAppStep onBack={() => undefined} onContinue={() => undefined} />);
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText(/WhatsApp conectado/i)).toBeNull();
  });
});

describe("Onboarding usa o passo", () => {
  const src = readFileSync("src/pages/Onboarding.tsx", "utf8");
  it("tem 4 passos, WhatsApp como 3º e 'Últimos detalhes' como 4º, que conclui", () => {
    expect(src).toContain("Passo {step} de 4");
    expect(src).toMatch(/step === 3 && <OnboardingWhatsAppStep onBack=\{\(\) => setStep\(2\)\} onContinue=\{\(\) => setStep\(4\)\}/);
    expect(src).toMatch(/step === 4 &&[\s\S]*Últimos detalhes[\s\S]*onClick=\{finish\}/);
    const step4 = src.slice(src.indexOf("step === 4"));
    expect(step4).toMatch(/onClick=\{\(\) => setStep\(3\)\}/);
  });
});
