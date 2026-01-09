
import { Repository } from './repository.js';
import { auth } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

function formatCurrency(value) {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}

function formatNumber(value) {
    return new Intl.NumberFormat('pt-BR').format(value);
}

// Global State
let localPactuacoes = [];
let localProcs = [];
let localProgs = [];
let allPactuacoes = [];
let currentSort = { column: null, direction: 'asc' };

async function initAcompanhamentoInst() {
    onAuthStateChanged(auth, async (user) => {
        if (!user) return;

        const profile = await Repository.getUserByEmail(user.email);
        // Allow both Institutos_Editor and Institutos_Leitor (and legacy Institutos)
        if (!profile || !profile.role.startsWith('Institutos')) return;

        const canEdit = profile.role === 'Institutos_Editor' || profile.role === 'Institutos'; // Legacy support

        // --- MULTI-INSTITUTE SUPPORT ---
        const allowedIds = profile.instIds || (profile.instId ? [profile.instId] : []);

        if (allowedIds.length === 0) {
            console.warn('Perfil de Instituto sem vínculos definidos.');
            return;
        }

        allPactuacoes = await Repository.getPactuacoes();
        localProcs = await Repository.getProcedimentos();
        localProgs = await Repository.getProgramas();

        // Hide old filter container if it exists
        const instFilterContainer = document.getElementById('container-filter-inst');
        if (instFilterContainer) instFilterContainer.classList.add('hidden');

        // Initial Data Load
        localPactuacoes = allPactuacoes.filter(p => allowedIds.includes(p.instId));

        // --- HEADER & MENU SETUP ---
        if (allowedIds.length > 1) {
            const institutes = await Repository.getInstitutos();
            const myInsts = institutes.filter(i => allowedIds.includes(i.id));

            // Wait for DOM to assume profile menu is ready
            const profileDropdown = document.getElementById('profile-dropdown');
            if (profileDropdown && !profileDropdown.querySelector('.inst-switcher-container')) {

                // Construct Switcher HTML
                const switcherHtml = document.createElement('div');
                switcherHtml.className = 'inst-switcher-container px-4 py-2 border-b border-slate-100 dark:border-slate-700 mb-1';
                switcherHtml.innerHTML = `
                    <p class="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Alternar Instituto</p>
                    <div class="flex flex-col gap-1">
                        <button data-inst-id="all" class="inst-switcher-btn w-full text-left text-xs font-medium py-1.5 px-2 rounded hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors flex items-center justify-between group text-primary bg-primary/5">
                            <span>Todos</span>
                            <span class="material-symbols-outlined text-[14px]">check</span>
                        </button>
                        ${myInsts.map(inst => `
                            <button data-inst-id="${inst.id}" class="inst-switcher-btn w-full text-left text-xs font-medium py-1.5 px-2 rounded hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors flex items-center justify-between group text-slate-600 dark:text-slate-300">
                                <span class="truncate">${inst.sigla}</span>
                            </button>
                        `).join('')}
                    </div>
                `;

                profileDropdown.insertBefore(switcherHtml, profileDropdown.firstChild);

                // Add Listeners
                const btns = switcherHtml.querySelectorAll('.inst-switcher-btn');
                btns.forEach(btn => {
                    btn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        profileDropdown.classList.add('hidden');

                        const selectedId = btn.dataset.instId;

                        // Update Data
                        if (selectedId === 'all') {
                            localPactuacoes = allPactuacoes.filter(p => allowedIds.includes(p.instId));
                            const nameDisplay = document.getElementById('inst-name-display');
                            if (nameDisplay) nameDisplay.textContent = 'Todos os Vinculados';
                        } else {
                            localPactuacoes = allPactuacoes.filter(p => p.instId === selectedId);
                            const selInst = myInsts.find(i => i.id === selectedId);
                            const nameDisplay = document.getElementById('inst-name-display');
                            if (nameDisplay) nameDisplay.textContent = selInst ? selInst.nome : 'Instituto';
                        }

                        // UI Update
                        const allBtns = profileDropdown.querySelectorAll('.inst-switcher-btn');
                        allBtns.forEach(b => {
                            b.classList.remove('text-primary', 'bg-primary/5', 'text-slate-600', 'dark:text-slate-300');
                            b.classList.add('text-slate-600', 'dark:text-slate-300');
                            const check = b.querySelector('.material-symbols-outlined');
                            if (check) check.remove();

                            if (b.dataset.instId === selectedId) {
                                b.classList.remove('text-slate-600', 'dark:text-slate-300');
                                b.classList.add('text-primary', 'bg-primary/5');
                                b.innerHTML += '<span class="material-symbols-outlined text-[14px]">check</span>';
                            }
                        });

                        // REFRESH COMPETENCE FILTER
                        const compFilter = document.getElementById('filter-competencia');
                        if (compFilter) {
                            if (localPactuacoes.length > 0) {
                                const comps = [...new Set(localPactuacoes.map(p => p.competencia))].sort().reverse();
                                const currentVal = compFilter.value;
                                compFilter.innerHTML = comps.map(c => `<option value="${c}">${c}</option>`).join('');
                                if (comps.includes(currentVal)) {
                                    compFilter.value = currentVal;
                                } else if (comps.length > 0) {
                                    compFilter.value = comps[0];
                                }
                            } else {
                                compFilter.innerHTML = '<option value="">Sem dados</option>';
                            }
                        }

                        renderTable();
                    });
                });
            }

            // Set initial header
            const nameDisplay = document.getElementById('inst-name-display');
            if (nameDisplay) nameDisplay.textContent = 'Todos os Vinculados';

            // Update User Headers
            const nameHeader = document.getElementById('user-name-header');
            if (nameHeader) nameHeader.textContent = profile.name || user.email;
            const instHeader = document.getElementById('inst-header-name');
            if (instHeader) instHeader.textContent = 'Múltiplos Vínculos';

        } else {
            // Single Mode
            const instId = allowedIds[0];
            const instituto = await Repository.getInstitutoById(instId);

            // Update Headers
            const nameHeader = document.getElementById('user-name-header');
            if (nameHeader) nameHeader.textContent = profile.name || user.email;

            const instHeader = document.getElementById('inst-header-name');
            if (instHeader) instHeader.textContent = instituto?.nome || 'Ponto de Pactuação';

            const pageName = document.getElementById('inst-name-display');
            if (pageName) pageName.textContent = instituto?.nome || 'Instituto';
        }

        // Setup Sidebar & Profile Menu Toggle (Crucial!)
        setupProfileMenu();

        // Populate Filters (Initial)
        const compFilter = document.getElementById('filter-competencia');
        if (localPactuacoes.length > 0) {
            const comps = [...new Set(localPactuacoes.map(p => p.competencia))].sort().reverse();
            compFilter.innerHTML = comps.map(c => `<option value="${c}">${c}</option>`).join('');
        }

        // Populate Program Filter
        const progFilter = document.getElementById('filter-programa');
        if (progFilter) {
            // Get unique Program IDs from current pactuacoes
            const uniqueProgIds = [...new Set(localPactuacoes.map(p => p.progId))];
            // Map to Program Objects
            const progs = uniqueProgIds.map(id => localProgs.find(pg => pg.id === id)).filter(Boolean);
            // Sort by Name
            progs.sort((a, b) => a.nome.localeCompare(b.nome));

            progFilter.innerHTML = `<option value="">Todos os Incentivos</option>` +
                progs.map(pg => `<option value="${pg.id}">${pg.nome}</option>`).join('');

            progFilter.addEventListener('change', renderTable);
        }

        // Search Listener
        const searchInput = document.getElementById('buscainteligente');
        if (searchInput) {
            searchInput.addEventListener('input', renderTable);
        }

        if (compFilter) {
            compFilter.addEventListener('change', renderTable);
        }



        // Pass permissions
        window.currentInstPermissions = { canEdit };

        renderTable();
        setupSortListeners();
    });
}

