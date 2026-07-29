## Objetivo

1. Garantir que o painel de WhatsApp **sempre** ofereça um caminho visível para conectar/reconectar (QR ou código de pareamento).
2. Auditar todas as abas e indicadores do Admin, remover o que é ruído/duplicado e reconstruir cada tela em torno de indicadores que geram decisão.

---

## Parte 1 — WhatsApp: conexão sempre acessível

### O que existe hoje (verificado no código)

`src/pages/admin/WhatsAppSessionPanel.tsx`:
- O card `ConnectDeviceCard` (QR + código de pareamento + "Redefinir sessão") só é renderizado quando `configured === true` **e** `status !== "connected"`.
- Se `config_status` retorna `configured: false`, a tela mostra **apenas** o botão "Configurar conexão", desabilitado para quem não é dono da plataforma — sem QR, sem código, sem alternativa. É um beco sem saída.
- Se o provedor responde `WORKING` mas o aparelho está de fato deslogado (caso já observado: a sessão parou em 28/07), o painel considera `connected`, esconde o `ConnectDeviceCard` e só oferece "Reiniciar" / "Desconectar" — nenhuma ação chamada "Reconectar".
- Diagnóstico exato de qual dos dois casos está ativo hoje ainda **não está confirmado**; a primeira ação da implementação é checar `config_status` + `status` reais.

### Correções

1. **Diagnóstico primeiro**: chamar `config_status` e `status` e registrar o retorno, para saber se o painel está em estado `not_configured` ou `connected` falso.
2. **Ação "Reconectar aparelho" sempre visível**: no estado conectado, incluir botão que abre o `ConnectDeviceCard` (com aviso de que o aparelho atual será desconectado). Nada mais fica escondido atrás do status.
3. **Fim do beco sem saída em `not_configured`**: manter o wizard de credenciais, mas explicar em texto claro o que falta e para quem pedir, e — quando as credenciais existirem mas a sessão não — mostrar o card de conexão mesmo assim.
4. **Estado de erro/indisponível**: quando não for possível ler o status, exibir o card de conexão com aviso, em vez de bloquear a tela.
5. **Feedback honesto de permissão**: se o papel não pode parear, dizer isso na própria ação, não sumir com ela.
6. Unificar `WhatsAppValidateCard` + painel de sessão numa única tela com ordem lógica: Status → Conectar/Reconectar → Recebimento de mensagens → Credenciais.

*Sem alteração de backend prevista; se o diagnóstico apontar erro no mapeamento de status do provedor, a correção entra na Edge Function `whatsapp-session`.*

---

## Parte 2 — Auditoria e redesenho do Admin

### Problemas encontrados na estrutura atual

- 14 itens de menu em 4 grupos, com duplicação real: **Mensageria** (`operacao/Mensageria.tsx`) é apenas um `export { default } from "./WhatsApp"` — duas abas para a mesma tela.
- **Simulador** ocupa item de menu próprio, sendo uma ferramenta interna do Assessor.
- Páginas legadas ainda no bundle e sem entrada de menu: `VisaoGeral`, `Usuarios`, `Engajamento`, `Financeiro`, `Produto`, `Mensagens`, `Seguranca`, `IAInteligencia`, `Agente`, `Operacao`, `NinoContexto` (v1), `AssessorAcompanhamento` (v1), `ProactiveEnginePanel` (v1).
- Indicadores repetidos entre Cockpit / Crescimento / Inteligência de Produto, muitos com base amostral de 2 usuários reais — número sem significado estatístico apresentado como métrica.

### Estrutura proposta (9 itens, 3 grupos)

```text
NEGÓCIO
  Cockpit            visão única do dia
  Clientes           lista real de usuários + ficha individual
  Crescimento        ativação, retenção e receita (fundidos)

OPERAÇÃO
  Saúde              automações, filas, erros
  WhatsApp           conexão, recebimento, envios  (absorve Mensageria)
  Assessor           qualidade, custo IA, OCR, simulador em aba interna
  Comunicação        proativas: enviadas, bloqueadas, agendadas

GOVERNANÇA
  Segurança          break-glass, permissões
  Auditoria          trilha de ações + configurações
```

### Princípio para cada indicador

Cada card precisa passar em três testes, senão sai da tela:
- responde a uma pergunta que o founder faz de verdade;
- tem uma ação associada quando o número está ruim;
- é confiável na base atual (com 2 usuários reais, percentuais e coortes viram texto absoluto: "2 de 2 ativos", nunca "100% de retenção").

### Indicadores por aba (proposta)

- **Cockpit**: canal WhatsApp no ar (com ação de reconectar), mensagens hoje (recebidas/respondidas/falhas), lançamentos registrados hoje, automações em falha, custo de IA no mês. Nada além disso.
- **Clientes**: lista real com último uso, nº de lançamentos, canal vinculado, estado do onboarding. Ficha individual com linha do tempo de mensagens.
- **Crescimento**: cadastros, ativação (primeiro lançamento), usuários ativos na semana, receita — todos em números absolutos com série temporal.
- **Saúde**: um card por job (última execução, processados, falhas) com ação de reprocessar — já existe, será apenas enxugado e ordenado por criticidade.
- **WhatsApp**: conforme Parte 1.
- **Assessor**: respostas por dia, taxa de falha, tempo de resposta, custo/tokens por dia e por conversa, documentos processados e taxa de extração, simulador em aba.
- **Comunicação**: fila, enviadas, bloqueadas com motivo em linguagem clara, próximas agendadas.
- **Segurança / Auditoria**: sessões break-glass, ações sensíveis, últimas alterações de configuração.

### Design

Mobile-first, DM Sans, paleta oficial Meu Nino, primitivos existentes (`PageHeader`, `KpiCard`, `StatusChip`, `DataTable`, `EmptyState`). Cada tela: cabeçalho → 3–5 KPIs → 1 gráfico ou tabela → ações. Todo rótulo em linguagem de produto, sem termos técnicos.

---

## Detalhes técnicos

- Edições concentradas em `src/components/admin/AdminLayout.tsx` (menu), `src/App.tsx` (rotas), páginas em `src/pages/admin/**` e `src/pages/admin/operacao/**`.
- Remoção dos arquivos legados listados acima e da rota/arquivo `operacao/Mensageria.tsx`.
- RPCs `admin_v2_*` existentes serão reaproveitados; indicadores removidos não exigem mudança de banco. Se algum card novo precisar de agregado inexistente, será criada uma migration aditiva com GRANTs e RLS por permissão de plataforma.
- App do usuário, autenticação, agente e integrações não são tocados.
- Sem publicação em produção sem autorização explícita.

## Fora de escopo

Alterar identidade visual da marca, mudar a Landing Page, ou remover permissões/RBAC já implantados.
