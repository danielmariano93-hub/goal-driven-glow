// Ponte de Caixa — wrapper fino sobre o bloco canônico (`finance_contract.v4`).
// A equação é calculada em `src/lib/engine/bridges.ts`; aqui só apresentamos.
import { CashBridgeBlock } from "@/components/finance/FinanceBlocks";
import type { BalanceExplanation, CashBridge } from "@/lib/engine/bridges";

type Props = {
  bridge: CashBridge;
  explanation: BalanceExplanation;
  periodLabel: string;
};

export function PonteCaixaCard({ bridge, explanation, periodLabel }: Props) {
  return <CashBridgeBlock bridge={bridge} explanation={explanation} periodLabel={periodLabel} />;
}
