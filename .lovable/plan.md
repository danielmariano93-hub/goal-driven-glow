## Objetivo
Corrigir dois bugs em produção sem publicar: (1) RPC `create_phone_link_code` falhando por `digest` não qualificado; (2) `WhatsAppLinkSheet` aparecendo atrás da `BottomTabBar` no mobile.

## Bug 1 — RPC `create_phone_link_code`

### Migration nova (versionada)
Recriar `public.create_phone_link_code()` mantendo assinatura e contrato:
- `SECURITY DEFINER`, `SET search_path = public` (mantido restrito).
- Qualificar explicitamente todas as chamadas: `extensions.digest(...)`, `extensions.gen_random_bytes(...)` se aplicável.
- Manter regras: `auth.uid()` obrigatório (senão `raise exception 'not_authenticated'`), rate-limit 5 tentativas/30min consultando `phone_link_codes` do usuário, gerar código numérico 6 dígitos, armazenar `code_hash` (sha256 via `extensions.digest`), `expires_at = now() + interval '10 minutes'`, `attempts = 0`, `used_at = null`.
- `REVOKE ALL ... FROM public, anon;` e `GRANT EXECUTE ... TO authenticated;`.
- Retornar apenas o código em texto plano (uma vez), sem detalhes internos em erro.

### Validação segura
- Testar via `SET LOCAL ROLE authenticated` + `SET LOCAL request.jwt.claims` em transação com `ROLLBACK` para não deixar linha real.
- Ao final, `SELECT count(*) FROM phone_link_codes` para confirmar zero vínculo artificial.

### Frontend
Em `WhatsAppLinkSheet.tsx` e `pages/WhatsApp.tsx`:
- No `catch` da RPC, gerar `correlationId = crypto.randomUUID()`, `console.error` sanitizado com `{ correlationId, code: error.code }`.
- Substituir `toast.error(...)` genérico por **estado de erro inline dentro do sheet**, preservando consentimento e mostrando:
  - título curto acionável (ex.: "Não consegui gerar o código agora"),
  - mensagem específica quando `error.message` inclui "too many" (rate-limit),
  - botão **"Tentar novamente"** que rechama `generateAndOpen`,
  - `correlationId` em caption discreta.
- Se o código já foi gerado antes do erro em `openWaMe`, preservar (fluxo popup-blocked continua igual).

## Bug 2 — Modal atrás da BottomTabBar

### Portal + z-index
Em `WhatsAppLinkSheet.tsx`:
- Envolver o retorno com `createPortal(..., document.body)`.
- Overlay: `fixed inset-0 z-[200]` (novo tier acima de tab bar e header).
- Painel: filho do overlay, sem alterar stacking.

### Layout mobile premium
- Painel mobile: `fixed bottom-0 left-0 right-0` (via container flex já existente com `items-end`), `max-h-[min(90dvh,640px)]`, `overflow-y-auto`, `pb-[calc(1.5rem+env(safe-area-inset-bottom))]`.
- Desktop: mantém centralizado (`md:items-center`, `md:max-w-md`, `md:rounded-3xl`).

### Scroll lock e a11y
- `useEffect` quando `open`: setar `document.body.style.overflow = 'hidden'` e restaurar no cleanup.
- Focar primeiro controle interativo ao abrir; Escape e clique no backdrop já existem.
- `aria-modal="true"` e `role="dialog"` mantidos.

### Ajustes de z-index globais
- `BottomTabBar`: reduzir para `z-40` (se estiver `z-50`) para eliminar disputa; verificar que nenhum outro modal shadcn dependia dessa ordem (Dialog usa portal Radix próprio, isolado).
- Sonner Toaster: configurar `toastOptions`/`className` com `z-[210]` **ou** — preferido — usar erro inline no sheet e deixar toasts globais como estão.

## Testes

Novos/atualizados em `src/test/`:
- `whatsapp-link-code.test.ts` (unit): mock supabase RPC; sucesso, erro genérico exibe retry inline preservando código quando aplicável, erro "too many" mostra mensagem específica.
- `whatsapp-official-number.test.tsx`: adicionar caso de portal montado em `document.body` (query via `document.body.querySelector('[role=dialog]')`).
- Regressão RPC via SQL: descrever passos no PR; execução real com rollback confirmando ausência de linha.

Rodar: `bunx vitest run`, `tsgo`, build.

## Entregáveis
- Migration nova em `supabase/migrations/` (não editar existentes).
- `src/components/whatsapp/WhatsAppLinkSheet.tsx` refatorado (portal, scroll lock, erro inline, safe-area).
- `src/components/BottomTabBar.tsx` z-index ajustado.
- Testes atualizados.
- Sem deploy de Edge Function (nenhuma alterada). Sem publicação. Nenhum toque em WAHA/Vault/secret.

## Detalhes técnicos

```text
Camadas z-index após ajuste
  toasts (sonner)      z-[210]  (se necessário)
  WhatsAppLinkSheet    z-[200]  ← portal em body
  Dialog shadcn        z-50     (Radix portal — isolado)
  Header/FAB           z-40
  BottomTabBar         z-40     (reduzido de z-50)
  conteúdo             z-auto
```

```sql
-- Esboço da nova função (executada via migration)
CREATE OR REPLACE FUNCTION public.create_phone_link_code()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_recent int;
  v_code text;
  v_hash bytea;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT count(*) INTO v_recent FROM phone_link_codes
    WHERE user_id = v_uid AND created_at > now() - interval '30 minutes';
  IF v_recent >= 5 THEN RAISE EXCEPTION 'too many attempts'; END IF;
  v_code := lpad((floor(random()*1000000))::int::text, 6, '0');
  v_hash := extensions.digest(v_code, 'sha256');
  INSERT INTO phone_link_codes(user_id, code_hash, expires_at)
    VALUES (v_uid, v_hash, now() + interval '10 minutes');
  RETURN v_code;
END; $$;

REVOKE ALL ON FUNCTION public.create_phone_link_code() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.create_phone_link_code() TO authenticated;
```

Ajustar campos ao schema real após leitura de `phone_link_codes` (colunas obrigatórias serão inspecionadas antes de escrever a migration final).
