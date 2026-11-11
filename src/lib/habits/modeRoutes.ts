// Onde o seletor Dinheiro | Hábitos aparece nas telas financeiras: só nas rotas raiz das abas.
export const MONEY_TAB_ROOTS = ["/app", "/app/lancamentos", "/app/metas", "/app/mais"] as const;

export const isMoneyTabRoot = (pathname: string): boolean => {
  const p = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return (MONEY_TAB_ROOTS as readonly string[]).includes(p);
};
