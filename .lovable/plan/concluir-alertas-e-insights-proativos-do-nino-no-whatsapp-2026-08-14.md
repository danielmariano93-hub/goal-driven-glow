# Concluir alertas e insights proativos do Nino no WhatsApp

## Diagnóstico confirmado

- O processamento automático está ativo a cada hora, com os canais `app` e `whatsapp`, sem rollout parcial; a última execução processou usuários sem registrar erro geral.
- As preferências estão habilitadas para todos os 6 usuários, inclusive `whatsapp_proactive`; os 2 usuários com WhatsApp vinculado também estão habilitados.
- A fila de envio do WhatsApp funciona: houve 75 mensagens entregues nos últimos 7 dias. Portanto, o defeito está antes do envio, na seleção/despacho proativo.
- Sugestões recentes já nascem com `channel_ready='both'`, porém terminam como `dismissed` sem qualquer registro de decisão ou tentativa de entrega.
- O catálogo ainda define muitos insights relevantes com `default_channels=['app']`. O despachante interpreta isso como WhatsApp desligado, não registra a supressão e depois encerra a sugestão silenciosamente.
- A lista fixa da política de WhatsApp não contém vários tipos já autorizados no catálogo, como risco de recaída, dívida vencida e pressão de compromissos.
- As funções automáticas não têm logs recentes disponíveis, e os registros posteriores às correções continuam incompatíveis com o comportamento do código atual: a implantação das funções compartilhadas precisa ser concluída e validada.
- Neste momento local (22h12 em São Paulo), o horário silencioso está ativo. Alertas elegíveis devem ser adiados para depois das 8h, nunca descartados.

## Implementação única

### 1. Unificar a decisão de canal
- Tornar o `communication_catalog` a única fonte de autorização por tipo, severidade e canal.
- Remover a segunda lista fixa divergente de tipos permitidos no WhatsApp, evitando que catálogo e código se contradigam.
- Manter `channel_ready` apenas como compatibilidade para registros antigos; sugestões novas terão `both` e a política central decidirá o canal.
- Habilitar WhatsApp por padrão para insights financeiros acionáveis de severidade `attention` ou `critical`, incluindo dívidas, duplicidades, pressão de caixa, mudanças relevantes de comportamento, metas em risco e revisões úteis.
- Manter conteúdos leves/editoriais e alertas sensíveis somente no app quando adequado.

### 2. Corrigir o ciclo de vida da sugestão
- Uma sugestão só poderá virar `dismissed` quando existir um motivo terminal explícito.
- Quiet hours e limites temporários virarão `deferred`, com `next_attempt_at`, para nova tentativa automática.
- Canal indisponível, opt-out, catálogo, deduplicação e ausência de vínculo terão decisão persistida em `communication_deliveries`; nenhuma sugestão desaparecerá sem rastreabilidade.
- Considerar a sugestão `dispatched` quando ao menos um canal tiver sido entregue/enfileirado, sem o app impedir a tentativa independente no WhatsApp.

### 3. Recuperar alertas perdidos com segurança
- Reabrir apenas sugestões recentes, ainda válidas e acionáveis que foram encerradas silenciosamente, preservando deduplicação e limites de frequência.
- Não reenviar comunicações já entregues nem ultrapassar o limite diário/semanal.
- Alertas recuperados durante o horário silencioso ficarão adiados para a primeira janela permitida.

### 4. Implantar todo o caminho operacional
- Implantar `agent-proactive-tick`, `whatsapp-webhook`, `whatsapp-send` e `whatsapp-ack-watchdog`, incluindo os módulos compartilhados usados por elas.
- Manter o cron horário do motor e o despachante de saída a cada minuto.
- Executar uma rodada controlada para o usuário vinculado após a implantação, sem publicar alterações de frontend.

### 5. Provar a entrega ponta a ponta
- Testes automatizados para: catálogo autorizando WhatsApp, tipo antigo `app` tratado pela política central, quiet hours com adiamento, opt-out, limites, deduplicação e proibição de descarte silencioso.
- Validar em produção a sequência completa: insight gerado → decisão registrada → mensagem enfileirada → enviada → entregue.
- Confirmar pelo menos um alerta proativo real no WhatsApp após a janela silenciosa, com texto curto, humano e sem nomes técnicos.
- Conferir telemetria após a rodada: nenhum `dismissed` sem decisão, nenhum `channel_not_ready` indevido e motivo explícito para toda não entrega.

## Critérios de conclusão

- Usuários com WhatsApp ativo e consentimento recebem insights financeiros elegíveis.
- Alertas em horário silencioso são entregues depois das 8h, não perdidos.
- Todo bloqueio ou adiamento possui motivo auditável.
- O app e o WhatsApp compartilham a mesma sugestão sem duplicação lógica.
- Nenhum rollout parcial: funcionamento habilitado para 100% dos usuários elegíveis.