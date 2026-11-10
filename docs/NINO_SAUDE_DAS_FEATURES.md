# Saúde das features (nino_feature_health.v1)

**Problema:** features já implementadas pararam de funcionar (erro ou sobreposição) e ninguém soube. Os alertas operacionais
(`ops_alerts`) cobriam infraestrutura (envio, fila, rotina, IA). Este módulo cobre o **resultado** de cada feature.

**Princípios**
1. Um indicador existe só se alguém sabe o que fazer quando ele muda. Cada linha tem a pergunta que responde, o número, a referência, o
   que está acontecendo e "o que fazer" (só aparece quando há o que fazer).
2. Mede **saída**, não atividade: "o Mapa gerou leitura esta semana", não "a rotina rodou" (a rotina `mapa-weekly` não deixa
   registro em `job_heartbeats` nem no histórico do cron, mas as leituras existem).
3. Volume pequeno (8 usuários, 2 com WhatsApp) não pode gerar falso alarme: toda regra tem amostra mínima e, abaixo dela, o estado é
   `nodata` (cinza), nunca verde nem vermelho.
4. Mesmo caminho dos alertas atuais: o que está em `warn`/`crit` entra em `ops_alerts` → faixa no painel, **notificação no app
   (popup)**, WhatsApp e ntfy, com lembrete e aviso de "resolvido".

**Onde:** SQL `feature_health_snapshot()` (calculado ao vivo, sem tabela nova) · `admin_feature_health()` (leitura do painel, só admin) ·
`ops_feature_health_alerts()` (alertas, só service_role) · Edge Function `ops-alerts-tick` (a cada 5 min) · tela `/admin/saude` ·
faixa na Visão geral (some quando tudo está bem).

## Catálogo
| Chave | Pergunta | Alerta | Amostra mínima |
|---|---|---|---|
| proactive_engine | O motor proativo está decidindo? | 0 decisões em 6 h | ≥1 usuário com WhatsApp |
| proactive_delivery | O que ele decide enviar sai? | 0 entregas (proativas + lembretes de contas) em 72 h; crítico se houve decisão de enviar por WhatsApp | idem |
| proactive_failure_rate | Quanto falha na entrega? | ≥25% aviso, ≥50% crítico | 5 tentativas em 7 dias |
| proactive_budget_choke | Algum limite barra tudo? | ≥10 retenções por teto diário ou cota de pilar (WhatsApp) e 0 mensagens (proativas + lembretes) em 24 h. Horário silencioso, intervalo de 2 h e severidade mínima não contam: o motor já os respeita ao decidir | idem |
| proactive_engagement | As mensagens geram resposta? | <5% respondidas em 2 h | 10 entregas desde 05/11 22:40 UTC |
| agent_error_rate | O agente responde? | ≥15% aviso, ≥30% crítico (pedir valor, `needs_*`, não é falha) | 5 conversas em 24 h |
| agent_silent | Quem escreve é atendido? | mensagens recebidas e 0 conversas em 24 h | 3 mensagens |
| agent_latency | A espera é aceitável? | p95 >20 s aviso, >40 s crítico | 5 conversas |
| agent_fallback | O provedor principal está estável? | ≥25% em modelo reserva | 5 conversas |
| agent_truth_gate | A trava de números barra demais? | ≥15% barradas em 7 dias | 10 conversas |
| mapa_freshness | O Mapa é atualizado toda semana? | >8 dias aviso, >9 crítico | Mapa liberado |
| mapa_coverage | A liberação chega às pessoas? | <50% com leitura em 8 dias | 3 contas e 8 dias desde a liberação |
| reports_weekly | O relatório semanal sai? | >8 dias aviso, >10 crítico | — |
| imports | As importações dão certo? | ≥40% falham em 7 dias | 3 importações |
| flags_changed | Alguém mudou o que está ligado? | informativo | — |

## Achados ao construir (dados reais de 06/11/2026)
- Conversas com `needs_amount` ("registrar pix de 10,80" sem valor) ficam gravadas com status `error` em `agent_runs`. Isso é pedir um
  dado, não falhar. O indicador novo ignora; **os painéis antigos (ex.: "Conversas sem erro") ainda contam como erro**.
- `communication_deliveries.interacted_at` só passou a ser preenchido em 05/11 à noite; antes disso "0% de resposta" seria artefato.
- `mapa-weekly` e `behavior-observed-weekly` não aparecem em `job_heartbeats` nem em `cron.job_run_details`; por isso o Mapa é medido
  pela leitura gerada, não pela rotina.
- Mapa liberado em 05/11: só 1 de 8 contas tem leitura. A primeira rodada completa é a de segunda-feira (09/11).

## Auditoria dos indicadores que já existiam na Visão geral (recomendações, não aplicadas)
- **Acionáveis, manter:** Mensagens entregues (% e falhas), Conversas sem erro, Tempo típico/mais lentas, alertas de funcionamento.
- **Contexto, rebaixar de tela inicial:** Pessoas atendidas, Tokens (todas as funções): não indicam ação. Custo de IA só faz sentido com meta.
- **Corrigir antes de confiar:** "Conversas sem erro" deve excluir `needs_*`.

