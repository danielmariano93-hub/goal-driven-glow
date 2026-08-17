# Tentativas x entregas: o painel está somando duas coisas diferentes

## Resposta curta

Não há problema de entrega no WhatsApp. O envio real está saudável: nos últimos 14 dias foram 223 mensagens na fila, 223 saíram para o provedor, 177 com confirmação de entrega no WhatsApp (as outras 45 são notificações dentro do app, que não têm confirmação) e apenas 1 falha (03/08).

O número que parece ruim vem de outra tabela: as **comunicações proativas geradas pelo motor**. Nos últimos 30 dias foram 138 candidatas, das quais 20 entregues, 7 na fila e **111 retidas por regra** — ou seja, o motor gera muito mais candidatas do que o produto permite enviar. Isso é o comportamento desejado (evita spam), mas o painel chama isso de "Tentativas", o que dá a impressão de falha de entrega.

Motivos das 111 retenções:

```text
weekly_frequency_cap (app)              38
channel_not_ready (whatsapp, legado)    24   -> nada novo desde 12/08
daily_frequency_cap (app)               11
weekly_frequency_cap (whatsapp)         11
channel_disabled_in_catalog (whatsapp)  10
kind_cooldown_24h (app)                  5
below_materiality (app)                  4
severity_below_whatsapp_threshold        3
daily_frequency_cap (whatsapp)           2
whatsapp_opt_out / logical_duplicate     2
```

## O que corrigir no painel

1. **Renomear a leitura**: em Comunicações, "Tentativas" passa a "Candidatas geradas"; entrega passa a ser medida sobre o que foi de fato liberado (`entregues / (entregues + enfileiradas + falhas)`), não sobre o total gerado.
2. **Mostrar o funil explícito**: Geradas -> Liberadas -> Entregues -> Interações, com o bloco "Retidas por regra" ao lado, exibindo os motivos ordenados (cap semanal, cap diário, cooldown, materialidade, canal desligado no catálogo, opt-out).
3. **Separar canal do motor**: em Canais/WhatsApp deixar claro que ali a base é a fila de envio (223/223/177/1) e que notificações no app não geram confirmação de entrega — hoje isso já é verdade nos números, mas o rótulo não diz.
4. **Sinalizar retenção crônica**: alerta quando um tipo de comunicação fica acima de ~60% retido no período, com o motivo dominante e link para ajustar o catálogo/limites.
5. **Limpar ruído legado**: marcar visualmente que `channel_not_ready` não ocorre desde 12/08 (agrupar como "histórico") para não poluir a leitura atual.

## Detalhes técnicos

- Fonte da fila: `outbound_messages` (RPC `admin_v2_whatsapp_monitor`, já conta `sent` incluindo `delivered/read` — está correto).
- Fonte do motor: `communication_deliveries` (`status` em `delivered|queued|suppressed`, `reason`, `block_context`).
- Ajustes de UI em `src/pages/admin/ComunicacaoProativa.tsx` (cards e gráfico) e `src/components/admin/messaging/ChannelsBoard.tsx` (rótulos/hints).
- Se o RPC de resumo proativo não devolver a quebra por `reason`, incluir esse agregado no `admin_v2_proactive_summary` (leitura apenas, sem nova tabela).
- Ponto de decisão de produto (fora do painel): os caps semanais/diários do app estão retendo quase metade das candidatas. Vale revisar os limites depois de ver o funil real.
