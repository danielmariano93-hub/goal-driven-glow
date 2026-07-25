## Contexto

O commit `91e302f` deixou a integração de Metas Conjuntas + Comunicação enxuta funcionalmente entregue (Edge Function `shared-goal-notify-invite` no ar, 638 testes verdes, frontend em `meunino.com.br`). Restam **três pendências operacionais** para dar o feature por concluído, mais **duas melhorias de paridade UX** que fazem sentido fechar na mesma rodada por serem triviais e usarem infra já existente.

## Escopo (uma execução, sem novas migrations)

### 1. Configurar `APP_PUBLIC_URL` em produção (bloqueante)
`fetch_secrets` confirma: só existem `BOOTSTRAP_DISABLED`, `CRON_SECRET`, `LOVABLE_API_KEY`, `WAHA_*`. Sem `APP_PUBLIC_URL`, `resolveAppPublicUrl` retorna `null`, `buildLinkSentence` cai no fallback textual e **os convites do Rolê e Metas Conjuntas saem sem link clicável** — recurso principal da rodada.

Ação: `set_secret({ name: "APP_PUBLIC_URL", value: "https://meunino.com.br" })`. Valor determinístico, gravado direto sem formulário. Edge Functions leem em runtime via `Deno.env.get` — nenhum redeploy necessário (`shared-goal-notify-invite`, `split-reminders-dispatch`, `whatsapp-send` já leem no cold-start seguinte).

⚠️ Confirmação rápida no início: o domínio canônico do app autenticado é `meunino.com.br` (mesmo host da LP + SPA, deep links funcionam por client-side routing) ou existe um subdomínio `app.meunino.com.br` reservado? Custom domains registrados hoje: `meunino.com.br` e `www.meunino.com.br`. Se o subdomínio dedicado não existe, a LP e o app compartilham host — `https://meunino.com.br` é o valor correto.

### 2. Feedback claro no convite de Meta Conjunta
`src/pages/MetaConjuntaDetalhe.tsx` já dispara `shared-goal-notify-invite` no `onSuccess` da mutation quando há `phone_e164`, mas o toast atual é genérico ("convite enviado"). Ajuste pontual: quando o telefone foi informado, o toast passa a ser "Convite enviado por WhatsApp"; sem telefone, mantém "Convite salvo — compartilhe o link". Uma linha de copy condicional, sem novo estado.

### 3. Contact Picker no convite de Meta Conjunta (paridade com Rolê)
O `DivisaoDoRoleNova.tsx` usa `ContactPickerButton` para preencher telefone rapidamente. Em `MetaConjuntaDetalhe.tsx` o campo é digitação pura. Adicionar o mesmo `ContactPickerButton` ao lado do input, com callback que chama `normalizeBrPhone` — componente já existente, zero migration, zero backend. Fecha a paridade UX prometida.

### 4. Smoke E2E via `supabase--test_edge_functions`
Antes de encerrar, rodar os testes Deno da Edge Function `shared-goal-notify-invite` para garantir que o secret novo não quebrou nada em runtime (o teste hoje é unit; se não houver `.test.ts` na função, é registrado como out-of-scope — a cobertura via `sharedGoalInviteEnqueue.ts` unit + `shared-goal-whatsapp-enqueue.test.ts` já é o contrato).

### 5. Verificação final
- `bun test` (regressão)
- `tsgo` nos arquivos tocados
- Re-publicar frontend (mudanças pequenas em `MetaConjuntaDetalhe.tsx`)

## O que fica fora (e por quê)

- **Opt-out de Metas Conjuntas**: exige tabela nova (`opt_out_at`). Plano original marcou como fora de escopo.
- **Referral/attribution, cockpit de mensageria, deep-link tokens**: pertencem a Ondas B.2/B.3 do roadmap admin, não a esta rodada.
- **Terceira mensagem e escalada por SLA**: já entregamos followup (72h Metas / 48h Rolê); mais que isso vira harassment.
- **Smoke test em produção com JWT real**: polui dados; cobertura via unit + integration é o padrão do projeto (638 verdes).

## Arquivos tocados

- Nenhum arquivo (secret operado via tool) — item 1.
- `src/pages/MetaConjuntaDetalhe.tsx` — itens 2 e 3.

## Riscos

- Domínio errado no `APP_PUBLIC_URL` mandaria convidados à LP em vez do detalhe da meta — mitigado pela pergunta de confirmação no item 1.
- `ContactPickerButton` depende da Contact Picker API do browser; já tem fallback silencioso (não quebra em iOS Safari).
- Nada mais nesta rodada altera schema, RLS ou contrato de Edge Functions.