## Métricas canônicas (uma definição por conceito) — 06/11/2026
**Problema:** o mesmo conceito aparecia com números diferentes em telas diferentes. Cerca de 30 funções do painel leem `agent_runs`;
só 5 excluíam contas de teste e só 2 excluíam o simulador; nenhuma tratava "pedir um dado" como não-falha.

**Definição única (SQL):** `v_real_agent_runs` (conversa real = fora do simulador e de contas de teste/sandbox; `needs_*` conta como concluída;
`raw_status` guarda o original) e `v_real_outbound` (mensagens a usuários reais, sem avisos internos). Migração
`20261106140000_metricas_canonicas.sql`; a definição original das funções fica em `admin_function_backups` (para desfazer).

**Antes e depois (7 dias, medido no banco):**
| Indicador | Tela | Antes | Depois |
|---|---|---|---|
| Conversas | Operações (`admin_v2_operations_health`) | 519 | 52 |
| Erros | idem | 134 | 1 |
| Sucesso | idem | 74,2% | 98,1% |
| Tempo típico / lentas | idem | 8,4 s / 13,5 s | 1,8 s / 8,8 s |
| Erros | Visão geral (`admin_v4_command_center`) | 3 (5,8%) | 1 (1,9%) |
| Falhas nas últimas 24 h | Status da plataforma | 2 | 0 |
| Conversas na história (universo) | `admin_v2_metrics_universe` | 2034 | 1143 |
| Conversas por capacidade | Autonomia (`admin_v2_agent_autonomy`) | 530 (bruto, inclui simulador) | 52 |

**Fora da regra, de propósito:** custo e tokens (o simulador gasta dinheiro de verdade; a Visão geral os mostra à parte, como contexto),
telas por usuário (ficha do cliente, reprocesso de mensagem), fila de envio.

**Ainda divergente / pendente**
- `admin_v2_cockpit` (rota escondida `painel-antigo`) calcula falha de mensagens com janela própria: 1,82% (amostra 110) contra 0,37% (544) da
  função padrão. Recomendo retirar essa tela.
- `admin_v2_agent_autonomy` → `funnel` lê a tabela `agent_decisions`, que está vazia (0 turnos em 7 dias): indicador morto.
- Funções de custo (`admin_v2_ai_history`, `admin_v2_ai_efficiency`, `admin_ai_ops_snapshot`) continuam brutas por decisão.

## Redesenho dos painéis (06/11/2026): o critério e o que mudou
**Critério:** um número fica na tela principal só se alguém sabe o que fazer quando ele muda. O que é contexto (custo, volume por canal) fica
recolhido e rotulado "contexto, não é alerta". O que não leva a nenhuma ação sai.

| Tela | Fica (decide algo) | Vira contexto (recolhido) | Saiu |
|---|---|---|---|
| Visão geral | Saúde das features; o que precisa de ação; alertas; conversas, sem erro, mensagens entregues e tempo; conversas por dia; mensagens por dia; tempo de resposta; o que mais dá errado; rotinas | Tokens e custo; eficiência por modelo; caminho de resposta; por canal | "Pessoas atendidas" como tile (virou dica de "Conversas") |
| Comunicações | Funil (candidatas → ação) com motivos de retenção; opt-out e dispensadas dentro do funil; evolução por dia; "as pessoas acharam útil?"; por tipo | Custo de comunicar | "Visão geral" (repetia o funil), "Preferências e dispensa" (agora no funil), "Hipóteses confirmadas" e "Revisões concluídas" (contagens sem decisão), "Por canal" (o filtro do topo já separa) |
| Nino & IA → Desempenho | Velocidade das telas; ferramentas que mais falham | Detalhes técnicos (eficiência, benchmark, capacidade) | — (já seguia o critério) |
| Crescimento e retenção | Leitura do crescimento; funil das experiências (com aviso de amostra pequena) | — | — |
| Cockpit antigo (`/admin/painel-antigo`) | — | — | Retirado (registro em `CODIGO_ARQUIVADO.md`) |

**Eixo de datas dos gráficos:** antes a data aparecia como `2026-10-24`, em poucos pontos, ou não aparecia. Agora todos os gráficos do admin usam
`lib/admin/chartFormat.ts`: rótulo curto `24/10`, todos os pontos quando são até 8, extremos e alguns do meio quando são mais, e dica com dia da
semana e ano (`qui, 24/10/2026`). Verificado no navegador nos componentes `SmoothChart` e `TrendChart`; os demais gráficos (tokens, eficiência,
benchmark, evolução) usam a mesma função.

**Não revisado:** Clientes e ficha do cliente, Governança, Planos e landing, Configurações, o Inspetor de cliente e o Simulador. São telas de
operação e ferramentas, não de acompanhamento; ficam para uma segunda rodada se você quiser.
