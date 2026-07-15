import { useNavigate } from 'react-router-dom';
import { CreditCard, Heart, BarChart3, User, ChevronRight, PiggyBank, LogOut } from 'lucide-react';

const items = [
  { path: '/app/investimentos', label: 'Investimentos', desc: 'Carteira e rendimentos', icon: PiggyBank, bg: 'bg-accent/10', iconColor: 'text-accent' },
  { path: '/app/dividas', label: 'Dívidas', desc: 'Gestão de passivos', icon: CreditCard, bg: 'bg-destructive/10', iconColor: 'text-destructive' },
  { path: '/app/emocoes', label: 'Emocional', desc: 'Comportamento financeiro', icon: Heart, bg: 'bg-brand-coral/15', iconColor: 'text-brand-coral' },
  { path: '/app/relatorios', label: 'Relatórios', desc: 'Análises e insights', icon: BarChart3, bg: 'bg-primary/10', iconColor: 'text-primary' },
  { path: '/app/perfil', label: 'Perfil', desc: 'Conta e configurações', icon: User, bg: 'bg-success/10', iconColor: 'text-success' },
];

export default function MaisMenu() {
  const navigate = useNavigate();

  return (
    <div className="space-y-5 pt-2">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">Mais</h1>
        <p className="text-xs text-muted-foreground mt-0.5">Módulos avançados e configurações</p>
      </div>

      <div className="surface-card divide-y divide-border overflow-hidden">
        {items.map(item => {
          const Icon = item.icon;
          return (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              className="w-full flex items-center gap-3 px-4 py-3.5 text-left active:bg-secondary/50 transition-colors"
            >
              <div className={`w-10 h-10 rounded-xl ${item.bg} flex items-center justify-center`}>
                <Icon size={16} className={item.iconColor} />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-foreground">{item.label}</p>
                <p className="text-[11px] text-muted-foreground">{item.desc}</p>
              </div>
              <ChevronRight size={14} className="text-muted-foreground" />
            </button>
          );
        })}
      </div>

      <button
        onClick={() => navigate('/')}
        className="w-full surface-card flex items-center gap-3 px-4 py-3.5 text-left active:bg-secondary/50 transition-colors"
      >
        <div className="w-10 h-10 rounded-xl bg-secondary flex items-center justify-center">
          <LogOut size={16} className="text-muted-foreground" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-medium text-foreground">Sair</p>
          <p className="text-[11px] text-muted-foreground">Voltar para a página inicial</p>
        </div>
        <ChevronRight size={14} className="text-muted-foreground" />
      </button>
    </div>
  );
}
