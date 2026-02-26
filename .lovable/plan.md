
# Limpar Dados Mockados + Redesign Visual Inspirado no Itau

## 1. Remover todos os dados seed e limpar localStorage

No `FinancialContext.tsx`, substituir todos os arrays de seed (`SEED_LANCAMENTOS`, `SEED_METAS`, `SEED_APORTES`, `SEED_DIVIDAS`, `SEED_CONTAS`, `SEED_INVESTIMENTOS`, `SEED_EMOCOES`) por arrays vazios. O `DEFAULT_CONFIG` permanece com valores zerados (renda_mensal: 0). Tambem alterar o `STORAGE_KEY` para `financial_ecosystem_v2` para forcar o reset do localStorage de quem ja tinha dados salvos. Isso garante que scores, alertas e indicadores partam todos de zero.

## 2. Redesign visual inspirado no layout do Itau

Baseado no print enviado, a estrutura segue: header com saudacao do usuario + area de destaque com cor de marca, seguido de um bottom sheet branco com acoes rapidas e cards de resumo.

### 2.1 Nova paleta de cores (index.css)

Trocar a paleta monocromatica atual por uma com cor primaria de marca (um azul profundo como `hsl(221, 83%, 53%)`) e acentos coloridos:
- `--primary`: azul marca (~`221 83% 53%`)
- `--success`: verde vivo (`152 69% 41%`)
- `--warning`: laranja (`38 92% 50%`)
- `--destructive`: vermelho (`0 72% 51%`)
- Fundo geral continua claro (`#F7F7F8`)
- Cards brancos com sombra suave

### 2.2 Dashboard redesenhado (Index.tsx)

Inspirado no layout do Itau:
- **Header colorido**: area com fundo `bg-primary` (azul) no topo exibindo nome do usuario, mes atual e patrimonio liquido em texto branco
- **Acoes rapidas**: grid horizontal de botoes circulares/quadrados (Novo Lancamento, Metas, Dividas, Relatorios) com icones e labels, similar ao "Pix e transferir / Pagar / Credito" do print
- **Cards de resumo**: Saldo do mes, Renda comprometida, Total investido -- em cards brancos abaixo, com o visual atual mas com cores nos indicadores
- Scores e alertas permanecem abaixo

### 2.3 Bottom Tab Bar com cor

Aba ativa ganha cor primaria (azul) no icone e label, ao inves do preto/cinza atual.

### 2.4 Elementos com mais cor

- Botoes de acao `+` em azul primario ao inves de preto
- Tags de "impulsivo" com fundo vermelho/laranja mais visivel
- Barras de progresso das metas em azul/verde
- Icones do menu "Mais" com backgrounds coloridos (azul, rosa, roxo, verde) ao inves do cinza
- Score rings mantendo verde/amarelo/vermelho mas mais saturados

### 2.5 Empty states

Com os dados zerados, cada pagina precisa de um estado vazio amigavel:
- Lancamentos: mensagem "Nenhum lancamento ainda" + botao de adicionar
- Metas: "Crie sua primeira meta"
- Dividas: "Sem dividas cadastradas"
- Dashboard: indicadores em zero com mensagem de boas-vindas

## Arquivos alterados

| Arquivo | Mudanca |
|---------|---------|
| `src/context/FinancialContext.tsx` | Zerar todos os seeds, mudar STORAGE_KEY |
| `src/index.css` | Nova paleta com primary azul, cores mais vivas |
| `src/pages/Index.tsx` | Header colorido + acoes rapidas + cards |
| `src/components/BottomTabBar.tsx` | Aba ativa com cor primaria |
| `src/pages/MaisMenu.tsx` | Icones com backgrounds coloridos |
| `src/pages/Lancamentos.tsx` | Botao + azul, empty state |
| `src/pages/Metas.tsx` | Barras coloridas, empty state |
| `src/components/AppLayout.tsx` | Ajuste de padding para header colorido |

## Detalhes tecnicos

- O `loadState()` carrega do localStorage se existir; ao mudar o `STORAGE_KEY` para `v2`, todos os usuarios comecam limpos
- Scores retornam 0 quando nao ha dados (engine.ts ja trata divisao por zero)
- Projecao patrimonial no dashboard mostra linha flat em zero ate que haja lancamentos
- Nenhuma entidade ou logica de calculo e alterada, apenas os dados iniciais e o visual
