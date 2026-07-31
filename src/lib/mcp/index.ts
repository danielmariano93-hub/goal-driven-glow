import { auth, defineMcp } from "@lovable.dev/mcp-js";
import listTransactions from "./tools/list-transactions";
import monthlySummary from "./tools/monthly-summary";
import listAccountsAndCategories from "./tools/list-accounts-and-categories";
import createTransaction from "./tools/create-transaction";
import financialPosition from "./tools/financial-position";

// O emissor OAuth precisa ser o host direto do Supabase, construído a partir do
// project ref (inline em build time, mantendo o módulo seguro para importar).
const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "mindful-money",
  title: "Mindful Money",
  version: "0.1.0",
  instructions:
    "Ferramentas do Meu Nino, app de finanças pessoais em português. Consulte lançamentos, resumo do mês, contas, categorias, cartões, dívidas e metas do usuário conectado, e registre novos lançamentos. Valores em reais (BRL).",
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
  ],
});
