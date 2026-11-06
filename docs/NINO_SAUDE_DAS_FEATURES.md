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
| proactive_delivery | O que ele decide enviar sai? | 0 entregas em 72 h (crítico se houve decisão de enviar) | idem |
| proactive_failure_rate | Quanto falha na entrega? | ≥25% aviso, ≥50% crítico | 5 tentativas em 7 dias |
| proactive_budget_choke | Algum limite barra tudo? | ≥10 retenções por limite e 0 entregas em 24 h | idem |
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
