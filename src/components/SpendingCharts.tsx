import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { getGastosPorCategoria, getGastosPorDia } from '@/data/mockData';
import { CATEGORIAS_GASTO } from '@/types/financial';
import { motion } from 'framer-motion';

const COLORS = [
  'hsl(215, 60%, 50%)',
  'hsl(145, 60%, 42%)',
  'hsl(35, 90%, 55%)',
  'hsl(0, 65%, 55%)',
  'hsl(270, 50%, 55%)',
  'hsl(180, 50%, 45%)',
  'hsl(320, 50%, 50%)',
  'hsl(50, 70%, 50%)',
];

export function SpendingBarChart() {
  const data = getGastosPorDia();

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="apple-card">
      <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-4">
        Gastos por Dia
      </h3>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
          <XAxis dataKey="dia" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} />
          <YAxis tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} />
          <Tooltip
            contentStyle={{
              background: 'hsl(var(--card))',
              border: '1px solid hsl(var(--border))',
              borderRadius: '12px',
              fontSize: '12px',
              boxShadow: 'var(--shadow-card)',
            }}
            formatter={(value: number) => [`R$ ${value}`, 'Valor']}
          />
          <Bar dataKey="valor" fill="hsl(var(--primary))" radius={[6, 6, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </motion.div>
  );
}

export function SpendingPieChart() {
  const data = getGastosPorCategoria().map((item) => {
    const cat = CATEGORIAS_GASTO.find((c) => c.value === item.name);
    return { ...item, label: cat?.label || item.name, icon: cat?.icon || '📦' };
  });

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="apple-card">
      <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-4">
        Gastos por Categoria
      </h3>
      <div className="flex items-center gap-4">
        <ResponsiveContainer width={140} height={140}>
          <PieChart>
            <Pie data={data} dataKey="value" cx="50%" cy="50%" innerRadius={35} outerRadius={60} paddingAngle={3} strokeWidth={0}>
              {data.map((_, i) => (
                <Cell key={i} fill={COLORS[i % COLORS.length]} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="flex-1 space-y-1.5">
          {data.map((item, i) => (
            <div key={item.name} className="flex items-center gap-2 text-xs">
              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: COLORS[i % COLORS.length] }} />
              <span className="text-card-foreground flex-1">{item.icon} {item.label}</span>
              <span className="font-medium text-card-foreground">R$ {item.value}</span>
            </div>
          ))}
        </div>
      </div>
    </motion.div>
  );
}
