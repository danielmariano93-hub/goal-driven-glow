import { mockInvestimentos } from '@/data/mockData';

export default function Investimentos() {
  const total = mockInvestimentos.reduce((s, i) => s + i.valor_atual, 0);
  const totalAplicado = mockInvestimentos.reduce((s, i) => s + i.valor_aplicado, 0);
  const rendimento = total - totalAplicado;

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <h1 className="text-xl font-semibold text-foreground">Investimentos</h1>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="apple-card">
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Total Aplicado</p>
          <p className="text-xl font-bold text-foreground mt-1">R$ {totalAplicado.toLocaleString('pt-BR')}</p>
        </div>
        <div className="apple-card">
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Valor Atual</p>
          <p className="text-xl font-bold text-foreground mt-1">R$ {total.toLocaleString('pt-BR')}</p>
        </div>
        <div className="apple-card">
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Rendimento</p>
          <p className="text-xl font-bold text-success mt-1">+R$ {rendimento.toLocaleString('pt-BR')}</p>
        </div>
      </div>

      <div className="space-y-3">
        {mockInvestimentos.map((inv) => {
          const rend = inv.valor_atual - inv.valor_aplicado;
          const rendPerc = ((rend / inv.valor_aplicado) * 100).toFixed(1);
          const liquidezLabel = { imediata: 'Imediata', curto_prazo: 'Curto prazo', longo_prazo: 'Longo prazo' };
          return (
            <div key={inv.id} className="apple-card">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-foreground">{inv.tipo}</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">Liquidez {liquidezLabel[inv.liquidez]} · {inv.rendimento_estimado}% a.a.</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold text-foreground">R$ {inv.valor_atual.toLocaleString('pt-BR')}</p>
                  <p className="text-xs text-success">+{rendPerc}%</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
