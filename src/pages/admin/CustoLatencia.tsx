import { Activity } from "lucide-react";
import { AiEfficiencyHistoryBoard } from "@/components/admin/AiEfficiencyHistoryBoard";
import { AiProviderBenchmarkBoard } from "@/components/admin/AiProviderBenchmarkBoard";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/admin/PageHeader";

export default function CustoLatencia() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Custo e latência"
        description="Tokens, latência, chamadas e comparação de providers da IA do Nino."
        status={<Badge variant="secondary" className="gap-1"><Activity size={12} /> Operação global</Badge>}
      />
      <AiEfficiencyHistoryBoard />
      <AiProviderBenchmarkBoard />
    </div>
  );
}
