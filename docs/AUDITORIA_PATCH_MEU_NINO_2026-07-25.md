# Auditoria técnica do patch — Meu Nino

Data da revisão: 25/07/2026
Commit-base: `8f4c82eb9d7a03ef42b7cb0c94048cfc4dbcdaaa`

## Decisão

O arquivo anterior `meu-nino-consolidated.patch` **não deve ser aplicado**.

A revisão contra o schema real encontrou riscos que justificam sua substituição:

1. Os RPCs `SECURITY DEFINER` não chamavam `_require_perm`, permitindo que qualquer
   usuário autenticado acessasse agregados administrativos e reenfileirasse mensagens.
2. O patch criava estruturas paralelas a tabelas existentes:
   - `notification_events` duplicaria `notifications`;
   - `platform_feature_flags` concorreria com o sistema atual de flags;
   - a plataforma já possui `notification_preferences` e `message_delivery_events`.
3. A classificação de falhas tentava converter `metadata->>'permanent'` diretamente
   para boolean. Valores livres poderiam causar erro de execução.
4. O reprocessamento não limpava lease, erro, dead-letter, SLA e contadores de tentativas.
5. A migration adicionava fundações não conectadas aos fluxos, aumentando complexidade
   sem entregar comportamento validado.

## O patch refinado faz somente o que pode ser integrado com segurança

- Reutiliza `outbound_messages`, `admin_v2_whatsapp_monitor`,
  `_require_perm` e o modelo atual de permissões.
- Usa as permissões já existentes:
  - `messaging.read`;
  - `messaging.reprocess`.
- Adiciona dois RPCs:
  - `admin_v2_message_intelligence`;
  - `admin_v2_retry_failed_outbound`.
- Evolui a tela existente de WhatsApp para inteligência operacional agregada.
- Não cria tabela paralela.
- Não lê nem devolve corpo ou telefone.
- Não altera contratos financeiros, assessor, Rolê ou Metas Conjuntas.

## O que foi deliberadamente retirado

Referral, novos tokens, central paralela de notificações, novas feature flags e opt-out
foram retirados deste patch. Cada tema precisa reutilizar os domínios já existentes e
ser conectado ao fluxo real antes de entrar em migration.

## Garantias reais

O patch foi refinado contra:

- colunas atuais de `outbound_messages`;
- enum atual `msg_status`;
- tabelas existentes de notificações e flags;
- RPC atual `admin_v2_whatsapp_monitor`;
- modelo atual `_require_perm`;
- permissões existentes no banco.

Não existe garantia absoluta sem executar testes, migrations e smoke test no ambiente
da branch. Por isso, o merge continua condicionado ao checklist do guia de aplicação.
