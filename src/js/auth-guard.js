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
            // Se logado, verifica o perfil no Firestore
            try {
                // Import dinâmico para evitar dependência circular se houver
                const { Repository } = await import('./repository.js');
                const profile = await Repository.getUserByEmail(user.email);

                if (!profile || profile.role !== 'Orçamento') {
                    if (!isPublicPage) {
                        console.warn('Acesso negado: Perfil insuficiente.');
                        alert('Seu perfil não tem permissão para acessar esta área.');
                        await signOut(auth);
                        window.location.href = 'login.html';
                    }
                }
            } catch (err) {
                console.error('Erro ao verificar permissões:', err);
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
