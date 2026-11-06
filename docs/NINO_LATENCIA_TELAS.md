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

## Rodada 2 (06/11/2026): as três telas que esperam por função no servidor
Verificado no código: Metas, Mapa e Relatórios dependem de chamadas à função `nino-insights` (mediana ~1,1 s) e/ou ao snapshot financeiro
(`home-snapshot`, mediana 1,1 s, p95 3,4 s). A página desenha rápido; o "Tela pronta" espera essas chamadas.

| Tela | Chamadas no caminho crítico (antes) | Depois |
|---|---|---|
| Metas | `nino-insights` (panorama das metas) + `home-snapshot` + ~12 consultas diretas ao banco (rápidas) | panorama e snapshot aquecidos no cache logo depois do app abrir |
| Mapa | flag → `nino-insights` (em fila) + redação da IA (dentro do relógio) | leitura junto com a flag, aquecida; redação fora do relógio |
| Relatórios | `nino-insights` (painel do mês) | painel padrão aquecido ao tocar/passar o mouse no link |

**Como funciona** (`lib/perf/screenWarmup.ts`): aquecimento ocioso (Metas e Mapa) e por intenção (toque ou mouse em link para Relatórios, Metas ou Mapa).
Cada consulta aquecida usa as MESMAS opções que a tela (`goalsOverviewOptions`, `snapshotQueryOptions`, `dashboardQueryOptions`, `mapaReadingOptions`); um teste
confirma que o dado cai na chave que a tela lê. Dado com menos de 60 s não é buscado de novo. Não roda com economia de dados nem em conexão 2G.

**Limites (honestos)**
- Ajuda quando a pessoa chega à tela depois de o app já estar aberto (o caso comum: abre o Início e navega). **Não ajuda link direto de tela fria.**
- Custo: de 3 a 5 chamadas a mais por abertura do app. Irrelevante hoje; com muitos usuários, reavaliar (o snapshot e o panorama pesam no servidor).
- O dado aquecido pode ter até alguns minutos; as telas já refazem a consulta em segundo plano e atualizam sozinhas.
- Perfil não foi alterado: uma consulta direta e poucas aberturas (4 em 7 dias); falta amostra para saber onde está o tempo.

## Como medir o depois (mesma fonte do antes)
```sql
select route, count(*) aberturas,
       round(percentile_cont(0.5) within group (order by ready_ms)) mediana_ms,
       round(percentile_cont(0.75) within group (order by ready_ms)) p75_ms
  from client_perf_events
 where occurred_at > :data_do_deploy and nav_kind = 'soft' and ready_ms is not null
 group by route order by p75_ms desc;
```
Comparar sempre telas abertas por navegação (`soft`), com a mesma fonte do "antes" (tabela acima), e olhar por versão do app (`build`).
