-- merchant_truth.v2 — higiene de aliases genéricos.
-- Aliases como "pay", "est", "celular" são prefixos de POS, não estabelecimentos:
-- eles sequestravam a identidade (e a categoria) de compras inteiras.
DELETE FROM public.merchant_aliases
WHERE lower(btrim(alias_key)) IN (
  'pay','est','pag','pagto','compra','celular','conta','loja','mercado','posto',
  'servico','servicos','outros','pix','ted','doc','debito','credito','cartao'
)
OR length(btrim(coalesce(alias_key,''))) < 3;

-- Intermediadores de pagamento nunca são o estabelecimento econômico.
DELETE FROM public.merchant_aliases
WHERE lower(coalesce(canonical_name, friendly_name,'')) IN (
  'pagseguro','pagbank','mercado pago','mercadopago','picpay','stone','cielo','getnet','rede'
);