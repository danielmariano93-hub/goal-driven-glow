# Open Finance (Pluggy) — beta fechado

Leitura dos bancos do dono do produto pelo Pluggy. **Somente leitura; nada vira lançamento sem revisão.**

## Como funciona
1. `bank_connections`: o `itemId` do Pluggy (a conexão do banco). Só quem está em `open_finance_access` vê o recurso (Perfil → Open Finance).
2. `openfinance-sync` (Edge Function, JWT do usuário):
   - `discover` lê as contas do banco e cria os vínculos (`bank_account_links`), sem destino.
   - O usuário vincula cada conta/cartão do banco a uma conta/cartão do Nino (ou "Não importar").
   - `preview` baixa as transações dos últimos N dias (padrão 90, máx. 365), traduz para `import_item.v2` e classifica contra o histórico. **Sem efeitos.**
   - `stage` faz o mesmo e grava o lote em `document_imports` (`source = open_finance`) para revisão no Assessor, com o motor único de duplicidade.
3. A identidade de cada movimento é `external_id = pluggy:<id>` (também em `bank_reference`): sincronizar duas vezes não duplica.

## Regras de tradução (`_shared/openfinance/pluggyAdapter.ts`)
- Pagamento de fatura = `card_payment` (não é gasto). No cartão, o crédito "pagamento" também.
- Aplicação/resgate/rendimento = tipos de investimento. Estorno/reembolso = `refund`.
- Pix/TED/transferência: `external_transfer_*` com confiança baixa ("confirmar destino") — vai para conferência.
- `PENDING` não entra. Parcelas só quando coerentes (`1 ≤ n ≤ total`).

## Configuração (uma vez)
- Segredos do Supabase: `PLUGGY_CLIENT_ID`, `PLUGGY_CLIENT_SECRET` (nunca no código nem no front).
- Liberar o usuário: `insert into open_finance_access(user_id, note) values ('<uuid>', 'beta')`.
- Pendente de confirmação (spike): como obter o `itemId` no modo pessoal (Meu Pluggy) e o formato real de fatura/parcelas do cartão.

## Uso pessoal gratuito (MeuPluggy) — como conectar de verdade
Conta nova do Pluggy é "de teste": só conecta o conector Sandbox (Pluggy Bank). Dados reais, de graça e sem uso comercial, vêm do conector **MeuPluggy** (id 200):
1. Crie conta em meu.pluggy.ai e conecte seus bancos lá (até 5 conexões).
2. No painel do Pluggy, ative o conector MeuPluggy.
3. No widget do Nino, o conector já vem fixo em MeuPluggy (`connectorIds=[200]`); escolher um banco direto dá "Contas de teste só podem conectar conectores sandbox".
`GET /v2/items` não existe para itens do Meu Pluggy, por isso `discover` trata a ficha do item como opcional.
Para outros usuários (uso comercial) é preciso "Liberar dados reais" no plano pago (vendas + due diligence).

## Limites e riscos conhecidos
- O endpoint v1 `GET /transactions` foi desativado pelo Pluggy (HTTP 410); usamos `GET /v2/transactions` com cursor (`paginateTransactionsV2` em `pluggyClient.ts`).
- O Meu Pluggy é de uso pessoal; para outros usuários é preciso o plano comercial do Pluggy.
- Desconectar apenas pausa a conexão (preserva histórico); excluir a conta apaga tudo em cascata.

## Conciliação do mês atual (decisão de produto)
Só o mês atual é conciliado (corte no dia 1º); meses anteriores não são retroagidos.
Lançamentos de WhatsApp/app continuam sendo registrados e editados normalmente (são **provisórios**). A cada atualização do banco (1x/dia no Meu Pluggy), o Nino casa o provisório com o movimento confirmado: o valor do banco prevalece, categoria e notas da pessoa ficam, e não entra segunda linha. Provisório sem par vira "não apareceu no banco" após 5 dias — nunca é apagado.
Ação `reconcile` (somente relatório): `_shared/openfinance/reconcile.ts` (`planReconciliation`, `dedupeAcrossAccounts`). A gravação da conciliação só será liberada depois da conferência manual.
Tradutor: aplicação = saída; resgate/rendimento = entrada; lado cartão do pagamento de fatura é ignorado; Pix enviado segue como consumo (a conferir); empréstimo nunca é confiável só pelo texto.
