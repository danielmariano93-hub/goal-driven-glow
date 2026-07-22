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
} from "lucide-react";
import { copy } from "@/lib/copy/strings";
import { useAuth } from "@/context/AuthContext";

type Item = { path: string; label: string; desc: string; icon: any };

const highlight: Item[] = [
  { path: "/app/divisao-do-role", label: "Divisão do Rolê", desc: "Divida contas com quem foi junto", icon: Users },
  { path: "/app/desafios", label: "Desafios", desc: "Metas de hábito com conquistas", icon: Trophy },
];

const organize: Item[] = [
  { path: "/app/contas", label: "Contas", desc: "Suas carteiras", icon: Wallet },
  { path: "/app/cartoes", label: "Cartões", desc: "Faturas, limites e parcelas", icon: CreditCard },
  { path: "/app/recorrencias", label: copy.recurring.title, desc: "Fixos que se repetem", icon: Repeat },
  { path: "/app/categorias", label: "Categorias", desc: "Padrões e pessoais", icon: Tag },
  { path: "/app/investimentos", label: "Investimentos", desc: "Carteira agregada", icon: PiggyBank },
  { path: "/app/dividas", label: "Dívidas", desc: "O que você deve", icon: CreditCard },
];

const understand: Item[] = [
  { path: "/app/relatorios", label: "Relatórios", desc: "Padrões do seu dinheiro", icon: BarChart3 },
  { path: "/app/emocoes", label: "Emocional", desc: "Como você se sente ao gastar", icon: Heart },
];

const account: Item[] = [
  { path: "/app/perfil", label: "Perfil", desc: "Conta, conexões e privacidade", icon: User },
  { path: "/app/importar", label: "Importar dados", desc: "CSV, OFX e legado", icon: Upload },
];

export default function MaisMenu() {
  const navigate = useNavigate();
  const { signOut } = useAuth();

  return (
    <div className="space-y-6 pt-2 pb-8">
      <header>
        <h1 className="font-display text-2xl font-bold tracking-tight">{copy.more.title}</h1>
        <p className="text-xs text-muted-foreground mt-0.5">{copy.more.subtitle}</p>
      </header>

      <section>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {copy.more.sections.highlight}
        </p>
        <div className="grid grid-cols-2 gap-3">
          {highlight.map((it) => {
            const Icon = it.icon;
            return (
              <button
                key={it.path}
                onClick={() => navigate(it.path)}
                className="rounded-2xl border border-border bg-gradient-to-br from-card to-secondary/30 p-4 text-left shadow-card transition-colors hover:border-primary/40"
              >
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary/10 text-primary">
                  <Icon size={18} />
                </span>
                <p className="mt-3 text-sm font-semibold">{it.label}</p>
                <p className="text-[11px] text-muted-foreground">{it.desc}</p>
              </button>
            );
          })}
        </div>
      </section>

      <MoreGroup title={copy.more.sections.organize} items={organize} onGo={navigate} />
      <MoreGroup title={copy.more.sections.understand} items={understand} onGo={navigate} />
      <MoreGroup title={copy.more.sections.account} items={account} onGo={navigate} />
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
              key={it.path}
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
