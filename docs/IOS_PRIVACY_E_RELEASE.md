# Meu Nino — iOS: privacidade, permissões e checklist de release

Documento de apoio para o preenchimento do App Privacy na App Store Connect e
para a revisão da Apple. Atualizar sempre que uma coleta de dados mudar.

## Identidade do app

| Item | Valor |
| --- | --- |
| Bundle ID | `br.com.meunino.app` |
| Nome | Meu Nino |
| Versão de marketing | 1.0.0 |
| Build | 1 |
| Orientação | Retrato |
| URL scheme | `meunino://` |
| Universal Links | `meunino.com.br`, `www.meunino.com.br` |
| Web bundle | Local (`dist/`). Nenhum `server.url` de desenvolvimento em produção. |

## Permissões declaradas (Info.plist, textos em pt-BR)

| Chave | Uso real no produto |
| --- | --- |
| `NSCameraUsageDescription` | Fotografar comprovantes e extratos para extração de lançamentos. |
| `NSPhotoLibraryUsageDescription` | Anexar prints e comprovantes já salvos no aparelho. |
| `NSMicrophoneUsageDescription` | Gravar mensagens de voz para o Nino transcrever. |
| `NSFaceIDUsageDescription` | Desbloquear o app com Face ID / Touch ID. |

Nenhuma permissão é solicitada na abertura: todas acontecem no momento da ação
do usuário, com estado de recusa tratado com texto claro em português.

## App Privacy — dados coletados

| Categoria | Dados | Vinculado ao usuário | Uso |
| --- | --- | --- | --- |
| Informações de contato | e-mail, nome de exibição, telefone do WhatsApp (opcional) | Sim | Funcionalidade do app |
| Informações financeiras | lançamentos, contas, cartões, dívidas, metas, investimentos | Sim | Funcionalidade do app |
| Conteúdo do usuário | mensagens com o Nino, áudios, fotos de documentos | Sim | Funcionalidade do app |
| Diagnóstico | erros e latência de operações (sem conteúdo do usuário) | Não | Desempenho do app |

Não há rastreamento entre apps, não há IDFA, não há publicidade e não há venda
ou compartilhamento de dados com corretores. Conversas e documentos são
processados apenas para gerar a resposta e o lançamento pedidos pelo usuário.

## Privacy Manifest (`PrivacyInfo.xcprivacy`)

Required Reason APIs declaradas: acesso a `UserDefaults` (CA92.1), timestamp de
arquivo (C617.1) e espaço em disco (E174.1). `NSPrivacyTracking` é `false` e a
lista de domínios de rastreamento está vazia.

## Segurança da sessão

- Tokens ficam no Secure Storage (Keychain), nunca em `localStorage` no app nativo.
- Desbloqueio biométrico opcional. Cancelar o Face ID **não** desloga: o app entra
  em estado bloqueado com opção de tentar de novo ou entrar com e-mail e senha.
- Ao sair do primeiro plano, uma tela de privacidade cobre o conteúdo para não
  vazar valores no App Switcher.
- Deep links passam por allowlist de esquema, host e rota (sem open redirect).
- Logs nativos passam por sanitizador: nenhum token, áudio, documento ou mensagem
  do usuário é impresso no console.

## Exclusão de conta (5.1.1(v))

Perfil → Meus dados → Excluir minha conta. O usuário confirma digitando a frase,
o pedido é aceito na hora com 3 dias de carência (cancelável pelo próprio app) e
depois o processador agendado apaga todos os dados e o registro de autenticação.
A purga é dinâmica: o catálogo `account_deletion_targets` cobre todas as tabelas
com dados do usuário (110 mapeadas), apagando os dados e desvinculando apenas as
trilhas de auditoria exigidas por conformidade.

## Checklist antes de enviar para revisão

- [ ] Conta Apple Developer ativa e certificados de distribuição.
- [ ] `npm run build && npx cap sync ios` executado com o bundle local.
- [ ] Ícone 1024px sem transparência e Launch Screen em Deep Ink (#10111A).
- [ ] Screenshots por tamanho de tela exigido, em português.
- [ ] Classificação de conteúdo e App Privacy preenchidos conforme as tabelas acima.
- [ ] Conta de teste para o revisor com dados de exemplo.
- [ ] Política de Privacidade (`/privacidade`) e Termos (`/termos`) públicos e linkados no app.
- [ ] Nada de compra digital fora das lojas: Premium aparece como "Em breve", sem checkout externo.
