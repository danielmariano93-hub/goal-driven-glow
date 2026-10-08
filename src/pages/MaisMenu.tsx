import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  ChevronRight,
  Users,
  BarChart3,
  LogOut,
  Sparkles,
  Loader2,
  Tags,
} from "lucide-react";

import { copy } from "@/lib/copy/strings";
import { useAuth } from "@/context/AuthContext";
import { markNinoSeen, useMoreMenuContext } from "@/lib/nino/intelligence";
import { moreGroups } from "@/lib/navigation/appNavigationRegistry";

type Item = { path: string; label: string; desc: string; icon: any; badge?: string | null };

/** Destaque: linha enxuta com o estado do assunto (só aparece quando há algo a dizer). */
type Highlight = Item & { tone?: "attention" | "neutral" };

/**
 * O menu Mais deriva de `appNavigationRegistry` — nenhuma lista manual aqui.
 * Uma funcionalidade nova ganha entrada automaticamente ao declarar
 * `mobilePlacement: "more"` no registry.
 */
const registryGroups = moreGroups().map((group) => ({
  title: group.label,
  items: group.items.map((entry) => ({
    path: entry.path,
    label: entry.label,
    desc: entry.desc ?? "",
    icon: entry.icon,
  })) as Item[],
}));

function brl(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}

export default function MaisMenu() {
  const navigate = useNavigate();
  const { signOut } = useAuth();
  const { data, isLoading } = useMoreMenuContext();

  useEffect(() => {
    void markNinoSeen("mais", "all");
  }, []);

  const split = data?.split;
  const reports = data?.reports;
  const nino = data?.nino;
  const uncategorized = data?.data_quality?.uncategorized_count ?? 0;

  // Em destaque: o que tem estado/novidade. Assuntos que não têm nada a dizer ficam só na grade abaixo.
  const highlights: Highlight[] = [];
  if ((split?.awaiting_confirmation ?? 0) > 0) {
    highlights.push({
      path: "/app/divisao-do-role",
      label: "Pagamentos a confirmar",
      desc: `${split!.awaiting_confirmation} participante${split!.awaiting_confirmation > 1 ? "s" : ""} informou pagamento`,
      icon: Users,
      tone: "attention",
    });
  } else if (split && split.open_count > 0) {
    highlights.push({
      path: "/app/divisao-do-role",
      label: "Divisão do Rolê",
      desc: `${split.open_count} em aberto · ${brl(Number(split.amount_to_receive ?? 0))} a receber`,
      icon: Users,
    });
  }
  if ((reports?.unread ?? 0) > 0) {
    highlights.push({
      path: "/app/relatorios",
      label: "Relatórios",
      desc: `${reports!.unread} não lido${reports!.unread > 1 ? "s" : ""}${reports?.last_period_label ? ` · fechamento ${reports.last_period_label}` : ""}`,
      icon: BarChart3,
    });
  }
  if (nino && (nino.new_since_last_visit > 0 || nino.attention_items > 0)) {
    highlights.push({
      path: "/app/nino",
      label: "Nino",
      desc: nino.new_since_last_visit > 0
        ? `${nino.new_since_last_visit} novidade${nino.new_since_last_visit > 1 ? "s" : ""} desde sua última visita`
        : `${nino.attention_items} ponto${nino.attention_items > 1 ? "s" : ""} de atenção`,
      icon: Sparkles,
    });
  }
  if (uncategorized > 0) {
    highlights.push({
      path: "/app/lancamentos",
      label: "Lançamentos sem categoria",
      desc: `${uncategorized} no mês — classificar melhora as leituras`,
      icon: Tags,
      tone: "attention",
    });
  }

  // Cada assunto aparece uma vez: o que já está em destaque não se repete na grade.
  const highlighted = new Set(highlights.map((h) => h.path));
  const groups = registryGroups
    .map((group) => ({ ...group, items: group.items.filter((item) => !highlighted.has(item.path)) }))
    .filter((group) => group.items.length > 0);

  return (
    <div className="space-y-5 pt-2 pb-8">
      <header>
        <h1 className="font-display text-2xl font-bold tracking-tight">{copy.more.title}</h1>
        <p className="mt-0.5 text-xs text-muted-foreground">{copy.more.subtitle}</p>
      </header>

      {isLoading && (
        <div className="grid place-items-center py-1">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      )}

      {highlights.length > 0 && (
        <section aria-label="Em destaque">
          <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card shadow-card">
            {highlights.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.path + item.label}
                  type="button"
                  onClick={() => navigate(item.path)}
                  className="flex min-h-[56px] w-full items-center gap-3 px-3.5 py-2.5 text-left active:bg-secondary/50"
                >
                  <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${item.tone === "attention" ? "bg-warning/15 text-warning" : "bg-primary/10 text-primary"}`}>
                    <Icon size={16} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{item.label}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">{item.desc}</span>
                  </span>
                  <ChevronRight size={14} className="shrink-0 text-muted-foreground" />
                </button>
              );
            })}
          </div>
        </section>
      )}

      {groups.map((group) => (
        <MoreGroup key={group.title} title={group.title} items={group.items} onGo={navigate} />
      ))}

      <section>
        <button
          type="button"
          onClick={signOut}
          className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl border border-border bg-card px-4 text-sm font-medium text-muted-foreground active:bg-secondary/50"
        >
          <LogOut size={15} /> Sair deste dispositivo
        </button>
      </section>

      <nav className="flex flex-wrap justify-center gap-4 pb-2 text-[11px] text-muted-foreground">
        <a href="/privacidade">Política de Privacidade</a>
        <a href="/termos">Termos de Uso</a>
      </nav>
    </div>
  );
}

/** Grade de atalhos: ícone + nome. A descrição fica no rótulo de acessibilidade (não ocupa a tela). */
function MoreGroup({
  title,
  items,
  onGo,
}: {
  title: string;
  items: Item[];
  onGo: (p: string) => void;
}) {
  return (
    <section>
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</p>
      <div className="grid grid-cols-3 gap-2">
        {items.map((it) => {
          const Icon = it.icon;
          return (
            <button
              key={it.path + it.label}
              type="button"
              onClick={() => onGo(it.path)}
              aria-label={it.desc ? `${it.label} — ${it.desc}` : it.label}
              title={it.desc || undefined}
              className="flex min-h-[84px] min-w-0 flex-col items-center justify-center gap-1.5 rounded-2xl border border-border bg-card px-1.5 py-2.5 text-center shadow-card transition active:scale-[0.97] active:bg-secondary/50"
            >
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-secondary text-primary">
                <Icon size={17} />
              </span>
              <span className="line-clamp-2 w-full break-words text-[12px] font-medium leading-tight">{it.label}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
