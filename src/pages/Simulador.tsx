import { useState } from 'react';
import { mockDividas, mockMetas, calcularGastoTotal, calcularRendaTotal } from '@/data/mockData';

export default function Simulador() {
  const renda = calcularRendaTotal();
  const gastoAtual = calcularGastoTotal();
  const [corteGastos, setCorteGastos] = useState(0);
  const [aumentoAporte, setAumentoAporte] = useState(0);

  const novoGasto = gastoAtual * (1 - corteGastos / 100);
  const novoSaldo = renda - novoGasto + aumentoAporte;
  const saldoAtual = renda - gastoAtual;

  const metaPrincipal = mockMetas.find((m) => m.prioridade === 'alta');
  const restanteMeta = metaPrincipal ? metaPrincipal.valor_objetivo - metaPrincipal.valor_atual : 0;
  const mesesComCorte = novoSaldo > 0 && restanteMeta > 0 ? Math.ceil(restanteMeta / novoSaldo) : null;
  const mesesSemCorte = saldoAtual > 0 && restanteMeta > 0 ? Math.ceil(restanteMeta / saldoAtual) : null;

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <h1 className="text-xl font-semibold text-foreground">Simulador</h1>

      <div className="apple-card space-y-5">
        <div className="space-y-2">
          <label className="text-xs text-muted-foreground font-medium">Corte de gastos: {corteGastos}%</label>
          <input type="range" min={0} max={50} value={corteGastos} onChange={(e) => setCorteGastos(+e.target.value)}
            className="w-full accent-foreground" />
        </div>
        <div className="space-y-2">
          <label className="text-xs text-muted-foreground font-medium">Aumento de aporte: R$ {aumentoAporte}</label>
          <input type="range" min={0} max={3000} step={100} value={aumentoAporte} onChange={(e) => setAumentoAporte(+e.target.value)}
            className="w-full accent-foreground" />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="apple-card">
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Saldo Atual/Mês</p>
          <p className="text-xl font-bold text-foreground mt-1">R$ {saldoAtual.toLocaleString('pt-BR')}</p>
        </div>
        <div className="apple-card">
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Saldo Simulado/Mês</p>
          <p className={`text-xl font-bold mt-1 ${novoSaldo > saldoAtual ? 'text-success' : 'text-foreground'}`}>
            R$ {Math.round(novoSaldo).toLocaleString('pt-BR')}
          </p>
        </div>
      </div>

      {metaPrincipal && (
        <div className="apple-card">
          <h3 className="text-sm font-medium text-foreground mb-2">Impacto na meta: {metaPrincipal.nome}</h3>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-xs text-muted-foreground">Sem alteração</p>
              <p className="font-semibold text-foreground">{mesesSemCorte ? `${mesesSemCorte} meses` : '—'}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Com simulação</p>
              <p className={`font-semibold ${mesesComCorte && mesesSemCorte && mesesComCorte < mesesSemCorte ? 'text-success' : 'text-foreground'}`}>
                {mesesComCorte ? `${mesesComCorte} meses` : '—'}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
