# Infraestrutura para publicar o Meu Nino na App Store e no Google Play (com plano pago)

Você confirmou que haverá plano pago dentro do app. Isso torna a camada de assinatura parte obrigatória da infraestrutura, porque as duas lojas exigem compra in-app para conteúdo digital.

## 1. O que já está pronto (verificado no código)

- Web app React/Vite responsivo, com barra inferior no mobile e sidebar no desktop.
- ~45 telas do produto + landing + autenticação; rotas sob `/app` protegidas.
- Backend na Lovable Cloud com ~30 funções (agente, WhatsApp, documentos, relatórios, motores proativos, admin) e núcleo financeiro determinístico.
- Autenticação por e-mail/senha, RBAC de admin, guarda de inatividade de sessão.
- Exportação de dados do usuário e **solicitação de exclusão de conta** já existentes em Perfil (`user_export_data`, `user_request_deletion`) — atendem parcialmente a exigência das lojas.
- Preferências de notificação por tipo já modeladas (`notification_preferences`).

## 2. Infraestrutura que falta

**A. Camada de app instalável / nativa**
- Não existe manifesto web, ícones de app, splash, nem `apple-touch-icon` (só `favicon.ico` e o símbolo SVG da marca).
- Não existe projeto nativo (nenhum Capacitor, iOS ou Android).
- Não existe esquema de deep link nem tratamento de retorno de autenticação para app nativo.

**B. Assinatura e cobrança (bloqueante para as lojas)**
- Nenhuma tabela de plano, assinatura, entitlement ou histórico de cobrança no banco.
- Nenhum provedor de pagamento ligado.
- Nenhum controle de acesso por plano no app (hoje tudo é liberado para qualquer usuário logado).
- Precisa: Apple In-App Purchase + Google Play Billing para o app; opcional cobrança web separada para quem assina pelo site.
- Precisa de um serviço de recibos/entitlement: verificação de recibo da Apple, Real-time Developer Notifications do Google, webhook que grava o status no banco e uma única fonte de verdade "este usuário tem plano ativo até X".

**C. Notificações**
- Não há push nativo: hoje a proatividade sai só por WhatsApp. Faltam projeto FCM (Android), chave APNs (iOS), tabela de tokens de dispositivo, função de envio e roteamento de canal no despachante de comunicação existente para não duplicar mensagem entre push e WhatsApp.

**D. Conformidade e páginas legais**
- Não existem rotas de Política de Privacidade nem Termos de Uso (as lojas exigem URL pública e link dentro do app).
- Falta declaração de privacidade das lojas (App Privacy / Data Safety) cobrindo dados financeiros e conversas com IA.
- Exclusão de conta: hoje passa por análise e carência; as lojas exigem caminho claro e concluível iniciado pelo usuário — precisa de revisão de texto e de prazo automático.
- Falta consentimento explícito de tratamento de dados no cadastro (LGPD).

**E. Recursos nativos que sustentam a aprovação**
- Sem câmera nativa, gravação de áudio nativa, biometria ou armazenamento seguro de sessão. Sem eles o app tende a ser visto como "só um site" pela Apple.
- Sessão hoje usa armazenamento web padrão; em app nativo precisa de armazenamento seguro e refresh em background.

**F. Processo de release**
- Conta Apple Developer (USD 99/ano) e Google Play (USD 25 único).
- Mac com Xcode ou serviço de build em nuvem para gerar o iOS.
- Ficha das lojas: nome, descrição, categoria, screenshots por tamanho, classificação de conteúdo.
- Versionamento, TestFlight e faixa interna do Play, conta de teste para o revisor.
- Observabilidade de crash e erro no app nativo.

## 3. Ordem para deixar tudo preparado

**Fase 1 — Fundação (dá para fazer agora, sem contas de loja)**
1. Ícones, splash, manifesto e metadados: app instalável e identidade visual de aplicativo.
2. Páginas de Política de Privacidade e Termos, com link no app e no cadastro.
3. Ajuste do fluxo de exclusão de conta para o padrão das lojas.
4. Modelo de planos e entitlement no banco (planos, assinatura, status, origem da compra) e um gate de acesso por plano no app, ainda sem cobrar.

**Fase 2 — Casca nativa**
5. Capacitor com projetos iOS e Android, áreas seguras, teclado, gestos, deep links.
6. Armazenamento seguro de sessão e biometria opcional.
7. Câmera e gravação de áudio nativas ligadas aos pipelines de documento e de transcrição que já existem.

**Fase 3 — Monetização e notificações**
8. In-App Purchase (Apple) e Play Billing, com verificação de recibo e webhooks gravando o entitlement.
9. Push nativo (FCM + APNs) com tokens por dispositivo e roteamento de canal.
10. Telas de assinatura: planos, estado atual, restaurar compra, cancelar.

**Fase 4 — Publicação**
11. Ficha das lojas, declarações de privacidade, classificação, conta de teste.
12. TestFlight e faixa interna, correções de revisão, publicação.

## 4. Detalhes técnicos

- Capacitor executa o build do Vite dentro de um WebView nativo; o React não é reescrito e a web continua servida do mesmo código.
- O entitlement deve ser resolvido no servidor a partir dos recibos, nunca por estado local do app; o cliente apenas lê o status.
- Compra pela loja e compra pela web precisam convergir para o mesmo registro de assinatura, com a origem marcada, para evitar cobrança dupla.
- Push exige tabela de tokens com dispositivo/plataforma e limpeza de tokens inválidos; o despachante de comunicação atual passa a escolher canal por preferência e presença de token.
- Permissões de câmera, microfone e notificação precisam ser declaradas nos arquivos nativos com textos de justificativa em português.
- Nada disso altera o núcleo financeiro nem o agente: é camada de entrega, cobrança e conformidade.

## 5. Confirmações antes de executar

- Começo pela Fase 1 completa nesta entrega (ícones, manifesto, legal, modelo de planos e gate), deixando o nativo para a etapa seguinte.
- Preciso saber, para a Fase 3: quantos planos, preços e se haverá teste gratuito.
