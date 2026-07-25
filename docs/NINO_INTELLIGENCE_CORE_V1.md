# Nino Intelligence Core v1

Este patch cria a primeira fundação de inteligência confiável do Meu Nino.

## Princípios

1. A LLM interpreta e explica; cálculos financeiros são determinísticos.
2. Toda conclusão analítica deve ter métrica, período, amostra, confiança, exclusões e versão da fórmula.
3. “Concentrou mais dinheiro” não é sinônimo de “normalmente gasta mais”.
4. App e WhatsApp recebem o mesmo envelope de resposta e o mesmo artefato.
5. Correções do usuário têm prioridade sobre inferências antigas.
6. Comunicações proativas respeitam opt-in, horário silencioso, cooldown e limite semanal.
7. O fornecedor de modelo é intercambiável; Gemini 2.5 Flash permanece como padrão inicial.

## Ativação segura

- `agent_settings.proactive_enabled` continua como kill switch global e permanece desativado por padrão.
- WhatsApp proativo exige `notification_preferences.whatsapp_proactive = true`.
- Modelos alternativos só são usados quando definidos nas variáveis `AI_MODEL_FAST`, `AI_MODEL_REASONING`, `AI_MODEL_VISION` ou `AI_MODEL_FALLBACK`.
- A migration reconstrói eventos de cadastro e recalcula três dias de agregados.

## Contratos administrativos

O Cockpit passa a calcular indicadores principais diretamente das fontes live, informa divergências entre `auth.users`, `profiles` e `user_pseudonyms`, e expõe cadastros do dia e usuários totais.

A lista de Clientes passa a incluir qualquer cadastro imediatamente, mesmo sem evento, lançamento ou conversa com o Nino.

## Homologação mínima

- Perguntar no App e no WhatsApp: “qual dia eu geralmente gasto mais?”.
- Confirmar que um gasto atípico não vira padrão recorrente.
- Pedir um gráfico no WhatsApp e validar recebimento do PNG.
- Criar um usuário novo e conferir Cockpit, Crescimento e Clientes.
- Manter proatividade desligada até revisar textos e preferências.
