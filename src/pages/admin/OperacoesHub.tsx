import { AdminTabs } from "@/components/admin/AdminTabs";
import Saude from "@/pages/admin/operacao/Saude";
import AssessorHub from "@/pages/admin/operacao/AssessorHub";

/**
 * Operações — tudo que precisa de acompanhamento e ação do dia a dia.
 * Canais e envios vivem em Comunicações, fonte única de mensageria.
 * A aba externa vive em `?secao=` para não colidir com as abas internas
 * de cada tela (que usam `?aba=`).
 */
export default function OperacoesHub() {
  return (
    <AdminTabs
      param="secao"
      tabs={[
        { id: "incidentes", label: "Incidentes", render: () => <Saude /> },
        { id: "nino", label: "Nino", render: () => <AssessorHub /> },
      ]}
    />
  );
}

