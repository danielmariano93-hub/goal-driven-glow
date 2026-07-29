import { AdminTabs } from "@/components/admin/AdminTabs";
import Seguranca from "@/pages/admin/GovernancaSeguranca";
import Auditoria from "@/pages/admin/GovernancaAuditoria";
import Configuracoes from "@/pages/admin/Configuracoes";

/**
 * Administração — acessos, trilha de auditoria e configurações da plataforma.
 * Área de baixa frequência: fica no fim do menu, fora do fluxo de decisão.
 */
export default function AdministracaoHub() {
  return (
    <AdminTabs
      param="secao"
      tabs={[
        { id: "acessos", label: "Acessos e segurança", render: () => <Seguranca /> },
        { id: "auditoria", label: "Auditoria", render: () => <Auditoria /> },
        { id: "configuracoes", label: "Configurações", render: () => <Configuracoes /> },
      ]}
    />
  );
}
