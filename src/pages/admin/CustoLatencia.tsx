import { Activity } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { AiEfficiencyTruthBoard } from "@/components/admin/AiEfficiencyTruthBoard";
import { AiProviderBenchmarkTruthBoard } from "@/components/admin/AiProviderBenchmarkTruthBoard";
import { SupabaseCapacityBoard } from "@/components/admin/SupabaseCapacityBoard";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/admin/PageHeader";
import { SkeletonTable } from "@/components/admin/AdminSkeleton";
import { AiPerformance, PeriodSwitch } from "./CentralDeComando";
import { useCommandCenter } from "@/lib/admin/useCommandCenter";

export default function CustoLatencia() {
  const [params, setParams] = useSearchParams();
  const requested = Number(params.get("dias"));
  const days = [7, 14, 30].includes(requested) ? requested : 7;
  const q = useCommandCenter(days);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Custo e latência"
        description="Tempo de resposta, tokens e custo estimado por dia e por modelo. Os detalhes técnicos continuam logo abaixo."
        status={<Badge variant="secondary" className="gap-1"><Activity size={12} /> Operação global</Badge>}
        actions={<PeriodSwitch days={days} onChange={(d) => setParams((p) => { p.set("dias", String(d)); return p; }, { replace: true })} />}
      />
      {q.isLoading && <SkeletonTable />}
      {q.data && <AiPerformance data={q.data} />}
      <details className="surface-card p-4">
        <summary className="cursor-pointer text-sm font-semibold">Detalhes técnicos (eficiência, benchmark de provedores e capacidade)</summary>
        <div className="mt-4 space-y-6">
          <AiEfficiencyTruthBoard />
          <AiProviderBenchmarkTruthBoard />
          <SupabaseCapacityBoard />
        </div>
      </details>
    </div>
  );
}
