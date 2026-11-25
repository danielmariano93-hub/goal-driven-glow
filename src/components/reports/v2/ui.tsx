import { useState, type ReactNode } from "react";
import { ChevronRight, Info, MoreHorizontal, type LucideIcon } from "lucide-react";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

// Primitivos dos Relatórios (handoff de design 25/11): só apresentação. Nenhuma métrica é calculada aqui.
// Tokens: cartão branco, raio 16, borda 1 px, padding 16, gap 12; título 24/28, seção 16/22, KPI 30/34,
// KPI secundário 20/24, corpo 14/20, legenda 12/16; números tabulares.

export const TONE = {
  success: "text-[#16A37A]",
  risk: "text-[#DC4C64]",
  alert: "text-[#B7791F]",
} as const;

export const brl0 = (n: number) => `${n < 0 ? "−" : ""}R$ ${Math.abs(Math.round(n)).toLocaleString("pt-BR")}`;
export const brl2 = (n: number) => `${n < 0 ? "−" : ""}R$ ${Math.abs(n).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const signed0 = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}R$ ${Math.abs(Math.round(n)).toLocaleString("pt-BR")}`;
export const pct0 = (r: number) => `${r > 0 ? "+" : r < 0 ? "−" : ""}${Math.abs(r) > 5 ? ">500" : Math.round(Math.abs(r) * 100)}%`;
export const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const MONTHS_FULL = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
export const mon = (ym: string) => MONTHS[Number(ym.slice(5, 7)) - 1] ?? ym;
export const monthFull = (ym: string) => MONTHS_FULL[Number(ym.slice(5, 7)) - 1] ?? ym;
export const monthTitle = (ym: string) => `${monthFull(ym).replace(/^./, (c) => c.toUpperCase())} ${ym.slice(0, 4)}`;

export function IconBadge({ icon: Icon, tone = "primary", size = "md" }: { icon: LucideIcon; tone?: "primary" | "success" | "risk" | "alert" | "muted"; size?: "sm" | "md" }) {
  const bg = { primary: "bg-primary/10 text-primary", success: "bg-[#16A37A]/10 text-[#16A37A]", risk: "bg-[#DC4C64]/10 text-[#DC4C64]", alert: "bg-[#E9A23B]/15 text-[#B7791F]", muted: "bg-secondary text-muted-foreground" }[tone];
  return <span className={cn("grid shrink-0 place-items-center rounded-xl", size === "md" ? "h-9 w-9" : "h-8 w-8", bg)} aria-hidden><Icon size={size === "md" ? 19 : 17} strokeWidth={2} /></span>;
}

/** Cartão-base. `title` 16/22; `scope` é o rótulo do recorte (período/base de comparação). */
export function Panel({ title, scope, icon, info, action, children, className, as: Tag = "section" }: {
  title?: string; scope?: string; icon?: LucideIcon; info?: () => void; action?: ReactNode; children: ReactNode; className?: string; as?: "section" | "div";
}) {
  return (
    <Tag aria-label={title} className={cn("rounded-2xl border border-border bg-card p-4 print:break-inside-avoid", className)}>
      {title ? (
        <header className="mb-3 flex items-start gap-2.5">
          {icon ? <IconBadge icon={icon} size="sm" /> : null}
          <div className="min-w-0 flex-1">
            <h2 className="flex items-center gap-1 text-base font-semibold leading-[22px]">
              {title}
              {info ? <button type="button" onClick={info} aria-label={`Como é calculado: ${title}`} className="-my-2.5 grid h-11 w-11 place-items-center rounded-full text-muted-foreground"><Info size={15} aria-hidden /></button> : null}
            </h2>
            {scope ? <p className="text-xs leading-4 text-muted-foreground">{scope}</p> : null}
          </div>
          {action}
        </header>
      ) : null}
      {children}
    </Tag>
  );
}

/** KPI secundário (20/24) com ícone. */
export function MetricTile({ icon, label, value, sub, tone }: { icon: LucideIcon; label: string; value: string; sub?: string; tone?: "risk" | "success" | "muted" }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-3.5">
      <div className="mb-1.5 flex items-center gap-2"><IconBadge icon={icon} size="sm" /><p className="min-w-0 text-xs leading-4 text-muted-foreground">{label}</p></div>
      <div className="min-w-0">
        <p className={cn("text-xl font-bold leading-6 tabular-nums", tone === "risk" && TONE.risk, tone === "muted" && "text-muted-foreground")}>{value}</p>
        {sub ? <p className="mt-0.5 text-xs leading-4 text-muted-foreground">{sub}</p> : null}
      </div>
    </div>
  );
}

