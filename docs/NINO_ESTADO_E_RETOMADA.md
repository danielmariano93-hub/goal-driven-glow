# Nino — estado atual e retomada (30/10/2026)

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
