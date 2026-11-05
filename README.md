# PAES · Programa de Acompanhamento de Equipamento de Segurança

Aplicação Svelte + Bun para consulta de materiais de segurança (EPI/EPC) por tipo de equipe e registro de blitz estática, com dashboard mensal.

## Stack

- Frontend: Svelte 5 + Vite, animações com GSAP
- Backend: Bun (`Bun.serve`)
- Banco: Supabase (Postgres), acessado só pelo servidor com a chave `service_role`
- Dados de materiais: `src/lib/data/materiais.json` (gerado a partir de `Estrutura de referencia cgb 2026.xlsx`)

## 1. Configurar o Supabase

1. Crie um projeto no painel do Supabase.
2. Crie o esquema: abra **SQL Editor**, cole o conteúdo de `supabase/migrations/20261030000000_schema.sql` e execute. A migração é idempotente, então pode rodar de novo sem problemas.
3. Copie `.env.example` para `.env` e preencha:
   - `SUPABASE_URL`: em **Project Settings > API**, o campo *Project URL*.
   - `SUPABASE_SERVICE_ROLE_KEY`: em **Project Settings > API**, a chave *service_role*.

A chave `service_role` ignora as regras de acesso do banco. Ela fica só no `.env` do servidor e nunca deve ir para o frontend ou para o repositório. O `.env` já está no `.gitignore`.

## 2. Rodar

Desenvolvimento (dois terminais):

```bash
bun install
bun run dev:api
```

```bash
bun run dev
```

Acesse http://localhost:5173 (o Vite encaminha `/api` para a porta 3000).

Produção:

```bash
bun install
bun run build
bun run start
```

Acesse http://localhost:3000. A porta pode ser trocada com `PORT` no `.env`.

## 3. Acesso e usuários

O sistema exige login. Não há cadastro público: os usuários são criados pelo terminal.

```bash
bun run usuario:criar <login> "<nome completo>"
```

A senha vem da variável `CEM_SENHA` ou, se ela não existir, da primeira linha da entrada padrão. Ela nunca é passada como argumento. A senha precisa ter pelo menos 8 caracteres. O login não diferencia maiúsculas de minúsculas.

- A sessão dura 12 horas e fica em cookie `HttpOnly`.
- Após 5 falhas de senha para o mesmo login, o acesso fica bloqueado por 15 minutos. O bloqueio fica na memória do servidor.

## Pendências de configuração

- Lista oficial de processos em `src/lib/compartilhado.ts` (`PROCESSOS`): hoje contém GSTC, GOMAN e GERE.
- Cadastro de equipes na aba **Equipes**: as equipes sem blitz só aparecem no ranking de "não participaram" depois de cadastradas.

## Planilha de equipes

Na aba **Equipes**, o botão **Exportar planilha** baixa o cadastro completo em `.xlsx`. Editar essa planilha e
reimportá-la pelo botão **Importar planilha** cria as equipes com prefixo novo e atualiza as equipes com prefixo
já cadastrado. **A importação nunca remove equipes** — uma linha apagada da planilha não apaga a equipe no
sistema; para remover, use o botão Remover na própria tela.

A planilha precisa manter as colunas exportadas (Prefixo, Nome, Responsável, Supervisor, Coordenador, Gerência,
Base, Processo, Tipo de equipe, Status). O "Tipo de equipe" usa o nome do tipo (ex.: "A1 - MOTO"), não o código
interno; "Status" aceita "Ativa" ou "Inativa". Uma linha com prefixo em branco, tipo ou processo inválido, ou
repetida na planilha, é ignorada e relatada ao final da importação, sem interromper as demais linhas.

## Vídeos de fundo da tela de login

A tela de login usa dois vídeos em loop, `public/media/video-topo.*` (lado superior) e `public/media/video-base.*` (lado inferior), com capas `poster-topo.jpg` e `poster-base.jpg`. Eles vêm do modelo `login-cem` e são cortados na diagonal pelo próprio componente de login.

## 4. Publicar na Vercel

O frontend é publicado como arquivos estáticos (`dist/`) e a API roda como uma função no runtime Bun da Vercel (`api/[...path].ts`), usando o mesmo código do servidor local.

1. Suba o projeto para um repositório Git (GitHub, GitLab ou Bitbucket). O `.env` não vai para o repositório.
2. No painel da Vercel, **Add New > Project**, importe o repositório. A Vercel lê o `vercel.json` (instalação com `bun install`, build com `bun run build`, saída em `dist`).
3. Em **Settings > Environment Variables**, cadastre:
   - `SUPABASE_URL`: a URL do projeto Supabase.
   - `SUPABASE_SERVICE_ROLE_KEY`: a chave `service_role`. Marque como sensível e não use o prefixo `NEXT_PUBLIC_` nem `VITE_`, para que ela nunca chegue ao navegador.
4. Faça o deploy. Depois, confira em `https://<seu-projeto>.vercel.app/api/auth/me`: a resposta deve ser `{"erro":"Sessão não iniciada."}` com status 401.
5. Abra o endereço no celular, entre com seu login e instale o app na tela inicial (botão **Instalar app**).

Pontos de atenção:
- O runtime Bun da Vercel está em beta. Se o primeiro deploy falhar com erro de runtime, confira se o projeto está com o Bun habilitado nas configurações de Functions.
- O limite de tentativas de login (5 por 15 minutos) fica na memória de cada instância da função. Em produção, com várias instâncias, ele é menos rígido do que no servidor local. Se isso importar, o próximo passo é guardar as tentativas no Supabase.
- O service worker só funciona em HTTPS, então ele só é ativado no endereço publicado (e em `localhost` quando o build de produção roda).