/** Aviso contextual curto (até duas linhas), com ícone. */
export function ContextNotice({ icon, title, text, tone = "primary", action }: { icon: LucideIcon; title: string; text?: string; tone?: "primary" | "alert"; action?: ReactNode }) {
  return (
    <div role="note" className={cn("flex items-start gap-2.5 rounded-2xl p-3.5", tone === "alert" ? "bg-[#E9A23B]/10" : "bg-primary/[0.07]")}>
      <IconBadge icon={icon} size="sm" tone={tone === "alert" ? "alert" : "primary"} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold leading-5">{title}</p>
        {text ? <p className="line-clamp-2 text-xs leading-4 text-muted-foreground">{text}</p> : null}
        {action}
      </div>
    </div>
  );
}

/** Link de detalhe "Ver … →" com alvo de toque de 44 px. */
export function DetailLink({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="-mx-1 mt-1 inline-flex min-h-[44px] items-center gap-0.5 px-1 text-sm font-semibold text-primary print:hidden">
      {children}<ChevronRight size={16} aria-hidden />
    </button>
  );
}

export interface RankedRow { key: string; icon: LucideIcon; label: string; value: string; detail?: string; bar?: { ratio: number; tone?: "primary" | "success" | "risk" | "neutral"; diverging?: boolean }; trailing?: ReactNode; onClick?: () => void }

/** Lista compacta com ícone, barra opcional (comum ou divergente com eixo zero) e valor à direita. */
export function RankedRows({ rows }: { rows: RankedRow[] }) {
  return (
    <ul className="divide-y divide-border">
      {rows.map((r) => {
        const Icon = r.icon;
        const color = { primary: "bg-primary", success: "bg-[#16A37A]", risk: "bg-[#DC4C64]", neutral: "bg-primary/45" }[r.bar?.tone ?? "primary"];
        const body = (
          <span className="flex items-center gap-3 py-2.5">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary" aria-hidden><Icon size={17} /></span>
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline justify-between gap-2">
                <span className="truncate text-sm font-semibold leading-5">{r.label}</span>
                <span className="shrink-0 text-sm font-bold leading-5 tabular-nums">{r.value}</span>
              </span>
              {r.bar ? (
                r.bar.diverging ? (
                  <span className="relative mt-1.5 block h-1.5 rounded-full bg-secondary" aria-hidden>
                    <span className="absolute inset-y-[-3px] left-1/2 w-px bg-foreground/25" />
                    <span className={cn("absolute inset-y-0 rounded-full", color)} style={r.bar.ratio >= 0 ? { left: "50%", width: `${Math.min(50, Math.abs(r.bar.ratio) * 50)}%` } : { right: "50%", width: `${Math.min(50, Math.abs(r.bar.ratio) * 50)}%` }} />
                  </span>
                ) : (
                  <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-secondary" aria-hidden><span className={cn("block h-full rounded-full", color)} style={{ width: `${Math.max(2, Math.min(100, r.bar.ratio * 100))}%` }} /></span>
                )
              ) : null}
              {r.detail ? <span className="mt-1 block truncate text-xs leading-4 text-muted-foreground tabular-nums">{r.detail}</span> : null}
            </span>
            {r.trailing}
          </span>
        );
        return <li key={r.key}>{r.onClick ? <button type="button" onClick={r.onClick} className="block w-full text-left">{body}</button> : body}</li>;
      })}
    </ul>
  );
}

/** Gaveta de detalhe/metodologia: fechada por padrão, abre por toque. */
export function DisclosureSheet({ open, onOpenChange, title, description, children }: { open: boolean; onOpenChange: (v: boolean) => void; title: string; description?: string; children: ReactNode }) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[85vh]">
        <DrawerHeader className="text-left">
          <DrawerTitle>{title}</DrawerTitle>
          {description ? <DrawerDescription>{description}</DrawerDescription> : null}
        </DrawerHeader>
        <div className="overflow-y-auto px-4 pb-8 text-sm leading-5">{children}</div>
      </DrawerContent>
    </Drawer>
  );
}

/** Controle de gaveta: título + conteúdo, com o gatilho fornecido por quem usa. */
export function useSheet() {
  const [open, setOpen] = useState<string | null>(null);
  return { open, show: (k: string) => setOpen(k), props: (k: string) => ({ open: open === k, onOpenChange: (v: boolean) => setOpen(v ? k : null) }) };
}

