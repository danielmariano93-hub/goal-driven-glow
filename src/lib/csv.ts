import type { Lancamento } from '@/types/financial';

export function exportarCSV(lancamentos: Lancamento[]): void {
  const headers = ['Data', 'Tipo', 'Categoria', 'Descrição', 'Valor', 'Fixo', 'Recorrente', 'Impulsivo', 'Emoção', 'Forma Pagamento'];
  const rows = lancamentos.map(l => [
    l.data,
    l.tipo,
    l.categoria,
    l.descricao,
    l.valor.toString(),
    l.fixo ? 'Sim' : 'Não',
    l.recorrente ? 'Sim' : 'Não',
    l.impulsivo ? 'Sim' : 'Não',
    l.emocao || '',
    l.forma_pagamento || '',
  ]);

  const csv = [headers, ...rows].map(r => r.map(c => `"${c}"`).join(',')).join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `lancamentos_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function importarCSV(file: File): Promise<Partial<Lancamento>[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target?.result as string;
        const lines = text.split('\n').filter(l => l.trim());
        const data = lines.slice(1).map(line => {
          const cols = line.split(',').map(c => c.replace(/"/g, '').trim());
          return {
            data: cols[0],
            tipo: cols[1] as 'receita' | 'despesa',
            categoria: cols[2],
            descricao: cols[3],
            valor: parseFloat(cols[4]) || 0,
            fixo: cols[5] === 'Sim',
            recorrente: cols[6] === 'Sim',
            impulsivo: cols[7] === 'Sim',
            emocao: cols[8] || undefined,
            forma_pagamento: cols[9] || undefined,
          };
        });
        resolve(data);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = reject;
    reader.readAsText(file);
  });
}
