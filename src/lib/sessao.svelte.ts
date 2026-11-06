export interface Usuario {
  id: number;
  login: string;
  nome: string;
  // Administrador altera dados; sem este perfil o usuário só consulta. O servidor confere em toda rota.
  admin?: boolean;
  // Proprietário também abre a página Usuários.
  proprietario?: boolean;
}

export const sessao = $state<{ estado: "carregando" | "entrou" | "saiu"; usuario: Usuario | null }>({
  estado: "carregando",
  usuario: null,
});

// Quem só consulta não vê os botões que alteram dados. Quem decide de verdade é o servidor.
export function podeEditar(): boolean {
  return sessao.usuario?.admin === true;
}

const CHAVE_USUARIO = "cem-usuario";

// Guarda o usuário no celular para o app abrir sem conexão. A sessão de verdade continua no servidor.
function guardarUsuario(usuario: Usuario | null) {
  try {
    if (usuario) localStorage.setItem(CHAVE_USUARIO, JSON.stringify(usuario));
    else localStorage.removeItem(CHAVE_USUARIO);
  } catch {
    // Sem armazenamento: o app funciona, só não abre offline.
  }
}

export function lerUsuarioGuardado(): Usuario | null {
  try {
    const bruto = localStorage.getItem(CHAVE_USUARIO);
    return bruto ? (JSON.parse(bruto) as Usuario) : null;
  } catch {
    return null;
  }
}

export function definirUsuario(usuario: Usuario) {
  sessao.usuario = usuario;
  sessao.estado = "entrou";
  guardarUsuario(usuario);
}

export function encerrarSessaoLocal() {
  sessao.usuario = null;
  sessao.estado = "saiu";
  guardarUsuario(null);
}