/** Linhas de conta (rótulo, sinal, valor) que fecham num total. */
export function LedgerLines({ lines, total }: { lines: Array<{ label: string; value: string; sign?: "+" | "−" | ""; icon?: LucideIcon; muted?: boolean }>; total?: { label: string; value: string } }) {
  return (
    <ul className="space-y-1.5 text-sm leading-5">
      {lines.map((l) => {
        const Icon = l.icon;
        return (
          <li key={l.label} className={cn("flex items-center gap-2", l.muted && "text-muted-foreground")}>
            {Icon ? <Icon size={16} className="shrink-0 text-primary" aria-hidden /> : null}
            <span className="min-w-0 flex-1">{l.label}</span>
            <span className="shrink-0 font-semibold tabular-nums">{l.sign ? `${l.sign} ` : ""}{l.value}</span>
          </li>
        );
      })}
      {total ? <li className="flex items-center justify-between border-t border-border pt-1.5 font-bold"><span>{total.label}</span><span className="tabular-nums">{total.value}</span></li> : null}
    </ul>
  );
}

/** Ação: uma CTA principal; dispensar e metodologia ficam no menu. */
export function ActionCard({ icon, title, body, impact, cta, onCta, menu }: {
  icon: LucideIcon; title: string; body?: string; impact?: string | null; cta?: { label: string; href?: string } | null; onCta?: () => void;
  menu: Array<{ label: string; onSelect: () => void }>;
}) {
  return (
    <div className="flex items-start gap-3">
      <IconBadge icon={icon} size="sm" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold leading-5">{title}</p>
        {body ? <p className="text-xs leading-4 text-muted-foreground">{body}</p> : null}
        {impact ? <p className="mt-0.5 text-xs font-semibold leading-4">{impact}</p> : null}
        {cta ? (cta.href
          ? <a href={cta.href} onClick={onCta} className="mt-1 inline-flex min-h-[44px] items-center gap-0.5 text-sm font-semibold text-primary print:hidden">{cta.label}<ChevronRight size={16} aria-hidden /></a>
          : <button type="button" onClick={onCta} className="mt-1 inline-flex min-h-[44px] items-center gap-0.5 text-sm font-semibold text-primary print:hidden">{cta.label}<ChevronRight size={16} aria-hidden /></button>) : null}
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger aria-label={`Mais opções: ${title}`} className="-mr-2 grid h-11 w-11 shrink-0 place-items-center rounded-full text-muted-foreground print:hidden"><MoreHorizontal size={18} /></DropdownMenuTrigger>
        <DropdownMenuContent align="end">{menu.map((m) => <DropdownMenuItem key={m.label} onSelect={m.onSelect}>{m.label}</DropdownMenuItem>)}</DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/** Legenda de gráfico. */
export function Legend({ items }: { items: Array<{ label: string; swatch: string; dashed?: boolean; color?: string }> }) {
  return (
    <div className="mb-2 flex flex-wrap gap-x-3 gap-y-1 text-xs leading-4 text-muted-foreground">
      {items.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-1.5">
          {i.dashed ? <span className={cn("h-0 w-3.5 border-t-2 border-dashed", i.swatch)} aria-hidden /> : <span className={cn("h-2.5 w-2.5 rounded-sm", i.swatch)} style={i.color ? { background: i.color } : undefined} aria-hidden />}{i.label}
        </span>
      ))}
    </div>
  );
}

/** Leitura do ponto/barra selecionado por toque (o "tooltip" acessível do gráfico). */
export function ChartReadout({ children }: { children: ReactNode }) {
  return <p aria-live="polite" className="mt-2 min-h-[32px] rounded-lg bg-secondary/70 px-2.5 py-1.5 text-xs leading-4 tabular-nums">{children}</p>;
}

export function Chip({ ratio, base }: { ratio: number; base: string }) {
  const up = ratio > 0.02; const down = ratio < -0.02;
  return (
    <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-bold tabular-nums", up ? "bg-[#DC4C64]/10 text-[#DC4C64]" : down ? "bg-primary/10 text-primary" : "bg-secondary text-muted-foreground")}>
      {up || down ? pct0(ratio) : "estável"}<span className="sr-only">{up ? ` acima de ${base}` : down ? ` abaixo de ${base}` : ""}</span>
    </span>
  );
}
