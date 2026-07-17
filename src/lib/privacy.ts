let financialValuesHidden = false;

export function setFinancialValuesHidden(hidden: boolean) {
  financialValuesHidden = hidden;
}

export function areFinancialValuesHidden() {
  return financialValuesHidden;
}

export function formatPrivateBRL(value: number): string {
  if (financialValuesHidden) return "R$ ••••";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value || 0);
}
