import { WhatsAppSessionPanel } from "./WhatsAppSessionPanel";
import { WhatsAppValidateCard } from "@/components/admin/WhatsAppValidateCard";
import { PageHeader } from "@/components/admin/PageHeader";

export default function WhatsAppAdmin() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="WhatsApp"
        description="Canal oficial de mensageria do NoControle.ia. Ações críticas exigem confirmação e ficam auditadas."
      />
      <WhatsAppValidateCard />
      <WhatsAppSessionPanel />
    </div>
  );
}
