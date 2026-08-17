import Saude from "@/pages/admin/operacao/Saude";

/**
 * Operações — apenas incidentes e saúde da plataforma.
 * Canais e envios vivem em Comunicações; qualidade, custo, documentos e
 * simulador vivem em Nino & IA. Sem aba dentro de aba.
 */
export default function OperacoesHub() {
  return <Saude />;
}
