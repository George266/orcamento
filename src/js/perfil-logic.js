import { Repository } from './repository.js';
import { auth } from './firebase-config.js';
import { onAuthStateChanged, sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

let currentProfile = null;

async function initProfile() {
    onAuthStateChanged(auth, async (user) => {
        if (!user) return;

        // Fetch user profile from Firestore
        const profile = await Repository.getUserByEmail(user.email);
        if (!profile) return;
        currentProfile = profile;

        await updateUI(profile, user.email);
        setupEvents();
    });
}

async function updateUI(profile, email) {
    let instituto = null;
    if (profile.instId) {
        instituto = await Repository.getInstitutoById(profile.instId);
    }

    // Update Header
    const nameHeader = document.getElementById('user-name-header');
    if (nameHeader) nameHeader.textContent = profile.name || email;

    const instHeader = document.getElementById('user-inst-header');
    if (instHeader) instHeader.textContent = instituto?.nome || 'Gestor SUS';

    // Update Main View
    document.getElementById('profile-name-lg').textContent = profile.name || '---';
    document.getElementById('profile-role-badge').textContent = profile.role || '---';
    document.getElementById('profile-email').textContent = email;
    document.getElementById('profile-inst-name').textContent = instituto?.nome || 'Secretaria de Saúde';

    // Update Details
    document.getElementById('detail-name').textContent = profile.name || '---';
    document.getElementById('detail-email').textContent = email;
    document.getElementById('detail-role').textContent = profile.role || '---';
    document.getElementById('detail-inst').textContent = instituto?.nome || 'N/A';

    // Update Inputs
    document.getElementById('input-name').value = profile.name || '';
    document.getElementById('input-email').value = email;
}

function setupEvents() {
    const editBtn = document.getElementById('edit-profile-btn');
    const saveBtn = document.getElementById('save-profile-btn');
    const cancelBtn = document.getElementById('cancel-edit-btn');
    const displayView = document.getElementById('profile-display-view');
    const editView = document.getElementById('profile-edit-view');

    const toggleMode = (editing) => {
        displayView.classList.toggle('hidden', editing);
        editView.classList.toggle('hidden', !editing);
        editBtn.classList.toggle('hidden', editing);
        saveBtn.classList.toggle('hidden', !editing);
        cancelBtn.classList.toggle('hidden', !editing);
    };

    if (editBtn) {
        editBtn.addEventListener('click', () => toggleMode(true));
    }

    if (cancelBtn) {
        cancelBtn.addEventListener('click', () => {
            document.getElementById('input-name').value = currentProfile?.name || '';
            toggleMode(false);
        });
    }

    if (saveBtn) {
        saveBtn.addEventListener('click', async () => {
            const newName = document.getElementById('input-name').value;

            if (!newName) {
                alert('O nome não pode ficar vazio.');
                return;
            }

            try {
                saveBtn.disabled = true;
                saveBtn.textContent = 'Salvando...';

                const updatedProfile = { ...currentProfile, name: newName };
                await Repository.saveUser(updatedProfile);

                currentProfile = updatedProfile;
                await updateUI(updatedProfile, auth.currentUser.email);

                toggleMode(false);
                alert('Perfil atualizado com sucesso!');
            } catch (error) {
                console.error('Erro ao salvar perfil:', error);
                alert('Erro ao salvar alterações.');
            } finally {
                saveBtn.disabled = false;
                saveBtn.textContent = 'Salvar';
            }
        });
    }

    // Profile Dropdown Toggle
    const btn = document.getElementById('profile-menu-btn');
    const dropdown = document.getElementById('profile-dropdown');
    const logoutBtn = document.getElementById('logout-btn');

    if (btn && dropdown) {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            dropdown.classList.toggle('hidden');
        });

        document.addEventListener('click', () => {
            dropdown.classList.add('hidden');
        });
    }

    if (logoutBtn) {
        logoutBtn.addEventListener('click', async () => {
            const { logout } = await import('./auth-guard.js');
            await logout();
        });
    }

    // Reset Password
    const resetBtn = document.getElementById('reset-pwd-btn');
    if (resetBtn) {
        resetBtn.addEventListener('click', async () => {
            const email = auth.currentUser?.email;
            if (email) {
                try {
                    await sendPasswordResetEmail(auth, email);
                    alert(`Um e-mail de redefinição foi enviado para: ${email}. Verifique sua caixa de entrada (e o spam).`);
                } catch (error) {
                    console.error('Erro ao enviar e-mail:', error);
                    alert('Erro ao solicitar redefinição. Tente novamente mais tarde.');
                }
            }
        });
    }
}

// Start
initProfile();
