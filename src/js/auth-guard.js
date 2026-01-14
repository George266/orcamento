import { auth } from './firebase-config';
import { onAuthStateChanged, signOut } from "firebase/auth";

// Proteção de rota: Se não estiver logado ou perfil for insuficiente, redireciona
export function initAuthGuard() {
    onAuthStateChanged(auth, async (user) => {
        const currentPage = window.location.pathname;
        const isPublicPage = currentPage.includes('login.html') || currentPage.includes('index.html') || currentPage === '/';

        if (!user) {
            if (!isPublicPage) {
                window.location.href = 'login.html';
            }
        } else {
            try {
                const { Repository } = await import('./repository.js');
                const profile = await Repository.getUserByEmail(user.email);

                // Normalização robusta: lowercase, remove acentos, remove espaços extras
                const normalize = (str) => str ? str.toString().toLowerCase().trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "") : "";

                if (!profile) {
                    if (!isPublicPage) {
                        alert('Perfil não encontrado no banco de dados. Entre em contato com o administrador.');
                        await signOut(auth);
                        window.location.href = 'login.html';
                    }
                    return;
                }

                // Definir áreas permitidas
                const isAdminPage = currentPage.includes('dashboard_orcamento.html') ||
                    currentPage.includes('acompanhamento_orcamento.html') ||
                    currentPage.includes('configuracao.html') ||
                    currentPage.includes('usuarios.html');

                const isInstitutePage = currentPage.includes('dashboard_instituto.html') ||
                    currentPage.includes('acompanhamento_instituto.html');

                const roleOriginal = profile.role;
                const role = normalize(roleOriginal);

                if (role === 'orcamento') {
                    // Admin can access everything, but if on login/index, send to dashboard
                    if (isPublicPage) window.location.href = 'dashboard_orcamento.html';
                } else if (role.startsWith('institutos')) {
                    // Institute restricted to their pages
                    if (isAdminPage) {
                        window.location.href = 'dashboard_instituto.html';
                    } else if (isPublicPage) {
                        window.location.href = 'dashboard_instituto.html';
                    }
                } else {
                    // Outros papéis
                    if (!isPublicPage) {
                        alert('Perfil sem permissão de acesso.');
                        await signOut(auth);
                        window.location.href = 'login.html';
                    }
                }
            } catch (err) {
                console.error('Erro ao verificar permissões:', err);
                alert('Erro interno de verificação: ' + err.message);
            }
        }
    });
}

// Função de logout
export async function logout() {
    try {
        await signOut(auth);
        window.location.href = 'login.html';
    } catch (error) {
        console.error('Erro ao fazer logout:', error);
    }
}

// Inicializa o guard automaticamente se importado
initAuthGuard();

// Expõe a função de logout para o window se necessário (para onclick em HTML legado)
window.handleLogout = logout;
