import { auth, defineMcp } from "@lovable.dev/mcp-js";
import listTransactions from "./tools/list-transactions";
import monthlySummary from "./tools/monthly-summary";
import listAccountsAndCategories from "./tools/list-accounts-and-categories";
import createTransaction from "./tools/create-transaction";
import financialPosition from "./tools/financial-position";
import listCardStatements from "./tools/list-card-statements";
import settleCardStatement from "./tools/settle-card-statement";

// O emissor OAuth precisa ser o host direto do Supabase, construído a partir do
// project ref (inline em build time, mantendo o módulo seguro para importar).
const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "meu-nino",
  title: "Meu Nino",
  version: "0.1.0",
  instructions:
    "Ferramentas do Meu Nino, app de finanças pessoais em português. Consulte lançamentos, resumo do mês, contas, categorias, cartões, faturas, dívidas e metas. Pagamento de fatura exige confirmação explícita e é baixa de caixa/obrigação, nunca nova despesa de consumo. Valores em reais (BRL).",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [
    listTransactions,
    monthlySummary,
    listAccountsAndCategories,
    createTransaction,
    financialPosition,
    listCardStatements,
    settleCardStatement,
  ],
});
