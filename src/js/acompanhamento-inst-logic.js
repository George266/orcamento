
import { Repository } from './repository.js';
import { auth } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { DateUtils } from './utils/date-utils.js';

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
let allInstitutes = []; // New global
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
        allInstitutes = await Repository.getInstitutos(); // Fetch ALL for breakdown lookup

        // Hide old filter container if it exists
        const instFilterContainer = document.getElementById('container-filter-inst');
        if (instFilterContainer) instFilterContainer.classList.add('hidden');

        // Initial Data Load
        // Initial Data Load
        let userInstId = 'all';
        const savedInstId = localStorage.getItem('selectedInstituteId');

        if (savedInstId && (savedInstId === 'all' || allowedIds.includes(savedInstId))) {
            userInstId = savedInstId;
        } else {
            userInstId = allowedIds.length > 1 ? 'all' : allowedIds[0];
        }

        if (userInstId === 'all') {
            localPactuacoes = allPactuacoes.filter(p => allowedIds.includes(p.instId));
        } else {
            localPactuacoes = allPactuacoes.filter(p => p.instId === userInstId);
        }

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
                        <button data-inst-id="all" class="inst-switcher-btn w-full text-left text-xs font-medium py-1.5 px-2 rounded hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors flex items-center justify-between group ${userInstId === 'all' ? 'text-primary bg-primary/5' : 'text-slate-600 dark:text-slate-300'}">
                            <span>Todos</span>
                            ${userInstId === 'all' ? '<span class="material-symbols-outlined text-[14px]">check</span>' : ''}
                        </button>
                        ${myInsts.map(inst => `
                            <button data-inst-id="${inst.id}" class="inst-switcher-btn w-full text-left text-xs font-medium py-1.5 px-2 rounded hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors flex items-center justify-between group ${userInstId === inst.id ? 'text-primary bg-primary/5' : 'text-slate-600 dark:text-slate-300'}">
                                <span class="truncate">${inst.sigla}</span>
                                ${userInstId === inst.id ? '<span class="material-symbols-outlined text-[14px]">check</span>' : ''}
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
                        localStorage.setItem('selectedInstituteId', selectedId);

                        // Update Data
                        if (selectedId === 'all') {
                            localPactuacoes = allPactuacoes.filter(p => allowedIds.includes(p.instId));
                            const nameDisplay = document.getElementById('inst-page-name');
                            if (nameDisplay) nameDisplay.textContent = 'Todos os Vinculados';
                            const headerName = document.getElementById('inst-header-name');
                            if (headerName) headerName.textContent = 'Todos os Vinculados';
                            // Disable editing in All view
                            if (window.currentInstPermissions) window.currentInstPermissions.canEdit = false;
                        } else {
                            localPactuacoes = allPactuacoes.filter(p => p.instId === selectedId);
                            const selInst = myInsts.find(i => i.id === selectedId);
                            const nameDisplay = document.getElementById('inst-page-name');
                            if (nameDisplay) nameDisplay.textContent = selInst ? selInst.nome : 'Instituto';
                            const headerName = document.getElementById('inst-header-name');
                            if (headerName) headerName.textContent = selInst ? selInst.nome : 'Instituto';
                            // Enable editing if user has role
                            if (window.currentInstPermissions) window.currentInstPermissions.canEdit = canEdit;
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

            // Update User Headers
            const nameHeader = document.getElementById('user-name-header');
            if (nameHeader) nameHeader.textContent = profile.name || user.email;
            const instHeader = document.getElementById('inst-header-name');

            // Set initial header based on selection
            if (userInstId === 'all') {
                const nameDisplay = document.getElementById('inst-page-name');
                if (nameDisplay) nameDisplay.textContent = 'Todos os Vinculados';
                if (instHeader) instHeader.textContent = 'Múltiplos Vínculos';
            } else {
                const selInst = myInsts.find(i => i.id === userInstId);
                const nameDisplay = document.getElementById('inst-page-name');
                if (nameDisplay) nameDisplay.textContent = selInst ? selInst.nome : 'Instituto';
                if (instHeader) instHeader.textContent = selInst ? selInst.nome : 'Instituto';
            }

        } else {
            // Single Mode
            const instId = allowedIds[0];
            const instituto = await Repository.getInstitutoById(instId);

            // Update Headers
            const nameHeader = document.getElementById('user-name-header');
            if (nameHeader) nameHeader.textContent = profile.name || user.email;

            const instHeader = document.getElementById('inst-header-name');
            if (instHeader) instHeader.textContent = instituto?.nome || 'Ponto de Pactuação';

            const pageName = document.getElementById('inst-page-name');
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
        // Default to false if in multi-view (length > 1), otherwise use user role
        let effectiveCanEdit = canEdit;
        if (allowedIds.length > 1) effectiveCanEdit = false;

        window.currentInstPermissions = { canEdit: effectiveCanEdit };

        renderTable();
        setupSortListeners();

        // --- DEADLINE ALERT CHECK (On Init) ---
        const config = await Repository.getSystemConfig();
        const deadlineDay = config?.deadlineDay || 5;
        const deadlineRule = config?.deadlineRule || 'business_day';
        const deadlineAlert = config?.deadlineAlert !== false;
        const endMonthDeadline = config?.endMonthDeadline || 7;
        const isCriticalPeriod = DateUtils.isWithinLastBusinessDays(endMonthDeadline);
        const isPastStandardDeadline = DateUtils.isPastDeadline(deadlineDay, deadlineRule);

        console.log(`[DEBUG] Init Alert: AlertEnabled=${deadlineAlert}, DayLimit=${deadlineDay}, Rule=${deadlineRule}`);
        console.log(`[DEBUG] Conditions: PastStandard=${isPastStandardDeadline}, Critical=${isCriticalPeriod}`);

        if (deadlineAlert && (isPastStandardDeadline || isCriticalPeriod)) {
            // Check compliance for ALL allowed ids (Global check for user)
            const allInstitutes = await Repository.getInstitutos();
            checkDeadlineCompliance(allPactuacoes, allowedIds, allInstitutes, config);
        } else {
            console.log('[DEBUG] Alert skipped: Conditions not met.');
        }
    });
}

// --- DEADLINE ALERT LOGIC ---
async function checkDeadlineCompliance(allPactuacoes, allowedInstIds, allInstitutes, config) {
    const targetComp = DateUtils.getCurrentMonthLabel('short'); // "mmm/yy" (e.g., "jan/26")

    const endDeadline = config?.endMonthDeadline || 7;
    const isCriticalPeriod = DateUtils.isWithinLastBusinessDays(endDeadline);
    const isPastStandardDeadline = DateUtils.isPastDeadline(config?.deadlineDay || 5, config?.deadlineRule || 'business_day');

    console.log(`[DEBUG] CheckDeadline: Target=${targetComp}, EndDeadline=${endDeadline} (Config: ${config?.endMonthDeadline}), Critical=${isCriticalPeriod}`);
    console.log(`[DEBUG] Allowed IDs:`, allowedInstIds);
    console.log(`[DEBUG] isPastStandardDeadline: ${isPastStandardDeadline}`);
    console.log(`[DEBUG] Config:`, config);

    // Filter pertinent data: Target Month AND User's Institutes
    const relevant = allPactuacoes.filter(p =>
        p.competencia === targetComp &&
        allowedInstIds.includes(p.instId)
    );

    // FETCH JUSTIFICATIONS
    const existingJustifications = await Repository.getJustificativas(targetComp);
    const justifiedSet = new Set(existingJustifications.map(j => `${j.instId}_${j.sigtap}`));
    console.log(`[DEBUG] Relevant Items Found: ${relevant.length}`);

    if (relevant.length === 0) return;

    // Check if ignored (ONLY if not critical period - Critical period overrides ignore?)
    // User probably implies this is a MUST DO. "deve ser escrito meta não atingida"
    // Let's assume critical period alerts show regardless or have their own ignore key?
    // For now, respect the standard ignore key unless we want to force it.
    // If it's a "Justification" request, maybe we shouldn't allow ignore until justified?
    // Let's stick to standard ignore for now to avoid annoying loops, or use a distinct key.

    // Using distinct key for critical alert to ensure it pops up even if early month was ignored
    const ignoreKey = isCriticalPeriod ? `critical_ignored_${targetComp}` : `deadline_ignored_${targetComp}`;
    if (localStorage.getItem(ignoreKey) === 'true') {
        // console.log(`Alert ignored for ${targetComp}`);
        return;
    }

    const pendingItems = [];
    const processedKeys = new Set(); // Key: instId_sigtap

    relevant.forEach(p => {
        const key = `${p.instId}_${p.sigtap}`;
        if (processedKeys.has(key)) return;

        // CHECK IF ALREADY JUSTIFIED (Firestore + Local Fallback)
        if (justifiedSet.has(key)) {
            console.log(`[DEBUG] Item ${key} found in database justifications.`);
            return;
        }

        const groupItems = relevant.filter(i => i.instId === p.instId && i.sigtap === p.sigtap);

        const maxMeta = groupItems.reduce((max, i) => Math.max(max, parseInt(i.ofertaMinima || 0)), 0);
        const totalRealized = groupItems.reduce((max, i) => Math.max(max, parseInt(i.producao?.realizada || 0)), 0);

        // Early Month Check (Day 5): Alert if Realized == 0 (Not Started)
        // Late Month Check (Last 7 Days): Alert if Realized < Meta (Not Achieved)

        let isPending = false;
        let statusType = 'DELAY'; // Default

        if (isCriticalPeriod) {
            if (maxMeta > 0 && totalRealized < maxMeta) {
                isPending = true;
                statusType = 'FAILURE'; // Meta não atingida
            }
        } else {
            if (maxMeta > 0 && totalRealized === 0) {
                isPending = true;
                statusType = 'DELAY'; // Não iniciado
            }
        }

        if (isPending) {
            pendingItems.push({
                instId: p.instId,
                sigtap: p.sigtap,
                meta: maxMeta,
                realized: totalRealized,
                type: statusType
            });
            processedKeys.add(key);
        }
    });

    if (pendingItems.length > 0) {
        showDeadlineAlert(targetComp, pendingItems, allInstitutes, config, isCriticalPeriod);
    }
}

function showDeadlineAlert(compLabel, items, allInstitutes, config, isCriticalPeriod = false) {
    const modal = document.getElementById('modal-alert-prazo');
    if (!modal) return;

    // Formatting Date Label
    // input: "jan/26"
    // output desired: "Janeiro 2026"
    const monthMap = { 'jan': 'Janeiro', 'fev': 'Fevereiro', 'mar': 'Março', 'abr': 'Abril', 'mai': 'Maio', 'jun': 'Junho', 'jul': 'Julho', 'ago': 'Agosto', 'set': 'Setembro', 'out': 'Outubro', 'nov': 'Novembro', 'dez': 'Dezembro' };
    let humanComp = compLabel;
    const parts = compLabel.split('/');
    if (parts.length === 2 && monthMap[parts[0].toLowerCase()]) {
        humanComp = `${monthMap[parts[0].toLowerCase()]} 20${parts[1]}`;
    }

    document.getElementById('alert-month').textContent = humanComp;

    // Calculate Deadline Date
    const today = new Date();
    let deadlineDate;
    const day = config?.deadlineDay || 5;
    const rule = config?.deadlineRule || 'business_day';

    if (rule === 'fixed_date') {
        deadlineDate = new Date(today.getFullYear(), today.getMonth(), day);
    } else {
        deadlineDate = DateUtils.getBusinessDay(today.getFullYear(), today.getMonth(), day);
    }

    // Header & Message Updates
    const titleEl = modal.querySelector('h3');
    const msgEl = modal.querySelector('div.bg-red-50 p');
    const ignoreBtn = modal.querySelector('button[onclick*="window.ignoreDeadlineAlert"]');

    if (isCriticalPeriod) {
        const endDeadline = config?.endMonthDeadline || 7;
        titleEl.textContent = "Atenção: Fechamento de Competência";
        msgEl.innerHTML = `Estamos nos <strong>últimos ${endDeadline} dias úteis</strong> do mês. Alguns procedimentos <strong>não atingiram a meta</strong> pactuada e exigem justificativa.`;

        // HIDE IGNORE BUTTON during critical period - Must justify!
        if (ignoreBtn) ignoreBtn.classList.add('hidden');

    } else {
        titleEl.textContent = "Atenção: Prazo de Lançamento";
        msgEl.innerHTML = `O prazo regular para início dos lançamentos encerrou no dia <strong>${deadlineDate.toLocaleDateString('pt-BR')}</strong>. Identificamos pendências:`;

        // Ensure ignore button is visible for standard alerts
        if (ignoreBtn) {
            ignoreBtn.classList.remove('hidden');
            ignoreBtn.onclick = () => window.ignoreDeadlineAlert('month');
            ignoreBtn.textContent = 'Não mostrar mais este aviso';
        }
    }

    // Render Items
    const tbody = document.getElementById('alert-table-body');
    // Use global localProcs variable (already loaded from Firestore)
    const procs = localProcs || [];

    tbody.innerHTML = items.map(item => {
        // Find Procedure Name (Flexible string/number match)
        console.log('[DEBUG] Looking for sigtap:', item.sigtap, 'Type:', typeof item.sigtap);
        console.log('[DEBUG] Available procedures:', procs.length);
        if (procs.length > 0) {
            console.log('[DEBUG] First proc sample:', procs[0]);
        }

        const proc = procs.find(p => {
            const match = String(p.sigtap) === String(item.sigtap);
            if (match) console.log('[DEBUG] MATCH FOUND:', p);
            return match;
        });
        const procName = proc ? proc.nome : `Procedimento não encontrado`;

        console.log('[DEBUG] Final procName:', procName);

        let statusBadge = '';
        let actionArea = '';

        if (item.type === 'FAILURE') {
            statusBadge = `<span class="inline-flex items-center gap-1 rounded-md bg-red-50 px-2 py-1 text-xs font-bold text-red-700 border border-red-100">Oferta mínima não realizada</span>`;

            actionArea = `
                <div class="w-full bg-slate-50 dark:bg-slate-900/50 p-3 rounded-lg border border-slate-100 dark:border-slate-800">
                    <textarea id="just-${item.sigtap}" rows="3" 
                        class="w-full text-sm rounded-lg border-slate-200 bg-white placeholder:text-slate-400 focus:border-blue-500 focus:ring-blue-500 mb-2"
                        placeholder="Justifique o motivo..."></textarea>
                    <div class="flex justify-end">
                        <button id="btn-save-${item.sigtap}" onclick="window.saveJustification('${item.instId}', '${item.sigtap}', '${compLabel}')"
                            class="text-xs bg-slate-800 text-white px-4 py-2 rounded-md hover:bg-slate-700 transition-colors font-medium">
                            Salvar Justificativa
                        </button>
                    </div>
                </div>
            `;
        } else {
            statusBadge = `<span class="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-700">Não Iniciado</span>`;
            actionArea = ``;
        }

        return `
        <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/50 item-row border-b border-slate-100 dark:border-slate-800 last:border-0" data-sigtap="${item.sigtap}" data-type="${item.type}">
            <td class="px-6 py-5">
                <div class="flex flex-col gap-3">
                    <!-- HEADER: CODE & NAME -->
                    <div class="flex items-start gap-3">
                        <span class="font-mono text-xs font-bold text-slate-500 bg-slate-100 px-2 py-1 rounded shrink-0">${item.sigtap}</span>
                        <h4 class="font-bold text-slate-800 dark:text-white text-sm leading-tight pt-0.5">${procName}</h4>
                    </div>

                    <!-- STATS -->
                    <div class="text-xs text-slate-500">
                        Realizado: <strong>${item.realized}</strong> / Meta: <strong>${item.meta}</strong>
                    </div>

                    <!-- BADGE -->
                    ${statusBadge}
                    
                    <!-- ACTION AREA -->
                    ${actionArea}
                </div>
            </td>
        </tr>
    `;
    }).join('');

    modal.classList.remove('hidden');
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

    // Recalculate Total Realizada - REMOVED: Realizada should not be auto-calculated from weeks.
    // pact.producao.realizada =
    //    (parseInt(pact.producao.sem1) || 0) +
    //    (parseInt(pact.producao.sem2) || 0) +
    //    (parseInt(pact.producao.sem3) || 0) +
    //    (parseInt(pact.producao.sem4) || 0);

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

    // 1.5 Calculate Global Stats (Unified by SIGTAP)
    // Map: sigtap -> { totalMeta: 0, totalRealizado: 0, breakdown: [] }
    const globalStats = {};

    // We iterate over ALL pactuacoes to get the global picture
    const allFiltered = allPactuacoes.filter(p => p.competencia === compValue);

    allFiltered.forEach(p => {
        if (!globalStats[p.sigtap]) {
            globalStats[p.sigtap] = {
                totalMeta: 0,
                totalRealizado: 0,
                breakdown: []
            };
        }

        const meta = parseInt(p.ofertaMinima || 0);
        const real = parseInt(p.producao?.realizada || 0);

        // Use Max Meta logic (Assuming Shared Goal)
        globalStats[p.sigtap].totalMeta = Math.max(globalStats[p.sigtap].totalMeta, meta);
        globalStats[p.sigtap].totalRealizado += real;

        // Find Institute Name
        // We know we only have access to "myInsts" usually, but "allPactuacoes" might contain others.
        // We might need to fetch all institutes or store a map if we want names for everyone.
        // For now, let's try to lookup in 'myInsts' if available, otherwise just use ID or generic.
        // ACTUALLY: We need to load ALL institutes to get names properly if we want a full report.
        // But let's assume valid IDs.
        globalStats[p.sigtap].breakdown.push({
            instId: p.instId,
            meta,
            realizado: real
        });
    });

    // 2. Group by SIGTAP Only (Merge incentives)
    const groups = {};
    filtered.forEach(p => {
        // Group Key is JUST SIGTAP now
        const groupKey = p.sigtap;

        if (!groups[groupKey]) {
            const proc = localProcs.find(pr => pr.sigtap === p.sigtap);
            groups[groupKey] = {
                key: groupKey,
                sigtap: p.sigtap,
                procName: proc?.nome || 'Procedimento',
                items: [],
                totalMeta: 0,
                maxMeta: 0,
                totalRealizado: 0,
                sem1: 0, sem2: 0, sem3: 0, sem4: 0, sem5: 0,
                programs: new Set(), // Track programs
                // Globals
                global: globalStats[p.sigtap] || { totalMeta: 0, totalRealizado: 0, breakdown: [] }
            };
        }
        groups[groupKey].items.push(p);

        // Track Program
        const prog = localProgs.find(pg => pg.id === p.progId);
        groups[groupKey].programs.add(prog ? prog.nome : (p.progId || ''));

        if (!groups[groupKey].instStats) {
            groups[groupKey].instStats = {};
        }

        // Initialize Stats for this Institute if not present
        if (!groups[groupKey].instStats[p.instId]) {
            groups[groupKey].instStats[p.instId] = {
                maxMeta: 0,
                sem1: 0, sem2: 0, sem3: 0, sem4: 0, sem5: 0
            };
        }

        const stats = groups[groupKey].instStats[p.instId];
        const meta = parseInt(p.ofertaMinima || 0);

        // Update Max Meta for this Institute (Shared Goal Logic within Inst)
        stats.maxMeta = Math.max(stats.maxMeta, meta);

        // Capture Production (Mirrored within Inst, so we can just take the value of any/latest)
        // We use Math.max just in case of slight sync inconsistency, favoring the positive value
        if (!p.producao) p.producao = {};
        stats.sem1 = Math.max(stats.sem1, parseInt(p.producao.sem1 || 0));
        stats.sem2 = Math.max(stats.sem2, parseInt(p.producao.sem2 || 0));
        stats.sem3 = Math.max(stats.sem3, parseInt(p.producao.sem3 || 0));
        stats.sem4 = Math.max(stats.sem4, parseInt(p.producao.sem4 || 0));
        stats.sem5 = Math.max(stats.sem5, parseInt(p.producao.sem5 || 0));
    });

    // Finalize Calculation: Aggregate InstStats to Group Totals
    Object.values(groups).forEach(group => {
        let maxMetaVal = 0;
        let sumSem1 = 0, sumSem2 = 0, sumSem3 = 0, sumSem4 = 0, sumSem5 = 0;

        Object.values(group.instStats).forEach(st => {
            maxMetaVal = Math.max(maxMetaVal, st.maxMeta);
            sumSem1 += st.sem1;
            sumSem2 += st.sem2;
            sumSem3 += st.sem3;
            sumSem4 += st.sem4;
            sumSem5 += st.sem5;
        });

        group.maxMeta = maxMetaVal;
        group.totalMeta = maxMetaVal; // Consistent
        group.sem1 = sumSem1;
        group.sem2 = sumSem2;
        group.sem3 = sumSem3;
        group.sem4 = sumSem4;
        group.sem5 = sumSem5;

        // Final Total Realized
        group.totalRealizado = sumSem1 + sumSem2 + sumSem3 + sumSem4 + sumSem5;
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
    if (currentSort.column) {
        displayItems.sort((a, b) => {
            let valA, valB;
            switch (currentSort.column) {
                case 'procedimento':
                    valA = a.procName.toLowerCase(); valB = b.procName.toLowerCase(); break;
                case 'meta':
                    valA = a.maxMeta; valB = b.maxMeta; break;
                case 'status':
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
        tbody.innerHTML = `<tr><td colspan="9" class="px-6 py-10 text-center text-slate-400 italic">Nenhum procedimento encontrado.</td></tr>`;
    } else {
        tbody.innerHTML = displayItems.map(group => {
            const target = group.maxMeta;
            const progress = target > 0 ? (group.totalRealizado / target) * 100 : 0;

            let statusColor = 'bg-primary';
            if (progress >= 100) statusColor = 'bg-green-500';
            else if (progress < 50) statusColor = 'bg-yellow-500';

            const inputState = canEdit ? '' : 'disabled';
            const activeClass = canEdit ? 'bg-white focus:ring-primary focus:border-primary' : 'bg-slate-50 text-slate-500';

            // Meta Check (Based on displayed Max Meta)
            const isMetaMet = target > 0 && group.totalRealizado >= target;

            // Program Label (Multiple or Single)
            const progNames = Array.from(group.programs).filter(Boolean); // Remove empty
            const uniqueProgs = [...new Set(progNames)];
            const progLabel = uniqueProgs.length > 1 ? `Vários (${uniqueProgs.length})` : uniqueProgs[0];

            let statusContent = '';
            if (isMetaMet) {
                statusContent = `
                    <button onclick="window.openGlobalBreakdown('${group.sigtap}')" class="w-full py-1.5 px-3 rounded-lg bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 font-bold text-xs border border-emerald-200 dark:border-emerald-800 hover:bg-emerald-200 dark:hover:bg-emerald-800 transition-colors flex items-center justify-center gap-1">
                        <span class="material-symbols-outlined text-[14px]">check_circle</span>
                        Meta Atingida
                    </button>
                    <div class="text-[10px] text-center text-slate-400 mt-1">Clique para ver detalhes</div>
                `;
            } else {
                statusContent = `
                    <div class="flex justify-between text-xs mb-1">
                        <span class="text-slate-600 dark:text-slate-400 font-medium">${formatNumber(group.totalRealizado)} ofertados</span>
                        <span class="font-bold text-slate-700 dark:text-white">${Math.round(progress)}%</span>
                    </div>
                    <div class="w-full bg-slate-200 dark:bg-slate-600 rounded-full h-2">
                        <div class="${statusColor} h-2 rounded-full transition-all duration-500" style="width: ${Math.min(progress, 100)}%"></div>
                    </div>
                 `;
            }

            // Generate 5 inputs
            const weeks = [1, 2, 3, 4, 5];
            const weekInputs = weeks.map(w => {
                const val = group[`sem${w}`];
                return `
                    <td class="px-2 py-4 whitespace-nowrap text-center">
                        <input
                            onchange="window.updateUnifiedWeek('${group.key}', 'sem${w}', this.value)"
                            class="w-16 text-center rounded-lg border-slate-300 dark:border-slate-600 focus:ring-primary focus:border-primary text-xs shadow-sm font-bold ${activeClass}"
                            min="0" 
                            value="${val}" 
                            type="number" 
                            ${inputState}
                        />
                    </td>
                 `;
            }).join('');

            return `
             <tr class="hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors group/row">
                <td class="px-6 py-4">
                    <div class="flex flex-col">
                        <span class="text-sm font-bold text-slate-900 dark:text-white truncate max-w-[250px]" title="${group.procName}">${group.procName}</span>
                        <div class="flex items-center gap-2 mt-0.5">
                            <span class="text-xs text-slate-500 font-mono">Cód: ${group.sigtap}</span>
                            ${progLabel ? `<span class="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 font-bold border border-blue-100" title="${progNames.join(', ')}">${progLabel}</span>` : ''}
                        </div>
                    </div>
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-center text-sm text-slate-600 dark:text-slate-300 font-bold">
                    ${formatNumber(target)}
                </td>
                <td class="px-6 py-4 align-middle">
                    <div class="flex flex-col gap-1 max-w-[140px] mx-auto">
                        ${statusContent}
                    </div>
                </td>
                ${weekInputs}
                 <td class="px-6 py-4 whitespace-nowrap text-center">
                    <button onclick="window.openDetailModal('${group.key}')" class="p-2 text-slate-400 hover:text-primary transition-colors bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg" title="Ver Detalhes">
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

window.updateUnifiedWeek = async (groupKey, weekField, value) => {
    const val = parseInt(value) || 0;
    const group = window.displayGroups[groupKey];
    if (group) {
        // Optimistic Update
        group[weekField] = val;
        // Recalc total
        group.totalRealizado = (group.sem1 || 0) + (group.sem2 || 0) + (group.sem3 || 0) + (group.sem4 || 0) + (group.sem5 || 0);

        // Update all items in group (Mirroring the value)
        const updatePromises = group.items.map(async (pact) => {
            if (!pact.producao) pact.producao = {};
            pact.producao[weekField] = val; // Set the same value
            pact.producao.realizada = (pact.producao.sem1 || 0) + (pact.producao.sem2 || 0) + (pact.producao.sem3 || 0) + (pact.producao.sem4 || 0) + (pact.producao.sem5 || 0);

            return Repository.savePactuacao({
                id: pact.id,
                producao: pact.producao
            });
        });

        try {
            await Promise.all(updatePromises);

            // Update local state (Optimistic already done on group object, but sync localPactuacoes)
            group.items.forEach(pact => {
                const localIdx = localPactuacoes.findIndex(lp => lp.id === pact.id);
                if (localIdx !== -1) {
                    if (!localPactuacoes[localIdx].producao) localPactuacoes[localIdx].producao = {};
                    localPactuacoes[localIdx].producao[weekField] = val;
                    localPactuacoes[localIdx].producao.realizada = pact.producao.realizada;
                }
            });

            renderTable(); // Re-render to update totals and progress bars
        } catch (error) {
            console.error("Error bulk updating week:", error);
            alert("Erro ao salvar semana.");
        }
    }
};

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

// New Function for Exclusive Global Breakdown

window.ignoreDeadlineAlert = function (type) {
    const targetComp = DateUtils.getCurrentMonthLabel('short');
    const ignoreKey = `deadline_ignored_${targetComp}`;
    localStorage.setItem(ignoreKey, 'true');

    const modal = document.getElementById('modal-alert-prazo');
    if (modal) modal.classList.add('hidden');

    // Optional: Toast notification
    // alert('Aviso ocultado para esta competência.');
};

window.saveJustification = async (instId, sigtap, competencia) => {
    const txtArea = document.getElementById(`just-${sigtap}`);
    if (!txtArea) return;

    const text = txtArea.value.trim();
    if (!text) {
        alert("Por favor, escreva uma justificativa.");
        return;
    }

    try {
        await Repository.saveJustificativa({
            instId,
            sigtap,
            competencia,
            texto: text,
            userEmail: auth.currentUser?.email || 'unknown'
        });

        // Mark as justified locally to hide immediately
        const key = `justified_${instId}_${sigtap}_${competencia}`;
        localStorage.setItem(key, 'true');

        // Update UI
        const row = document.querySelector(`tr[data-sigtap="${sigtap}"]`);
        if (row) {
            row.style.opacity = '0.5';
            row.innerHTML = `<td class="px-6 py-5 text-center text-green-600 font-bold bg-green-50">Justificativa enviada com sucesso!</td>`;
            setTimeout(() => row.remove(), 2000);
        }

        // Check if list empty to close modal
        setTimeout(() => {
            const tbody = document.getElementById('alert-table-body');
            if (tbody && tbody.children.length <= 1) { // 1 because we just removed one effectively
                document.getElementById('modal-alert-prazo').classList.add('hidden');
            }
        }, 2200);

    } catch (err) {
        console.error("Erro ao salvar justificativa:", err);
        alert("Erro ao salvar. Tente novamente.");
    }
};

window.openGlobalBreakdown = (sigtap) => {
    // Find ANY group with this sigtap to get the global data (which assumes global stats are by sigtap)
    const groups = window.displayGroups || {};
    // We need to find the correct group by sigtap, but keys are now composite.
    // Iterating to find match:
    const groupKey = Object.keys(groups).find(k => groups[k].sigtap === sigtap);
    const group = groups[groupKey];

    if (!group) return;

    const modal = document.getElementById('modal-detalhe-lancamento');
    if (modal) {
        document.getElementById('modal-title').textContent = "Status da Rede";
        document.getElementById('modal-subtitle').textContent = `${group.procName} (Cód: ${sigtap})`;

        // Hide the standard table header for this view
        const thead = modal.querySelector('thead');
        if (thead) thead.classList.add('hidden');

        // Hide standard blue info legend for this view
        const infoLegend = document.getElementById('modal-info-legend');
        if (infoLegend) infoLegend.classList.add('hidden');

        // Hide standard modal footer for this view
        const modalFooter = document.getElementById('modal-footer');
        if (modalFooter) modalFooter.classList.add('hidden');

        const tbody = document.getElementById('modal-table-body');

        // Remove old global section if present
        const oldGlobal = document.getElementById('dynamic-global-section');
        if (oldGlobal) oldGlobal.remove();

        if (group.global && group.global.breakdown.length > 0) {
            const breakdownHtml = group.global.breakdown.map(item => {
                const inst = allInstitutes.find(i => i.id === item.instId);
                const instName = inst ? inst.sigla : 'Inst. Desconhecido';

                return `
                    <div class="flex items-center justify-between text-sm py-3 border-b border-emerald-100 dark:border-emerald-800 last:border-0 hover:bg-emerald-50/50 dark:hover:bg-emerald-900/10 px-2 rounded-lg transition-colors">
                        <span class="font-bold text-slate-700 dark:text-emerald-100">${instName}</span>
                        <div class="flex items-center gap-4">
                            <span class="text-xs text-slate-500 font-medium">Meta: ${item.meta}</span>
                            <span class="font-bold ${item.realizado >= item.meta ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-600 dark:text-slate-400'}">
                                Ofertado: ${item.realizado}
                            </span>
                        </div>
                    </div>
                `;
            }).join('');

            // Inject simpler view
            tbody.innerHTML = `
                <tr>
                    <td colspan="4" class="p-0 border-none">
                        <div class="p-6 flex flex-col items-center">
                            
                            <div class="w-full bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-2xl p-6 text-center shadow-sm mb-6">
                                <div class="bg-white dark:bg-emerald-950/50 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 border border-emerald-100 dark:border-emerald-800 shadow-sm">
                                    <span class="material-symbols-outlined text-4xl text-emerald-500">check_circle</span>
                                </div>
                                
                                <h4 class="text-xl font-bold text-emerald-900 dark:text-white mb-2">Meta Global Atingida!</h4>
                                <p class="text-sm text-emerald-700 dark:text-emerald-300 max-w-sm mx-auto">
                                    A soma das ofertas de todos os institutos superou a meta estabelecida para a rede.
                                </p>
                            
                                <div class="flex items-center justify-center gap-8 mt-6">
                                    <div class="flex flex-col items-center">
                                        <span class="text-[10px] uppercase tracking-wider text-slate-400 font-bold mb-1">Meta Rede</span>
                                        <span class="text-2xl font-mono font-bold text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-800 px-4 py-1 rounded-lg border border-slate-200 dark:border-slate-700 shadow-sm">${group.global.totalMeta}</span>
                                    </div>
                                    <div class="h-10 w-px bg-emerald-200 dark:bg-emerald-800"></div>
                                    <div class="flex flex-col items-center">
                                        <span class="text-[10px] uppercase tracking-wider text-emerald-600 font-bold mb-1">Oferta Rede</span>
                                        <span class="text-2xl font-mono font-bold text-emerald-600 dark:text-emerald-400 bg-white dark:bg-emerald-950 px-4 py-1 rounded-lg border border-emerald-100 dark:border-emerald-800 shadow-sm">${group.global.totalRealizado}</span>
                                    </div>
                                </div>
                            </div>

                            <div class="w-full">
                                <h5 class="flex items-center gap-2 text-xs font-bold text-slate-500 uppercase mb-3 px-1 ml-1">
                                    <span class="material-symbols-outlined text-[16px]">domain</span>
                                    Detalhamento por Instituto
                                </h5>
                                <div class="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
                                    <div class="divide-y divide-slate-100 dark:divide-slate-700 p-2">
                                        ${breakdownHtml}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </td>
                </tr>
            `;
        } else {
            tbody.innerHTML = `<tr><td colspan="4" class="p-4 text-center text-slate-500">Nenhum dado de rede disponível.</td></tr>`;
        }

        modal.classList.remove('hidden');
    }
};

window.openDetailModal = (groupKey) => {
    // If displayGroups isn't ready, verify if renderTable ran. 
    // It should be by the time button is clicked.
    const groups = window.displayGroups || {};
    const group = groups[groupKey];

    if (!group) return;

    const sigtap = group.sigtap; // Extract sigtap from group

    const modal = document.getElementById('modal-detalhe-lancamento');
    if (modal) {
        document.getElementById('modal-title').textContent = group.procName;
        document.getElementById('modal-subtitle').textContent = `Cód. SIGTAP: ${sigtap}`;

        // Ensure header is visible
        const thead = modal.querySelector('thead');
        if (thead) thead.classList.remove('hidden');

        // Ensure standard legend is visible
        const infoLegend = document.getElementById('modal-info-legend');
        if (infoLegend) infoLegend.classList.remove('hidden');

        // Ensure standard footer is visible
        const modalFooter = document.getElementById('modal-footer');
        if (modalFooter) modalFooter.classList.remove('hidden');

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

        // Remove old dynamic section if present
        const oldGlobal = document.getElementById('dynamic-global-section');
        if (oldGlobal) oldGlobal.remove();

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