function setupSortListeners() {
    const headers = document.querySelectorAll('th[data-sort]');
    headers.forEach(th => {
        th.style.cursor = 'pointer';
        th.addEventListener('click', () => {
            const column = th.getAttribute('data-sort');
            if (currentSort.column === column) {
                currentSort.direction = currentSort.direction === 'asc' ? 'desc' : 'asc';
            } else {
                currentSort.column = column;
                currentSort.direction = 'asc';
            }

            // Update Icons
            headers.forEach(h => {
                const icon = h.querySelector('.sort-icon');
                if (icon) icon.textContent = 'unfold_more';
                h.classList.remove('text-primary');
            });

            const activeIcon = th.querySelector('.sort-icon');
            if (activeIcon) {
                activeIcon.textContent = currentSort.direction === 'asc' ? 'expand_less' : 'expand_more';
            }
            th.classList.add('text-primary');

            renderTable();
        });
    });
}

// Add autoSave function near the top or export it
window.autoSave = async function (pactId, field, value) {
    const pact = localPactuacoes.find(p => p.id === pactId);
    if (!pact) return;

    if (!pact.producao) pact.producao = { realizada: 0, sem1: 0, sem2: 0, sem3: 0, sem4: 0 };

    // Update local state
    pact.producao[field] = parseInt(value) || 0;

    // Recalculate Total Realizada
    pact.producao.realizada =
        (parseInt(pact.producao.sem1) || 0) +
        (parseInt(pact.producao.sem2) || 0) +
        (parseInt(pact.producao.sem3) || 0) +
        (parseInt(pact.producao.sem4) || 0);

    // Update Firestore
    try {
        await Repository.savePactuacao(pact);

        // Update Row UI calculations immediately without re-rendering everything
        updateRowUI(pactId, pact);
    } catch (error) {
        console.error("AutoSave Error:", error);
    }
};

