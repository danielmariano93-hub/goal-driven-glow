// Central error mapper — the UI never renders raw error.message.
export type FriendlyError = {
  title: string;
  hint: string;
  code: string;
};

function randCode(): string {
  const alpha = "ABCDEFGHJKMNPQRSTUVWXYZ";
  const pick = (s: string) => s[Math.floor(Math.random() * s.length)];
  return `${pick(alpha)}${pick(alpha)}${Math.floor(Math.random() * 100)}-${Math.floor(Math.random() * 100)}`;
}

export function mapAdminError(_err: unknown): FriendlyError {
  return {
    title: "Não foi possível carregar agora",
    hint: "Tente novamente em instantes. Se persistir, informe o código de referência ao suporte.",
    code: randCode(),
  };
}

export function mapAdminActionError(_err: unknown): FriendlyError {
  return {
    title: "Não foi possível concluir a ação",
    hint: "Aguarde alguns instantes e tente de novo.",
    code: randCode(),
  };
}
