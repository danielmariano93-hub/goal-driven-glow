

# Reconstrucao Completa: Ecossistema Financeiro Pessoal

## Visao Geral

Reconstruir a aplicacao de 5 paginas estaticas para um ecossistema de 10 modulos com dados dinamicos, CRUD completo, calculos em tempo real e estado global reativo. Toda alteracao em qualquer modulo recalcula automaticamente todos os indicadores.

## Arquitetura de Dados

### Camada de Estado Global

Substituir os arrays estaticos de `mockData.ts` por um **Context + useReducer** centralizado (`FinancialProvider`), persistido em **localStorage**. Cada entidade tera operacoes CRUD completas e toda mutacao dispara recalculo global.

Entidades gerenciadas:
- Lancamentos (receitas + gastos unificados)
- Metas + Aportes
- Dividas + Pagamentos
- Contas Fixas
- Investimentos
- Emocoes Diarias
- Configuracoes do Perfil
- Alertas (gerados automaticamente)

### Novo arquivo: `src/context/FinancialContext.tsx`

Estado centralizado com:
- `state`: todas as entidades + configuracoes
- `dispatch`: acoes CRUD (ADD, UPDATE, DELETE para cada entidade)
- Hooks derivados: `useIndicadores()`, `useAlertas()`, `useScore()`
- Persistencia automatica em localStorage a cada mutacao

### Novo arquivo: `src/lib/engine.ts`

Motor de calculos puros (sem dependencia de React):
- `calcularPatrimonioLiquido(state)`
- `calcularRendaComprometida(state)`
- `calcularScoreFinanceiro(state)` (0-100, composto por 5 fatores)
- `calcularScoreEmocional(state)`
- `calcularProjecao(state, meses)`
- `gerarAlertas(state)`
- `simular(state, cenario)`
- `calcularCustoDivida(divida)`
- `compararAvalancheVsBolaNeve(dividas)`

---

## Navegacao

Manter **Bottom Tab Bar** com 5 abas, mas usar sub-rotas para acessar todos os 10 modulos:

```text
Tab 1: Dashboard (/)
Tab 2: Lancamentos (/lancamentos)
Tab 3: Planejamento (/planejamento) -- inclui Simulador
Tab 4: Metas (/metas)
Tab 5: Mais (/mais) -- menu com: Dividas, Emocoes, Relatorios, Perfil/Config
```

A aba "Mais" sera um hub com links para os modulos complementares:
- `/dividas`
- `/emocoes`
- `/relatorios`
- `/perfil`

---

## Modulos (Paginas)

### MODULO 1 -- Dashboard Estrategico (`/`)

Reconstruir `Index.tsx` com dados 100% dinamicos:

- Bloco 1: Patrimonio liquido, Saldo do mes, Renda comprometida %, Total investido, Total em dividas
- Bloco 2: Score financeiro (0-100) + Score emocional (0-100) com CircularScore
- Bloco 3: Grafico de evolucao patrimonial (linha, 6 meses)
- Bloco 4: Alertas inteligentes (cards vermelhos/laranja)
- Bloco 5: Resumo de metas (top 3) com barras de progresso
- Todos os valores calculados dinamicamente via `useIndicadores()`

### MODULO 2 -- Lancamentos (`/lancamentos`)

Reconstruir `Lancamentos.tsx` como ledger completo:

- Tabela unificada receitas+gastos com colunas: Data, Tipo, Categoria, Subcategoria, Descricao, Valor, Fixo/Variavel, Recorrente, Emocao, Forma pgto
- CRUD completo: modal para adicionar/editar, swipe ou botao para excluir
- Filtros: periodo (mes), categoria, tipo (receita/despesa), impulsivo
- Busca por texto
- Ordenacao por data ou valor
- Botao exportar CSV
- Botao duplicar lancamento
- Cada lancamento alimenta Dashboard, Metas, Simulador

### MODULO 3 -- Metas (`/metas`)

Expandir `Metas.tsx`:

- Tipos de meta: reserva emergencia, investimento, compra, independencia financeira
- CRUD completo com formulario (nome, valor objetivo, aporte, prazo, prioridade, status)
- Status: ativa, pausada, concluida
- Calculo automatico: tempo estimado = (objetivo - atual) / aporte
- Registrar aportes manuais (historico de aportes)
- Simular impacto de mudar aporte (inline)
- Progresso visual com barra + percentual

### MODULO 4 -- Dividas (`/dividas`)

Nova pagina `Dividas.tsx`:

