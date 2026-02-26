import { useState, useMemo } from 'react';
import { useFinancial, useIndicadores } from '@/context/FinancialContext';
import { simularGasto, type GastoSimulado, type ResultadoSimulacao } from '@/lib/engine';
import { CATEGORIAS_GASTO, EMOCOES } from '@/types/financial';
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip, Legend } from 'recharts';
import { toast } from 'sonner';
import { ShoppingCart, TrendingDown, Target, Brain, ArrowRight, Check, X } from 'lucide-react';

export default function Planejamento() {
  const { state, dispatch } = useFinancial();
  const ind = useIndicadores();

  // Form state
  const [valor, setValor] = useState('');
  const [categoria, setCategoria] = useState('');
  const [parcelado, setParcelado] = useState(false);
  const [parcelas, setParcelas] = useState(2);
  const [emocao, setEmocao] = useState('');
  const [resultado, setResultado] = useState<ResultadoSimulacao | null>(null);

  const handleAnalisar = () => {
    const v = parseFloat(valor);
    if (!v || v <= 0 || !categoria) {
      toast.error('Preencha o valor e a categoria.');
      return;
    }
    const gasto: GastoSimulado = {
      valor: v,
      categoria,
      parcelado,
      parcelas: parcelado ? parcelas : 1,
      emocao: emocao || undefined,
    };
    setResultado(simularGasto(state, gasto));
  };

  const handleConfirmar = () => {
    const v = parseFloat(valor);
    const hoje = new Date().toISOString().slice(0, 10);
    const emocoesImpulsivas = ['ansioso', 'triste', 'frustrado', 'estressado', 'entediado'];
    const isImpulsivo = emocao ? emocoesImpulsivas.includes(emocao) : false;
    const numParcelas = parcelado ? parcelas : 1;
    const valorParcela = Math.round((v / numParcelas) * 100) / 100;

    for (let i = 0; i < numParcelas; i++) {
      const data = new Date();
      data.setMonth(data.getMonth() + i);
      const dataStr = data.toISOString().slice(0, 10);
      dispatch({
        type: 'ADD_LANCAMENTO',
        payload: {
          id: crypto.randomUUID(),
          data: dataStr,
          tipo: 'despesa',
          categoria,
          descricao: numParcelas > 1 ? `Simulação confirmada (${i + 1}/${numParcelas})` : 'Simulação confirmada',
          valor: valorParcela,
          fixo: false,
          recorrente: false,
          impulsivo: isImpulsivo,
          emocao: emocao || undefined,
        },
      });
    }
    toast.success('Despesa lançada com sucesso!');
    handleCancelar();
  };

  const handleCancelar = () => {
    setResultado(null);
    setValor('');
    setCategoria('');
    setParcelado(false);
    setParcelas(2);
    setEmocao('');
  };

  const chartData = useMemo(() => {
    if (!resultado) return [];
    return resultado.projecaoSem.map((v, i) => ({
      mes: `Mês ${i + 1}`,
      sem: v,
      com: resultado.projecaoCom[i],
    }));
  }, [resultado]);

  if (resultado) {
    return (
      <div className="space-y-4 pt-2 pb-4">
        <h1 className="text-xl font-bold text-foreground">Resultado da Simulação</h1>

        {/* Bloco 1: Impacto Imediato */}
        <div className="ios-card p-4">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
              <ShoppingCart className="w-4 h-4 text-primary" />
            </div>
            <h3 className="text-sm font-semibold text-foreground">Impacto Imediato</h3>
          </div>
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-xs text-muted-foreground">Saldo do mês</span>
              <div className="flex items-center gap-2 text-sm font-semibold">
                <span className="text-foreground">R$ {resultado.saldoAtual.toLocaleString('pt-BR')}</span>
                <ArrowRight className="w-3 h-3 text-muted-foreground" />
                <span className={resultado.saldoComGasto < 0 ? 'text-destructive' : 'text-success'}>
                  R$ {resultado.saldoComGasto.toLocaleString('pt-BR')}
                </span>
              </div>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-xs text-muted-foreground">Taxa de poupança</span>
              <div className="flex items-center gap-2 text-sm font-semibold">
                <span className="text-foreground">{resultado.taxaPoupancaAtual}%</span>
                <ArrowRight className="w-3 h-3 text-muted-foreground" />
                <span className={resultado.taxaPoupancaComGasto < resultado.taxaPoupancaAtual ? 'text-destructive' : 'text-success'}>
                  {resultado.taxaPoupancaComGasto}%
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Bloco 2: Impacto Estratégico */}
        <div className="ios-card p-4">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-8 h-8 rounded-full bg-warning/10 flex items-center justify-center">
              <TrendingDown className="w-4 h-4 text-warning" />
            </div>
            <h3 className="text-sm font-semibold text-foreground">Impacto Estratégico (12 meses)</h3>
          </div>
          <div className="space-y-3 mb-4">
            <div className="flex justify-between items-center">
              <span className="text-xs text-muted-foreground">Patrimônio projetado</span>
              <div className="flex items-center gap-2 text-sm font-semibold">
                <span className="text-foreground">R$ {resultado.patrimonioAtual12m.toLocaleString('pt-BR')}</span>
                <ArrowRight className="w-3 h-3 text-muted-foreground" />
                <span className="text-destructive">R$ {resultado.patrimonioComGasto12m.toLocaleString('pt-BR')}</span>
              </div>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-xs text-muted-foreground">Score financeiro</span>
              <div className="flex items-center gap-2 text-sm font-semibold">
                <span className="text-foreground">{resultado.scoreAtual}</span>
                <ArrowRight className="w-3 h-3 text-muted-foreground" />
                <span className={resultado.scoreComGasto < resultado.scoreAtual ? 'text-destructive' : 'text-foreground'}>
                  {resultado.scoreComGasto}
                </span>
              </div>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={160}>
            <LineChart data={chartData}>
              <XAxis dataKey="mes" tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} interval={2} />
              <YAxis hide />
              <Tooltip
                contentStyle={{ background: 'hsl(var(--background))', border: 'none', borderRadius: '10px', fontSize: '10px', boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}
                formatter={(v: number) => [`R$ ${v.toLocaleString('pt-BR')}`, '']}
              />
              <Line type="monotone" dataKey="sem" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} name="Sem gasto" />
              <Line type="monotone" dataKey="com" stroke="hsl(var(--destructive))" strokeWidth={2} dot={false} name="Com gasto" strokeDasharray="5 5" />
              <Legend iconSize={8} wrapperStyle={{ fontSize: '10px' }} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Bloco 3: Impacto nas Metas */}
        {resultado.metas.length > 0 && (
          <div className="ios-card p-4">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                <Target className="w-4 h-4 text-primary" />
              </div>
              <h3 className="text-sm font-semibold text-foreground">Impacto nas Metas</h3>
            </div>
            <div className="space-y-3">
              {resultado.metas.map((m, i) => (
                <div key={i} className="flex justify-between items-center">
                  <span className="text-xs text-muted-foreground truncate max-w-[40%]">{m.nome}</span>
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <span className="text-foreground">{m.tempoAtual ? `${m.tempoAtual}m` : '—'}</span>
                    <ArrowRight className="w-3 h-3 text-muted-foreground" />
                    <span className={m.atraso > 0 ? 'text-destructive' : 'text-foreground'}>
                      {m.tempoComGasto ? `${m.tempoComGasto}m` : '—'}
                    </span>
                    {m.atraso > 0 && (
                      <span className="text-[10px] text-destructive">+{m.atraso}m</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Bloco 4: Feedback Comportamental */}
        <div className="ios-card p-4">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-8 h-8 rounded-full bg-accent/50 flex items-center justify-center">
              <Brain className="w-4 h-4 text-primary" />
            </div>
            <h3 className="text-sm font-semibold text-foreground">Feedback Comportamental</h3>
          </div>
          <div className="space-y-2">
            {resultado.feedback.split('\n').map((line, i) => (
              <p key={i} className="text-xs text-foreground leading-relaxed">{line}</p>
            ))}
          </div>
        </div>

        {/* Botões de ação */}
        <div className="flex gap-3">
          <button
            onClick={handleCancelar}
            className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl border border-border text-sm font-medium text-foreground"
          >
            <X className="w-4 h-4" /> Cancelar
          </button>
          <button
            onClick={handleConfirmar}
            className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-primary text-primary-foreground text-sm font-medium"
          >
            <Check className="w-4 h-4" /> Confirmar despesa
          </button>
        </div>
      </div>
    );
  }

  // Formulário
  return (
    <div className="space-y-5 pt-2">
      <h1 className="text-xl font-bold text-foreground">Simulador de Decisão</h1>
      <p className="text-xs text-muted-foreground -mt-3">Simule uma compra e veja o impacto antes de decidir.</p>

      <div className="ios-card p-4 space-y-4">
        {/* Valor */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-foreground">Valor do gasto (R$)</label>
          <input
            type="number"
            inputMode="decimal"
            placeholder="0,00"
            value={valor}
            onChange={e => setValor(e.target.value)}
            className="w-full h-11 rounded-xl border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>

        {/* Categoria */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-foreground">Categoria</label>
          <select
            value={categoria}
            onChange={e => setCategoria(e.target.value)}
            className="w-full h-11 rounded-xl border border-border bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
          >
            <option value="">Selecione...</option>
            {CATEGORIAS_GASTO.map(c => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        </div>

        {/* Parcelado */}
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-foreground">Parcelado?</span>
          <button
            onClick={() => setParcelado(!parcelado)}
            className={`w-12 h-7 rounded-full transition-colors ${parcelado ? 'bg-primary' : 'bg-secondary'}`}
          >
            <div className={`w-5 h-5 rounded-full bg-white shadow-md transform transition-transform mx-1 ${parcelado ? 'translate-x-5' : 'translate-x-0'}`} />
          </button>
        </div>

        {/* Parcelas */}
        {parcelado && (
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">Número de parcelas</label>
            <input
              type="number"
              inputMode="numeric"
              min={2}
              max={48}
              value={parcelas}
              onChange={e => setParcelas(Math.max(2, parseInt(e.target.value) || 2))}
              className="w-full h-11 rounded-xl border border-border bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
        )}

        {/* Emoção */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-foreground">Emoção associada <span className="text-muted-foreground">(opcional)</span></label>
          <select
            value={emocao}
            onChange={e => setEmocao(e.target.value)}
            className="w-full h-11 rounded-xl border border-border bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
          >
            <option value="">Nenhuma</option>
            {EMOCOES.map(e => (
              <option key={e.value} value={e.value}>{e.label}</option>
            ))}
          </select>
        </div>
      </div>

      <button
        onClick={handleAnalisar}
        className="w-full py-3.5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold"
      >
        Analisar Impacto
      </button>
    </div>
  );
}
