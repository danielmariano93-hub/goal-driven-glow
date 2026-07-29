import { AdminTabs } from "@/components/admin/AdminTabs";
import Crescimento from "@/pages/admin/Crescimento";
import Receita from "@/pages/admin/Receita";
import InteligenciaProduto from "@/pages/admin/InteligenciaProduto";

export default function CrescimentoHub() {
  return (
    <AdminTabs
      tabs={[
        { id: "crescimento", label: "Crescimento", render: () => <Crescimento /> },
        { id: "receita", label: "Receita", render: () => <Receita /> },
        { id: "produto", label: "Produto", render: () => <InteligenciaProduto /> },
      ]}
    />
  );
}
