# Fechamento do Nino Efficiency V2 — pendências e validação E2E com IA ativa

A ponte de contexto do WhatsApp já está fechada (o webhook envia `reply_context` com id citado e valor, o orquestrador repassa ao `handleTurn`). Restam três frentes: dois defeitos confirmados por teste, um falso positivo na guarda de segurança e a validação real com o agente agora que há crédito de IA.

## 1. Guarda de segurança sem falso positivo

O padrão da denylist marca qualquer número 402/403/429/500/502/503 solto como vazamento de infraestrutura. Isso derruba texto legítimo do produto ("R$ 500,00 disponíveis", "parcela 403 do contrato"). Correção: exigir contexto HTTP explícito (`HTTP 500`, `status 402`, `código 403`, `erro 429`) e nunca casar número precedido de `R$` ou seguido de `,` decimal. Adicionar teste com valores monetários nesses números para travar a regressão.

## 2. Categoria explícita sem pendência de contexto

`readCategoryAnswer("Nino, cria a categoria beleza e registre", false)` não devolve o par esperado (`name: "beleza"`, `explicit: true`, `create: true`). O reconhecimento do pedido explícito de criação precisa funcionar independentemente de existir lançamento pendente, e o nome extraído deve parar antes do verbo seguinte ("e registre"), sem engolir a conjunção.

## 3. Ordem da fila de leituras da Home

`buildNinoReadingQueue` está devolvendo `p, a, s, pt` — antecipação antes do apoio. A ordem contratada é: principal, apoio (incluindo contraponto), antecipação, padrão. Ajustar a ordenação da fila para respeitar essa hierarquia narrativa, mantendo intactas as regras já verdes (dedupe canônico, expiração/resolvidas/suprimidas, cooldown de leitura respondida).

## 4. Validação E2E com crédito de IA ativo

Com o circuito de IA liberado, validar em produção, na ordem:

1. Estado do circuito: confirmar que `ai_runtime_circuit` não está mais em `paused`; se estiver, retomar o circuito antes dos testes.
2. Fluxo "registro → categoria": disparar pelo canal do agente um lançamento sem categoria e responder com uma palavra curta ("Beleza"); provar que a resposta virou categoria pelo caminho determinístico (sem chamada de modelo) e que o lançamento ficou categorizado no banco.
3. Fluxo de resposta citada: responder citando o recibo e confirmar que o `amount_hint` levou à transação certa.
4. Fidelidade emocional: registrar "estou triste" e confirmar que o recibo devolve "triste", não um sinônimo.
5. Áudio: enviar um áudio simples e confirmar transcrição + roteamento, agora que a indisponibilidade de IA foi resolvida.
6. Degradação: simular um bloqueio de IA e confirmar que o usuário recebe o texto neutro, e que caminhos determinísticos (categorização, registro simples) continuam funcionando.

Evidência: logs da função do agente e leitura direta das linhas gravadas em `agent_runs` (caminho, capability, modelo/tier usado) para cada passo.

## Detalhes técnicos

- Arquivos afetados: `supabase/functions/_shared/agent/core/UserSafeError.ts`, `.../core/PendingAction.ts`, `src/lib/nino/rotation.ts`, e testes em `src/test/nino-context-degradation.test.ts` / `src/test/nino-home-rotation.test.ts`.
- Nenhuma alteração em finanças, migrations, schema ou autenticação.
- Nada publicado em produção sem autorização explícita; a validação usa as functions já implantadas.
- Critério de saída: suíte de testes verde e os seis passos E2E com evidência registrada.
