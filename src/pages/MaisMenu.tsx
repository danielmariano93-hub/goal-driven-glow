import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  CreditCard,
  Heart,
  User,
  ChevronRight,
  PiggyBank,
  Wallet,
  Tag,
  Upload,
  Users,
  Repeat,
  Trophy,
  BarChart3,
  LogOut,
  Sparkles,
  Loader2,
  Tags,
} from "lucide-react";
import { copy } from "@/lib/copy/strings";
import { useAuth } from "@/context/AuthContext";
import { markNinoSeen, useMoreMenuContext } from "@/lib/nino/intelligence";

type Item = { path: string; label: string; desc: string; icon: any; badge?: string | null };

const organize: Item[] = [
  { path: "/app/contas", label: "Contas", desc: "Suas carteiras", icon: Wallet },
  { path: "/app/cartoes", label: "Cartões", desc: "Faturas, limites e parcelas", icon: CreditCard },
  { path: "/app/recorrencias", label: copy.recurring.title, desc: "Fixos que se repetem", icon: Repeat },
  { path: "/app/categorias", label: "Categorias", desc: "Padrões e pessoais", icon: Tag },
  { path: "/app/investimentos", label: "Investimentos", desc: "Carteira agregada", icon: PiggyBank },
  { path: "/app/dividas", label: "Dívidas", desc: "O que você deve", icon: CreditCard },
];

const understand: Item[] = [
  { path: "/app/emocoes", label: "Emocional", desc: "Como você se sente ao gastar", icon: Heart },
  { path: "/app/desafios", label: "Desafios", desc: "Metas de hábito com conquistas", icon: Trophy },
];

const account: Item[] = [
  { path: "/app/perfil", label: "Perfil", desc: "Conta, conexões e privacidade", icon: User },
  { path: "/app/importar", label: "Importar dados", desc: "CSV, OFX e legado", icon: Upload },
];

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

  const attention: Item[] = [];
  if ((split?.awaiting_confirmation ?? 0) > 0) {
    attention.push({
      path: "/app/divisao-do-role",
      label: "Pagamentos a confirmar",
      desc: `${split!.awaiting_confirmation} participante${split!.awaiting_confirmation > 1 ? "s" : ""} informou pagamento`,
      icon: Users,
    });
  }
  if (uncategorized > 0) {
    attention.push({
      path: "/app/lancamentos",
      label: "Lançamentos sem categoria",
      desc: `${uncategorized} no mês — classificar melhora as leituras`,
      icon: Tags,
    });
  }

  return (
    <div className="space-y-6 pt-2 pb-8">
      <header>
        <h1 className="font-display text-2xl font-bold tracking-tight">{copy.more.title}</h1>
        <p className="text-xs text-muted-foreground mt-0.5">{copy.more.subtitle}</p>
      </header>

      {isLoading && (
        <div className="grid place-items-center py-3">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      )}

      <section>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Prioridade agora</p>
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => navigate("/app/divisao-do-role")}
            className="rounded-2xl border border-border bg-gradient-to-br from-card to-secondary/30 p-4 text-left shadow-card transition-colors hover:border-primary/40"
          >
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary/10 text-primary">
              <Users size={18} />
            </span>
            <p className="mt-3 text-sm font-semibold">Divisão do Rolê</p>
            <p className="text-[11px] text-muted-foreground">
              {split && split.open_count > 0
                ? `${split.open_count} em aberto · ${brl(Number(split.amount_to_receive ?? 0))} a receber`
                : "Divida contas com quem foi junto"}
            </p>
          </button>

          <button
            onClick={() => navigate("/app/relatorios?tab=fechamentos")}
            className="rounded-2xl border border-border bg-gradient-to-br from-card to-secondary/30 p-4 text-left shadow-card transition-colors hover:border-primary/40"
          >
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary/10 text-primary">
              <BarChart3 size={18} />
            </span>
            <p className="mt-3 text-sm font-semibold">Relatórios</p>
            <p className="text-[11px] text-muted-foreground">
              {reports?.last_period_label
                ? `Último fechamento ${reports.last_period_label}${(reports.unread ?? 0) > 0 ? ` · ${reports.unread} não lido` : ""}`
                : "Período atual e fechamentos"}
            </p>
          </button>

          <button
            onClick={() => navigate("/app/nino")}
            className="col-span-2 rounded-2xl border border-border bg-gradient-to-br from-card to-secondary/30 p-4 text-left shadow-card transition-colors hover:border-primary/40"
          >
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary/10 text-primary">
              <Sparkles size={18} />
            </span>
            <p className="mt-3 text-sm font-semibold">Nino</p>
            <p className="text-[11px] text-muted-foreground">
              {nino && nino.new_since_last_visit > 0
                ? `${nino.new_since_last_visit} novidade${nino.new_since_last_visit > 1 ? "s" : ""} desde sua última visita`
                : nino && nino.attention_items > 0
                  ? `${nino.attention_items} ponto${nino.attention_items > 1 ? "s" : ""} de atenção`
                  : "Agora, mudanças, aprendizados e o que vem aí"}
            </p>
          </button>
        </div>
      </section>

      {attention.length > 0 && <MoreGroup title="Precisa de você" items={attention} onGo={navigate} />}

      <MoreGroup title={copy.more.sections.organize} items={organize} onGo={navigate} />
      <MoreGroup title={copy.more.sections.understand} items={understand} onGo={navigate} />
      <MoreGroup title={copy.more.sections.account} items={account} onGo={navigate} />

      <section>
        <button
          type="button"
          onClick={signOut}
          className="flex w-full items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3 text-left shadow-card active:bg-secondary/50"
        >
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-secondary text-primary">
            <LogOut size={15} />
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium">Sair</p>
            <p className="text-[11px] text-muted-foreground">Encerrar sessão neste dispositivo</p>
          </div>
          <ChevronRight size={14} className="text-muted-foreground" />
        </button>
      </section>
    </div>
  );
}

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
      <div className="rounded-2xl border border-border bg-card shadow-card overflow-hidden divide-y divide-border">
        {items.map((it) => {
          const Icon = it.icon;
          return (
            <button
              key={it.path + it.label}
              onClick={() => onGo(it.path)}
              className="w-full flex items-center gap-3 px-4 py-3 text-left active:bg-secondary/50"
            >
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-secondary text-primary">
                <Icon size={15} />
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">{it.label}</p>
                <p className="text-[11px] text-muted-foreground">{it.desc}</p>
              </div>
              <ChevronRight size={14} className="text-muted-foreground" />
            </button>
          );
        })}
      </div>
    </section>
  );
}
