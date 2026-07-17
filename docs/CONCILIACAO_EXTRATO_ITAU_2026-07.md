# Conciliação do extrato Itaú e contrato de importação

## Diagnóstico financeiro comprovado

Período efetivamente analisado: 01/07/2026 a 16/07/2026.

| Componente | Valor |
|---|---:|
| Saldo em 30/06/2026 | R$ 3.275,59 |
| 105 entradas/saídas no período - entradas | R$ 11.259,42 |
| 105 entradas/saídas no período - saídas | R$ 14.261,82 |
| Variação líquida | -R$ 3.002,40 |
| Saldo calculado em 16/07/2026 | R$ 273,19 |
| Saldo informado pelo banco | R$ 273,19 |
| Diferença | R$ 0,00 |

O extrato é matematicamente consistente. O erro do aplicativo foi usar R$ 100,00
como saldo inicial e importar apenas 97 dos 105 movimentos.

### Oito movimentos descartados incorretamente

O sanitizador eliminava aplicações, resgates e rendimentos. Eles não são renda ou
consumo, mas alteram o caixa da conta e não podem desaparecer do livro financeiro.

| Data | Movimento | Valor |
|---|---|---:|
| 01/07 | Resgate de CDB | +R$ 1.000,31 |
| 01/07 | Rendimento de aplicação | +R$ 0,02 |
| 03/07 | Aplicação em CDB | -R$ 5.000,00 |
| 06/07 | Resgate de CDB | +R$ 400,03 |
| 06/07 | Resgate de CDB | +R$ 100,26 |
| 06/07 | Rendimento de aplicação | +R$ 0,01 |
| 08/07 | Resgate de investimento | +R$ 970,71 |
| 15/07 | Resgate de CDB | +R$ 500,19 |

Impacto líquido omitido: -R$ 2.028,47. O restante da divergência veio do saldo-base
incorreto: R$ 100,00 em vez do marco bancário de R$ 3.275,59 em 30/06.

## Regras obrigatórias

1. Linhas de saldo e limite são metadados, nunca transações.
2. O saldo diário imediatamente anterior ao primeiro dia incluído é o saldo inicial
   do recorte; o último saldo diário é o saldo final.
3. A equação `saldo inicial + entradas - saídas = saldo final` deve fechar antes da
   confirmação. Diferença diferente de zero bloqueia confirmação silenciosa.
4. Aplicação/resgate/rendimento e transferências internas permanecem no livro-caixa,
   mas ficam fora dos indicadores de renda e consumo.
5. O saldo bancário confirmado cria um snapshot por conta/data. Cálculos partem do
   snapshot mais recente e somam apenas movimentos posteriores.
6. Repetição por data/valor/descrição sem identificador bancário é ambígua, não
   duplicata automática. Duas compras iguais podem ser legítimas.
7. Referência bancária idêntica é duplicidade forte. Reimportar o mesmo documento é
   idempotente.
8. O texto original fica em `raw_description`; a interface usa uma descrição amigável.
9. Categoria segue a ordem: histórico do usuário, regra de alta confiança, sugestão
   do modelo. Baixa confiança permanece sem categoria e exige revisão.
10. Nenhuma reparação apaga automaticamente transações editadas depois da importação.

## Exemplos de normalização

- `ON UBER TRIP H16/07` -> `Uber` -> Transporte.
- `PIX WHATS QRCODE AUTOPASS S 15/07` -> `Autopass` -> Transporte.
- `PIX QRS ENEL DISTRI05/07` -> `Enel` -> Moradia.
- `PIX WHATS QRCODE IFOOD.COM A05/07` -> `iFood` -> Alimentação.
- `PIX WHATS QRCODE TOTAL PASS 19/06` -> `TotalPass` -> Saúde.
- `PAY NETFL 27/06` -> `Netflix` -> Assinaturas.
- `PAY -COBASI TATU` -> `Cobasi` -> Pets.
- `PIX TRANSF MARIA D14/07` -> `PIX Maria` (categoria pendente).
- Descrições opacas como `PAY HIROT 1607` são apenas limpas para `Hirot`; o sistema
  não inventa categoria sem histórico ou evidência.

## Reparação do documento já confirmado

1. Abrir Importações recentes.
2. Executar diagnóstico/rollback auditável do documento.
3. Preservar transações que tenham edição posterior.
4. Cancelar o snapshot associado, caso exista.
5. Reprocessar o arquivo original com as novas regras e a orientação persistida.
6. Revisar duplicatas, nomes, categorias e movimentos internos.
7. Selecionar a conta e aceitar explicitamente o saldo bancário de R$ 273,19.
8. Confirmar somente depois de a equação apresentar diferença R$ 0,00.

## Critérios de aceite

- O extrato gera 105 movimentos entre 01/07 e 16/07, não 97.
- Entradas R$ 11.259,42; saídas R$ 14.261,82; variação -R$ 3.002,40.
- Saldo-base R$ 3.275,59 e saldo final R$ 273,19; diferença zero.
- Movimentos de investimento afetam caixa, mas não renda/consumo.
- Duplicatas fortes ficam desmarcadas; ambíguas exigem decisão humana.
- Nomes originais permanecem auditáveis e nomes amigáveis aparecem na interface.
- Categorias de alta confiança são preenchidas e sua fonte/confiança é exibida.
- O patrimônio usa o mesmo snapshot de saldo utilizado nas telas de contas e pelo agente.
- Rollback e reprocessamento podem ser repetidos sem duplicar nem apagar edições.
