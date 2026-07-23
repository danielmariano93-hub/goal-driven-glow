import { NinoSymbol } from "./NinoSymbol";
import { NinoWordmark } from "./NinoWordmark";

/**
 * Logo horizontal oficial: símbolo + wordmark.
 * Único componente autorizado para uso institucional (header, footer, CTA).
 */
type Props = {
  variant?: "light" | "dark";
  size?: "sm" | "md" | "lg";
  className?: string;
};

export function NinoLogo({ variant = "light", size = "md", className }: Props) {
  const symbolSize = size === "sm" ? 26 : size === "lg" ? 40 : 30;
  return (
    <span className={`nino-logo ${className ?? ""}`}>
      <NinoSymbol size={symbolSize} />
      <NinoWordmark size={size} variant={variant} />
    </span>
  );
}
