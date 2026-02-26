
# Simulador de Decisao de Gasto

## Objetivo

Substituir completamente o modulo de Planejamento (simulador de sliders) por um **Simulador de Decisao de Gasto** -- uma ferramenta onde o usuario simula uma compra antes de realiza-la e recebe analise estrategica e comportamental do impacto.

## Arquivos Modificados

| Arquivo | Acao |
|---------|------|
| `src/pages/Planejamento.tsx` | Reescrever completamente |
| `src/lib/engine.ts` | Adicionar funcao `simularGasto()` |

## Nova Funcao no Engine (`src/lib/engine.ts`)

Adicionar `simularGasto(state, gasto)` que recebe:

```text
gasto = { valor, categoria, parcelado, parcelas, emocao }
```

E retorna:

```text
{
  // Impacto imediato
  saldoAtual, saldoComGasto, diferencaSaldo,
  taxaPoupancaAtual, taxaPoupancaComGasto,

  // Impacto estrategico (12 meses)
  patrimonioAtual12m, patrimonioComGasto12m,
  scoreAtual, scoreComGasto,

  // Impacto nas metas
  metas: [{ nome, tempoAtual, tempoComGasto, atraso }],

  // Feedback comportamental
  feedback: string (mensagem contextual baseada em emocao + valor + categoria)
}
```

Logica de parcelamento: se parcelado, o impacto mensal e `valor / parcelas` por N meses, afetando a projecao de patrimonio e o saldo de cada mes simulado.

## Nova Pagina (`src/pages/Planejamento.tsx`)

Reescrita completa com 2 estados: **formulario** e **resultado**.

### Estado 1: Formulario

- Campo: Valor do gasto (input numerico, R$)
- Campo: Categoria (select com `CATEGORIAS_GASTO`)
- Campo: Parcelado (toggle sim/nao)
- Campo: Numero de parcelas (aparece se parcelado = sim)
- Campo: Emocao associada (select opcional com `EMOCOES`)
- Botao: "Analisar Impacto" (azul primario)

Visual: ios-cards brancos, inputs estilo iOS, consistente com o resto do app.

### Estado 2: Resultado (4 blocos)

**Bloco 1 -- Impacto Imediato**
- Saldo do mes: atual -> com gasto (com cor verde/vermelho)
- Taxa de poupanca: atual -> com gasto

**Bloco 2 -- Impacto Estrategico (12 meses)**
- Patrimonio projetado: sem gasto vs com gasto
- Score financeiro: atual vs projetado
- Grafico de linha comparativo (2 linhas: "Sem gasto" vs "Com gasto") mostrando 12 meses

**Bloco 3 -- Impacto nas Metas**
- Lista de metas ativas com tempo estimado atual vs com o gasto
- Destaque em vermelho se o gasto atrasa alguma meta

**Bloco 4 -- Feedback Comportamental**
- Mensagem inteligente baseada na emocao selecionada e no impacto
- Exemplos: "Compra por impulso: considere esperar 24h", "Este gasto compromete X% da sua renda"

**Botoes de acao:**
- "Confirmar e lancar como despesa" -- cria o lancamento automaticamente via dispatch (ADD_LANCAMENTO) e volta ao formulario
- "Cancelar" -- limpa a simulacao e volta ao formulario

### Detalhes Tecnicos

- A simulacao usa dados reais do `FinancialContext` via `useFinancial()` e `useIndicadores()`
- Nenhum dado real e alterado ate o usuario clicar "Confirmar"
- Ao confirmar, o lancamento e criado com todos os campos preenchidos (data=hoje, tipo=despesa, categoria, valor, emocao, impulsivo baseado na emocao)
- Se parcelado, cria N lancamentos futuros (1 por mes) com valor = total / parcelas
- O grafico usa recharts (LineChart) ja instalado
- Feedback comportamental e gerado por logica condicional simples no engine (sem IA)
