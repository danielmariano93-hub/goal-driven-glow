// Cores das fontes nos gráficos do Ticket (mesmas do "Ticket ou bolso", aprovado pelo dono do produto):
// Ticket = degradê roxo do Nino; dinheiro próprio = degradê lilás claro. Usadas em todos os gráficos de fonte.
export const TICKET_FILL = "bg-gradient-to-b from-[#9A6BFF] to-primary";
export const OWN_FILL = "bg-gradient-to-b from-[#EDE7FF] to-[#D6C8FF] dark:from-[#3A3156] dark:to-[#4C4072]";
export const OWN_TEXT = "text-[#4B3A86] dark:text-[#E4DCFF]";
export const SOURCE_LABEL = { ticket: "Ticket", own: "Dinheiro próprio", total: "Total" } as const;

export const dm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"] as const;
export const monthName = (m: string) => MONTHS[Number(m.slice(5, 7)) - 1];
export const brl0 = (v: number) => `R$ ${Math.round(v).toLocaleString("pt-BR")}`;
export const pct1 = (v: number) => `${v.toFixed(1).replace(".", ",")}%`;
