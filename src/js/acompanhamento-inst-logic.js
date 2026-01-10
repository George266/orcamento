
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

// --- UNIFIED LAUNCH LOGIC START ---

function renderTable() {
    const compValue = document.getElementById('filter-competencia')?.value;
    const progValue = document.getElementById('filter-programa')?.value;
    const searchValue = document.getElementById('buscainteligente')?.value.toLowerCase();
    const { canEdit } = window.currentInstPermissions || { canEdit: false };

    if (!compValue) return;

    // 1. Filter
    let filtered = localPactuacoes.filter(p => p.competencia === compValue);

    if (progValue) {
        filtered = filtered.filter(p => p.progId === progValue);
    }

    // 2. Group by SIGTAP
    const groups = {};
    filtered.forEach(p => {
        if (!groups[p.sigtap]) {
            const proc = localProcs.find(pr => pr.sigtap === p.sigtap);
            groups[p.sigtap] = {
                sigtap: p.sigtap,
                procName: proc?.nome || 'Procedimento',
                items: [],
                totalMeta: 0,
                maxMeta: 0,
                totalRealizado: 0
            };
        }
        groups[p.sigtap].items.push(p);

        const meta = parseInt(p.ofertaMinima || 0);
        // Ensure producao object exists
        if (!p.producao) p.producao = { realizada: 0 };
        const real = parseInt(p.producao.realizada || 0);

        groups[p.sigtap].totalMeta += meta;
        if (meta > groups[p.sigtap].maxMeta) groups[p.sigtap].maxMeta = meta;

        // In unified view, we assume the single input value applies to the group, 
        // OR we take the max of existing values if they differ (to avoid showing 0 if one is set).
        // Standard behavior: max of existing lines to represent the "current offer".
        groups[p.sigtap].totalRealizado = Math.max(groups[p.sigtap].totalRealizado, real);
    });

    // 3. Search Filter (on Groups)
    let displayItems = Object.values(groups);
    if (searchValue) {
        displayItems = displayItems.filter(g =>
            g.sigtap.includes(searchValue) ||
            g.procName.toLowerCase().includes(searchValue)
        );
    }

    // 4. Sort (Simplified for Unified View)
    // Supports: Procedure Name, Status, Offer/Meta
    if (currentSort.column) {
        displayItems.sort((a, b) => {
            let valA, valB;
            switch (currentSort.column) {
                case 'procedimento':
                    valA = a.procName.toLowerCase(); valB = b.procName.toLowerCase(); break;
                case 'meta':
                    valA = a.maxMeta; valB = b.maxMeta; break;
                case 'status':
                    // progress
                    valA = a.maxMeta > 0 ? a.totalRealizado / a.maxMeta : 0;
                    valB = b.maxMeta > 0 ? b.totalRealizado / b.maxMeta : 0;
                    break;
                case 'oferta':
                    valA = a.totalRealizado; valB = b.totalRealizado; break;
                default:
                    return 0;
            }
            if (valA < valB) return currentSort.direction === 'asc' ? -1 : 1;
            if (valA > valB) return currentSort.direction === 'asc' ? 1 : -1;
            return 0;
        });
    }

    const tbody = document.getElementById('table-acompanhamento-inst');
    if (!tbody) return;

    if (displayItems.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="px-6 py-10 text-center text-slate-400 italic">Nenhum procedimento encontrado.</td></tr>`;
    } else {
        tbody.innerHTML = displayItems.map(group => {
            const target = group.maxMeta;
            const progress = target > 0 ? (group.totalRealizado / target) * 100 : 0;

            let statusColor = 'bg-primary';
            if (progress >= 100) statusColor = 'bg-green-500';
            else if (progress < 50) statusColor = 'bg-yellow-500';

            const inputState = canEdit ? '' : 'disabled';
            const activeClass = canEdit ? 'bg-white focus:ring-primary focus:border-primary' : 'bg-slate-50 text-slate-500';

            return `
             <tr class="hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors group/row">
                <td class="px-6 py-4">
                    <div class="flex flex-col">
                        <span class="text-sm font-bold text-slate-900 dark:text-white truncate max-w-[250px]" title="${group.procName}">${group.procName}</span>
                        <span class="text-xs text-slate-500 font-mono mt-0.5">Cód: ${group.sigtap}</span>
                    </div>
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-center text-sm text-slate-600 dark:text-slate-300 font-bold">
                    ${formatNumber(target)}
                </td>
                <td class="px-6 py-4 align-middle">
                    <div class="flex flex-col gap-1 max-w-[140px] mx-auto">
                        <div class="flex justify-between text-xs mb-1">
                            <span class="text-slate-600 dark:text-slate-400 font-medium">${formatNumber(group.totalRealizado)} ofertados</span>
                            <span class="font-bold text-slate-700 dark:text-white">${Math.round(progress)}%</span>
                        </div>
                        <div class="w-full bg-slate-200 dark:bg-slate-600 rounded-full h-2">
                            <div class="${statusColor} h-2 rounded-full transition-all duration-500" style="width: ${Math.min(progress, 100)}%"></div>
                        </div>
                    </div>
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-center">
                    <input
                        onchange="window.updateUnifiedOffer('${group.sigtap}', this.value)"
                        class="w-24 text-center rounded-lg border-slate-300 dark:border-slate-600 focus:ring-primary focus:border-primary sm:text-sm shadow-sm font-bold ${activeClass}"
                        min="0" 
                        value="${group.totalRealizado}" 
                        type="number" 
                        ${inputState}
                    />
                </td>
                 <td class="px-6 py-4 whitespace-nowrap text-center">
                    <button onclick="window.openDetailModal('${group.sigtap}')" class="p-2 text-slate-400 hover:text-primary transition-colors bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg" title="Ver Detalhes">
                         <span class="material-symbols-outlined text-[20px]">visibility</span>
                    </button>
                </td>
            </tr>
            `;
        }).join('');
    }

    // Store for modal access
    window.displayGroups = groups;
}

// Global functions for Unified Interface
window.updateUnifiedOffer = async (sigtap, value) => {
    const val = parseInt(value) || 0;
    const group = window.displayGroups[sigtap];
    if (group) {
        // Optimistic Update & Save Logic
        // We update EVERY item in the group to have this same realized value
        const updatePromises = group.items.map(async (pact) => {
            if (!pact.producao) pact.producao = {};
            pact.producao.realizada = val;

            // Also update localPactuacoes state to allow re-render without refetch
            const localIdx = localPactuacoes.findIndex(lp => lp.id === pact.id);
            if (localIdx !== -1) localPactuacoes[localIdx].producao.realizada = val;

            return Repository.savePactuacao(pact);
        });

        try {
            await Promise.all(updatePromises);
            // Re-render to update progress bars correctly
            renderTable();
        } catch (error) {
            console.error("Error bulk updating offer:", error);
            alert("Erro ao salvar oferta unificada.");
        }
    }
};

window.openDetailModal = (sigtap) => {
    // If displayGroups isn't ready, verify if renderTable ran. 
    // It should be by the time button is clicked.
    const groups = window.displayGroups || {};
    const group = groups[sigtap];

    if (!group) return;

    const modal = document.getElementById('modal-detalhe-lancamento');
    if (modal) {
        document.getElementById('modal-title').textContent = group.procName;
        document.getElementById('modal-subtitle').textContent = `Cód. SIGTAP: ${sigtap}`;

        const tbody = document.getElementById('modal-table-body');
        tbody.innerHTML = group.items.map(item => {
            const prog = localProgs.find(p => p.id === item.progId);
            const progName = prog ? prog.nome : (item.progId || 'Incentivo Padrão');

            const meta = parseInt(item.ofertaMinima || 0);
            const real = parseInt(item.producao?.realizada || 0);
            const progress = meta > 0 ? (real / meta) * 100 : 0;

            let statusColor = 'bg-primary';
            if (progress >= 100) statusColor = 'bg-green-500';
            else if (progress < 50) statusColor = 'bg-yellow-500';

            return `
            <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                <td class="px-4 py-3 text-sm font-medium text-slate-700 dark:text-slate-300">
                    ${progName}
                </td>
                <td class="px-4 py-3 text-right text-sm font-mono text-slate-600 dark:text-slate-400">
                    ${formatNumber(meta)}
                </td>
                <td class="px-4 py-3 text-right text-sm font-mono font-bold text-slate-900 dark:text-white">
                    ${formatNumber(real)}
                </td>
                 <td class="px-4 py-3 align-middle">
                     <div class="flex items-center gap-2">
                        <div class="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-1.5 flex-1">
                            <div class="${statusColor} h-1.5 rounded-full" style="width: ${Math.min(progress, 100)}%"></div>
                        </div>
                        <span class="text-[10px] font-bold text-slate-500">${Math.round(progress)}%</span>
                    </div>
                </td>
            </tr>
        `}).join('');

        modal.classList.remove('hidden');
    }
};

window.closeDetailModal = () => {
    document.getElementById('modal-detalhe-lancamento').classList.add('hidden');
};

// --- UNIFIED LAUNCH LOGIC END ---

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
