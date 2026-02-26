import { useFinancial, useIndicadores } from '@/context/FinancialContext';
import { gastosPorCategoria, gastosPorEmocao } from '@/lib/engine';
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, LineChart, Line } from 'recharts';
import { CATEGORIAS_GASTO } from '@/types/financial';

export default function Relatorios() {
  const { state } = useFinancial();
  const ind = useIndicadores();

  const porCategoria = gastosPorCategoria(state);
  const porEmocao = gastosPorEmocao(state);

  const getCatLabel = (val: string) => CATEGORIAS_GASTO.find(c => c.value === val)?.label || val;
  const categoriasFormatadas = porCategoria.map(c => ({ ...c, name: getCatLabel(c.name) }));

  const insights: string[] = [];
  if (ind.indiceImpulsividade > 20) insights.push(`${ind.indiceImpulsividade}% dos seus gastos são impulsivos. Tente a regra das 24h.`);
  if (ind.rendaComprometida > 70) insights.push(`Renda ${ind.rendaComprometida}% comprometida. Revise gastos fixos.`);
  if (ind.taxaPoupanca > 20) insights.push(`Taxa de poupança de ${ind.taxaPoupanca}%. Excelente disciplina!`);
  if (ind.taxaPoupanca < 10 && ind.taxaPoupanca >= 0) insights.push(`Taxa de poupança baixa (${ind.taxaPoupanca}%). Considere cortar gastos variáveis.`);

  return (
    <div className="space-y-5 pt-2">
      <h1 className="text-xl font-bold text-foreground">Relatórios</h1>

      {/* KPIs */}
      <div className="grid grid-cols-3 gap-2">
        <div className="ios-card p-3">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Poupança</p>
          <p className="text-sm font-bold text-foreground mt-0.5">{ind.taxaPoupanca}%</p>
        </div>
        <div className="ios-card p-3">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Impulsividade</p>
          <p className="text-sm font-bold text-foreground mt-0.5">{ind.indiceImpulsividade}%</p>
        </div>
        <div className="ios-card p-3">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Comprometida</p>
          <p className="text-sm font-bold text-foreground mt-0.5">{ind.rendaComprometida}%</p>
        </div>
      </div>

      {/* Gastos por categoria */}
      <div className="ios-card p-4">
        <h3 className="text-xs text-muted-foreground font-medium mb-3">Gastos por categoria</h3>
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={categoriasFormatadas} layout="vertical">
            <XAxis type="number" hide />
            <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: 'hsl(0,0%,46%)' }} axisLine={false} tickLine={false} width={80} />
            <Tooltip
              contentStyle={{ background: 'hsl(0,0%,100%)', border: 'none', borderRadius: '10px', fontSize: '10px', boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}
              formatter={(v: number) => [`R$ ${v.toLocaleString('pt-BR')}`, '']}
            />
            <Bar dataKey="value" fill="hsl(220,14%,20%)" radius={[0, 4, 4, 0]} barSize={14} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Gastos por emoção */}
      {porEmocao.length > 0 && (
        <div className="ios-card p-4">
          <h3 className="text-xs text-muted-foreground font-medium mb-3">Gastos por emoção</h3>
          <ResponsiveContainer width="100%" height={140}>
            <BarChart data={porEmocao} layout="vertical">
              <XAxis type="number" hide />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: 'hsl(0,0%,46%)' }} axisLine={false} tickLine={false} width={80} />
              <Tooltip
                contentStyle={{ background: 'hsl(0,0%,100%)', border: 'none', borderRadius: '10px', fontSize: '10px', boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}
                formatter={(v: number) => [`R$ ${v.toLocaleString('pt-BR')}`, '']}
              />
              <Bar dataKey="value" fill="hsl(38,92%,50%)" radius={[0, 4, 4, 0]} barSize={14} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Projeção patrimonial */}
      <div className="ios-card p-4">
        <h3 className="text-xs text-muted-foreground font-medium mb-3">Projeção patrimonial (12 meses)</h3>
        <ResponsiveContainer width="100%" height={140}>
          <LineChart data={ind.projecao12.map((v, i) => ({ mes: `M${i + 1}`, valor: v }))}>
            <XAxis dataKey="mes" tick={{ fontSize: 9, fill: 'hsl(0,0%,46%)' }} axisLine={false} tickLine={false} interval={1} />
            <YAxis hide />
            <Tooltip
              contentStyle={{ background: 'hsl(0,0%,100%)', border: 'none', borderRadius: '10px', fontSize: '10px', boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}
              formatter={(v: number) => [`R$ ${v.toLocaleString('pt-BR')}`, '']}
            />
            <Line type="monotone" dataKey="valor" stroke="hsl(220,14%,20%)" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Insights */}
      {insights.length > 0 && (
        <div className="ios-card p-4">
          <h3 className="text-xs text-muted-foreground font-medium mb-3">Insights automáticos</h3>
          <div className="space-y-2">
            {insights.map((ins, i) => (
              <p key={i} className="text-xs text-foreground leading-relaxed">{ins}</p>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
