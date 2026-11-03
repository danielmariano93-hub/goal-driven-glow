# Nino — estado atual e retomada (atualizado em 03/11/2026)

Documento de passagem de bastão. Para retomar: "retome o Nino a partir de `docs/NINO_ESTADO_E_RETOMADA.md`".
Projeto Supabase: `amjanjlvsatubxdreyep`. Repositório: `danielmariano93-hub/goal-driven-glow`. Conta dona dos testes: `088920ce-1f5e-47d5-9e07-e2e4a63f9214`.

## 1. Onde estamos

Duas frentes, ambas com a `main` atualizada (PRs #339 a #347 mesclados, CI verde):

**A. Agente conversacional (WhatsApp)** — concluído até aqui
- Conjunto dourado ao vivo (86 casos, gabarito por SQL independente): WRONG = 0 (86/86 no código da branch na época). Pontuador no CI.
- Autocorreção, dimensão indisponível (`unavailable_dimension`), canal de motivo de falha (`contract_invalid:<campo>`), comparação por competência, comparação por estabelecimento (#339, #341, #342, #343).
- O harness ao vivo (`nino-e2e-harness-tmp`) hoje é um stub 410; para novas medições é preciso reimplantar com um SHA completo e token novo (nunca imprimir o token).

**B. App como um todo — "caixa é sintoma" (causas + alertas coexistindo)**. Plano em `docs/NINO_CAUSAS_E_ALERTAS_REFINAMENTO_TECNICO.md`:
| Fase | Estado |
|---|---|
| F0 custo/escala (pollers só com trabalho, trava de evidência, retenção 90 dias) | **Feito e verificado em produção** (#340, #345) |
| F1 definições únicas, modo sombra | **Feito** (#346): `nino_commitments_shadow`, ninguém a chama; relatório no doc §5.2 |
| F2 livro de causas | **Metade feita** (#347): módulo puro `causeLedger.ts` + testes. Falta o F2b |
| F3 cards da Home ("Por que está assim?", "O que vem pela frente") | Não iniciado |
| F4 qualidade dos alertas | Não iniciado |
| F5 abertura gradual por flag | Não iniciado |

## 1b. O que mudou desde 30/10 (PRs #346 a #352 mesclados) e o Ticket Alimentação

**Entregue e em produção**
- #346 compromissos v2 em modo sombra; #347 livro de causas v1 (módulo puro).
- #349 botão **Confirmar lançamento** para lançamento planejado (o aluguel do dia 30 não tinha como ser contabilizado).
- #350 relatório "dia a dia": cartão e parcelas (inclusive antecipadas) ficam num bloco separado, sem inventar um dia.
- #351 agente: ferramentas por estabelecimento usam a **competência** (como categoria e relatório), ausência vira resposta ("não encontrei"), e o peso por categoria nunca passa de 100%.
- #352 cobrança de atraso curta (`split_overdue_copy.v2`): só o que está em atraso, sem saldo total e sem link; a 2ª mensagem do dia nunca repete a 1ª.
- Régua de cobrança (dado, não código): `late_after_days = 1` → até 2 cobranças por dia (9h e 19h) a partir do **2º dia de atraso**. Detalhe: o texto da 2ª mensagem não depende mais de uma constante do código.
- Lição de processo: dois testes novos ficaram fora da lista do CI por falha de inclusão minha (corrigido). **Conferir sempre se o teste novo entrou na lista do gate.**

**Ticket Alimentação — Fase 1 (esta etapa)**
- Proposta completa em `docs/NINO_TICKET_ALIMENTACAO_PRODUTO_E_ARQUITETURA.md`; mockup navegável: https://claude.ai/artifact/YC5bKCFad6phjRqFE2Maox (privado).
- Decisões do dono: crédito **fixo**, em **data certa**, e a **sobra acumula** para o mês seguinte. Contexto separado do livro-razão (benefício não é renda nem caixa livre).
- Implementado: tabelas `benefit_wallets`/`benefit_entries`/`benefit_wallet_access` (migração `20261103120000`, aplicada em produção, com segurança por linha), motor puro `finance-core/benefitWallet.ts` (saldo ancorado em leitura, crédito previsto sem precisar lançar, ritmo de 14 dias, projeção, "e se eu gastar R$ X", dia da semana, estabelecimentos, sugestões), tela `/app/ticket` (link direto, fora do menu), registro rápido, criação da carteira, tests.
- Acesso: só quem está em `benefit_wallet_access` (a função `benefit_wallet_enabled()` falha fechada). Piloto: conta dona.
- **Fases seguintes já entregues (03/11):** #354 agente lê o Ticket (métrica `benefit_balance` → `get_benefit_status`) e entrada no menu Mais (só com acesso); #355 padrão por dia da semana desde os primeiros dias, com selo de confiança (baixa < 14 dias, média < 28); #356 registro pelo `!ja` da automação do celular com "Ticket" como meio de pagamento (grava só na carteira, dedupe por valor+dia+estabelecimento+hora, validado em produção pelo dono); leitura do extrato por print (`benefit-statement-read`: o modelo só transcreve, validação e dedupe determinísticos em `benefitStatement.ts`, a pessoa confirma na tela antes de lançar).
- **Ainda não implementado:** texto livre sem `!ja` ("gastei 45 no mercado com o ticket" ainda pode tentar lançar em conta); avisos proativos por mudança (projeção piora, data de esgotamento se desloca 2+ dias, ritmo fora do padrão, crédito atrasado; sem teto semanal fixo, silêncio 21h–8h, via governador de atenção; exige migration do CHECK de kinds, `communicationPolicy`, `TonePolicy` e testes do contrato de comunicações); card na Home (campo aditivo do `home-snapshot` + invalidação ao lançar; a Home só lê esse snapshot); métrica de "vazamento" (alimentação paga do bolso depois que o Ticket acaba; pede definir as categorias de comida); abertura gradual do menu.
- O dia da semana e o ranking por estabelecimento **exigem gastos lançados**; só com leituras de saldo o Nino calcula ritmo e data de esgotamento.

## 2. Próximo passo exato (F2b)
Montar as entradas do `causeLedger` a partir do **ledger canônico** (regras de `isRealMonthlyMovement`, competência, sem transferência/fatura/investimento) classificando cada lançamento em fixa / parcela_cartao / variavel / pontual / antecipacao / desconhecida, e criar o **gabarito SQL independente** da piora da conta do dono (jul, ago, out). Um SQL ingênuo sobre `transactions` NÃO serve (mistura transferências e aportes: mostrou renda de R$ 34 mil em junho). Depois: F3 atrás de flag, sem consulta nova (reaproveitar o `home-snapshot`).

## 3. Decisões e fatos já fechados
- **Fatura de cartão não é compromisso fixo**: é mista. Compromissos = recorrências + dívidas + parcelas de cartão agendadas (scheduled/billed). Fatura aberta é item de caixa/calendário, nunca soma. Antecipação = liquidação que reduz compromissos futuros.
- O "102%" vinha da fatura aberta (R$ 9,5 mil) contada como compromisso; o número oscila com o pagamento. Definição v2 do dono: 34,0% (mês), 41,5% (novembro).
- Novembro reconciliado: Airbnb canceladas = cancelamento real (confirmado pelo usuário na fatura de outubro); Turbi canceladas = antecipação (segundo o usuário; aparece cancelada também em set/out); os "2 antecipados" (R$ 1.053,92) são lançamentos do JIM.COM, outro conjunto.
- **Pendência de modelagem**: antecipar o Turbi cancelou a série no cronograma; antecipar o JIM só marcou os lançamentos (cronograma mantém parcelas). Falta regra única de como antecipação aparece no cronograma (decidir no F2b).
- Alertas devem **coexistir** com o diagnóstico, na mesma base e com um único governador de atenção.
- Mediana (3+ meses) e não média como "normal" do usuário (renda extraordinária distorce).

## 4. Regras permanentes (do usuário)
Responder em português do Brasil; engenheiro/arquiteto especialista; pronomes neutros se não informados; SQL de produção pré-autorizado para tarefas pedidas; nunca expor segredos; ler dados só da conta dona; confirmar antes de ação irreversível/externa; **não enviar WhatsApp/mensagem a usuários** sem pedido explícito (harness só no canal "simulator"); sem regras de roteamento por palavra-chave; sem commits vazios para forçar CI; piloto por flags/rollout; se o MCP do Supabase pedir confirmação/travar, parar de usá-lo naquele turno e passar o SQL ao usuário.
Custo/escala (guia §11): nada recorrente abaixo de 1 h sem aprovação; pollers O(1) em repouso (EXISTS antes de chamar Edge Function); declarar custo por usuário para 10 mil usuários; cache por versão do ledger; incremental; escrita mínima; retenção em tabela que cresce; sem LLM em caminho recorrente; Realtime só de baixo volume; mudanças aditivas, reversíveis, por flag e em modo sombra; uma definição por conceito.

## 5. Pendências abertas (fora da linha principal)
- Heartbeat do `whatsapp-send-dispatch` parado há >30 min em repouso (painel pode mostrar "atrasado"; não é falha). Correção barata: heartbeat ocioso como nos lembretes da divisão.
- Medir o efeito do F0 após algumas horas/dias (`net.http_post`, crescimento da evidência, `pg_stat_statements` de `split_message_pipeline_tick`).
- Candidatos de custo: `documents-cleanup-2m`, `ops-alerts-5m` (~4 s por execução), custo do Realtime (WAL).
- Divergência repo x banco: 499 arquivos de migração contra 473 aplicadas; reconciliar por conteúdo (a migração "Free readiness" não está aplicada).
- Alertas de baixo valor na Home (ex.: meta Dízimo "faltam R$ 1,00") — F4.
- Diagnóstico atual usa data de compra, 90 dias/3 de renda e fatura aberta como compromisso — trocar pela definição v2 por flag, depois do aceite do relatório F1.
- Agente: totais por estabelecimento x por categoria diferem (regras diferentes); o compositor às vezes insere "caixa negativo" sem suporte em recusas; janela "mês anterior" às vezes estranha; ~2/10 comparações ainda não entregues; flag `generic_aggregate_v1` ainda só do dono; dois agrupamentos simultâneos; aposentar gradualmente as regras 35x do prompt.
- O usuário deve testar no WhatsApp real e fornecer ~15–20 perguntas reais para um conjunto de validação separado; testes de transformação.
- Resíduos de teste em outras contas: limpar só com autorização.
- Decisões em aberto: onde mora o livro de causas (Home x Mapa); como tratar renda irregular de usuários típicos.

### Pendências abertas novas (03/11)
- Agente (achados da varredura de 02/11): "o que gastei no **dia 1º** de novembro?" responde o período todo; "quanto vem na **fatura** de novembro?" responde o total de gastos; "quanto falta pagar no JIM.COM?" não tem suporte (parcelas futuras não filtram por estabelecimento); "liste meus gastos" devolve ranking por categoria; o compositor às vezes escreve "o caixa ficou negativo" sem base.
- O gráfico diário do app e a série diária gerada pelo agente ainda usam competência (mesmo efeito do relatório já corrigido).
- Modelagem das antecipações no cronograma: Turbi cancelou a série; JIM.COM só marcou lançamentos. Falta regra única (F2b).
- Cobrança: o vigia de entrega marca `failed` por `ack_stalled_no_delivery` mesmo quando a mensagem chegou (caso do Roger em 02/11); não reenvia, mas o painel mostra falha.
- Medir amanhã de manhã se a cobrança das 9h saiu com o texto curto, e à noite se a das 19h saiu diferente.

