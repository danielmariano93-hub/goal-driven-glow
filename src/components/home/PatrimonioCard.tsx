import { ChevronRight, CreditCard, LineChart, Wallet } from "lucide-react";
import { Link } from "react-router-dom";
import { formatBRL } from "@/lib/engine/facts";

interface Props {
  cash: number;
  cardsOwed: number;
  invested: number;
  otherDebts: number;
  net: number;
  loading?: boolean;
}

export function PatrimonioCard({ cash, cardsOwed, invested, otherDebts, net, loading }: Props) {
  const fmt = (n: number) => (loading ? "…" : formatBRL(n));

  return (
    <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#21164F] via-[#7543FF] to-[#F06467] p-5 text-white shadow-brand sm:p-6">
      <div aria-hidden className="pointer-events-none absolute -right-16 -top-20 h-48 w-48 rounded-full bg-white/15 blur-3xl" />
      <div className="relative">
        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-white/75">Seu patrimônio hoje</p>
        <p className="mt-1 font-display text-4xl font-bold tabular-nums tracking-tight sm:text-5xl">
          {fmt(net)}
        </p>
        <p className="mt-1 max-w-sm text-xs leading-relaxed text-white/75">
          O que você tem, menos fatura e outras dívidas.
        </p>

        <div className="mt-5 grid grid-cols-3 gap-2 border-t border-white/20 pt-4">
          <HeroMetric icon={<Wallet size={13} />} label="Em conta" value={fmt(cash)} />
          <HeroMetric icon={<CreditCard size={13} />} label="Na fatura" value={fmt(cardsOwed)} />
          <HeroMetric icon={<LineChart size={13} />} label="Investido" value={fmt(invested)} />
        </div>

        <div className="mt-4 flex items-center justify-between gap-3">
          <p className="min-w-0 truncate text-[11px] text-white/70">
            Outras dívidas: <span className="font-semibold text-white">{fmt(otherDebts)}</span>
          </p>
          <Link to="/app/planejamento" className="inline-flex shrink-0 items-center gap-1 rounded-full bg-white/15 px-3 py-1.5 text-[11px] font-semibold text-white transition hover:bg-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80">
            Ver composição <ChevronRight size={12} />
          </Link>
        </div>
      </div>
    </section>
  );
}

function HeroMetric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1 text-[10px] text-white/70">
        {icon}<span className="truncate">{label}</span>
      </div>
      <p className="mt-1 truncate text-sm font-semibold tabular-nums text-white sm:text-base">{value}</p>
    </div>
  );
}
