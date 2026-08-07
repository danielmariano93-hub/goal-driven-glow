// PONTE DE COMPATIBILIDADE — finance_contract.v1
// ==============================================
// Este módulo NÃO tem lógica própria. Ele re-exporta o núcleo canônico
// `_shared/finance-core/facts.ts`, espelho determinístico de
// `src/lib/engine/facts.ts` gerado por `scripts/sync-finance-core.mjs`.
// Nunca reintroduzir fórmulas aqui: divergência entre App e Edge é bug P0.
export * from "../finance-core/facts.ts";
