# Latência das telas (indicador "Tela pronta")

Medido em 06/11/2026 em `client_perf_events` (7 dias). **Amostra pequena (2 a 3 pessoas):** p75 oscila muito de um dia e de uma versão para outra; use o indicador por versão (`build`) depois de alguns dias, não um dia isolado.

| Tela | Aberturas | Mediana | p75 | O que o medidor mostra |
|---|---|---|---|---|
| Mapa Financeiro | 7 | 4,7 s | 5,5 s | a página desenha em 0,7 s (LCP), o resto é espera por dados |
| Relatórios | 12 | 1,9 s | 3,2 s | LCP 1,8 s |
| Perfil | 4 | 2,7 s | 2,9 s | — |
| Metas | 141 | 1,6 s | 2,4 s | a tela mais usada: maior peso total |
| Início | 82 | 0,6 s | 2,0 s | — |
| Compromissos / Meta por categoria | 8 / 18 | 1,2 s | 2,0 / 1,9 s | — |

## Diagnóstico do Mapa (verificado no código)
1. **Fila de duas esperas:** `Emocoes` esperava a flag (`mapa_enabled`) para só então montar a página, que pedia a leitura à função `nino-insights` (mediana ~1,1 s no servidor, p95 1,6 s).
2. **Texto redigido pela IA dentro do relógio:** o medidor considera "carregando" qualquer consulta inicial sem dado, e a redação da IA (`map_explain`, chamada de modelo) entrava nisso, embora a tela já mostre o texto determinístico. Era a maior parte dos 4,7 s.

## O que foi feito
- A leitura do Mapa começa junto com a flag (sem fila) e o aquecimento ocioso do app (`usePrefetchShellContexts`) já deixa flag e leitura no cache antes da pessoa abrir a aba.
- A redação da IA só é pedida depois do primeiro desenho (800 ms) e é marcada `nonBlocking`: não segura o "Tela pronta", que passa a medir quando a pessoa já consegue usar a tela.
- Consequência para a leitura do indicador: **o Mapa vai "melhorar" em parte porque deixou de contar um extra opcional**, não só porque ficou mais rápido. A comparação justa é a leitura (`nino-insights`, que caiu da fila) e a abertura com cache aquecido.

## Próximos candidatos (hipóteses, ainda não medidas)
- **Metas (maior peso total):** a tela dispara cerca de 14 consultas em paralelo (metas, aportes, investimentos, contas, categorias, 4 meses de lançamentos, metas por categoria, panorama, histórico, ajustes, snapshot financeiro). O volume de dados é pequeno (1.551 lançamentos em 4 meses somando todas as contas), então o custo parece ser de ida e volta e da consulta mais lenta, não do tamanho. Próximo passo: medir o tempo de cada consulta e juntar as que sempre andam juntas numa chamada só.
- **Relatórios e Perfil:** repetir a medição por consulta antes de mexer; mesma técnica.
- **Aquecer por intenção:** pré-carregar Metas quando a pessoa toca no item do menu, antes de abrir.
- **Guardar a última leitura no aparelho** para mostrar na hora e atualizar em seguida (exige decisão de privacidade: dado financeiro no aparelho).
