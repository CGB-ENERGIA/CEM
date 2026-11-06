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

Duas superfícies usam o mesmo sistema. O **sistema administrativo** (`/`, com login) cobre dashboard, histórico de blitzes, controle de pendências, materiais e equipes; ele consulta e gerencia, não registra blitz. O **app de campo** (`/campo/`, sem login) é o único lugar onde a blitz é registrada, pelo encarregado ou supervisor, com fila offline e PWA próprio.

## Colors

- **Fundo aço**: chão da aplicação e furos das etiquetas.
- **Tinta**: cabeçalho e textos principais; fundo da barra de envio.
- **Azul-aço (`primaria`)**: somente ação primária, foco e barras de participação.
- **Verde, âmbar e vermelho**: sinalização ISO 3864. Verde = conforme, âmbar = não conforme (atenção), vermelho = faltante. Vermelho nunca aparece como decoração.

## Temas

Dois temas com os mesmos nomes de token em `src/app.css`:

- **Claro**: aço claro como chão, tinta quase preta.
- **Escuro**: grafite profundo como chão (`#0d1116`), superfícies em `#131a21` e `#1a222c`, texto `#e8edf3`. O azul-aço clareia para `#7ab4ea` para manter contraste sobre o fundo. Os estados mantêm o significado da sinalização: verde, âmbar e vermelho.

O tema é escolhido pelo botão no cabeçalho e salvo no navegador. Sem escolha, segue a preferência do sistema. O cabeçalho usa tokens próprios (`--topo-*`) para que o tema escuro não fique "invertido".

## Movimento

- Troca de aba: o painel desliza na direção da aba nova e um indicador azul desliza sob a aba ativa.
- Dados: contadores e barras crescem; linhas entram em cascata.
- Avisos: confirmações e erros chegam pelo canto inferior direito.
- Carregamento: esqueletos com brilho suave em vez de texto de espera.
- Preferência de movimento reduzido: todas as animações são desligadas.

## Typography

Barlow Condensed para títulos, rótulos e chips (caixa alta com tracking leve). Barlow para texto corrido e campos. JetBrains Mono para prefixos, números de item, datas e valores monetários. Todas as fontes são servidas pelo próprio projeto (`@fontsource`).

## Layout

- Cabeçalho escuro com as abas em formato de etiqueta de pasta; a aba ativa assenta sobre o painel com uma faixa azul no topo.
- Conteúdo com largura máxima de 1680px e painéis de 18px de respiro (12px no celular).
- Mobile: abas em barra fixa no rodapé, com rótulos curtos; cabeçalho em uma linha com a marca, o tema e Sair; tabelas viram cartões, com a descrição ou o título primeiro e o nome de cada coluna ao lado do valor; faixa de identificação da equipe presa no checklist da blitz.
- Barra de envio (blitz): fixa na parte de baixo. Trilho de progresso colado à borda superior, à esquerda a contagem e o que falta ("2/7 · 5 itens faltam" ou "Pronto para registrar"), à direita a ação principal em azul. No celular, fica acima da barra de abas.
- Avisos: no canto inferior direito no computador; no celular, descem do topo, logo abaixo do cabeçalho, para não cobrir a barra de envio nem a de abas.
- Alvos de toque: pelo menos 44px no celular, inclusive botões de ação, Sair e o alternador de tema.

## Elevation & Depth

Planos com borda de 1px. Uma sombra fina apenas nos painéis principais e uma sombra para cima na barra de envio fixa.

## Shapes

Cantos de 4px nas etiquetas, 6px nos painéis e campos. Ilhó da etiqueta é uma fenda de 12×5px no canto superior esquerdo, nunca um círculo (para não parecer botão de rádio).

## Components

- **Etiqueta** (`.etiqueta`): cartão com fenda de ilhó.
- **Chip** (`.chip`): status e grupo (EPI/EPC), em caixa alta.
- **Segmento de situação**: três botões OK / Não OK / Faltante por item, sem valor padrão. A selecionada assume a cor do status. Em Não OK ou Faltante, um contador informa quantas unidades (quando o item exige mais de uma).
- **Trilho e preenchimento**: progresso e rankings, animados na entrada.
- **Situação com cor**: vermelho só para Faltante; Não OK em âmbar; OK em verde. Ações (registrar, instalar, salvar) em azul-aço, nunca em âmbar ou vermelho.
- **Rótulos de situação**: os mesmos nomes dos botões, em qualquer lugar da tela: OK, Faltante, Não OK.
- **Planilha de equipes**: exportar e importar na aba Equipes. Importar cria e atualiza por prefixo e nunca remove; erros de linha viram um aviso só.
- **Ícone de tema**: `IconeTema` é o único ícone de tema, usado no cabeçalho e no login.

## Do's and Don'ts

- Faça: status sempre com cor e texto (nunca só cor).
- Faça: números e códigos sempre em mono, alinhados à direita nas tabelas.
- Não faça: rótulo acima de título (eyebrow), borda lateral colorida, gradiente de texto, badge genérico sem significado de status.
