import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, cleanup, waitFor } from "@testing-library/react";
import { WhatsAppSessionPanel } from "@/pages/admin/WhatsAppSessionPanel";

const invokeMock = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...args: unknown[]) => invokeMock(...args) },
  },
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

type Body = { action?: string; url?: string; api_key?: string } | undefined;

function reply(action: string, body: Body): unknown {
  if (action === "config_status") return { configured: false, has_url: false, has_api_key: false, has_webhook_secret: false, session_name: "default", updated_at: null, admin_role: "platform_owner", can_manage_config: true };
  if (action === "status") return { status: "not_configured", capabilities: { can_connect: false, can_send: false, needs_session: false, temporarily_unavailable: false }, phone_masked: null, last_seen_at: null, latency_ms: null, error_code: null };
  if (action === "test_config") return { ok: true, latency_ms: 42, code: "ok" };
  if (action === "save_config") return { ok: true, configured: true, has_url: true, has_api_key: true, has_webhook_secret: true, session_name: "default", updated_at: new Date().toISOString() };
  if (action === "setup_session") return { ok: true, status: "awaiting_qr" };
  if (action === "qr") return { ok: true, base64: "AAA", mimeType: "image/png" };
  if (action === "begin_qr") return { ok: true, qr: "AAA", mime_type: "image/png", expires_at: new Date(Date.now() + 60000).toISOString() };
  if (action === "request_pairing_code") return { ok: true, pairing_code: "ABCD-1234", expires_at: new Date(Date.now() + 60000).toISOString() };
  return { ok: true };
  void body;
}

let pending: Array<() => void> = [];

function installMock(options: { failStatus?: boolean; hangStatus?: boolean; configured?: boolean; sessionStatus?: string; codeError?: string } = {}) {
  invokeMock.mockImplementation(async (_fn: string, opts: { body: { action: string } & Record<string, unknown> }) => {
    const action = opts.body.action;
    if (action === "config_status" && options.hangStatus) {
      await new Promise<void>((resolve) => { pending.push(resolve); });
    }
    if (action === "config_status" && options.failStatus) {
      return { data: null, error: { message: "boom" } };
    }
    if (action === "config_status" && options.configured) {
      return { data: { configured: true, has_url: true, has_api_key: true, has_webhook_secret: true, session_name: "default", updated_at: new Date().toISOString(), admin_role: "platform_owner", can_manage_config: true }, error: null };
    }
    if (action === "status" && options.configured) {
      const st = options.sessionStatus ?? "needs_attention";
      return { data: { status: st, capabilities: { can_connect: true, can_send: st === "connected", needs_session: st !== "connected", temporarily_unavailable: false }, phone_masked: null, last_seen_at: null, latency_ms: null, error_code: null }, error: null };
    }
    if (action === "request_pairing_code" && options.codeError) {
      return { data: { ok: false, error_code: options.codeError }, error: null };
    }
    return { data: reply(action, opts.body as Body), error: null };
  });
}


beforeEach(() => {
  invokeMock.mockReset();
  pending = [];
  sessionStorage.clear();
  localStorage.clear();
});
afterEach(() => { cleanup(); });

describe("WhatsAppSessionPanel — carregamento", () => {
  it("primeiro render mostra skeleton, não o formulário do wizard", async () => {
    installMock({ hangStatus: true });
    render(<WhatsAppSessionPanel />);
    expect(screen.queryByPlaceholderText("https://…")).toBeNull();
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
    // liberar promessa pendente
    await act(async () => { pending.forEach((r) => r()); pending = []; });
  });

  it("configured=false renderiza card estável sem inputs até clique explícito", async () => {
    installMock();
    render(<WhatsAppSessionPanel />);
    await screen.findByRole("button", { name: /Configurar conexão/i });
    expect(screen.queryByPlaceholderText("https://…")).toBeNull();
    // aguardar mais um ciclo simulando refresh externo
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(screen.queryByPlaceholderText("https://…")).toBeNull();
  });

  it("clique em Configurar conexão abre o wizard e valores digitados persistem", async () => {
    installMock();
    render(<WhatsAppSessionPanel />);
    const cta = await screen.findByRole("button", { name: /Configurar conexão/i });
    fireEvent.click(cta);
    const urlInput = await screen.findByPlaceholderText("https://…") as HTMLInputElement;
    const keyInput = screen.getByPlaceholderText("•••") as HTMLInputElement;
    fireEvent.change(urlInput, { target: { value: "https://waha.example.com" } });
    fireEvent.change(keyInput, { target: { value: "supersecret123" } });
    // simular re-render por prop de pai não deve limpar
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect((screen.getByPlaceholderText("https://…") as HTMLInputElement).value).toBe("https://waha.example.com");
    expect((screen.getByPlaceholderText("•••") as HTMLInputElement).value).toBe("supersecret123");
  });

  it("erro em config_status mostra Tentar novamente", async () => {
    installMock({ failStatus: true });
    render(<WhatsAppSessionPanel />);
    await screen.findByText(/Não consegui carregar o status/);
    expect(screen.getByRole("button", { name: /Tentar novamente/i })).toBeInTheDocument();
  });
});

describe("WhatsAppSetupWizard — fluxo e segurança", () => {
  it("testAndSave sucesso limpa apiKey e avança para step session", async () => {
    installMock();
    render(<WhatsAppSessionPanel />);
    fireEvent.click(await screen.findByRole("button", { name: /Configurar conexão/i }));
    const urlInput = await screen.findByPlaceholderText("https://…") as HTMLInputElement;
    const keyInput = screen.getByPlaceholderText("•••") as HTMLInputElement;
    fireEvent.change(urlInput, { target: { value: "https://waha.example.com" } });
    fireEvent.change(keyInput, { target: { value: "supersecretkey" } });
    fireEvent.click(screen.getByRole("button", { name: /Testar e salvar/i }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Preparar número/i })).toBeInTheDocument());
    // chave sumiu do DOM
    expect(screen.queryByPlaceholderText("•••")).toBeNull();
  });

  it("nenhuma credencial é gravada em storage", async () => {
    installMock();
    render(<WhatsAppSessionPanel />);
    fireEvent.click(await screen.findByRole("button", { name: /Configurar conexão/i }));
    const urlInput = await screen.findByPlaceholderText("https://…") as HTMLInputElement;
    const keyInput = screen.getByPlaceholderText("•••") as HTMLInputElement;
    fireEvent.change(urlInput, { target: { value: "https://waha.example.com" } });
    fireEvent.change(keyInput, { target: { value: "supersecretkey" } });
    expect(localStorage.length).toBe(0);
    const raw = sessionStorage.getItem("nc:wa-wizard") ?? "";
    expect(raw).not.toMatch(/supersecretkey/);
    expect(raw).not.toMatch(/api[_-]?key/i);
  });
});
