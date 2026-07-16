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
      expect(url).toContain("wa.me/5511999998888");
      expect(url).toContain(encodeURIComponent("código de verificação"));
      expect(url).toContain("123456");
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
      expect(url).toContain("123456");
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

    expect(await screen.findByText(/código de verificação.*123456/i)).toBeInTheDocument();
    const retry = await screen.findByRole("button", { name: /Abrir WhatsApp novamente/i });
    openSpy.mockReturnValue({} as Window);
    fireEvent.click(retry);
    await waitFor(() => expect(openSpy).toHaveBeenCalledTimes(2));
  });
});

describe("WhatsAppLinkSheet — portal e erros inline", () => {
  it("renderiza via portal em document.body", async () => {
    invokeMock.mockResolvedValue({
      data: { available: true, official_number: "+5511999998888" },
      error: null,
    });
    const { container } = render(<WhatsAppLinkSheet open={true} onClose={() => {}} />);
    // O container do render está vazio; o dialog vive no document.body
    expect(container.querySelector("[role=dialog]")).toBeNull();
    expect(document.body.querySelector("[role=dialog]")).not.toBeNull();
  });

  it("erro na RPC create_phone_link_code exibe alerta inline com botão Tentar novamente", async () => {
    invokeMock.mockResolvedValue({
      data: { available: true, official_number: "+5511999998888" },
      error: null,
    });
    rpcMock.mockImplementation(async (fn: string) => {
      if (fn === "list_my_whatsapp_link") return { data: [], error: null };
      if (fn === "create_phone_link_code")
        return { data: null, error: { message: "digest not found", code: "42883" } };
      return { data: null, error: null };
    });

    render(<WhatsAppLinkSheet open={true} onClose={() => {}} />);
    fireEvent.click(await screen.findByRole("checkbox"));
    const btn = await screen.findByRole("button", { name: /Gerar código/i });
    await waitFor(() => expect(btn).not.toBeDisabled());
    fireEvent.click(btn);

    // Modal permanece aberto e mostra retry inline
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: /Tentar novamente/i }),
    ).toBeInTheDocument();
  });

  it("erro 'too many' mostra mensagem específica de rate-limit", async () => {
    invokeMock.mockResolvedValue({
      data: { available: true, official_number: "+5511999998888" },
      error: null,
    });
    rpcMock.mockImplementation(async (fn: string) => {
      if (fn === "list_my_whatsapp_link") return { data: [], error: null };
      if (fn === "create_phone_link_code")
        return { data: null, error: { message: "too many attempts, try again later" } };
      return { data: null, error: null };
    });

    render(<WhatsAppLinkSheet open={true} onClose={() => {}} />);
    fireEvent.click(await screen.findByRole("checkbox"));
    fireEvent.click(await screen.findByRole("button", { name: /Gerar código/i }));

    expect(await screen.findByText(/Muitas tentativas/i)).toBeInTheDocument();
  });
});

