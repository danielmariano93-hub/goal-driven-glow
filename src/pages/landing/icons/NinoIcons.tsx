import { useId, type SVGProps } from "react";

/**
 * Biblioteca de ícones outline coerente com o design system Meu Nino.
 * Todos: 24×24, stroke 1.6, linecaps/joins round, fill none.
 * Accent aplica cor sólida da paleta ou gradiente violeta→coral.
 */
type Accent = "violet" | "coral" | "mint" | "ink" | "white";

type IconProps = Omit<SVGProps<SVGSVGElement>, "stroke" | "fill"> & {
  size?: number;
  accent?: Accent;
  title?: string;
};

function useIconBase({ size = 24, accent = "violet", title, ...rest }: IconProps) {
  const uid = useId().replace(/:/g, "");
  const gradId = `nino-icon-grad-${uid}`;
  const stroke =
    accent === "mint"
      ? "#2FC99A"
      : accent === "ink"
        ? "#10111A"
        : accent === "coral"
          ? "#FF6B5F"
          : accent === "white"
            ? "#FFFFFF"
            : `url(#${gradId})`;
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none" as const,
    stroke,
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    role: "img" as const,
    "aria-label": title,
    ...rest,
  };
  const defs = (
    <defs>
      <linearGradient id={gradId} x1="3" y1="4" x2="21" y2="20" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#6D4AFF" />
        <stop offset="55%" stopColor="#4338FF" />
        <stop offset="100%" stopColor="#FF6B5F" />
      </linearGradient>
    </defs>
  );
  return { common, defs };
}

export function ChatBubble(props: IconProps) {
  const { common, defs } = useIconBase(props);
  return (
    <svg {...common}>
      {defs}
      <path d="M4 11c0-3.5 3.4-6 8-6s8 2.5 8 6-3.4 6-8 6h-3l-4 3 1-4c-1.3-1.3-2-3-2-5Z" />
    </svg>
  );
}

export function Sparkle(props: IconProps) {
  const { common, defs } = useIconBase(props);
  return (
    <svg {...common}>
      {defs}
      <path d="M12 3.5c.6 3.2 1.8 4.4 5 5-3.2.6-4.4 1.8-5 5-.6-3.2-1.8-4.4-5-5 3.2-.6 4.4-1.8 5-5Z" />
      <path d="M19 14c.3 1.5.9 2.1 2.5 2.5-1.6.4-2.2 1-2.5 2.5-.3-1.5-.9-2.1-2.5-2.5 1.6-.4 2.2-1 2.5-2.5Z" />
    </svg>
  );
}

export function Pulse(props: IconProps) {
  const { common, defs } = useIconBase(props);
  return (
    <svg {...common}>
      {defs}
      <path d="M3 12h4l2-5 3 10 3-8 2 3h4" />
    </svg>
  );
}

export function HeartOutline(props: IconProps) {
  const { common, defs } = useIconBase(props);
  return (
    <svg {...common}>
      {defs}
      <path d="M12 20s-7-4.3-7-9.5A4.5 4.5 0 0 1 12 7a4.5 4.5 0 0 1 7 3.5C19 15.7 12 20 12 20Z" />
    </svg>
  );
}

export function Target(props: IconProps) {
  const { common, defs } = useIconBase(props);
  return (
    <svg {...common}>
      {defs}
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="12" cy="12" r="1" />
    </svg>
  );
}

export function Compass(props: IconProps) {
  const { common, defs } = useIconBase(props);
  return (
    <svg {...common}>
      {defs}
      <circle cx="12" cy="12" r="8.5" />
      <path d="m15 9-2 5-5 2 2-5 5-2Z" />
    </svg>
  );
}

export function TrendUp(props: IconProps) {
  const { common, defs } = useIconBase(props);
  return (
    <svg {...common}>
      {defs}
      <path d="M4 17c2.5-1 4.5-4 7-6.5S16 8 20 6.5" />
      <path d="M14 6.5h6v6" />
    </svg>
  );
}

export function BellSoft(props: IconProps) {
  const { common, defs } = useIconBase(props);
  return (
    <svg {...common}>
      {defs}
      <path d="M6 16c0-1 .5-1.4.5-3.5C6.5 8.5 8.9 6 12 6s5.5 2.5 5.5 6.5c0 2.1.5 2.5.5 3.5Z" />
      <path d="M10.5 19a1.5 1.5 0 0 0 3 0" />
    </svg>
  );
}

export function CalendarSoft(props: IconProps) {
  const { common, defs } = useIconBase(props);
  return (
    <svg {...common}>
      {defs}
      <rect x="4" y="6" width="16" height="14" rx="3" />
      <path d="M8 4v4M16 4v4M4 11h16" />
    </svg>
  );
}

export function Wallet(props: IconProps) {
  const { common, defs } = useIconBase(props);
  return (
    <svg {...common}>
      {defs}
      <path d="M4 8c0-1.7 1.3-3 3-3h11c1.1 0 2 .9 2 2v10c0 1.7-1.3 3-3 3H7a3 3 0 0 1-3-3V8Z" />
      <path d="M17 12h3" />
    </svg>
  );
}
