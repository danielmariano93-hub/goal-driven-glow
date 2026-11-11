import type { IconKey } from "@/lib/habits/catalog";

/** Ícones de linha (24x24) dos hábitos, em um conjunto só. */
const PATHS: Record<IconKey, string> = {
  sun: "M12 17a5 5 0 100-10 5 5 0 000 10z M12 1v2 M12 21v2 M4.2 4.2l1.4 1.4 M18.4 18.4l1.4 1.4 M1 12h2 M21 12h2 M4.2 19.8l1.4-1.4 M18.4 5.6l1.4-1.4",
  activity: "M22 12h-4l-3 9L9 3l-3 9H2",
  heart: "M20.8 4.6a5.5 5.5 0 00-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 00-7.8 7.8l1 1.1L12 21.2l7.8-7.7 1-1.1a5.5 5.5 0 000-7.8z",
  book: "M4 19.5A2.5 2.5 0 016.5 17H20 M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z",
  drop: "M12 2.7l5.7 5.6a8 8 0 11-11.4 0z",
  moon: "M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z",
  phone: "M7 2h10a2 2 0 012 2v16a2 2 0 01-2 2H7a2 2 0 01-2-2V4a2 2 0 012-2z M12 18h.01",
  bag: "M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z M3 6h18 M16 10a4 4 0 01-8 0",
  smoke: "M18 12H2v4h16z M22 12v4 M7 12V8a3 3 0 013-3",
  coin: "M12 22a10 10 0 100-20 10 10 0 000 20z M14.8 9a3 3 0 00-2.8-1.5c-1.7 0-3 .9-3 2.2 0 3 6 1.5 6 4.3 0 1.3-1.3 2.2-3 2.2A3 3 0 019 14.7 M12 6v1.5 M12 16.5V18",
  list: "M8 6h13 M8 12h13 M8 18h13 M3 6h.01 M3 12h.01 M3 18h.01",
  calendar: "M3 4h18v18H3z M16 2v4 M8 2v4 M3 10h18",
  clock: "M12 22a10 10 0 100-20 10 10 0 000 20z M12 6v6l4 2",
  brain: "M9.5 2A2.5 2.5 0 007 4.5v.3A3 3 0 005 7.5a3 3 0 001 2.2A3 3 0 005 12a3 3 0 001.5 2.6A3 3 0 009 19h.5A2.5 2.5 0 0012 21.5V4.5A2.5 2.5 0 009.5 2z M14.5 2A2.5 2.5 0 0117 4.5v.3a3 3 0 012 2.7 3 3 0 01-1 2.2 3 3 0 011 2.3 3 3 0 01-1.5 2.6A3 3 0 0115 19h-.5a2.5 2.5 0 01-2.5 2.5",
  home: "M3 10.5L12 3l9 7.5V21H3z M9 21v-7h6v7",
  pen: "M12 20h9 M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z",
};

export function HabitIcon({ name, size = 20, className, stroke = 1.75 }: { name: IconKey; size?: number; className?: string; stroke?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      <path d={PATHS[name] ?? PATHS.sun} />
    </svg>
  );
}
