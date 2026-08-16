# Nino humano, confiável e que aprende (nino_brain.v3)

## O que aconteceu no print

Na frase "Registre 96 reais como gasto em 15/08 em adega" o Nino:

1. Mostrou "Categoria: Adega" — categoria que não existe. O texto do rascunho é escrito livremente pelo modelo, então ele descreveu algo diferente do que a ferramenta realmente guardou (a categoria ficou vazia e "adega" nunca virou descrição).
2. Ficou sem descrição, e ninguém perguntou "em quê foi essa compra?".
3. Saiu com layout ruim: `* Despesa:` colado na frase, bullets no meio do parágrafo e "Data: 15/08/2026 Posso registrar?" grudados.
4. Mandou "Só um instante…" de novo numa mensagem curta de correção ("Categoria lazer, descrição adega"), que é resposta instantânea.
5. Fechou com um recibo seco e sempre igual: "Despesa registrada: R$ 96,00 ✅", sem confirmar o que de fato ficou salvo.

Ou seja: o problema não é "o Nino não sabe" — é que a **fala dele não é a verdade do sistema** e o tom é repetitivo.

## O que vamos entregar

### 1. Cartão de rascunho e recibo determinísticos (fim da divergência)
- O texto do rascunho e do recibo passa a ser **renderizado a partir do que foi realmente gravado** (valor, descrição, categoria real ou "a definir", conta/cartão, data, parcelas), nunca redigido pelo modelo.
- Se a categoria não foi pedida explicitamente, o cartão diz "Categoria: eu classifico depois" em vez de inventar nome.
- Recibo pós-confirmação passa a ecoar os campos finais, com variação de abertura.

### 2. Descrição x categoria x meio de pagamento
- "em adega", "no mercado", "no posto" viram **descrição/estabelecimento**, não categoria — só há categoria quando o usuário disser "categoria X".
- Rascunho sem descrição e sem estabelecimento não é apresentado: o Nino faz **uma** pergunta curta ("96 reais em 15/08 — em quê foi?").
- Correção do tipo "categoria lazer, descrição adega" edita o rascunho/lançamento anterior em um único passo, sem recriar nada.

### 3. Fala humana e não repetitiva
- Banco de aberturas/fechamentos com variação por turno, sem repetir a mesma frase nas últimas mensagens da conversa.
- Aviso de espera ("Só um instante…") suprimido em confirmações, correções e mensagens curtas, e nunca duas vezes no mesmo assunto.
- Normalizador de texto passa a corrigir bullet `* ` colado no meio da frase, pergunta grudada no fim do bloco e listas sem linha própria — com testes que reproduzem exatamente o print acima.

### 4. Auto-aprendizado real
- Toda correção do usuário gera um evento de aprendizado com: o que o Nino entendeu, o que era certo e qual etapa errou (descrição, categoria, data, conta, métrica).
- Desses eventos nascem preferências pessoais reutilizadas nos turnos seguintes: estabelecimento → categoria, apelidos de conta/cartão, forma preferida de resposta.
- As preferências aprendidas entram no contexto do turno, então o mesmo erro não se repete uma segunda vez para aquele usuário.
- Consolidação periódica promove padrões repetidos a regra de categorização, e rebaixa o que o usuário contrariou.
- Painel admin ganha a leitura dos gaps: quais etapas mais recebem correção, por canal.

### 5. Liberar tudo para todos os usuários
- Auditoria de todas as chaves de feature flag e defaults do agente; o que já está homologado passa a ligado para toda a base (inclusive `commit_movement_rpc` e `artifacts_v2_strict` se a validação passar), sem rollout parcial.
- Redeploy das funções do agente para que app e WhatsApp usem exatamente a mesma versão.

## Detalhes técnicos

- Novo `core/DraftCard.ts`: renderiza rascunho e recibo a partir do payload persistido; `AgentCore` passa a preferir esse texto quando o turno terminou em tool `*_draft`/confirmação, ignorando a prosa do modelo.
- `tools.ts` (`create_transaction_draft`): retorna `needs_description` quando não há descrição nem estabelecimento; extrai estabelecimento de "em/no/na <termo>" quando o termo não casa com categoria existente; devolve `category_status: "explicit" | "auto_later"` para o cartão.
- `ReplyHumanizer.ts`: converte `* item`/`- item` inline em linhas próprias, separa pergunta final em novo parágrafo, remove `Rascunhei aqui: *`; novos casos em `findBrokenPhrases` e testes em `src/test/`.
- `Acknowledgement.ts` + `Conversational.ts`: `shouldAcknowledge` recebe sinais de confirmação/correção/mensagem curta e o último ack do thread.
- Variação de tom: novo `core/ToneVariants.ts` com pools determinísticos por hash de turno, consultando as últimas aberturas usadas.
- Aprendizado: migration com `agent_learning_events` (RLS + GRANT para `authenticated`/`service_role`) e reforço de `agent_memory`; `LearningLoop.ts` grava o evento estruturado; `ContextPipeline.ts` injeta o bloco `[APRENDIDO COM VOCÊ]`; job de consolidação em `nino-intelligence-tick`.
- Flags: migration de `UPDATE public.financial_feature_flags SET enabled = true` para as chaves homologadas + alinhamento dos `DEFAULTS` em `FeatureFlags.ts`.
- Deploy: `agent-chat`, `agent-run`, `whatsapp-webhook`, `nino-intelligence-tick`, `category-engine`.
- Sem mudança de identidade, paleta ou LP. Nenhuma publicação em produção sem autorização.
