import { AdminTabs } from "@/components/admin/AdminTabs";
import Auditoria from "@/pages/admin/GovernancaAuditoria";
import Configuracoes from "@/pages/admin/Configuracoes";

export default function AuditoriaHub() {
  return (
    <AdminTabs
      tabs={[
        { id: "auditoria", label: "Auditoria", render: () => <Auditoria /> },
        { id: "configuracoes", label: "Configurações", render: () => <Configuracoes /> },
      ]}
    />
  );
}
