import { useNavigate } from 'react-router-dom';
import { CreditCard, Heart, BarChart3, User, ChevronRight } from 'lucide-react';

const items = [
  { path: '/dividas', label: 'Dívidas', desc: 'Gestão de passivos', icon: CreditCard },
  { path: '/emocoes', label: 'Emocional', desc: 'Comportamento financeiro', icon: Heart },
  { path: '/relatorios', label: 'Relatórios', desc: 'Análises e insights', icon: BarChart3 },
  { path: '/perfil', label: 'Perfil', desc: 'Configurações', icon: User },
];

export default function MaisMenu() {
  const navigate = useNavigate();

  return (
    <div className="space-y-4 pt-2">
      <h1 className="text-xl font-bold text-foreground">Mais</h1>

      <div className="ios-card divide-y divide-border overflow-hidden">
        {items.map(item => {
          const Icon = item.icon;
          return (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              className="w-full flex items-center gap-3 px-4 py-3.5 text-left active:bg-secondary/50 transition-colors"
            >
              <div className="w-9 h-9 rounded-xl bg-secondary flex items-center justify-center">
                <Icon size={16} className="text-foreground" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-foreground">{item.label}</p>
                <p className="text-[10px] text-muted-foreground">{item.desc}</p>
              </div>
              <ChevronRight size={14} className="text-muted-foreground" />
            </button>
          );
        })}
      </div>
    </div>
  );
}
