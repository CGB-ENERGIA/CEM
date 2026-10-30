---
name: Etiqueta de equipamento
description: Sistema visual do Blitz Estática. Cada equipe é uma etiqueta de inspeção; o estado vive na cor da etiqueta.
colors:
  fundo: "#e8ecf0"
  superficie: "#f8fafc"
  superficie-elevada: "#ffffff"
  tinta: "#141a21"
  tinta-suave: "#4b5663"
  borda: "#c3ccd6"
  borda-forte: "#8f9bab"
  primaria: "#1f4e79"
  primaria-suave: "#dbe7f3"
  ok: "#3fae5a"
  ok-suave: "#dcf1e2"
  atencao: "#f2b233"
  atencao-suave: "#fdf0d2"
  falta: "#c8301e"
  falta-suave: "#f9dfd9"
typography:
  titulo:
    fontFamily: Barlow Condensed
    fontWeight: 700
  texto:
    fontFamily: Barlow
    fontWeight: 400
  codigo:
    fontFamily: JetBrains Mono
    fontWeight: 500
rounded:
  padrao: 6px
  etiqueta: 4px
  chip: 3px
---

## Overview

Ferramenta de campo para inspeção de segurança. O sistema é uma etiqueta de inspeção: aço claro como chão, tinta de estêncil para títulos, etiquetas de status para cada item. Não há gradiente, vidro nem sombra colorida.

## Colors

- **Fundo aço**: chão da aplicação e furos das etiquetas.
- **Tinta**: cabeçalho e textos principais; fundo da barra de envio.
- **Azul-aço (`primaria`)**: somente ação primária, foco e barras de participação.
- **Verde, âmbar e vermelho**: sinalização ISO 3864. Verde = conforme, âmbar = não conforme (atenção), vermelho = faltante. Vermelho nunca aparece como decoração.

## Temas

Dois temas com os mesmos nomes de token em `src/app.css`:

- **Claro** (padrão): aço claro como chão, tinta quase preta.
- **Escuro**: grafite profundo como chão (`#0d1116`), superfícies em `#131a21` e `#1a222c`, texto `#e8edf3`. O azul-aço clareia para `#7ab4ea` para manter contraste sobre o fundo. Os estados mantêm o significado da sinalização: verde, âmbar e vermelho.

O tema é escolhido pelo botão no cabeçalho e salvo no navegador. Sem escolha, segue a preferência do sistema. O cabeçalho usa tokens próprios (`--topo-*`) para que o tema escuro não fique "invertido".

## Movimento

- Troca de aba: o painel desliza na direção da aba nova e um indicador azul desliza sob a aba ativa.
- Dados: contadores e barras crescem; linhas entram em cascata.
- Blitz: a etiqueta do item "assenta" ao mudar a situação.
- Avisos: confirmações e erros chegam pelo canto inferior direito.
- Carregamento: esqueletos com brilho suave em vez de texto de espera.
- Preferência de movimento reduzido: todas as animações são desligadas.

## Typography

Barlow Condensed para títulos, rótulos e chips (caixa alta com tracking leve). Barlow para texto corrido e campos. JetBrains Mono para prefixos, números de item, datas e valores monetários. Todas as fontes são servidas pelo próprio projeto (`@fontsource`).

## Layout

- Cabeçalho escuro com as abas em formato de etiqueta de pasta; a aba ativa assenta sobre o painel com uma faixa azul no topo.
- Conteúdo com largura máxima de 1200px e painéis de 24px de respiro.
- Mobile: abas em grade de quatro colunas, itens em cartões de largura total, ação de envio em largura total.

## Elevation & Depth

Planos com borda de 1px. Uma sombra fina apenas nos painéis principais e uma sombra para cima na barra de envio fixa.

## Shapes

Cantos de 4px nas etiquetas, 6px nos painéis e campos. Ilhó da etiqueta é uma fenda de 12×5px no canto superior esquerdo, nunca um círculo (para não parecer botão de rádio).

## Components

- **Etiqueta** (`.etiqueta`): cartão com fenda de ilhó.
- **Chip** (`.chip`): status e grupo (EPI/EPC), em caixa alta.
- **Segmento de situação**: três etiquetas OK / Não OK / Faltante. A selecionada assume a cor do status.
- **Assinatura**: ao mudar a situação de um item, a etiqueta assenta (GSAP, 450ms, `expo.out`).
- **Trilho e preenchimento**: progresso e rankings, animados na entrada.

## Do's and Don'ts

- Faça: status sempre com cor e texto (nunca só cor).
- Faça: números e códigos sempre em mono, alinhados à direita nas tabelas.
- Não faça: rótulo acima de título (eyebrow), borda lateral colorida, gradiente de texto, badge genérico sem significado de status.
