/**
 * Símbolo do Meu Nino.IA — recriado em SVG puro (sem imagem/base64).
 * Duas letras "N" entrelaçadas formando um contorno arredondado sobre gradiente.
 */
type Props = {
  size?: number;
  className?: string;
  title?: string;
};

export function NinoSymbol({ size = 40, className, title = "Meu Nino.IA" }: Props) {
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
        <linearGradient id="nino-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#6D4AFF" />
          <stop offset="55%" stopColor="#4338FF" />
          <stop offset="100%" stopColor="#FF6B5F" />
        </linearGradient>
      </defs>
      {/* Squircle base */}
      <path
        d="M32 2C50 2 62 14 62 32C62 50 50 62 32 62C14 62 2 50 2 32C2 14 14 2 32 2Z"
        fill="url(#nino-grad)"
      />
      {/* Stylized N mark */}
      <path
        d="M18 44V20H24L40 38V20H46V44H40L24 26V44H18Z"
        fill="#ffffff"
      />
    </svg>
  );
}
