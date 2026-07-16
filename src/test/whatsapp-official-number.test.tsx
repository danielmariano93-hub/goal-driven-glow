import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, act } from "@testing-library/react";
import { WhatsAppLinkSheet } from "@/components/whatsapp/WhatsAppLinkSheet";

const rpcMock = vi.fn();
const invokeMock = vi.fn();
const fromMock = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...a: unknown[]) => rpcMock(...a),
    functions: { invoke: (...a: unknown[]) => invokeMock(...a) },
    from: (...a: unknown[]) => fromMock(...a),
  },
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

// Ensure env fallback is empty for the tests
(import.meta.env as any).VITE_WHATSAPP_OFFICIAL_NUMBER = "";

function mockPublicConfig(value: string | null) {
  fromMock.mockImplementation(() => ({
    select: () => ({
      eq: () => ({
        maybeSingle: async () => ({ data: value ? { value } : null, error: null }),
      }),
    }),
  }));
}

beforeEach(() => {
  rpcMock.mockReset();
  invokeMock.mockReset();
  fromMock.mockReset();
  rpcMock.mockImplementation(async (fn: string) => {
    if (fn === "list_my_whatsapp_link") return { data: [], error: null };
    if (fn === "create_phone_link_code") return { data: "123456", error: null };
    return { data: null, error: null };
  });
  mockPublicConfig(null);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("WhatsAppLinkSheet — resolução do número oficial", () => {
  it("env ausente + edge disponível: habilita fluxo e monta wa.me correto", async () => {
    invokeMock.mockResolvedValue({
      data: { available: true, official_number: "+5511999998888" },
      error: null,
    });
    const openSpy = vi.spyOn(window, "open").mockReturnValue({} as Window);

    render(<WhatsAppLinkSheet open={true} onClose={() => {}} />);

    const checkbox = await screen.findByRole("checkbox");
    fireEvent.click(checkbox);
    const btn = await screen.findByRole("button", { name: /Gerar código/i });
    await waitFor(() => expect(btn).not.toBeDisabled());
    fireEvent.click(btn);

    await waitFor(() => expect(rpcMock).toHaveBeenCalledWith("create_phone_link_code"));
    await waitFor(() => {
      const url = openSpy.mock.calls[0]?.[0] as string;
      expect(url).toBe("https://wa.me/5511999998888?text=VINCULAR%20123456");
    });
  });

  it("env ausente + edge falha + fallback platform_public_config: funciona", async () => {
    invokeMock.mockResolvedValue({ data: { available: false, official_number: null }, error: null });
    mockPublicConfig("+5511977776666");
    const openSpy = vi.spyOn(window, "open").mockReturnValue({} as Window);

    render(<WhatsAppLinkSheet open={true} onClose={() => {}} />);
    fireEvent.click(await screen.findByRole("checkbox"));
    const btn = await screen.findByRole("button", { name: /Gerar código/i });
    await waitFor(() => expect(btn).not.toBeDisabled());
    fireEvent.click(btn);

    await waitFor(() => {
      const url = openSpy.mock.calls[0]?.[0] as string;
      expect(url).toContain("wa.me/5511977776666");
      expect(url).toContain("VINCULAR%20123456");
    });
  });

  it("env ausente + edge falha + sem fallback: mostra indisponibilidade e não gera código", async () => {
    invokeMock.mockResolvedValue({ data: { available: false, official_number: null }, error: null });
    render(<WhatsAppLinkSheet open={true} onClose={() => {}} />);

    expect(
      await screen.findByText(/Não consegui localizar o número oficial/i),
    ).toBeInTheDocument();
    expect(rpcMock).not.toHaveBeenCalledWith("create_phone_link_code");
  });

  it("popup bloqueado: preserva código e mostra botão de retry", async () => {
    invokeMock.mockResolvedValue({
      data: { available: true, official_number: "+5511999998888" },
      error: null,
    });
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    render(<WhatsAppLinkSheet open={true} onClose={() => {}} />);
    fireEvent.click(await screen.findByRole("checkbox"));
    const btn = await screen.findByRole("button", { name: /Gerar código/i });
    await waitFor(() => expect(btn).not.toBeDisabled());
    fireEvent.click(btn);

    expect(await screen.findByText(/VINCULAR 123456/)).toBeInTheDocument();
    const retry = await screen.findByRole("button", { name: /Abrir WhatsApp novamente/i });
    openSpy.mockReturnValue({} as Window);
    fireEvent.click(retry);
    await waitFor(() => expect(openSpy).toHaveBeenCalledTimes(2));
  });
});
