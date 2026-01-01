import { auth } from './firebase-config';
import { onAuthStateChanged, signOut } from "firebase/auth";

// Proteção de rota: Se não estiver logado, redireciona para o login
export function initAuthGuard() {
    onAuthStateChanged(auth, (user) => {
        if (!user) {
            // Se a página atual não for login.html ou index.html, redireciona
            const currentPage = window.location.pathname;
            if (!currentPage.includes('login.html') && !currentPage.includes('index.html') && currentPage !== '/') {
                window.location.href = 'login.html';
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
