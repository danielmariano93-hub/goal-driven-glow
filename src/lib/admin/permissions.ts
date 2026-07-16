/**
 * Matriz central de permissões da experiência administrativa (Platform).
 *
 * Aplica-se ao frontend e é espelhada no servidor (Edge Functions revalidam via RPC).
 * Todas as ações críticas SEMPRE devem ser reverificadas por RLS/RPC no banco.
 */

export type PlatformRole =
  | "platform_owner"
  | "platform_admin"
  | "support"
  | "analyst";

export type PlatformAction =
  // Visão Geral
  | "overview.read"
  // Usuários
  | "users.read"
  | "users.suspend"
  | "users.reset_password"
  | "users.process_deletion"
  // Financeiro da empresa
  | "company_finance.read"
  | "company_finance.write"
  // Agente
  | "agent.read"
  | "agent.write"
  // WhatsApp / mensageria
  | "whatsapp.read"
  | "whatsapp.critical"
  // Operação
  | "ops.read"
  | "ops.write"
  // Produto (desafios, categorias globais, flags)
  | "product.read"
  | "product.write"
  // Segurança
  | "security.read"
  | "security.manage_admins"
  // Configurações
  | "settings.read"
  | "settings.critical";

const MATRIX: Record<PlatformRole, PlatformAction[]> = {
  platform_owner: [
    "overview.read",
    "users.read", "users.suspend", "users.reset_password", "users.process_deletion",
    "company_finance.read", "company_finance.write",
    "agent.read", "agent.write",
    "whatsapp.read", "whatsapp.critical",
    "ops.read", "ops.write",
    "product.read", "product.write",
    "security.read", "security.manage_admins",
    "settings.read", "settings.critical",
  ],
  platform_admin: [
    "overview.read",
    "users.read", "users.suspend", "users.reset_password", "users.process_deletion",
    "company_finance.read", "company_finance.write",
    "agent.read", "agent.write",
    "whatsapp.read", "whatsapp.critical",
    "ops.read", "ops.write",
    "product.read", "product.write",
    "security.read",
    "settings.read",
  ],
  support: [
    "overview.read",
    "users.read", "users.suspend", "users.reset_password",
    "agent.read",
    "whatsapp.read",
    "ops.read",
    "product.read",
  ],
  analyst: [
    "overview.read",
    "users.read",
    "agent.read",
    "whatsapp.read",
    "ops.read",
    "product.read",
    "company_finance.read",
    "security.read",
  ],
};

export function can(role: PlatformRole | null | undefined, action: PlatformAction): boolean {
  if (!role) return false;
  return MATRIX[role]?.includes(action) ?? false;
}

export function roleLabel(role: PlatformRole | null | undefined): string {
  switch (role) {
    case "platform_owner": return "Platform Owner";
    case "platform_admin": return "Platform Admin";
    case "support": return "Suporte";
    case "analyst": return "Analista";
    default: return "Sem acesso";
  }
}
