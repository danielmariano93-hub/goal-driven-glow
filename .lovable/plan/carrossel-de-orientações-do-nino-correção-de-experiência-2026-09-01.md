# Carrossel de orientações do Nino — correção de experiência

## O problema (visível nos prints)
- Os slides não ocupam a largura inteira: o card seguinte "vaza" cortado na borda e o card atual aparece deslocado no meio da transição (`align: "start"` + `pr-1` sem gap real).
- Os cards têm alturas diferentes. Quando o carrossel troca, o bloco encolhe/estica e o conteúdo abaixo (Resumo do período) salta.
- Sobra um vazio grande entre o card curto e os pontinhos, porque a altura fica travada pelo card mais alto sem o card curto se distribuir.
- A troca automática não tem indicação de progresso: o card muda "do nada" enquanto a pessoa lê.

## Como um bom carrossel editorial se comporta (referência Apple/Nubank)
1. Um slide = uma largura inteira, com respiro lateral igual à margem da Home. Nada de card cortado.
2. Todos os slides com a mesma altura, definida pelo mais alto; o card curto distribui seu conteúdo (CTA ancorado embaixo) em vez de deixar buraco.
3. Transição curta e previsível, com o card inativo levemente esmaecido durante o arraste.
4. Pontinhos logo abaixo do card, com barra de progresso fina no indicador ativo mostrando o tempo até a próxima troca.
5. Autoplay pausa em hover, foco, arraste e quando a aba não está visível; respeita `prefers-reduced-motion` (sem autoplay).
6. Acessível: setas ←/→ pelo teclado, `aria-roledescription="carousel"`, cada slide como `group`/`aria-label "1 de 2"`.

## O que vai mudar
Apenas apresentação, dentro de `NinoGuidanceSection.tsx` e ajustes visuais nos dois cards:

- `useEmblaCarousel({ loop: true, align: "center", containScroll: "trimSnaps" })`; slides `flex-[0_0_100%]` com gap por `ml`/`pl` em vez de `pr-1`.
- Trilha com `items-stretch` e cada slide `h-full`, para altura uniforme; os cards passam a `flex flex-col` com o bloco de ações/CTA em `mt-auto`.
- Pontinhos: indicador ativo como pílula com barra de progresso animada (CSS, reiniciada a cada troca) e alvo de toque mínimo de 36px; espaçamento reduzido em relação ao card.
- Autoplay: pausa em `pointerDown`, `mouseenter`, `focusin` e `visibilitychange`; desligado com `prefers-reduced-motion`.
- Teclado e rótulos ARIA no container e nos slides.
- Sem carrossel quando só existe uma orientação (comportamento atual mantido).

## Fora de escopo
Nenhuma mudança de motor, texto, números, backend ou lógica de priorização das orientações.
