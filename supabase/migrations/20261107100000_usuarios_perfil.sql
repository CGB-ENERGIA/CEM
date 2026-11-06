-- Perfil de administrador e usuário ativo.
--
-- A página Usuários do painel é só para administradores: criar, editar, redefinir senha, desativar e excluir.
--   admin: pode abrir a página Usuários. O servidor confere este campo em toda rota de usuários.
--   ativo: usuário desativado não entra e perde as sessões abertas, mas continua cadastrado.
--
-- Todos os usuários existentes ficam ativos e sem perfil de administrador, exceto o login abaixo.
--
-- Esta migração pode rodar de novo sem problemas. Roda depois de 20261106100000_pendencias_resolvidas.sql.

alter table usuarios add column if not exists admin boolean not null default false;
alter table usuarios add column if not exists ativo boolean not null default true;

update usuarios set admin = true where lower(login) = 'italo.fontes@cgbengenharia.com.br';
