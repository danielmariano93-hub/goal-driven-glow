import { Activity } from "lucide-react";
import { AiEfficiencyTruthBoard } from "@/components/admin/AiEfficiencyTruthBoard";
import { AiProviderBenchmarkTruthBoard } from "@/components/admin/AiProviderBenchmarkTruthBoard";
import { SupabaseCapacityBoard } from "@/components/admin/SupabaseCapacityBoard";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/admin/PageHeader";

export default function CustoLatencia() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Custo e latência"
        description="Tokens, latência, chamadas, providers de IA e capacidade operacional do Nino."
        status={<Badge variant="secondary" className="gap-1"><Activity size={12} /> Operação global</Badge>}
      />
      <AiEfficiencyTruthBoard />
      <AiProviderBenchmarkTruthBoard />
      <SupabaseCapacityBoard />
    </div>
  );
}
