## Diagnóstico
Em `src/pages/admin/WhatsAppSessionPanel.tsx` linha 233:
```
if (wizard || (notConfigured && !config)) return <WhatsAppSetupWizard .../>
```
No primeiro render `config === null`, então `notConfigured && !config` é `true` e o wizard monta automaticamente. Assim que `refresh()` retorna, `config` vira objeto (`configured=false`) e a condição vira `false` — o wizard desmonta, destruindo `url`, `apiKey`, `step`, `tested`. É exatamente o "aparece e some".

Além disso o wizard hoje pode remontar em qualquer refetch porque não há flag interna de "sessão do wizard aberta"; qualquer polling que force estado externo pode fechá-lo.

## Correção

### 1. `WhatsAppSessionPanel` — estado explícito de loading
- Novo estado: `configLoading: boolean` (true inicial), `configError: string | null`.
- `refresh()` (renomear parte inicial para `loadConfig()`):
  - antes: `configLoading=true`, limpa erro;
  - success: seta config/snap, `configLoading=false`;
  - erro: `configError=code`, `configLoading=false` (sem toast em boot).
- Render:
  - `configLoading` → skeleton estável (`<div className="surface-card p-5 animate-pulse h-32" />`), NUNCA wizard.
  - `configError` → card "Não consegui carregar o status" + botão "Tentar novamente" chamando `loadConfig()`.
  - `wizard === true` → `<WhatsAppSetupWizard .../>` (única condição que monta o wizard).
  - `config.configured === false` → card "Configurar conexão" + botão que faz `setWizard(true)`.
  - `config.configured === true` → painel normal.
- **Remover** a expressão `(notConfigured && !config)` do render — wizard só monta por clique.
- `refresh()` (após ações) continua atualizando `config`/`snap` sem afetar `wizard`.

### 2. Estabilidade do `WhatsAppSetupWizard`
- Aceitar prop `mode?: "initial" | "replace"` e `onCancel: () => void`.
- Nada dentro do wizard chama props/estado do pai que possam desmontá-lo — o pai NÃO passa `key` variável e NÃO condiciona a montagem em `config`.
- Guard `busy` já existe; adicionar `submittingRef = useRef(false)` para bloquear double-submit em `testAndSave` e `setupSession`.
- `apiKey` **somente em memória**; após `save_config` OK: `setApiKey("")` (já feito) e nunca escrever em storage.
- `url` e `step` opcionais em `sessionStorage` sob chave `nc:wa-wizard` (`{url, step, mode}`) — restaura no mount, limpa em `onDone`/`onCancel`. Chave nunca gravada.
- Polling do step `connect`:
  - se `s.status === "connected"` → `setStep("done")`.
  - **nunca** faz `setStep("creds")` ou similar; só progride.
  - se sessão já `connected` ao entrar em `session`, `setupSession` detecta via snap retornado e pula direto para `done`.
  - se `awaiting_qr`, mostra QR; permanece em `connect` até timeout de 3 min → mostra CTA "Tentar de novo" (sem sair do step).
- Cleanup do `useEffect` já limpa `iv`; adicionar guard `let cancelled=false` para descartar setState pós-unmount.
- Botão "Cancelar/Fechar" no header do wizard:
  - se `url` ou `apiKey` preenchidos e step==="creds", abre `AlertDialog` "Descartar dados?";
  - caso contrário chama `onCancel()` direto que limpa sessionStorage e faz `setWizard(false)`.
- Botão "Voltar" entre creds↔session: mantém `url` (mesmo state), NUNCA restaura apiKey.

### 3. "Substituir credenciais"
- Fluxo: clique em "Substituir credenciais" abre `AlertDialog` (já existe). Confirmar chama `setWizard(true)` com `mode="replace"` (novo state `wizardMode`).
- Wizard em modo replace começa em `creds` com `url`/`apiKey` vazios e um badge "Substituindo credenciais atuais".
- Refetch/polling do pai não fecha o wizard (garantido pelo item 1).

### 4. Testes de regressão
Novo arquivo `src/test/whatsapp-wizard.test.tsx` com RTL + fake timers + mocks de `supabase.functions.invoke`:
1. Primeiro render mostra skeleton (não formulário) enquanto `config_status` pendente.
2. `configured=false` → card "Configurar conexão" estável (sem inputs).
3. Clique "Configurar conexão" → inputs URL/API key aparecem.
4. Digitar URL/key, disparar `refresh()` externo (simulando polling) → valores permanecem.
5. `testAndSave` sucesso → `apiKey` limpo do DOM, step vira "session".
6. Polling em step `connect` recebendo `awaiting_qr` várias vezes → step nunca volta a `creds`.
7. Unmount limpa `setInterval`.
8. Erro em `config_status` inicial → card "Tentar novamente".
9. Asserção: `localStorage.length===0` e `sessionStorage.getItem("nc:wa-wizard")` nunca contém a apiKey (regex `/api|key|secret/i` no valor bruto).

Ajustar `vitest.config.ts` já suporta jsdom.

### 5. Auditoria do mesmo anti-pattern
Grep por render condicional em `config === null` / `!config &&` em:
- `src/pages/admin/Agente.tsx` (editor de comportamento) — verificar se o drawer/editor está montado por presença de `draft` em vez de flag explícita `editing`. Se sim, corrigir com flag booleana `editorOpen` e loading skeleton.
- `src/pages/admin/Operacao.tsx`, `Usuarios.tsx`, `VisaoGeral.tsx` — apenas leitura de status, baixo risco; verificação rápida.
Documentar achados no relatório final.

## Ordem de implementação
1. Refatorar `WhatsAppSessionPanel` (estados loading/error, remover condição automática, passar `mode`/`onCancel` ao wizard).
2. Refatorar `WhatsAppSetupWizard` (ref anti double-submit, sessionStorage sanitizado, cancelar com confirmação, polling que só progride).
3. Auditoria `Agente.tsx` — aplicar mesma correção se houver montagem por dado.
4. Novos testes `whatsapp-wizard.test.tsx`.
5. `bun run typecheck`, testes vitest, `bun run build`.
6. Relatório: arquivo/linha da causa, correção aplicada, resultado dos comandos, auditoria de storage.

## Aceite
- Wizard não pisca no primeiro carregamento.
- Digitação preservada durante refetchs/polling.
- API key nunca aparece em `localStorage` nem `sessionStorage`.
- Cancelar com campos preenchidos pede confirmação.
- Polling não regride o step.
- Todos os 81+ testes anteriores continuam verdes e 9 novos passam.
- Typecheck e build sem erros.
