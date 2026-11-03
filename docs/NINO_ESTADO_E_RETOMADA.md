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
| F2 livro de causas | **Feito** (#347 módulo + F2b em 03/11): `causeEntries.ts` monta as entradas do ledger canônico; gabarito SQL independente de maio a novembro bate mês a mês; trava `base_atipica` quando a base tem < 3 meses desiguais |
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
- **Fechamento do Ticket (#358):** texto livre sem `!ja` ("gastei 45 no mercado com o ticket", "caiu o ticket 900", "ticket 412,40"; pergunta/hipótese nunca registra); avisos por mudança (`benefitSituations.ts`, `nino_benefit_alerts.v1`: o identificador carrega situação+faixa de esgotamento+ciclo, então o mesmo estado não repete e estado novo avisa; janela 8h–20h; entra no pipeline proativo existente, sem cron novo e sem teto semanal fixo); card do Ticket na Home (`HomeTicketCard`; lê pelos hooks do Ticket e não pelo `home-snapshot`, desvio consciente da regra "Home lê só o snapshot" porque o Ticket é contexto separado do livro-razão); vazamento (`food_outside_ticket` na ferramenta do agente: despesas reais de comida do livro-razão no ciclo).
- **Ainda não feito:** vazamento na tela do Ticket (hoje só no agente), abertura gradual do menu para outras contas, validação visual da tela e validação real da leitura de print pelo modelo de visão.
- O dia da semana e o ranking por estabelecimento **exigem gastos lançados**; só com leituras de saldo o Nino calcula ritmo e data de esgotamento.

## 2. Próximo passo exato (F3: cards na Home atrás de flag, dentro do `home-snapshot`, sem consulta nova; depois F4 alertas e F5 abertura gradual). O F2b está concluído (ver `docs/NINO_CAUSAS_E_ALERTAS_REFINAMENTO_TECNICO.md` §5.4)
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
- Agente (achados da varredura de 02/11) — **corrigidos em 03/11**: "dia 1º de novembro"/"dia 15 de outubro"/"do dia 1 a 5 de novembro" agora viram o dia/intervalo certo (`explicitPeriodResolver`); "quanto vem na fatura de novembro?" usa a fatura da competência pelo motor de cartões (`get_card_invoice`, metric `card_invoice`: oficial quando importada, senão estimativa); "quanto falta pagar no JIM.COM?" filtra as parcelas futuras por estabelecimento (`get_future_installments` com `merchant`); "liste meus gastos" lista os lançamentos do período, por competência e só movimento real (`list_period_transactions`, metric `transaction_list`); o compositor não pode mais dizer "caixa negativo / no vermelho" sem saldo negativo na evidência (`GroundingGateV3`).
- **Não alterado (de propósito):** `ack_stalled_no_delivery` — 278 mensagens marcadas como falha desde 17/07, nenhuma com `delivered_at`; o banco não prova se foram entregues, e mudar a regra pode esconder falha real. Precisa investigar o que o WAHA devolve no ack antes de mexer.
- Gráfico diário do app e série diária do agente: **já usam a data da compra** (o total do período segue a competência). Item antigo, verificado em 03/11 no código (`reportDashboard.chart_date`, `loadTxAndCategories`).
- Antecipações no cronograma (verificado em 03/11 nos dados do dono): JIM.COM = parcelas antecipadas viram `paid`/absorvidas na fatura do ciclo e os lançamentos ficam com `installment_anticipated` e competência econômica no mês original; Turbi = parcelas futuras `cancelled`. Para "o que falta pagar" as duas formas saem do total futuro (mesmo resultado); a diferença é só de exibição no cronograma. Não alterado.
- Cobrança: o vigia de entrega marca `failed` por `ack_stalled_no_delivery` mesmo quando a mensagem chegou (caso do Roger em 02/11); não reenvia, mas o painel mostra falha.
- Medir amanhã de manhã se a cobrança das 9h saiu com o texto curto, e à noite se a das 19h saiu diferente.


## Metas: veredito e categorias candidatas (`goal_verdict.v1`)
- Tela de Metas responde literalmente "ter metas está fazendo sentido?" (SIM / EM PARTE / AINDA NÃO / CEDO DEMAIS) com `goalVerdict.ts` (módulo puro, espelhado em `finance-core`), saído em `goalHistoryOf` como `verdict` e `candidates` (aditivos, opcionais).
- Conceitos: referência congelada (`baseline_value`); evitado LÍQUIDO (soma de todas as categorias com meta, inclusive as que subiram); efeito por categoria (≤ −10% ajudou, ≥ +10% não ajudou); confiança pelo nº de meses fechados; contexto = gasto de categorias sem meta e gasto variável total (evitado numa categoria só vira dinheiro guardado se o total também cai — quando não cai, o veredito é "em parte").
- O antigo card "O que as metas já fizeram por você" e o destaque `impact` saíram da tela: somavam só o que caiu. O motor `goalImpact` continua (testes e agente).
- Candidatas: consumo livre SEM meta, ≥ R$ 150/mês e ≥ 4% do variável (≥ 2% se subindo ≥ 20%); essenciais (mercado/farmácia) só subindo; nunca obrigações, "Outros", rolê e contas da casa. Prioridade alta = ≥ 10% do variável, ou ≥ 5% e subindo. Teto sugerido = média dos 3 últimos meses × 0,9.
- Verificado com os dados reais do dono (agregados): Sim/Em parte conforme a regra, net ≈ R$ 1,76 mil/mês (−26%), Transporte "não ajudou" (+26%), gasto variável total caiu só ~R$ 90/mês (Serviços/JIM subiu).

### Metas — tela v2 (ordem e conceito)
- Ordem: resultado ("N de M funcionaram") → placar mês a mês (+ coluna "vs antes") → metas deste mês (layout de sempre) → dízimo/metas de guardar → "Onde ainda não há meta" (fechado, expande) → metas conjuntas → encerradas. Saíram "Impacto positivo no mês", "Atingimento geral", o carrossel de destaques e a lista de sugestões antiga.
- A pergunta é POR META (a meta da categoria X funcionou?). O conjunto é o líquido de todas as metas. O que está fora das metas é contexto neutro ("sem meta, sem freio"), nunca causa.
- Meses importados em lote (`category_spending_goal_cycles.source = 'backfill'`) só contam depois que o usuário confirma (`confirmed`: true = tinha meta, false = não tinha, null = "?" no placar, fora dos totais). Agosto/2026 do dono ficou "?"; setembro de Lazer e Assinaturas foi confirmado por ele.
- A referência ("antes") só usa o valor guardado quando a meta que o guardou é a do primeiro mês de meta; senão recalcula pelos 3 meses anteriores ao primeiro mês.

### Metas — compactação (skill unslop)
- Skill de design **unslop** (Damir Sokolovsky, CC BY 4.0) incluída em `.claude/skills/unslop/` (só `SKILL.md` e `references/*.md`, com `NOTICE.md`; nenhum script de terceiros). Usada como guia de revisão: auditoria dos sinais, direção e passes (espaço, cor, copy, tipo, detalhes).
- Tela de Metas: escala 12/14/16/28, pesos 400–600, caixa de frase (sem rótulos em maiúsculas), superfícies neutras (cor só no número-chave e em estados), cartão do resultado em 4 linhas, placar com células de 24px, lista "este mês" compacta (título, barra e uma linha de números; plano e ações em "Detalhes e ações").
- "12 meses" era a soma categoria × mês. O período agora é o de calendário: "evitado R$ X desde set/2026 (2 meses)" (`since_month`, `calendar_months`).

## Metas: início automático pelo histórico de ciclos
- O primeiro mês de cada categoria é o mais antigo registrado em `category_spending_goal_cycles` ou nas metas vivas. NÃO usar `created_at` da linha viva como início: a linha é renovada/editada e só diz quando ela nasceu (as metas de ago/set de Assinaturas e Lazer vivem nos ciclos). Ciclos contam sozinhos; só `confirmed=false` ("não tinha") fica de fora.
- A referência "antes" congelada vale quando a linha foi criada no primeiro mês de meta (`goalStartMonth`), mesmo com o período renovado depois; senão, média dos 3 meses anteriores.
- Confiança do veredito = elo mais fraco (menor nº de meses fechados entre as categorias medidas), não a soma categoria × mês.
- Pendente: data do gasto de compra no cartão ainda é o mês da fatura (`reportingCompetenceDate`); parcelas 2+ de compra antiga já ficam de fora.
