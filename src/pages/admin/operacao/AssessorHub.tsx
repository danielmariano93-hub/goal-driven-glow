import { AdminTabs } from "@/components/admin/AdminTabs";
import Assistente from "@/pages/admin/operacao/Assistente";
import Simulador from "@/pages/admin/AgenteSimulador";
import IaOcr from "@/pages/admin/operacao/IaOcr";

export default function AssessorHub() {
  return (
    <AdminTabs
      tabs={[
        { id: "qualidade", label: "Qualidade", render: () => <Assistente /> },
        { id: "documentos", label: "IA & Documentos", render: () => <IaOcr /> },
        { id: "simulador", label: "Simulador", render: () => <Simulador /> },
      ]}
    />
  );
}
