
# Plano de correção — Nino (app), Divisão do Rolê e Admin

Diagnósticos abaixo foram confirmados por leitura de código e consulta ao banco.

## 1. "Agora não" não troca a dica

Confirmado no banco: as últimas 12 dicas do usuário são todas `categorize_transaction` (família `categorizacao`), várias já com `dismissed` / `not_useful`.

Causa raiz (dupla):
- Ao dispensar, o card não pede nova dica ao servidor de propósito; a lista fica vazia e ele cai no **fallback local** (`pickFallback` em `src/lib/insights/fallbacks.ts`), que não conhece dispensas nem cooldown de família — logo repete o mesmo assunto de categorização.
- No servidor, quando nada é elegível, `insights-generate` devolve a dica ativa em cache (`insight: usable`), o que também reapresenta o mesmo tema.

Correções:
- No `AssistantTipCard`: após "Agora não", registrar o feedback, remover a dica da lista local e **solicitar uma nova geração** (`generate(true)`), com estado de carregamento no card.
- Aplicar filtro de família/dedup no fallback local: guardar em `sessionStorage` as famílias/chaves dispensadas nas últimas 72h e passar como `skip` para `pickFallback`, garantindo assunto diferente do dispensado.
- Em `insights-generate`: quando o usuário acabou de dispensar (`force: true`), ignorar o retorno em cache e relaxar apenas o cooldown de família (nunca os cooldowns de feedback), devolvendo a melhor candidata de **outra** família. Reduzir `minGapMinutes` para não bloquear a rotação pedida explicitamente pelo usuário.
- Se realmente não existir outra família elegível, exibir estado honesto ("sem novas dicas por agora") em vez de repetir a mesma.

## 2. Mensagem e link do lembrete do rolê

- Remover o meta-comentário "Passando com um lembrete leve" do template `reminder` em `_shared/agent/messageTemplates.ts` — a leveza fica no tom, não descrita. Revisar os demais templates de rolê para o mesmo padrão.
- Link: hoje `APP_PUBLIC_URL` aponta para `https://meunino.com.br` e a frase de link imprime a URL com `https://`. Ajustes:
  - passar a usar o host `www.meunino.com.br`;
  - em `buildLinkSentence`, imprimir o link em formato `www.meunino.com.br/...` (sem o prefixo `https://`), que o WhatsApp reconhece e abre corretamente;
  - manter a validação de segurança atual (somente HTTPS, sem hosts privados) na construção interna.
- Validar a rota `/app/divisao-do-role/:id` e `/signup?next=...` respondendo no domínio com `www`.

## 3. Régua de lembretes da Divisão do Rolê

Hoje (função `schedule_split_due_reminders`): D-1, D0, **D+1, D+3 e D+7**.

Nova régua, via migration:
- Participantes: **D-1, D0, D+1, D+3** — remover o estágio D+7 (e cancelar jobs D+7 ainda na fila).
- **Dono do rolê**: novo lembrete `owner_digest`, disparado após o estágio D+1 e novamente após D+3, listando os participantes já cobrados que continuam em aberto (nome, valor pendente, quantas cobranças receberam). Entregue no app (notificação) e no WhatsApp quando o dono tiver número ativo.
- Ajustes técnicos: incluir `owner_digest` no `reminder_jobs_kind_check`, manter idempotência por `idempotency_key`, e tratar o novo tipo no worker `split-reminders-dispatch-v2` (montagem do resumo, texto próprio e registro em `shared_expense_events`).
- Regra de silêncio: sem participantes em aberto, o job é marcado como `skipped` e nada é enviado.

## 4. Admin — nomes técnicos em Comunicação Proativa

`src/pages/admin/ComunicacaoProativa.tsx` imprime `row.kind` e canais crus (`duplicate_expense`, `advisor_review_weekly`, `app`, `whatsapp`).

- Ampliar `src/lib/admin/displayDictionary.ts` com todos os `kind` reais de `communication_deliveries` (gasto duplicado, revisão semanal/mensal do assessor, lembretes do rolê, dicas etc.), canais e motivos de bloqueio.
- Aplicar `dict.*` em todas as tabelas/filtros da página (tipo, canal, motivo), com fallback humanizado para valores novos.

## 5. Admin — "mensagens bloqueadas"

Consulta ao banco mostra que os bloqueios atuais são de política, não falhas:

| Tipo | Canal | Motivo | Qtde |
|---|---|---|---|
| Gasto duplicado | WhatsApp | rollout do canal desligado | 6 |
| Gasto duplicado | App | cooldown de 24h do mesmo tipo | 3 |
| Revisão semanal/mensal | WhatsApp | canal não habilitado | 2 |

Correções:
- Parar de gravar entrega "bloqueada" quando o canal WhatsApp está desligado por rollout: nesses casos o canal simplesmente não é alvo, então não deve contar como bloqueio.
- Separar no painel: **Suprimido por política** (cooldown, dedup, preferência do usuário) vs **Falha** (erro real), com motivo legível e sem tom de alerta para supressões saudáveis.
- Depurar o duplo registro por sugestão (linhas duplicadas no mesmo segundo) para não inflar contagens.

## 6. Entregáveis finais solicitados

Ao concluir, apresentarei:
1. Lista objetiva do que foi corrigido, item a item.
2. Lista das comunicações que o Nino **tentou enviar** (extraída de `communication_deliveries` + `outbound_messages`, com tipo, canal, status e motivo legível).
3. Lista das comunicações que o Nino **já consegue gerar sozinho hoje** (gatilhos ativos: gasto duplicado, revisão semanal/mensal do assessor, dicas do Nino, convites e lembretes do rolê, convites de meta conjunta), indicando canal disponível e o que ainda depende de liberação do WhatsApp.

## Detalhes técnicos

- Frontend: `AssistantTipCard.tsx`, `lib/insights/fallbacks.ts`, `pages/admin/ComunicacaoProativa.tsx`, `lib/admin/displayDictionary.ts`.
- Edge Functions: `insights-generate`, `split-reminders-dispatch-v2`, `_shared/agent/messageTemplates.ts`, `_shared/messaging/appUrl.ts`, `_shared/intelligence/communicationPolicy.ts`.
- Banco: migration alterando `schedule_split_due_reminders`, o check de `kind` em `reminder_jobs` e limpeza dos jobs D+7 pendentes.
- Config: `APP_PUBLIC_URL` para o host com `www`.
- Testes: cobertura nova para política de rotação de dicas, nova régua de lembretes, digest do dono e formatação de link.
