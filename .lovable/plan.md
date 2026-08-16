# Fechamento da fundação iOS do Meu Nino

Objetivo: manter a web e o backend como estão e entregar um projeto iOS real, seguro e auditável, pronto para a fase Apple (signing, TestFlight, App Store Connect). Nada de StoreKit, push, widget, Siri ou novos recursos financeiros nesta rodada.

## Estado atual verificado

- `capacitor.config.ts` usa `appId: app.lovable.p73db6dbefc9046e48278b978492e7f92`, `appName: goal-driven-glow` e `server.url` apontando para o sandbox da Lovable com `cleartext: true`.
- Não existem as pastas `ios/` nem `android/` no repositório; só os pacotes `@capacitor/ios` e `@capacitor/android` estão instalados.
- Já existem: `src/lib/native/platform.ts`, `src/lib/native/session.ts` (Secure Storage + biometria), `NativeRuntime.tsx` (status bar, teclado, deep link com allowlist), `NativeCaptureButton`, `NativeRecorderButton`, função `native-audio-transcribe`, `PrivacyModeContext`, `AdminErrorBoundary`, manifesto PWA com 4 ícones, páginas legais e `Plano.tsx`.
- Exclusão de conta: `admin_process_deletion_request` apaga 22 tabelas. O banco tem **106 tabelas com `user_id`**, mais 5 com `owner_user_id` e 6 com `created_by`. Ou seja, a maior parte dos dados pessoais hoje **não** é apagada. A remoção de `auth.users` já ocorre na função `admin-process-deletion` via service role, depois da RPC.
- `AuthContext` faz logout completo quando a biometria é cancelada (`unlockWithBiometrics` false → `signOut`).
- `Plano.tsx` já mostra "Em breve", mas o texto diz que "a contratação feita pelo aplicativo será processada pela loja".
- Privacidade afirma "sem uso para treinamento de modelos".

## Entrega em 6 blocos

### Bloco 1 — Identidade nativa e ambientes

- Fonte única de identidade em `src/lib/native/appIdentity.ts` + `capacitor.config.ts`: `appId: br.com.meunino.app`, `appName: Meu Nino`, scheme `meunino`.
- `capacitor.config.ts` passa a ler o ambiente: produção sem `server.url` e sem `cleartext` (bundle local do `dist/`); apenas `CAP_DEV_SERVER_URL` (opcional, não versionado) reativa live reload em desenvolvimento.
- Documentar Debug vs Release: Release sem badge Lovable, sem URL da Lovable, sem logs verbosos.

### Bloco 2 — Projeto iOS real

- Gerar `ios/` com `npx cap add ios` e versionar o projeto Xcode.
- `Info.plist` com apenas as permissões usadas e textos em português: câmera (comprovantes), microfone (áudio com o Nino), Face ID (proteção dos dados), fototeca de leitura (anexar documentos já salvos). Sem `NSPhotoLibraryAddUsageDescription` se não gravarmos na galeria.
- `PrivacyInfo.xcprivacy` auditado plugin por plugin (Secure Storage/Keychain, biometria, câmera, filesystem, preferences, keyboard, status bar) com razão declarada para cada Required Reason API realmente usada, documentada em tabela.
- `AppIcon.appiconset` a partir do símbolo oficial (sem texto miúdo, sem ícone padrão do Capacitor) e Launch Screen sóbria em Deep Ink com o símbolo — transição, não splash.
- Marketing version 1.0.0 / build 1, com regra de incremento documentada.
- Preparação de Universal Links: entrada de Associated Domains comentada + `public/.well-known/apple-app-site-association` com Team ID marcado como pendente. Nada de Team ID inventado.

### Bloco 3 — Exclusão de conta V2 (parte mais sensível)

- Criar `docs/ACCOUNT_DELETION_INVENTORY.md` classificando **todas** as tabelas com coluna de usuário em DELETE / ANONYMIZE / RETAIN_LEGAL / CASCADE / NOT_APPLICABLE (auditoria já feita: 106 + 5 + 6 tabelas).
- Nova migration com `admin_process_deletion_request` V2 dirigida por um **catálogo em tabela** (`account_deletion_targets`: tabela, coluna, estratégia, ordem), para não depender de lista hardcoded e nunca mais ficar defasada; um teste SQL falha se existir tabela com coluna de usuário fora do catálogo.
- Ordem segura: dependências → agregados → perfil; anonimização (não delete) onde há trilha de auditoria/administrativa (`admin_grants_audit`, `platform_admin_audit`, `edge_incidents`, `ledger_corrections`) usando pseudônimo já existente em `user_pseudonyms`.
- Idempotência: função tolera reexecução (status `completed` retorna sem erro), grava progresso por estágio e retoma de falha parcial sem recriar dados.
- `auth.users` continua sendo removido pela edge function com service role, agora só após todos os estágios confirmados; cliente permanece sem privilégio administrativo.
- Auditoria mínima em `account_deletion_audit`: request id, timestamps, status, tabelas processadas, linhas apagadas/anonimizadas, retenção legal, estágio de falha. Sem guardar dado financeiro.
- Testes: primeira execução, segunda execução, retomada após falha, verificação de resíduo (query que varre o catálogo procurando linhas remanescentes).