- CRUD de dividas (nome, valor total, saldo, juros, parcela, metodo amortizacao, prioridade)
- Indicadores: total juros projetado, tempo ate quitacao, impacto mensal
- Comparacao avalanche vs bola de neve
- Simular antecipacao de parcelas
- Impacto no patrimonio e renda comprometida

### MODULO 5 -- Planejamento & Simulador (`/planejamento`)

Expandir `Planejamento.tsx`:

- Resumo atual (renda, gastos fixos, variaveis, saldo)
- Campos editaveis: reducao fixo %, reducao variavel %, aumento renda, aumento aporte, quitar divida
- Recalcular: saldo mensal, tempo para metas, patrimonio projetado 12/24/60 meses, renda comprometida futura
- Tabela ANTES vs DEPOIS
- Grafico comparativo (linha) -- atual vs simulado
- Simulacao NAO altera dados reais

### MODULO 6 -- Relatorios (`/relatorios`)

Nova pagina `Relatorios.tsx`:

- Gastos por categoria (barra horizontal)
- Gastos por emocao (barra)
- Evolucao de renda (linha)
- Evolucao de patrimonio (linha)
- Indice de impulsividade (gauge)
- Taxa de poupanca (mensal)
- Insights automaticos gerados pelo engine

### MODULO 7 -- Emocional (`/emocoes`)

Nova pagina `Emocoes.tsx`:

- Registrar emocao diaria (nivel 1-5, emocao principal, observacao)
- Historico em timeline vertical
- Metricas: % gastos impulsivos, correlacao emocao vs categoria
- Score emocional mensal

### MODULO 8 -- Perfil (`/perfil`)

Reconstruir `Perfil.tsx`:

- Configuracoes base: renda mensal, frequencia recebimento, perfil de risco, objetivo macro, horizonte de tempo
- Esses dados alimentam projecoes e scores
- Secoes de investimentos e contas fixas (com CRUD)
- Exportar/importar dados

---

## Motor de Scores (Modulo 9)

Implementado em `engine.ts`:

```text
Score Financeiro (0-100) =
  Taxa de poupanca (peso 25) +
  Crescimento patrimonial (peso 20) +
  Controle de dividas (peso 20) +
  Renda comprometida inversa (peso 20) +
  Consistencia de aportes (peso 15)
```

Score Emocional baseado em % gastos impulsivos e emocoes negativas associadas a gastos.

---

## Alertas Inteligentes (Modulo 10)

Gerados automaticamente pelo engine quando:
- Renda comprometida > 60%
- Meta atrasada (ritmo insuficiente para prazo)
- Divida com juros > 5% a.m.
- Gastos impulsivos > 25% do total
- Patrimonio em queda

Exibidos no Dashboard e acessiveis globalmente.

---

## Estrutura de Arquivos

```text
src/
  context/
    FinancialContext.tsx       -- Estado global + Provider
  lib/
    engine.ts                  -- Calculos puros
    csv.ts                     -- Export/import CSV
  types/
    financial.ts               -- Types expandidos
  components/
    AppLayout.tsx              -- Layout com Outlet
    BottomTabBar.tsx            -- 5 abas (Dashboard, Lancamentos, Planejamento, Metas, Mais)
    LancamentoForm.tsx         -- Modal CRUD lancamento
    MetaForm.tsx               -- Modal CRUD meta
    DividaForm.tsx             -- Modal CRUD divida
    EmocaoForm.tsx             -- Registro emocao
    AlertCard.tsx              -- Card de alerta
    ScoreRing.tsx              -- Indicador circular
  pages/
    Index.tsx                  -- Dashboard
    Lancamentos.tsx            -- Ledger
    Metas.tsx                  -- Metas
    Dividas.tsx                -- Dividas
    Planejamento.tsx           -- Simulador
    Relatorios.tsx             -- Analises
    Emocoes.tsx                -- Comportamental
    Perfil.tsx                 -- Config + perfil
    MaisMenu.tsx               -- Hub de navegacao
```

---

## Detalhes Tecnicos

- **Estado**: React Context + useReducer com persistencia em localStorage
- **Tipos**: Expandir `financial.ts` com Lancamento unificado (receita+gasto), Aporte, PagamentoDivida, ConfiguracaoPerfil, Alerta
- **Recalculo global**: Cada dispatch recalcula indicadores derivados automaticamente
- **Graficos**: recharts (ja instalado) -- LineChart, BarChart
- **Formularios**: Dialogs/Sheets do Radix (ja instalado) com validacao basica
- **CSV**: Funcao utilitaria para exportar array de lancamentos como CSV download
- **UI**: Manter estilo iOS atual (ios-card, fundo #F7F7F8, tipografia Inter)

