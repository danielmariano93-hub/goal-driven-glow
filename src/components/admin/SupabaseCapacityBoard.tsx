import { useQuery } from "@tanstack/react-query";
import { Database, HardDrive, Loader2, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";

 type Capacity = {
  captured_at: string;
  database: { bytes: number; free_limit_bytes: number; usage_pct: number };
  public_schema: { bytes: number };
  storage: { bytes: number; free_limit_bytes: number; usage_pct: number };
  auth: { users: number; mau_30d: number; free_mau_limit: number; mau_usage_pct: number };
  top_tables: Array<{ table: string; rows_estimate: number; bytes: number }>;
 };

const fmtBytes = (value: number | null | undefined) => {
  const n = Number(value ?? 0);
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
};

function Meter({ value }: { value: number }) {
  const clamped = Math.max(0, Math.min(100, Number(value || 0)));
  return (
    <div className="h-2 overflow-hidden rounded-full bg-muted">
      <div className="h-full rounded-full bg-foreground/70 transition-all" style={{ width: `${clamped}%` }} />
    </div>
  );
}

function StatusBadge({ pct }: { pct: number }) {
  const label = pct >= 100 ? "Acima do Free" : pct >= 80 ? "Atenção" : "Com folga";
  return <Badge variant={pct >= 100 ? "destructive" : "secondary"}>{label}</Badge>;
}

export function SupabaseCapacityBoard() {
  const capacity = useQuery({
    queryKey: ["admin_supabase_capacity_snapshot"],
    queryFn: async (): Promise<Capacity> => {
      const { data, error } = await (supabase as any).rpc("admin_supabase_capacity_snapshot");
      if (error) throw error;
      return data as Capacity;
    },
    staleTime: 60_000,
  });

  if (capacity.isLoading) {
    return (
      <section className="rounded-2xl border border-border bg-card p-5">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 size={16} className="animate-spin" /> Carregando capacidade do Supabase…
        </div>
      </section>
    );
  }

  if (capacity.error || !capacity.data) {
    return (
      <section className="rounded-2xl border border-border bg-card p-5">
        <p className="text-sm font-medium">Capacidade Supabase</p>
        <p className="mt-1 text-xs text-muted-foreground">
          O painel ficará disponível após a migration de readiness ser aplicada.
        </p>
      </section>
    );
  }

  const c = capacity.data;
  const dbPct = Number(c.database.usage_pct || 0);
  const storagePct = Number(c.storage.usage_pct || 0);
  const mauPct = Number(c.auth.mau_usage_pct || 0);

  return (
    <section className="space-y-4 rounded-2xl border border-border bg-card p-4 sm:p-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold tracking-tight">Capacidade Supabase</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Uso atual comparado ao alvo do plano Free. O tamanho físico do banco atual ainda inclui bloat histórico que não será levado para a migração limpa.
          </p>
        </div>
        <StatusBadge pct={dbPct} />
      </header>

      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-xl border border-border p-4">
          <div className="mb-3 flex items-center justify-between"><span className="text-xs text-muted-foreground">Banco físico</span><Database size={15} /></div>
          <p className="text-xl font-semibold">{fmtBytes(c.database.bytes)}</p>
          <p className="mb-3 text-xs text-muted-foreground">de {fmtBytes(c.database.free_limit_bytes)} · {dbPct.toFixed(1)}%</p>
          <Meter value={dbPct} />
          <p className="mt-2 text-[11px] text-muted-foreground">Tabelas públicas: {fmtBytes(c.public_schema.bytes)}</p>
        </div>

        <div className="rounded-xl border border-border p-4">
          <div className="mb-3 flex items-center justify-between"><span className="text-xs text-muted-foreground">Arquivos</span><HardDrive size={15} /></div>
          <p className="text-xl font-semibold">{fmtBytes(c.storage.bytes)}</p>
          <p className="mb-3 text-xs text-muted-foreground">de {fmtBytes(c.storage.free_limit_bytes)} · {storagePct.toFixed(2)}%</p>
          <Meter value={storagePct} />
        </div>

        <div className="rounded-xl border border-border p-4">
          <div className="mb-3 flex items-center justify-between"><span className="text-xs text-muted-foreground">Usuários ativos</span><Users size={15} /></div>
          <p className="text-xl font-semibold">{Number(c.auth.mau_30d).toLocaleString("pt-BR")}</p>
          <p className="mb-3 text-xs text-muted-foreground">de {Number(c.auth.free_mau_limit).toLocaleString("pt-BR")} MAU · {mauPct.toFixed(2)}%</p>
          <Meter value={mauPct} />
          <p className="mt-2 text-[11px] text-muted-foreground">{Number(c.auth.users).toLocaleString("pt-BR")} contas no total</p>
        </div>
      </div>

      <div className="rounded-xl border border-border p-4">
        <p className="mb-3 text-sm font-medium">Maiores tabelas públicas</p>
        <div className="space-y-2">
          {(c.top_tables ?? []).slice(0, 6).map((row) => (
            <div key={row.table} className="flex items-center justify-between gap-4 text-xs">
              <span className="min-w-0 truncate text-muted-foreground">{row.table}</span>
              <span className="shrink-0 tabular-nums">{fmtBytes(row.bytes)} · ~{Number(row.rows_estimate || 0).toLocaleString("pt-BR")} linhas</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
