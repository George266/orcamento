import { auth } from './firebase-config';
import { signInWithEmailAndPassword } from "firebase/auth";

document.addEventListener('DOMContentLoaded', () => {
    const loginForm = document.getElementById('login-form');
    const emailInput = document.getElementById('email');
    const passwordInput = document.getElementById('password');
    const errorMessage = document.getElementById('error-message');

    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            const email = emailInput.value;
            const password = passwordInput.value;

            try {
                // Limpar mensagens de erro anteriores
                if (errorMessage) {
                    errorMessage.textContent = '';
                    errorMessage.classList.add('hidden');
                }

                const userCredential = await signInWithEmailAndPassword(auth, email, password);
                const user = userCredential.user;

                // Get user profile to determine redirection
                const { Repository } = await import('./repository.js');
                const profile = await Repository.getUserByEmail(user.email);

                // Log the login activity
                try {
                    await Repository.logActivity('LOGIN', { email: user.email });
                } catch (logErr) {
                    console.error('Falha ao logar atividade:', logErr);
                }

                console.log('Login realizado com sucesso:', user);

                // Smart Redirection
                // Check for any institute role variant (Institutos, Institutos_Editor, Institutos_Leitor)
                if (profile && profile.role && profile.role.toString().startsWith('Institutos')) {
                    window.location.href = 'dashboard_instituto.html';
                } else {
                    window.location.href = 'dashboard_orcamento.html';
                }
            } catch (error) {
                console.error('Erro ao fazer login:', error.code, error.message);

                if (errorMessage) {
                    errorMessage.classList.remove('hidden');
                    switch (error.code) {
                        case 'auth/invalid-credential':
                            errorMessage.textContent = 'E-mail ou senha incorretos.';
                            break;
                        case 'auth/user-not-found':
                            errorMessage.textContent = 'Usuário não encontrado.';
                            break;
                        case 'auth/wrong-password':
                            errorMessage.textContent = 'Senha incorreta.';
                            break;
                        case 'auth/invalid-email':
                            errorMessage.textContent = 'E-mail inválido.';
                            break;
                        default:
                            errorMessage.textContent = 'Erro ao acessar o sistema. Tente novamente.';
                    }
                }
            }
        });
    }
});
