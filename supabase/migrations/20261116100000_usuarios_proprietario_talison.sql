-- Segundo proprietário: Talison Sousa passa a criar usuários e definir perfis (cargos) na página Usuários.
--
-- Proprietário é o perfil que abre a página Usuários. Ele também é administrador, então altera todos os dados.
-- A página não cria proprietários: este perfil só vem de migração, como a do Ítalo em 20261107120000.
--
-- Esta migração pode rodar de novo sem problemas. Roda depois de 20261107120000_usuarios_proprietario.sql.
-- Se o login ainda não existir, nada acontece: crie o usuário e rode de novo.

update usuarios set proprietario = true, admin = true, ativo = true
where lower(login) = 'talison.sousa@cgbengenharia.com.br';
