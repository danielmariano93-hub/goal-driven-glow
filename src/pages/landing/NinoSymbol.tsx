/**
 * Símbolo oficial Meu Nino.IA.
 * SVG inline — markup idêntico a /public/brand/meu-nino-symbol.svg,
 * sem alterações de geometria, cores, proporção ou stroke.
 *
 * Este é o ÚNICO símbolo autorizado. Não reinterpretar, não substituir,
 * não usar variantes (avatar/quadrado). O parâmetro `size` altera apenas
 * dimensão renderizada — não a geometria.
 */
type Props = {
  size?: number;
  className?: string;
  title?: string;
};

export function NinoSymbol({ size = 64, className, title = "Meu Nino.IA" }: Props) {
  const gradId = `ninoGradient-${size}`;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="img"
      aria-label={title}
    >
      <defs>
        <linearGradient id={gradId} x1="92" y1="92" x2="420" y2="430" gradientUnits="userSpaceOnUse">
          <stop stopColor="#6D4AFF" />
          <stop offset="0.55" stopColor="#4338FF" />
          <stop offset="1" stopColor="#FF6B5F" />
        </linearGradient>
      </defs>
      <path
        d="M104 334V154C104 111 155 87 187 116L256 180L325 116C357 87 408 111 408 154V334"
        stroke={`url(#${gradId})`}
        strokeWidth="54"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M174 272C198 306 225 322 256 322C289 322 316 306 338 272"
        stroke={`url(#${gradId})`}
        strokeWidth="46"
        strokeLinecap="round"
      />
      <circle cx="256" cy="392" r="28" fill="#FF6B5F" />
    </svg>
  );
}
