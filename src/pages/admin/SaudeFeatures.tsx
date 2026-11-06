import { PageHeader } from "@/components/admin/PageHeader";
import { FeatureHealthPanel } from "@/components/admin/FeatureHealth";

export default function SaudeFeatures() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Saúde das features"
        description="Cada linha responde se uma feature está entregando o que deveria. O que parar ou quebrar aparece aqui e chega até você no app e no WhatsApp."
      />
      <FeatureHealthPanel />
    </div>
  );
}
