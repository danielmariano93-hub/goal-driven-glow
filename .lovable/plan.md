## Diagnóstico (verificado nos logs e no código)

Os logs da Edge Function `insights-generate` mostram, em toda geração recente:

```
insert_error_categorize: new row for relation "user_insights" violates check constraint "user_insights_type_check"
```

Causa raiz (arquivo por arquivo):

- `supabase/migrations/20260716010625_*.sql` (linha 8) define:
  `CHECK (type IN ('habit','alert','celebration','onboarding','opportunity'))`.
- `supabase/functions/_shared/insights/fallbacks.ts` (linha 79) e `src/lib/insights/fallbacks.ts` (linha 84) usam `type: "categorize_transaction"` para o card de categorização, que é justamente o caminho **priorizado** em `insights-generate/index.ts` linhas 197–218 quando existe transação sem categoria.
- Como esse usuário sempre tem transações não categorizadas recentes, o fluxo entra no ramo priorizado, tenta inserir com `type='categorize_transaction'`, viola a CHECK, retorna `500 insert_failed`, e nada novo é persistido. O front continua exibindo as mesmas dicas antigas — dando a impressão de que "nada foi feito".

Ou seja: todo o resto (novos sinais, rotação, exaustão, tools do agente) foi entregue no código, mas a persistência da dica prioritária está bloqueada pela constraint desatualizada.

## Correção (mínima e cirúrgica)

1. **Migration** `supabase/migrations/<timestamp>_user_insights_add_categorize_type.sql`
   - `ALTER TABLE public.user_insights DROP CONSTRAINT IF EXISTS user_insights_type_check;`
   - Recria a constraint incluindo `categorize_transaction`:
     `CHECK (type IN ('habit','alert','celebration','onboarding','opportunity','categorize_transaction'));`
   - Idempotente; não altera dados existentes.

2. **Higienização leve (opcional na mesma migration)**
   - `UPDATE public.user_insights SET status='expired' WHERE status='active' AND expires_at < now();` para forçar o front a puxar a próxima dica assim que a geração voltar a persistir.

3. **Sem alteração de código**
   - `insights-generate`, `AssistantTipCard`, fallbacks e schema Zod já tratam `categorize_transaction` corretamente. Não há refatoração necessária.

4. **Deploy**
   - Aplicar a migration.
   - Não é necessário redeploy da função (a lógica já está publicada).
   - Validar chamando `insights-generate` e conferindo nos logs a ausência de `insert_error_categorize` e a presença de `categorize_priority`.

5. **Verificação no app**
   - Recarregar Home → a dica priorizada de categorização deve aparecer.
   - Clicar em "gerar nova" → deve rotacionar; sessionStorage `noc:last-tip` é atualizado.

## Fora de escopo

Não mexer em: engine de sinais, rotação, tools do agente, categorias globais, Pulso, Patrimônio, WhatsApp. Não recriar tabelas, políticas RLS, ou grants. Não alterar prompts.
