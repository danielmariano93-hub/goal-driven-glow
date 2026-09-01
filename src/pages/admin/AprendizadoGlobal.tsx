import { Brain } from "lucide-react";
import { NinoLearningBoard } from "@/components/admin/NinoLearningBoard";
import { BehavioralTimingBoard } from "@/components/admin/BehavioralTimingBoard";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/admin/PageHeader";

export default function AprendizadoGlobal() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Aprendizado global"
        description="O que o Nino absorveu no conjunto das interações, sem expor dados pessoais."
        status={<Badge variant="secondary" className="gap-1"><Brain size={12} /> Todos os clientes</Badge>}
      />
      <NinoLearningBoard />
      <BehavioralTimingBoard />
    </div>
  );
}