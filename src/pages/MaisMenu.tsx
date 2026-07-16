import { useNavigate } from 'react-router-dom';
import { CreditCard, Heart, User, ChevronRight, PiggyBank, LogOut, Wallet, Tag, MessageCircle, Upload, Users, Repeat, Trophy, BarChart3, Bell } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';

export default function MaisMenu() {
  const navigate = useNavigate();
  const { signOut } = useAuth();

  const items = [
    { path: '/app/divisao-do-role', label: 'Divisão do Rolê', desc: 'Divida contas com amigos', icon: Users, bg: 'bg-primary/10', iconColor: 'text-primary' },
    { path: '/app/recorrencias', label: 'Recorrências', desc: 'Receitas e despesas fixas', icon: Repeat, bg: 'bg-accent/10', iconColor: 'text-accent' },
    { path: '/app/desafios', label: 'Desafios', desc: 'Hábitos e conquistas', icon: Trophy, bg: 'bg-brand-coral/15', iconColor: 'text-brand-coral' },
    { path: '/app/relatorios', label: 'Relatórios', desc: 'Análises factuais', icon: BarChart3, bg: 'bg-primary/10', iconColor: 'text-primary' },
    { path: '/app/notificacoes', label: 'Notificações', desc: 'Central do app', icon: Bell, bg: 'bg-secondary', iconColor: 'text-foreground' },
    { path: '/app/whatsapp', label: 'WhatsApp', desc: 'Vincular seu número', icon: MessageCircle, bg: 'bg-success/10', iconColor: 'text-success' },
    { path: '/app/contas', label: 'Contas', desc: 'Suas carteiras', icon: Wallet, bg: 'bg-primary/10', iconColor: 'text-primary' },
    { path: '/app/categorias', label: 'Categorias', desc: 'Padrões e pessoais', icon: Tag, bg: 'bg-accent/10', iconColor: 'text-accent' },
    { path: '/app/investimentos', label: 'Investimentos', desc: 'Carteira agregada', icon: PiggyBank, bg: 'bg-accent/10', iconColor: 'text-accent' },
    { path: '/app/dividas', label: 'Dívidas', desc: 'Passivos', icon: CreditCard, bg: 'bg-destructive/10', iconColor: 'text-destructive' },
    { path: '/app/emocoes', label: 'Emocional', desc: 'Check-in do dia', icon: Heart, bg: 'bg-brand-coral/15', iconColor: 'text-brand-coral' },
    { path: '/app/importar', label: 'Importar dados', desc: 'Legado, CSV e OFX', icon: Upload, bg: 'bg-muted', iconColor: 'text-muted-foreground' },
    { path: '/app/perfil', label: 'Perfil', desc: 'Conta e configurações', icon: User, bg: 'bg-success/10', iconColor: 'text-success' },
  ];

  return (
    <div className="space-y-5 pt-2">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">Mais</h1>
        <p className="text-xs text-muted-foreground mt-0.5">Módulos e configurações</p>
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
        onClick={() => signOut().then(() => navigate('/'))}
        className="w-full surface-card flex items-center gap-3 px-4 py-3.5 text-left active:bg-secondary/50 transition-colors"
      >
        <div className="w-10 h-10 rounded-xl bg-secondary flex items-center justify-center">
          <LogOut size={16} className="text-muted-foreground" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-medium text-foreground">Sair</p>
          <p className="text-[11px] text-muted-foreground">Encerrar sessão</p>
        </div>
        <ChevronRight size={14} className="text-muted-foreground" />
      </button>
    </div>
  );
}
