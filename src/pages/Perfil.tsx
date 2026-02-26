import { mockDividas, mockInvestimentos, mockContasFixas, calcularPatrimonioLiquido } from '@/data/mockData';
import { User, CreditCard, TrendingUp, Building, ChevronRight } from 'lucide-react';

export default function Perfil() {
  const patrimonio = calcularPatrimonioLiquido();
  const totalDividas = mockDividas.reduce((s, d) => s + d.valor_atual, 0);
  const totalInvestimentos = mockInvestimentos.reduce((s, i) => s + i.valor_atual, 0);

  const sections = [
    {
      title: 'Investimentos',
      icon: TrendingUp,
      items: mockInvestimentos.map((i) => ({
        label: i.tipo,
        value: `R$ ${i.valor_atual.toLocaleString('pt-BR')}`,
        sub: `${i.rendimento_estimado}% a.a.`,
      })),
    },
    {
      title: 'Dívidas',
      icon: CreditCard,
      items: mockDividas.map((d) => ({
        label: d.tipo,
        value: `R$ ${d.valor_atual.toLocaleString('pt-BR')}`,
        sub: `${d.parcelas_restantes} parcelas · ${d.taxa_juros}% a.m.`,
      })),
    },
    {
      title: 'Contas Fixas',
      icon: Building,
      items: mockContasFixas.map((c) => ({
        label: c.nome,
        value: `R$ ${c.valor.toLocaleString('pt-BR')}`,
        sub: `Dia ${c.vencimento}`,
      })),
    },
  ];

  return (
    <div className="space-y-5 pt-2">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-full bg-secondary flex items-center justify-center">
          <User size={20} className="text-muted-foreground" />
        </div>
        <div>
          <h1 className="text-lg font-bold text-foreground">Perfil</h1>
          <p className="text-xs text-muted-foreground">Patrimônio: R$ {patrimonio.toLocaleString('pt-BR')}</p>
        </div>
      </div>

      {/* Quick stats */}
      <div className="grid grid-cols-2 gap-3">
        <div className="ios-card p-3">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Investimentos</p>
          <p className="text-sm font-bold text-foreground mt-0.5">R$ {totalInvestimentos.toLocaleString('pt-BR')}</p>
        </div>
        <div className="ios-card p-3">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Dívidas</p>
          <p className="text-sm font-bold text-foreground mt-0.5">R$ {totalDividas.toLocaleString('pt-BR')}</p>
        </div>
      </div>

      {/* Sections */}
      {sections.map((section) => {
        const Icon = section.icon;
        return (
          <div key={section.title} className="ios-card overflow-hidden">
            <div className="flex items-center gap-2 px-4 pt-4 pb-2">
              <Icon size={14} className="text-muted-foreground" />
              <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{section.title}</h3>
            </div>
            <div className="divide-y divide-border">
              {section.items.map((item) => (
                <div key={item.label} className="flex items-center justify-between px-4 py-3">
                  <div>
                    <p className="text-xs font-medium text-foreground">{item.label}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">{item.sub}</p>
                  </div>
                  <span className="text-xs font-semibold text-foreground">{item.value}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })}

      {/* Settings links */}
      <div className="ios-card divide-y divide-border overflow-hidden">
        {['Configurações', 'Exportar dados', 'Sobre'].map((item) => (
          <button key={item} className="w-full flex items-center justify-between px-4 py-3 text-left active:bg-secondary/50 transition-colors">
            <span className="text-xs font-medium text-foreground">{item}</span>
            <ChevronRight size={14} className="text-muted-foreground" />
          </button>
        ))}
      </div>
    </div>
  );
}
