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

## Limites e riscos conhecidos
- `GET /transactions` (v1) está marcado como descontinuado pelo Pluggy (remoção prevista 31/12/2026). Trocar por `/v2/transactions` afeta só `listTransactions` em `pluggyClient.ts`.
- O Meu Pluggy é de uso pessoal; para outros usuários é preciso o plano comercial do Pluggy.
- Desconectar apenas pausa a conexão (preserva histórico); excluir a conta apaga tudo em cascata.
