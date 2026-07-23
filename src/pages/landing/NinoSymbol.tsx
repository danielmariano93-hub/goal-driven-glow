import { useId } from "react";

/**
 * Símbolo do Meu Nino — monograma orgânico em SVG puro.
 * Curvas contínuas que sugerem M/N entrelaçados dentro de uma silhueta de balão
 * de conversa arredondado, com ponto coral no canto inferior direito.
 *
 * variant:
 *   - gradient: traço em gradiente violet → indigo → coral (default)
 *   - mono:     traço em Deep Ink sólido
 *   - avatar:   envelopa o monograma num círculo Deep Ink com indicador mint
 */
type Variant = "gradient" | "mono" | "avatar";

type Props = {
  size?: number;
  className?: string;
  title?: string;
  variant?: Variant;
};

export function NinoSymbol({
  size = 40,
  className,
  title = "Meu Nino",
  variant = "gradient",
}: Props) {
  const uid = useId().replace(/:/g, "");
  const gradId = `nino-grad-${uid}`;

  // Traço do monograma — cor depende da variante
  const stroke =
    variant === "mono" ? "#10111A" : variant === "avatar" ? "#FFFFFF" : `url(#${gradId})`;

  // No avatar, o ponto coral fica visualmente sobre o círculo escuro
  const coral = "#FF6B5F";

  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role="img"
      aria-label={title}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id={gradId} x1="6" y1="10" x2="58" y2="56" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#6D4AFF" />
          <stop offset="55%" stopColor="#4338FF" />
          <stop offset="100%" stopColor="#FF6B5F" />
        </linearGradient>
      </defs>

      {variant === "avatar" ? (
        <>
          {/* Círculo Deep Ink */}
          <circle cx="32" cy="32" r="30" fill="#10111A" />
          {/* Indicador mint (canto superior direito) */}
          <circle cx="52" cy="14" r="5" fill="#2FC99A" />
        </>
      ) : null}

      {/* Balão de conversa arredondado (contorno) */}
      <path
        d="M14 30
           C14 20, 22 12, 32 12
           C42 12, 50 20, 50 30
           C50 40, 42 48, 32 48
           L24 48
           L18 54
           L20 46
           C16 42, 14 36, 14 30 Z"
        fill="none"
        stroke={stroke}
        strokeWidth={variant === "avatar" ? 3.2 : 3.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Monograma M/N entrelaçado — duas curvas contínuas */}
      <path
        d="M22 38
           L22 24
           C22 22, 24 22, 25 24
           L31 33
           C32 34.5, 33 34.5, 34 33
           L40 24
           C41 22, 43 22, 43 24
           L43 38"
        fill="none"
        stroke={stroke}
        strokeWidth={variant === "avatar" ? 3.2 : 3.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Ponto coral — respiro humano do símbolo */}
      <circle cx="46" cy="46" r={variant === "avatar" ? 3.2 : 3.6} fill={coral} />
    </svg>
  );
}
