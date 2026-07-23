/**
 * Wordmark oficial: lettering "Meu Nino" + descritor ".IA" sobrescrito discreto.
 *
 * Regras:
 *  - "Meu Nino" em Deep Ink (ou branco na variante dark), peso 700, tracking negativo.
 *  - ".IA" ~50% da altura de "Nino", elevado, cor violeta oficial — nunca compete.
 *  - Não usar pill gradient. Não substituir por texto comum sem símbolo ao lado.
 */
type Props = {
  size?: "sm" | "md" | "lg";
  variant?: "light" | "dark";
  className?: string;
};

export function NinoWordmark({ size = "md", variant = "light", className }: Props) {
  const fontSize = size === "sm" ? "1.05rem" : size === "lg" ? "1.5rem" : "1.22rem";
  return (
    <span
      className={`nino-wordmark nino-wordmark--${variant} ${className ?? ""}`}
      style={{ fontSize }}
      aria-label="Meu Nino.IA"
    >
      <span className="nino-wordmark__name">Meu Nino</span>
      <span className="nino-wordmark__ia" aria-hidden="true">.IA</span>
    </span>
  );
}
