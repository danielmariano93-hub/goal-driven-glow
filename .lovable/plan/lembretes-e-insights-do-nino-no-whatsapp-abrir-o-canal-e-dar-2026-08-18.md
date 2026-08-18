# Lembretes e insights do Nino no WhatsApp — abrir o canal e dar controle ao admin

## O que eu confirmei no banco e no código (não é suposição)

- Nos últimos 7 dias: **7 entregas no app, 7 mensagens enfileiradas no WhatsApp e 61 supressões**. Ou seja: o motor gera, mas quase tudo é barrado antes de sair.
- Motivos reais das supressões: `weekly_frequency_cap` (39), `channel_disabled_in_catalog` (10), `below_materiality` (5), `severity_below_whatsapp_threshold` (3), duplicidade/cooldown (4).
- O lembrete de check-in emocional existe (`emotional_checkin_due`), mas está **duplamente bloqueado para WhatsApp**:
  1. no catálogo, `default_channels = ['app']`;
  2. o catálogo exige severidade mínima `attention` para WhatsApp, e o lembrete nasce como `info`.
- Pior: a regra que decide se o lembrete é devido exige que a pessoa **tenha aberto o app naquele dia** (`used_nino_without_checkin`) e só depois das 18h. Quem usa só o WhatsApp nunca dispara o lembrete.
- Sobre responder "registra que hoje me senti ansioso": **não existe ferramenta de registro emocional no Nino**. A lista de ferramentas do agente não tem nada que escreva em `emotional_checkins`. Hoje ele não conseguiria registrar.
- No admin, o catálogo só permite editar `active`, prioridade, `allowed_channels`, cooldown, máximo por dia e aprovação manual. **Não há como editar** o canal padrão, a severidade mínima para WhatsApp, o piso de materialidade nem a janela/horário dos lembretes.

Resumo: o Nino cala no WhatsApp por configuração, e o founder não tem onde mexer nessa configuração.

## O que vou entregar

### 1. Lembrete emocional carinhoso, também no WhatsApp
- Passa a valer para quem usa o app **ou** o WhatsApp (qualquer interação no dia conta), com opção de lembrar mesmo em dia sem uso, conforme configuração.
- Horário do lembrete deixa de ser fixo em 18h e passa a ser configurável (respeitando horário silencioso).
- Severidade e canal ajustados para que lembretes de cuidado possam sair no WhatsApp sem depender de "gravidade financeira".
- Texto humano, curto, sem cobrança, com resposta fácil: a pessoa pode responder no próprio WhatsApp.

### 2. O Nino passa a registrar emoção por conversa
- Nova capacidade de registro emocional: entende "hoje foi um dia ansioso", "me senti tranquilo", "tô cansado, gastei por impulso" e grava o check-in do dia (humor, intensidade, nota).
- Rota determinística de emoção (sem depender de sorte do modelo), com confirmação leve e recibo curto: "registrei seu check-in de hoje".
- Atualização em vez de duplicar quando já existe check-in no dia.
- Vincula, quando houver, a emoção ao gasto recém-lançado, alimentando os indicadores comportamentais já existentes.

### 3. Menos silêncio: reabrir o fluxo de lembretes úteis
- Lembretes de cuidado e operacionais (check-in emocional, revisão semanal, compromisso chegando, dívida vencendo) deixam de competir na mesma cota de 1 por dia / 3 por semana que hoje engole tudo: passa a existir cota separada para "lembretes leves", com limite próprio e editável.
- Piso de materialidade continua valendo só para insights financeiros — nunca barra lembrete de cuidado.
- Nada é descartado em silêncio: todo bloqueio segue registrado com motivo.

### 4. Tudo editável no painel admin
Na tela de Mensageria, o catálogo de comunicações ganha edição completa por tipo:
- ativo/inativo, canais permitidos e **canal padrão** (app, WhatsApp ou ambos);
- severidade mínima para WhatsApp;
- cooldown, máximo por dia, janela de validade;
- piso de materialidade e confiança mínima (para os tipos financeiros).

E uma nova seção **Lembretes** com:
- liga/desliga por tipo de lembrete;
- horário preferido e horário silencioso padrão;
- cota separada de lembretes leves (dia/semana);
- pré-visualização e edição do texto (app e WhatsApp) reaproveitando o editor de templates já existente;
- botão de teste: enviar o lembrete agora para um cliente escolhido, para validar texto e entrega.

### 5. Prova de que funciona
- Testes automatizados: lembrete devido para usuário só-WhatsApp, lembrete não barrado por severidade, cota leve separada da cota financeira, registro de emoção por frase natural, e atualização em vez de duplicação no mesmo dia.
- Rodada controlada com o usuário vinculado após a implantação e conferência ponta a ponta: lembrete gerado → liberado → enfileirado → entregue → resposta registrando a emoção.

## Detalhes técnicos

- `supabase/functions/_shared/intelligence/emotionalReminder.ts`: aceitar sinal de atividade de qualquer canal, hora-alvo parametrizada e política "lembrar mesmo sem uso".
- `supabase/functions/_shared/agent/core/ProactiveEngineV2.ts`: lembrete com `channel_ready: "both"` e severidade compatível com o canal; ler configuração do catálogo/limites em vez de constantes.
- `supabase/functions/_shared/agent/core/CommunicationDispatcherV3.ts` e `_shared/intelligence/communicationPolicy.ts`: classe de cota "lembrete leve" separada, materialidade restrita a insights financeiros.
- Novas ferramentas/rota do agente: `log_emotional_checkin` (e leitura do check-in do dia) em `_shared/agent/tools.ts`, com roteamento determinístico no `CapabilityRouter.ts`/`IntentRouter.ts` e recibo em `ReceiptBuilder.ts`.
- Migration: ampliar `admin_communication_catalog_update` para os novos campos; nova tabela/colunas de configuração de lembretes (horário, cota leve, ativação) com GRANTs e RLS; auditoria em `admin_configuration_audit`.
- Admin: expandir `src/components/admin/messaging/FlowsBoard.tsx` para edição completa, nova aba **Lembretes** em `src/pages/admin/ComunicacaoProativa.tsx`, contratos em `src/lib/admin/rpcContracts.ts` e rótulos em `displayDictionary.ts`.
- Implantação das funções `agent-proactive-tick`, `agent-chat`, `whatsapp-send` e módulos compartilhados. Nenhuma publicação em produção sem sua autorização.
