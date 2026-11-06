-- Proprietário: o único perfil que abre a página Usuários.
--
-- Perfis do sistema:
--   proprietario: todas as funcionalidades, inclusive a página Usuários. Só o login abaixo; a página não cria outro.
--   admin (Administrador): todas as funcionalidades, menos a página Usuários.
--
-- Até a migração 20261107100000_usuarios_perfil.sql, o campo admin abria a página Usuários. Agora essa permissão
-- é do campo proprietario, e admin passa a ser só o perfil de Administrador.
--
-- Esta migração pode rodar de novo sem problemas. Roda depois de 20261107100000_usuarios_perfil.sql.

alter table usuarios add column if not exists proprietario boolean not null default false;

update usuarios set proprietario = true, admin = true where lower(login) = 'italo.fontes@cgbengenharia.com.br';
