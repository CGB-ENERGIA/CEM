---
version: 1
slug: "src-app-svelte"
primary_target: "src/App.svelte"
related_targets: []
---

# Blitz Estática · painel operacional

## Scope and mode
Operate. Ferramenta de campo (celular) e gestão (desktop): registrar blitz, consultar materiais por tipo de equipe, ver dashboard mensal, cadastrar equipes.

## Audience, job, constraints
Inspetor de segurança registra a blitz em pé, ao lado da equipe, no celular. Gestão consulta materiais e dashboard no desktop. Sem marca oficial: a identidade é criada aqui. Sem exigências especiais de uso.

## Direction contract
THESIS: cada equipe é uma etiqueta de inspeção. O estado de segurança vive na cor da etiqueta, não em badge genérico nem em card colorido. Recusa o dashboard de cards com ícone, título e métrica.
OWN-WORLD: fundo aço-claro frio, tinta de estêncil quase preta para títulos, etiquetas de inspeção em verde, âmbar e vermelho (cor de sinalização ISO 3864) com texto escuro, ilhós nas etiquetas, números de série e prefixos em fonte monoespaçada. Azul-aço apenas para ação primária. Sem gradiente, sem vidro, sem sombra colorida.
STORY: o inspetor identifica a equipe numa etiqueta, marca cada material com uma etiqueta de status e vê o contador de pendências cair até zero. A gestão lê o dashboard como pilha de etiquetas: quem não foi inspecionado e o que mais falta.
FIRST VIEWPORT: desktop com barra superior fina (marca CEM e quatro abas em formato de etiqueta de pasta). Abaixo, o bloco de identificação da blitz como etiqueta com ilhó; à direita, o contador de pendências. Logo abaixo, a primeira linha da checklist: número, descrição e três abas de status (OK, Não OK, Faltante). Ação primária "Registrar blitz" fixa no rodapé. Mobile: identificação empilhada, itens como cartões-etiqueta de largura total, ação primária fixa na base.
FORM: código direto. Sem comp. Assinatura: ao marcar um item, a aba de status "imprime" a cor e a etiqueta assenta com um leve deslocamento. Dashboard: equipes e itens pendentes entram em cascata como pilha de etiquetas.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.

seed: 30c9c741115851d7