function updateRowUI(pactId, pact) {
    const row = document.querySelector(`tr[data-id="${pactId}"]`);
    if (!row) return;

    const offer = parseInt(pact.ofertaMinima || 0);
    const real = pact.producao.realizada;
    const status = offer > 0 ? (real / offer) * 100 : 0;

    // Update Status Badge
    const badgeCell = row.querySelector('.status-cell');
    if (badgeCell) {
        badgeCell.innerHTML = `
             <div class="flex flex-col items-center gap-1">
                <span class="text-[10px] font-black ${status >= 100 ? 'text-emerald-600' : 'text-slate-400'}">${Math.round(status)}%</span>
                <div class="w-12 bg-slate-100 h-1 rounded-full overflow-hidden">
                    <div class="h-full ${status >= 100 ? 'bg-emerald-500' : 'bg-primary'}" style="width: ${Math.min(status, 100)}%"></div>
                </div>
            </div>
        `;
    }
}

// Add to window for inline onclick
window.deletePact = async function (id) {
    if (!confirm('Tem certeza que deseja excluir esta linha do Plano Operativo?')) return;

    try {
        await Repository.deletePactuacao(id);

        // Update local state
        localPactuacoes = localPactuacoes.filter(p => p.id !== id);

        // Update UI
        const row = document.querySelector(`tr[data-id="${id}"]`);
        if (row) row.remove();

        // Re-check empty state
        const tbody = document.getElementById('table-acompanhamento-inst');
        if (localPactuacoes.length === 0 && tbody) {
            tbody.innerHTML = `<tr><td colspan="11" class="px-6 py-10 text-center text-slate-400 italic">Nenhum dado encontrado.</td></tr>`;
        }

    } catch (error) {
        console.error('Erro ao excluir:', error);
        alert('Erro ao excluir linha.');
    }
};