### Bloco 4 — Sessão, biometria e ciclo de vida

- Auditar `session.ts`: garantir que access/refresh token só vivem no Secure Storage no nativo, limpeza em logout/troca de usuário/revogação, e nenhum segredo em Preferences.
- Biometria com estados distintos: indisponível, não configurada, cancelada, falhou. Cancelar **não** faz logout: mostra tela de bloqueio com opção "usar login" e mantém a sessão.
- Lifecycle: um único gate biométrico por retomada, com supressão enquanto câmera/gravador/picker estiverem ativos (evita Face ID duplicado ao voltar do picker); refresh de sessão no resume.
- Privacy screen: overlay/blur ao entrar em background para os valores não aparecerem no App Switcher, reutilizando `PrivacyModeContext`; restaura ao voltar.
- Sanitização de log: helper que bloqueia token, senha, base64 de áudio, documento e mensagem inteira; revisão dos `console.*` do fluxo nativo.

### Bloco 5 — Robustez de app e fluxos nativos

- Deep links: allowlist explícita por rota (login, reset de senha, convite, `/app`, assessor), scheme `meunino`, rejeição de host/rota desconhecida — proteção contra open redirect.
- Error boundary global no `App.tsx` (reaproveitando o padrão do admin) com tela amigável em vez de tela branca para erro de plugin, auth, câmera, biometria e rede.
- Estado offline: detector de conectividade, tela/banner amigável com retry; ações financeiras nunca exibem sucesso otimista sem resposta do servidor.
- Safe areas e teclado: consolidar tokens de `env(safe-area-inset-*)` em um único lugar, remover padding duplicado e validar chat do Nino, login, cadastro, lançamento, modais e review de documentos.
- Câmera e áudio nativos: validar ponta a ponta (cancelamento, permissão negada, HEIC/JPEG, orientação, foto grande; áudio curto, silêncio, longo, permissão negada) mantendo tudo após a transcrição no mesmo pipeline textual do AgentCore — sem inteligência paralela.

### Bloco 6 — Conformidade, textos e documentação

- `Plano.tsx`: Nino Premium como "Em breve", sem botão de compra e sem menção a cobrança pela loja ou checkout externo. Arquitetura de entitlement preservada para StoreKit futuro.
- Termos e Política revisados para o produto real: app gratuito hoje, Premium não lançado; a frase sobre treinamento de modelos passa a refletir o que é contratualmente verificável nos provedores usados. Documentar tipos de dado, finalidade, operadores, retenção e exclusão.
- Novos documentos: `docs/APPLE_APP_PRIVACY_MATRIX.md`, `docs/IOS_REVIEW_ACCOUNT.md` (como criar e semear a conta de review sem usar conta pessoal, com/sem WhatsApp), `docs/IOS_TEST_CHECKLIST.md` e `docs/IOS_RELEASE_READINESS.md` (implementado / depende da Apple / variáveis externas / Xcode / device / archive / TestFlight).
- Fecho com `npm test` + `npm run build` e a matriz final por requisito: IMPLEMENTADO, TESTADO, PREPARADO MAS DEPENDE DA APPLE, NÃO IMPLEMENTADO.

## Notas técnicas e limites honestos

- O sandbox é Linux: `npx cap add ios` gera e versiona o projeto, mas `pod install` e `npx cap sync ios` só rodam de fato em macOS com CocoaPods. Vou validar o que é validável aqui (build web, config, arquivos do projeto, `cap sync` da parte web) e documentar o passo de Pods como execução obrigatória no Mac. Não vou declarar "cap sync ios passou" sem ter rodado.
- Ícone, Launch Screen e assets usam a identidade oficial já existente; nada de logo novo.
- Motores financeiros, AgentCore, regras contábeis e telas web existentes não são alterados; mexo neles apenas onde a compatibilidade nativa exigir (safe area/teclado/lifecycle).
- Migration de exclusão é aditiva e revisável: catálogo + função nova, sem apagar nada em produção durante o deploy.
