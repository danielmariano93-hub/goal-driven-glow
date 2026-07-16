import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { WhatsAppSessionPanel } from "@/pages/admin/WhatsAppSessionPanel";

const invokeMock = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: (...a: unknown[]) => invokeMock(...a) } },
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

type StatusPayload = Record<string, unknown>;

function setup(configPayload: StatusPayload | null, opts: { fail?: boolean; sessionStatus?: string } = {}) {
  invokeMock.mockReset();
  invokeMock.mockImplementation(async (_fn: string, o: { body: { action: string } }) => {
    const action = o.body.action;
    if (action === "config_status") {
      if (opts.fail) return { data: null, error: { message: "boom" } };
      return { data: configPayload, error: null };
    }
    if (action === "status") {
      const st = opts.sessionStatus ?? "not_configured";
      return { data: { status: st, capabilities: { can_connect: true, can_send: st === "connected", needs_session: st !== "connected", temporarily_unavailable: false }, phone_masked: null, last_seen_at: null, latency_ms: null, error_code: null }, error: null };
    }
    return { data: { ok: true }, error: null };
  });
}

beforeEach(() => { sessionStorage.clear(); localStorage.clear(); });
afterEach(() => { cleanup(); });

describe("WhatsAppSessionPanel — permissões", () => {
  it("owner: can_manage_config=true habilita Configurar conexão sem hint", async () => {
    setup({ configured: false, has_url: false, has_api_key: false, has_webhook_secret: false, session_name: "default", updated_at: null, admin_role: "platform_owner", can_manage_config: true });
    render(<WhatsAppSessionPanel />);
    const btn = await screen.findByRole("button", { name: /Configurar conexão/i });
    expect(btn).not.toBeDisabled();
    expect(screen.queryByText(/Apenas o dono da plataforma/i)).toBeNull();
  });

  it("não-owner: can_manage_config=false desabilita botão e mostra hint", async () => {
    setup({ configured: false, has_url: false, has_api_key: false, has_webhook_secret: false, session_name: "default", updated_at: null, admin_role: "platform_admin", can_manage_config: false });
    render(<WhatsAppSessionPanel />);
    const btn = await screen.findByRole("button", { name: /Configurar conexão/i });
    expect(btn).toBeDisabled();
    expect(screen.getByText(/Apenas o dono da plataforma/i)).toBeInTheDocument();
  });

  it("owner sem can_manage_config ainda habilita Configurar conexão pelo admin_role", async () => {
    setup({ configured: false, has_url: false, has_api_key: false, has_webhook_secret: false, session_name: "default", updated_at: null, admin_role: "platform_owner" });
    render(<WhatsAppSessionPanel />);
    const btn = await screen.findByRole("button", { name: /Configurar conexão/i });
    expect(btn).not.toBeDisabled();
    expect(screen.queryByText(/Apenas o dono da plataforma/i)).toBeNull();
  });

  it("platform_admin configurado sem can_manage_config ainda vê pareamento", async () => {
    setup({ configured: true, has_url: true, has_api_key: true, has_webhook_secret: true, session_name: "default", updated_at: new Date().toISOString(), admin_role: "platform_admin" }, { sessionStatus: "needs_attention" });
    render(<WhatsAppSessionPanel />);
    await screen.findByText(/Conectar aparelho/i);
    expect(screen.getByRole("tab", { name: /QR Code/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Código pelo telefone/i })).toBeInTheDocument();
  });

  it("owner: 'Substituir credenciais' abre wizard", async () => {
    setup({ configured: true, has_url: true, has_api_key: true, has_webhook_secret: true, session_name: "default", updated_at: new Date().toISOString(), admin_role: "platform_owner", can_manage_config: true });
    render(<WhatsAppSessionPanel />);
    const trigger = await screen.findByRole("button", { name: /Substituir credenciais/i });
    fireEvent.click(trigger);
    const confirm = await screen.findByRole("button", { name: /Substituir agora/i });
    fireEvent.click(confirm);
    await waitFor(() => expect(screen.getByPlaceholderText("https://…")).toBeInTheDocument());
    expect(screen.getByText(/substituindo as credenciais/i)).toBeInTheDocument();
  });
});
