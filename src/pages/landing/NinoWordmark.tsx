import { NinoSymbol } from "./NinoSymbol";

/**
 * Wordmark oficial da LP: símbolo + "Meu Nino" + pill ".IA" gradiente.
 * Não usa nenhuma imagem — apenas SVG e texto vivo.
 */
type Props = {
  size?: "sm" | "md";
  className?: string;
};

export function NinoWordmark({ size = "md", className }: Props) {
  const symbolSize = size === "sm" ? 28 : 34;
  return (
    <span className={`lp-logo ${className ?? ""}`}>
      <NinoSymbol size={symbolSize} />
      <span className="lp-wordmark">Meu Nino</span>
      <span className="lp-ia-pill" aria-hidden="true">.IA</span>
      <span className="sr-only">.IA</span>
    </span>
  );
}
