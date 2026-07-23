import { NinoSymbol } from "./NinoSymbol";

/**
 * Wordmark oficial: símbolo + lettering "Meu Nino".
 * O sufixo ".IA" NÃO faz parte obrigatória do logotipo.
 * Quando `withDescriptor` for true, ".IA" aparece como descritor discreto,
 * peso Regular, cor muted — nunca como pill gradiente.
 */
type Props = {
  size?: "sm" | "md";
  className?: string;
  withDescriptor?: boolean;
};

export function NinoWordmark({ size = "md", className, withDescriptor = false }: Props) {
  const symbolSize = size === "sm" ? 28 : 34;
  return (
    <span className={`lp-logo ${className ?? ""}`}>
      <NinoSymbol size={symbolSize} />
      <span className="lp-wordmark">Meu Nino</span>
      {withDescriptor ? (
        <span className="lp-descriptor" aria-hidden="true">
          .IA
        </span>
      ) : null}
    </span>
  );
}
