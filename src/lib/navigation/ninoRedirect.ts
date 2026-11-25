/**
 * A aba "Nino" deixou de existir: os insights vivem na Home e a leitura de
 * mudanças/previsão virou os atos de Relatórios. Links antigos (WhatsApp,
 * push, favoritos) caem no lugar certo.
 */
export function ninoRedirectTarget(section: string | null): string {
  switch (section) {
    case "mudancas":
    case "aprendizados":
    case "historico":
      return "/app/relatorios?ato=mudou";
    case "prepare-se":
      return "/app/relatorios?ato=vai";
    default:
      return "/app";
  }
}