function renderTable() {
    const compValue = document.getElementById('filter-competencia')?.value;
    const progValue = document.getElementById('filter-programa')?.value;
    const searchValue = document.getElementById('buscainteligente')?.value.toLowerCase();
    const { canEdit } = window.currentInstPermissions || { canEdit: false };

    if (!compValue) return; // Wait for population

    let filtered = localPactuacoes.filter(p => p.competencia === compValue);

    // Filter by Program
    if (progValue) {
        filtered = filtered.filter(p => p.progId === progValue);
    }

    // Sorting
    if (currentSort.column) {
        filtered.sort((a, b) => {
            let valA, valB;

            switch (currentSort.column) {
                case 'linha':
                    const progA = localProgs.find(pg => pg.id === a.progId);
                    const progB = localProgs.find(pg => pg.id === b.progId);
                    valA = (progA?.nome || '').toLowerCase();
                    valB = (progB?.nome || '').toLowerCase();
                    break;
                case 'sigtap':
                    valA = a.sigtap;
                    valB = b.sigtap;
                    break;
                case 'procedimento':
                    const procA = localProcs.find(pr => pr.sigtap === a.sigtap);
                    const procB = localProcs.find(pr => pr.sigtap === b.sigtap);
                    valA = procA?.nome || '';
                    valB = procB?.nome || '';
                    break;
                case 'oferta':
                    valA = parseInt(a.ofertaMinima || 0);
                    valB = parseInt(b.ofertaMinima || 0);
                    break;
                case 'vlrSigtap':
                    valA = parseFloat(a.vlrSigtapBase || 0);
                    valB = parseFloat(b.vlrSigtapBase || 0);
                    break;
                case 'vlrIncentivo':
                    valA = parseFloat(a.vlrIncentivo || 0);
                    valB = parseFloat(b.vlrIncentivo || 0);
                    break;
                default:
                    return 0;
            }

            if (valA < valB) return currentSort.direction === 'asc' ? -1 : 1;
            if (valA > valB) return currentSort.direction === 'asc' ? 1 : -1;
            return 0;
        });
    }

    if (searchValue) {
        filtered = filtered.filter(p => {
            const proc = localProcs.find(pr => pr.sigtap === p.sigtap);
            const term = searchValue;
            return (
                p.sigtap.includes(term) ||
                (proc && proc.nome.toLowerCase().includes(term))
            );
        });
    }

    const tbody = document.getElementById('table-acompanhamento-inst');
    if (!tbody) return;

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="9" class="px-6 py-10 text-center text-slate-400 italic">Nenhum dado encontrado para os filtros selecionados.</td></tr>`;
    } else {
        tbody.innerHTML = filtered.map(p => {
            const proc = localProcs.find(pr => pr.sigtap === p.sigtap);
            // Get Program Name
            const prog = localProgs.find(pg => pg.id === p.progId);
            const progName = prog ? prog.nome : "Programa Padrão";

            const pact = parseInt(p.ofertaMinima || 0);
            const vBase = parseFloat(p.vlrSigtapBase || 0);
            const vInc = parseFloat(p.vlrIncentivo || 0);

            const prod = p.producao || { sem1: 0, sem2: 0, sem3: 0, sem4: 0 };
            const inputState = canEdit ? '' : 'disabled';
            const activeClass = canEdit ? 'bg-white focus:ring-primary focus:border-primary' : '';
            const baseInputClass = "w-[70px] text-center text-sm font-bold border-slate-200 rounded px-1 py-1 transition-all";
            const disabledClass = 'bg-slate-50 text-slate-500 cursor-not-allowed';


            return `
                <tr data-id="${p.id}" class="hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors group">
                    <td class="px-3 py-3 whitespace-nowrap text-xs font-medium text-slate-900 dark:text-white">
                        <span class="text-[10px] text-slate-500 uppercase tracking-widest">${progName}</span>
                    </td>
                    <td class="px-2 py-3 whitespace-nowrap text-xs text-center font-mono text-slate-500">
                        ${p.sigtap}
                    </td>
                    <td class="px-3 py-3 whitespace-nowrap text-xs font-medium text-slate-900 dark:text-white">
                        <div class="flex flex-col">
                            <span class="font-bold truncate max-w-[180px]" title="${proc?.nome}">${proc?.nome || 'Procedimento'}</span>
                        </div>
                    </td>
                    <td class="px-2 py-3 text-center font-mono text-xs font-bold text-slate-500 bg-slate-50/50">${formatNumber(pact)}</td>
                    
                    <!-- Week Inputs -->
                    <td class="p-1 text-center"><input type="number" value="${prod.sem1 || 0}" ${inputState} onchange="autoSave('${p.id}', 'sem1', this.value)" class="${baseInputClass} ${canEdit ? activeClass : disabledClass}"></td>
                    <td class="p-1 text-center"><input type="number" value="${prod.sem2 || 0}" ${inputState} onchange="autoSave('${p.id}', 'sem2', this.value)" class="${baseInputClass} ${canEdit ? activeClass : disabledClass}"></td>
                    <td class="p-1 text-center"><input type="number" value="${prod.sem3 || 0}" ${inputState} onchange="autoSave('${p.id}', 'sem3', this.value)" class="${baseInputClass} ${canEdit ? activeClass : disabledClass}"></td>
                    <td class="p-1 text-center"><input type="number" value="${prod.sem4 || 0}" ${inputState} onchange="autoSave('${p.id}', 'sem4', this.value)" class="${baseInputClass} ${canEdit ? activeClass : disabledClass}"></td>

                    <td class="px-2 py-3 text-center status-cell">
                        <!-- Populated by updateRowUI -->
                        <span class="text-[10px] text-slate-400">---</span>
                    </td>
                    
                </tr>
            `;
        }).join('');

        // Initial UI update for all rows
        filtered.forEach(p => updateRowUI(p.id, p));
    }
}

function setupProfileMenu() {
    const btn = document.getElementById('profile-menu-btn');
    const dropdown = document.getElementById('profile-dropdown');
    const logoutBtn = document.getElementById('logout-btn');

    if (btn && dropdown) {
        btn.onclick = (e) => {
            e.stopPropagation();
            dropdown.classList.toggle('hidden');
        };

        document.addEventListener('click', () => {
            if (!dropdown.classList.contains('hidden')) {
                dropdown.classList.add('hidden');
            }
        });

        dropdown.onclick = (e) => {
            e.stopPropagation();
        };
    }

    if (logoutBtn) {
        logoutBtn.onclick = async () => {
            const { logout } = await import('./auth-guard.js');
            await logout();
        };
    }

    // Sidebar Toggle
    const sidebarToggle = document.getElementById('sidebar-toggle');
    const sidebar = document.querySelector('aside');
    if (sidebarToggle && sidebar) {
        sidebarToggle.onclick = () => {
            sidebar.classList.toggle('hidden');
        };
    }
}

// Make update function global
window.updateProducao = async function (input) {
    const pId = input.dataset.id;
    const newVal = input.value;

    // Optimistic UI update could happen here
    // Find item
    const idx = localPactuacoes.findIndex(p => p.id === pId);
    if (idx !== -1) {
        if (!localPactuacoes[idx].producao) localPactuacoes[idx].producao = {};
        localPactuacoes[idx].producao.realizada = newVal;
    }
    // Update in ALL list too
    const allIdx = allPactuacoes.findIndex(p => p.id === pId);
    if (allIdx !== -1) {
        if (!allPactuacoes[allIdx].producao) allPactuacoes[allIdx].producao = {};
        allPactuacoes[allIdx].producao.realizada = newVal;
    }

    try {
        await Repository.updateProducao(pId, newVal);
        input.classList.add('border-green-500');
        setTimeout(() => input.classList.remove('border-green-500'), 1000);
    } catch (e) {
        console.error(e);
        alert('Erro ao salvar produção.');
    }
};

initAcompanhamentoInst();
