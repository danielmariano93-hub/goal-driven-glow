# Meu Nino nas lojas (App Store e Google Play) — análise e caminho

## 1. O que já temos hoje

**Frontend (web app React + Vite + Tailwind)**
- Layout responsivo já pensado para celular: `BottomTabBar` no mobile, `DesktopSidebar` no desktop, `viewport-fit=cover` no `index.html`.
- ~40 telas do produto (Home, Lançamentos, Cartões, Dívidas, Metas, Investimentos, Desafios, Emoções, Relatórios, Divisão do Rolê, Assessor/Nino, Admin, Landing, Auth).
- Anexos e importação já existem via `input type=file` (Assessor, Importar CSV/OFX).

**Backend (Lovable Cloud)**
- ~30 funções de servidor: agente (`agent-chat`, `agent-run`), WhatsApp (webhook, envio, watchdog), documentos, relatórios, insights, motores proativos, admin.
- Núcleo financeiro determinístico compartilhado (`_shared`, `src/lib/engine`) com verdade financeira única.
- Autenticação por e-mail/senha já implementada; papéis/admin com RBAC.

**O que ainda não existe para lojas**
- Nenhum manifesto PWA, ícones de app, service worker ou projeto nativo (nada de Capacitor).
- Nenhuma notificação push nativa (hoje a proatividade vive no WhatsApp).
- Nenhum fluxo de assinatura/pagamento no app.
- Nenhuma tela de exclusão de conta acessível pelo usuário final (exigência das duas lojas).

## 2. Caminho recomendado

Duas etapas, do mais barato ao mais completo:

**Etapa A — App instalável (PWA)**: manifesto, ícones e metadados para "adicionar à tela de início". Entrega a sensação de app em dias, sem conta de desenvolvedor e sem revisão de loja. Não aparece nas lojas.

**Etapa B — App nativo real com Capacitor**: o mesmo código React roda dentro de um app iOS/Android nativo, com push, câmera, gravação de áudio, biometria e presença nas lojas. É o caminho para App Store e Play Store.

```text
React/Vite (mesmo código)
   ├── Web (meunino.com.br)  ← hoje
   ├── PWA instalável        ← Etapa A
   └── Capacitor
         ├── iOS   → App Store   (precisa de Mac/Xcode)
         └── Android → Play Store
```

## 3. O que precisa ser construído para as lojas (Etapa B)

**Produto / identidade**
- Ícone de app em todos os tamanhos, splash screen, screenshots por tamanho de tela, textos e categoria da loja.
- Política de privacidade e termos publicados em URL fixa (já temos domínio).

**Exigências que reprovam o app se faltarem**
- Exclusão de conta dentro do app (Apple 5.1.1(v) e Play): tela em Perfil que dispara a exclusão de fato (já existe função de processamento no backend, falta a porta de entrada do usuário).
- Login social da Apple quando houver login social de terceiros.
- Rótulos de privacidade / Data Safety declarando dados financeiros e conversas com IA.
- Se houver plano pago dentro do app: compra in-app obrigatória (Apple IAP / Play Billing), não cartão externo.
- Risco de reprovação por "app é só um site" (Apple 4.2): mitigado usando recursos nativos reais (push, áudio, câmera, biometria) em vez de um WebView puro.

**Funcionalidades nativas que fazem sentido para o Nino**
- Push nativo para alertas e insights proativos (hoje só WhatsApp).
- Gravação de áudio nativa para falar com o Nino (o pipeline de transcrição já existe no WhatsApp).
- Câmera para fotografar comprovantes (o pipeline documental já existe).
- Biometria/PIN para abrir o app, dado que é dado financeiro.
- Deep links (`meunino://` e links do domínio) e um widget/atalho de lançamento rápido no futuro.

**Infra e processo**
- Conta Apple Developer (USD 99/ano) e Google Play (USD 25 único).
- Máquina macOS com Xcode (ou serviço de build em nuvem) para gerar o app iOS.
- Fluxo de release: TestFlight e faixa interna do Play antes de publicar; versionamento e changelog.
- Atenção a LGPD e ao fato de o app tratar dados financeiros sensíveis.

## 4. Ordem sugerida de execução

1. PWA instalável + ícones e identidade de app (rápido, valida a experiência mobile).
2. Tela de exclusão de conta, política de privacidade e termos publicados.
3. Ajustes de app nativo na interface: áreas seguras (notch), gestos, teclado, estados offline.
4. Adicionar Capacitor e gerar os projetos iOS/Android.
5. Push nativo + áudio nativo + câmera + biometria.
6. Assinatura in-app, se houver plano pago.
7. Pacote de loja (screenshots, textos, privacidade) e submissão em TestFlight/faixa interna.
8. Publicação nas duas lojas.

## 5. Detalhes técnicos

- Capacitor roda o build do Vite dentro de um WebView nativo; nada do React precisa ser reescrito, e a mesma base continua servindo a web.
- Push nativo exige FCM (Android) e APNs (iOS) com uma tabela de tokens de dispositivo e um roteador de canal no despachante de comunicação já existente, para escolher entre WhatsApp e push sem duplicar mensagem.
- Sessão do backend precisa de armazenamento seguro no dispositivo e refresh em background; o cliente atual usa armazenamento web padrão.
- Chamadas ao backend continuam iguais; é preciso liberar o esquema de app nas configurações de redirecionamento de autenticação.
- Notificações e áudio pedem permissões declaradas em `Info.plist` e no manifesto Android.
- Nada disso altera o núcleo financeiro nem o agente; é camada de entrega.

## 6. Decisões que preciso de você

- Vai existir plano pago dentro do app? Isso muda muito o escopo (compra in-app).
- Lançar nas duas lojas ao mesmo tempo ou começar por Android (revisão mais simples e rápida)?
- Você tem Mac disponível ou prefere build em nuvem para o iOS?
