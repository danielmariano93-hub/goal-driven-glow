import { AdminTabs } from "@/components/admin/AdminTabs";
import Crescimento from "@/pages/admin/Crescimento";
import InteligenciaProduto from "@/pages/admin/InteligenciaProduto";

/** Produto: quem chega e fica (crescimento) e o que as pessoas usam (adoção). Receita saiu: não há pagamentos conectados. */
export default function CrescimentoHub() {
  return (
    <AdminTabs
      tabs={[
        { id: "crescimento", label: "Crescimento e retenção", render: () => <Crescimento /> },
        { id: "produto", label: "Uso das funcionalidades", render: () => <InteligenciaProduto /> },
      ]}
    />
  );
}
