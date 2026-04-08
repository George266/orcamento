
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
let localGruposOferta = [];
let currentSort = { column: null, direction: 'asc' };

function populateCompetenceFilter(selectElement, pactuacoes, preserveValue = false) {
    if (!selectElement) return;

    let competencias = [];
    if (pactuacoes && pactuacoes.length > 0) {
        competencias = [...new Set(pactuacoes.map(p => p.competencia))];
    }

    // Always include current month
    const currentComp = DateUtils.getCurrentMonthLabel('short');
    if (!competencias.includes(currentComp)) {
        competencias.push(currentComp);
    }

    // Sort Chronologically (Newest first)
    const monthMap = { 'jan': 0, 'fev': 1, 'mar': 2, 'abr': 3, 'mai': 4, 'jun': 5, 'jul': 6, 'ago': 7, 'set': 8, 'out': 9, 'nov': 10, 'dez': 11 };
    const parseComp = (c) => {
        if (!c) return 0;
        const [m, y] = c.split('/');
        if (!m || !y) return 0;
        return new Date(2000 + parseInt(y), monthMap[m.toLowerCase()] || 0, 1);
    };
    competencias.sort((a, b) => parseComp(b) - parseComp(a));

    if (competencias.length > 0) {
        const previousVal = selectElement.value;
        selectElement.innerHTML = competencias.map(c => `<option value="${c}">${c}</option>`).join('');

        if (preserveValue && previousVal && competencias.includes(previousVal)) {
            selectElement.value = previousVal;
        } else {
            selectElement.value = currentComp;
            if (selectElement.value !== currentComp) selectElement.value = competencias[0];
        }
    } else {
        selectElement.innerHTML = '<option value="">Sem dados</option>';
    }
}

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
        allInstitutes = await Repository.getInstitutos();
        localGruposOferta = await Repository.getGruposOferta();

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
                            populateCompetenceFilter(compFilter, localPactuacoes, true);
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
        if (compFilter) {
            populateCompetenceFilter(compFilter, localPactuacoes, false);
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
    const processedKeys = new Set(); // Key: instId_sigtap OR instId_grupo_<grupoId>

    relevant.forEach(p => {
        const grupo = p.grupoOfertaId ? localGruposOferta.find(g => g.id === p.grupoOfertaId) : null;
        // For grupo items, use a shared key per (instId + grupoId) so all sigtaps in the group are evaluated together
        const key = grupo ? `${p.instId}_grupo_${grupo.id}` : `${p.instId}_${p.sigtap}`;
        if (processedKeys.has(key)) return;

        // CHECK IF ALREADY JUSTIFIED
        const justKey = `${p.instId}_${p.sigtap}`;
        if (!grupo && justifiedSet.has(justKey)) {
            console.log(`[DEBUG] Item ${justKey} found in database justifications.`);
            return;
        }

        let maxMeta, totalRealized;

        if (grupo) {
            // Unified group: sum production of ALL sigtaps in the group for this institute
            const grupoItems = relevant.filter(i => i.instId === p.instId && i.grupoOfertaId === grupo.id);
            maxMeta = parseInt(grupo.ofertaMinima || 0);
            totalRealized = grupoItems.reduce((sum, i) => sum + parseInt(i.producao?.realizada || 0), 0);
        } else {
            const groupItems = relevant.filter(i => i.instId === p.instId && i.sigtap === p.sigtap);
            maxMeta = groupItems.reduce((max, i) => Math.max(max, parseInt(i.ofertaMinima || 0)), 0);
            totalRealized = groupItems.reduce((max, i) => Math.max(max, parseInt(i.producao?.realizada || 0)), 0);
        }

        let isPending = false;
        let statusType = 'DELAY';

        if (isCriticalPeriod) {
            if (maxMeta > 0 && totalRealized < maxMeta) {
                isPending = true;
                statusType = 'FAILURE';
            }
        } else {
            if (maxMeta > 0 && totalRealized === 0) {
                isPending = true;
                statusType = 'DELAY';
            }
        }

        if (isPending) {
            pendingItems.push({
                instId: p.instId,
                sigtap: grupo ? `(grupo: ${grupo.nome})` : p.sigtap,
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

    // First pass: deduplicate by (sigtap + instId) to avoid double-counting
    // when the same procedure appears in multiple incentives for the same institute
    const globalInstMap = {}; // sigtap -> instId -> { meta, realizado }

    allFiltered.forEach(p => {
        if (!globalInstMap[p.sigtap]) globalInstMap[p.sigtap] = {};
        const instEntry = globalInstMap[p.sigtap][p.instId];
        const meta = parseInt(p.ofertaMinima || 0);
        const real = parseInt(p.producao?.realizada || 0);
        if (!instEntry) {
            globalInstMap[p.sigtap][p.instId] = { meta, realizado: real };
        } else {
            // Same institute, different incentive: take max meta and max realizado (not sum)
            instEntry.meta = Math.max(instEntry.meta, meta);
            instEntry.realizado = Math.max(instEntry.realizado, real);
        }
    });

    // Second pass: build globalStats from deduplicated data
    Object.keys(globalInstMap).forEach(sigtap => {
        const instMap = globalInstMap[sigtap];
        globalStats[sigtap] = { totalMeta: 0, totalRealizado: 0, breakdown: [] };
        Object.keys(instMap).forEach(instId => {
            const { meta, realizado } = instMap[instId];
            globalStats[sigtap].totalMeta = Math.max(globalStats[sigtap].totalMeta, meta);
            globalStats[sigtap].totalRealizado += realizado;
            globalStats[sigtap].breakdown.push({ instId, meta, realizado });
        });
    });

    // 2. Group by SIGTAP (or by grupoOfertaId when unified)
    const groups = {};
    filtered.forEach(p => {
        const cleanSigtap = (s) => String(s || "").replace(/^0+/, "").replace(/[^0-9]/g, "");

        const parseRobust = (v) => {
            if (typeof v === 'number') return v;
            let s = String(v || '0').replace(/[R$\s\u00A0]/g, "").trim();
            if (s.includes(',') && s.includes('.')) s = s.replace(/\./g, "").replace(",", ".");
            else if (s.includes(',')) s = s.replace(",", ".");
            return parseFloat(s) || 0;
        };

        const grupo = p.grupoOfertaId ? localGruposOferta.find(g => g.id === p.grupoOfertaId) : null;
        const groupKey = grupo ? `grupo_${grupo.id}` : cleanSigtap(p.sigtap);

        if (!groups[groupKey]) {
            const proc = localProcs.find(pr => cleanSigtap(pr.sigtap) === cleanSigtap(p.sigtap));
            groups[groupKey] = {
                key: groupKey,
                sigtap: p.sigtap,
                procName: grupo ? grupo.nome : (proc?.nome || 'Procedimento'),
                isGrupo: !!grupo,
                grupoId: grupo?.id || null,
                items: [],
                totalMeta: grupo ? parseInt(grupo.ofertaMinima || 0) : 0,
                maxMeta: grupo ? parseInt(grupo.ofertaMinima || 0) : 0,
                totalRealizado: 0,
                sem1: 0, sem2: 0, sem3: 0, sem4: 0, sem5: 0,
                programs: new Set(),
                global: globalStats[p.sigtap] || { totalMeta: 0, totalRealizado: 0, breakdown: [] },
                vSigtap: parseRobust(p.vlrSigtapBase) || (proc?.vlrSigtap || 0),
                vInc: parseRobust(p.vlrIncentivo) || 0
            };
        }
        groups[groupKey].items.push(p);

        const vSigtapRaw = parseRobust(p.vlrSigtapBase);
        if (vSigtapRaw > groups[groupKey].vSigtap) groups[groupKey].vSigtap = vSigtapRaw;

        const vIncRaw = parseRobust(p.vlrIncentivo);
        if (vIncRaw > groups[groupKey].vInc) groups[groupKey].vInc = vIncRaw;

        const prog = localProgs.find(pg => pg.id === p.progId);
        groups[groupKey].programs.add(prog ? prog.nome : (p.progId || ''));

        if (!groups[groupKey].instStats) groups[groupKey].instStats = {};

        if (!groups[groupKey].instStats[p.instId]) {
            groups[groupKey].instStats[p.instId] = {
                maxMeta: 0,
                sem1: 0, sem2: 0, sem3: 0, sem4: 0, sem5: 0
            };
        }

        const stats = groups[groupKey].instStats[p.instId];

        // Meta: for grupo items fixed from group; for individual take max
        if (!grupo) {
            const meta = parseInt(p.ofertaMinima || 0);
            stats.maxMeta = Math.max(stats.maxMeta, meta);
            groups[groupKey].maxMeta = Math.max(groups[groupKey].maxMeta, meta);
            groups[groupKey].totalMeta = Math.max(groups[groupKey].totalMeta, meta);
        }

        // Production: for grupo items SUM semanas (each sigtap contributes separately)
        if (!p.producao) p.producao = {};
        if (grupo) {
            // Sum production across all sigtaps in the group
            stats.sem1 = (stats.sem1 || 0) + parseInt(p.producao.sem1 || 0);
            stats.sem2 = (stats.sem2 || 0) + parseInt(p.producao.sem2 || 0);
            stats.sem3 = (stats.sem3 || 0) + parseInt(p.producao.sem3 || 0);
            stats.sem4 = (stats.sem4 || 0) + parseInt(p.producao.sem4 || 0);
            stats.sem5 = (stats.sem5 || 0) + parseInt(p.producao.sem5 || 0);
        } else {
            stats.sem1 = Math.max(stats.sem1, parseInt(p.producao.sem1 || 0));
            stats.sem2 = Math.max(stats.sem2, parseInt(p.producao.sem2 || 0));
            stats.sem3 = Math.max(stats.sem3, parseInt(p.producao.sem3 || 0));
            stats.sem4 = Math.max(stats.sem4, parseInt(p.producao.sem4 || 0));
            stats.sem5 = Math.max(stats.sem5, parseInt(p.producao.sem5 || 0));
        }
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

        // For grupo items, meta is fixed from the group definition — don't overwrite with 0
        if (!group.isGrupo) {
            group.maxMeta = maxMetaVal;
            group.totalMeta = maxMetaVal;
        }
        group.sem1 = sumSem1;
        group.sem2 = sumSem2;
        group.sem3 = sumSem3;
        group.sem4 = sumSem4;
        group.sem5 = sumSem5;

        // Total pelas semanas da própria instituição
        const semanasTotal = sumSem1 + sumSem2 + sumSem3 + sumSem4 + sumSem5;

        if (group.isGrupo && group.grupoId) {
            // Para oferta unificada: soma toda a produção de todos os institutos
            // de todos os sigtaps do grupo — o status é da rede, não do instituto
            group.totalRealizado = allPactuacoes
                .filter(p => p.competencia === compValue && p.grupoOfertaId === group.grupoId)
                .reduce((sum, p) => sum + parseInt(p.producao?.realizada || 0), 0);
        } else {
            // Para procedimentos individuais: usa as semanas locais
            const globalRealized = allPactuacoes
                .filter(p => p.competencia === compValue && p.sigtap === group.sigtap)
                .reduce((max, p) => Math.max(max, parseInt(p.producao?.realizada || 0)), 0);
            group.totalRealizado = Math.max(semanasTotal, globalRealized);
        }
    });

    const cleanSigtapFn = (s) => String(s || "").replace(/^0+/, "").replace(/[^0-9]/g, "");

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
        tbody.innerHTML = `<tr><td colspan="9" class="px-6 py-10 text-center text-slate-400 italic">Aguardando ofertas</td></tr>`;
    } else {
        tbody.innerHTML = displayItems.map(group => {
            const target = group.maxMeta;
            const progress = target > 0 ? (group.totalRealizado / target) * 100 : 0;

            let statusColor = 'bg-primary';
            if (progress >= 100) statusColor = 'bg-green-500';
            else if (progress < 50) statusColor = 'bg-yellow-500';

            const inputState = canEdit ? '' : 'disabled';
            const activeClass = canEdit ? 'bg-white focus:ring-primary focus:border-primary' : 'bg-slate-50 text-slate-500';

            const isMetaMet = target > 0 && group.totalRealizado >= target;

            const progNames = Array.from(group.programs).filter(Boolean);
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

            // ── GRUPO DE OFERTA UNIFICADA: header row + sub-rows per procedure ──
            if (group.isGrupo) {
                const grupoObj = localGruposOferta.find(gr => gr.id === group.grupoId);

                // Header row — meta, progress bar, no inputs
                const headerRow = `
                    <tr class="bg-indigo-50/60 dark:bg-indigo-900/20 border-b border-indigo-100 dark:border-indigo-800">
                        <td class="px-6 py-3">
                            <div class="flex items-center gap-2 flex-wrap">
                                <span class="text-sm font-black text-slate-900 dark:text-white">${group.procName}</span>
                                <span class="px-1.5 py-0.5 rounded text-[10px] font-black bg-indigo-100 text-indigo-700 border border-indigo-200 uppercase tracking-wide whitespace-nowrap">Oferta Unificada</span>
                                ${progLabel ? `<span class="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 font-bold border border-blue-100">${progLabel}</span>` : ''}
                            </div>
                        </td>
                        <td class="px-6 py-3 whitespace-nowrap text-center text-sm font-black text-indigo-700">
                            ${formatNumber(target)} <span class="text-[10px] font-normal text-slate-400">total</span>
                        </td>
                        <td class="px-6 py-3 align-middle" colspan="6">
                            <div class="flex flex-col gap-1 max-w-[240px]">
                                ${statusContent}
                            </div>
                        </td>
                        <td class="px-6 py-3 text-center">
                            <button onclick="window.openDetailModal('${group.key}')" class="p-2 text-slate-400 hover:text-primary transition-colors bg-white dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg border border-indigo-100" title="Ver Detalhes">
                                <span class="material-symbols-outlined text-[20px]">visibility</span>
                            </button>
                        </td>
                    </tr>`;

                // Sub-rows — one per procedure in the group
                const subRows = (grupoObj?.procedimentos || []).map(sigtap => {
                    const proc = localProcs.find(x => x.sigtap === sigtap);
                    const procName = proc?.nome || sigtap;
                    // Find the matching pactuacao item for this institute + sigtap
                    const pact = group.items.find(i => i.sigtap === sigtap);
                    const pactId = pact?.id || '';
                    const semVals = [1,2,3,4,5].map(w => parseInt(pact?.producao?.[`sem${w}`] || 0));
                    const subTotal = semVals.reduce((s, v) => s + v, 0);

                    // All procedures in the group are editable — pass sigtap so a pactuação can be auto-created if missing
                    const subWeekInputs = [1,2,3,4,5].map((w, idx) => `
                        <td class="px-2 py-3 whitespace-nowrap text-center">
                            <input
                                onchange="window.updateUnifiedWeek('${group.key}', 'sem${w}', this.value, '${pactId}', '${sigtap}')"
                                class="w-16 text-center rounded-lg border-slate-300 dark:border-slate-600 focus:ring-primary focus:border-primary text-xs shadow-sm font-bold ${activeClass}"
                                min="0" value="${semVals[idx]}" type="number" ${inputState}
                            />
                        </td>`).join('');

                    return `
                    <tr class="border-b border-indigo-50 dark:border-indigo-900/30 hover:bg-white dark:hover:bg-slate-800/30 transition-colors">
                        <td class="pl-10 pr-4 py-3" colspan="2">
                            <div class="flex items-center gap-2">
                                <span class="material-symbols-outlined text-[14px] text-indigo-300">subdirectory_arrow_right</span>
                                <span class="text-xs font-medium text-slate-700 dark:text-slate-300">${procName}</span>
                                <span class="text-[10px] font-mono text-slate-400">${sigtap}</span>
                            </div>
                        </td>
                        <td class="px-6 py-3 text-center text-xs font-bold text-slate-500">${formatNumber(subTotal)}</td>
                        <td class="px-4 py-3 text-center text-[10px] text-slate-400" colspan="1">—</td>
                        ${subWeekInputs}
                        <td></td>
                    </tr>`;
                }).join('');

                return headerRow + subRows;
            }

            // ── ITEM INDIVIDUAL (original logic) ──

            // Procedimentos de outros institutos ficam somente leitura
            const isShared = !!group.isSharedFromOther;
            const effectiveInputState = (isShared || !canEdit) ? 'disabled' : '';
            const effectiveActiveClass = (isShared || !canEdit)
                ? 'bg-slate-50 text-slate-400 cursor-not-allowed'
                : 'bg-white focus:ring-primary focus:border-primary';

            const weeks = [1, 2, 3, 4, 5];
            const weekInputs = weeks.map(w => {
                const val = group[`sem${w}`];
                return `
                    <td class="px-2 py-4 whitespace-nowrap text-center">
                        <input
                            onchange="window.updateUnifiedWeek('${group.key}', 'sem${w}', this.value)"
                            class="w-16 text-center rounded-lg border-slate-300 dark:border-slate-600 focus:ring-primary focus:border-primary text-xs shadow-sm font-bold ${effectiveActiveClass}"
                            min="0" value="${val}" type="number" ${effectiveInputState}
                        />
                    </td>
                `;
            }).join('');

            return `
             <tr class="hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors group/row ${isShared ? 'opacity-80' : ''}">
                <td class="px-6 py-4">
                    <div class="flex flex-col">
                        <span class="text-sm font-bold text-slate-900 dark:text-white truncate max-w-[250px]" title="${group.procName}">${group.procName}</span>
                        <div class="flex items-center gap-2 mt-0.5">
                            <span class="text-xs text-slate-500 font-mono">Cód: ${group.sigtap}</span>
                            ${progLabel ? `<span class="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 font-bold border border-blue-100" title="${progNames.join(', ')}">${progLabel}</span>` : ''}
                            ${isShared ? `<span class="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-600 font-bold border border-amber-100" title="Produção compartilhada entre institutos">Oferta compartilhada</span>` : ''}
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

function renderTableKeepFocus() {
    const inputs = Array.from(document.querySelectorAll('#table-acompanhamento-inst input[type="number"]'));
    const focusIdx = inputs.indexOf(document.activeElement);
    renderTable();
    if (focusIdx !== -1) {
        const newInputs = document.querySelectorAll('#table-acompanhamento-inst input[type="number"]');
        if (newInputs[focusIdx]) newInputs[focusIdx].focus();
    }
}

window.updateUnifiedWeek = async (groupKey, weekField, value, pactId = null, sigtap = null) => {
    const val = parseInt(value) || 0;
    const group = window.displayGroups[groupKey];
    if (!group) return;

    if (group.isGrupo && !pactId && sigtap) {
        // No pactuação exists for this procedure yet — auto-create from a sibling item in the group
        const template = group.items[0];
        if (!template) return;
        const newPact = {
            instId: template.instId,
            competencia: template.competencia,
            progId: template.progId,
            grupoOfertaId: template.grupoOfertaId,
            sigtap,
            ofertaMinima: 0,
            vlrSigtapBase: template.vlrSigtapBase || 0,
            vlrIncentivo: template.vlrIncentivo || 0,
            producao: { sem1: 0, sem2: 0, sem3: 0, sem4: 0, sem5: 0, realizada: 0 },
        };
        newPact.producao[weekField] = val;
        newPact.producao.realizada = val;
        try {
            const newId = await Repository.savePactuacao(newPact);
            newPact.id = newId;
            group.items.push(newPact);
            localPactuacoes.push(newPact);
            // Recalc group totals
            group.totalRealizado = group.items.reduce((s, i) => s + (parseInt(i.producao?.realizada) || 0), 0);
            [1,2,3,4,5].forEach(w => {
                group[`sem${w}`] = group.items.reduce((s, i) => s + (parseInt(i.producao?.[`sem${w}`]) || 0), 0);
            });
            renderTableKeepFocus();
        } catch (error) {
            console.error("Erro ao criar pactuação automática:", error);
            alert("Erro ao salvar. Tente novamente.");
        }
        return;
    }

    if (group.isGrupo && pactId) {
        // Unified group: update only the specific pactuacao (one procedure's input)
        const pact = group.items.find(i => i.id === pactId);
        if (!pact) return;
        if (!pact.producao) pact.producao = {};
        pact.producao[weekField] = val;
        pact.producao.realizada = [1,2,3,4,5].reduce((s, w) => s + (parseInt(pact.producao[`sem${w}`]) || 0), 0);

        // Recalc group total from ALL items
        group.totalRealizado = group.items.reduce((s, i) => s + (parseInt(i.producao?.realizada) || 0), 0);
        // Also update group semX totals
        [1,2,3,4,5].forEach(w => {
            group[`sem${w}`] = group.items.reduce((s, i) => s + (parseInt(i.producao?.[`sem${w}`]) || 0), 0);
        });

        try {
            await Repository.savePactuacao({ id: pact.id, producao: pact.producao });
            const localIdx = localPactuacoes.findIndex(lp => lp.id === pact.id);
            if (localIdx !== -1) localPactuacoes[localIdx].producao = { ...pact.producao };
            renderTableKeepFocus();
        } catch (error) {
            console.error("Error updating week for grupo item:", error);
            alert("Erro ao salvar semana.");
        }
    } else {
        // Individual item: original mirror logic
        group[weekField] = val;
        group.totalRealizado = [1,2,3,4,5].reduce((s, w) => s + (group[`sem${w}`] || 0), 0);

        const updatePromises = group.items.map(async (pact) => {
            if (!pact.producao) pact.producao = {};
            pact.producao[weekField] = val;
            pact.producao.realizada = [1,2,3,4,5].reduce((s, w) => s + (parseInt(pact.producao[`sem${w}`]) || 0), 0);
            return Repository.savePactuacao({ id: pact.id, producao: pact.producao });
        });

        try {
            await Promise.all(updatePromises);
            group.items.forEach(pact => {
                const localIdx = localPactuacoes.findIndex(lp => lp.id === pact.id);
                if (localIdx !== -1) {
                    if (!localPactuacoes[localIdx].producao) localPactuacoes[localIdx].producao = {};
                    localPactuacoes[localIdx].producao[weekField] = val;
                    localPactuacoes[localIdx].producao.realizada = pact.producao.realizada;
                }
            });
            renderTableKeepFocus();
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
            renderTableKeepFocus();
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
    const groups = window.displayGroups || {};
    const group = groups[groupKey];
    if (!group) return;

    const sigtap = group.sigtap;
    const modal = document.getElementById('modal-detalhe-lancamento');
    if (!modal) return;

    document.getElementById('modal-title').textContent = group.procName;
    document.getElementById('modal-subtitle').textContent = `Cód. SIGTAP: ${sigtap}`;

    // Hide unused elements from other modal views
    const thead = modal.querySelector('thead');
    if (thead) thead.classList.add('hidden');
    const infoLegend = document.getElementById('modal-info-legend');
    if (infoLegend) infoLegend.classList.add('hidden');
    const oldGlobal = document.getElementById('dynamic-global-section');
    if (oldGlobal) oldGlobal.remove();

    // Ensure footer visible
    const modalFooter = document.getElementById('modal-footer');
    if (modalFooter) modalFooter.classList.remove('hidden');

    const currentComp = document.getElementById('filter-competencia')?.value || '';
    const cleanSigtapFn = s => (s || '').replace(/\D/g, '');
    const userInstIds = new Set(group.items.map(i => i.instId));
    const redeBody = document.getElementById('modal-rede-body');

    if (group.isGrupo && group.grupoId) {
        // ── GRUPO DE OFERTA: barra única do total, detalhamento por instituto ──
        const grupoObj = localGruposOferta.find(g => g.id === group.grupoId);
        const grupaMeta = parseInt(grupoObj?.ofertaMinima || 0);

        // Soma toda a produção do grupo por instituto (todos os sigtaps do grupo)
        const allForGrupo = allPactuacoes.filter(p =>
            p.grupoOfertaId === group.grupoId && p.competencia === currentComp
        );
        const byInst = {};
        allForGrupo.forEach(p => {
            if (!byInst[p.instId]) byInst[p.instId] = { real: 0 };
            byInst[p.instId].real += parseInt(p.producao?.realizada || 0);
        });

        const totalReal = Object.values(byInst).reduce((s, v) => s + v.real, 0);
        const totalProgress = grupaMeta > 0 ? Math.min((totalReal / grupaMeta) * 100, 100) : 0;
        let totalBarColor = 'bg-primary';
        if (totalProgress >= 100) totalBarColor = 'bg-green-500';
        else if (totalProgress < 50) totalBarColor = 'bg-yellow-400';

        // Ordena: instituto do usuário primeiro, depois alfabético
        const instEntries = Object.entries(byInst).sort(([aId], [bId]) => {
            const aIsUser = userInstIds.has(aId), bIsUser = userInstIds.has(bId);
            if (aIsUser !== bIsUser) return aIsUser ? -1 : 1;
            const aName = allInstitutes.find(i => i.id === aId)?.sigla || aId;
            const bName = allInstitutes.find(i => i.id === bId)?.sigla || bId;
            return aName.localeCompare(bName);
        });

        const metaAtingida = totalProgress >= 100;

        if (redeBody) {
            redeBody.innerHTML = `
                <!-- Barra total do grupo -->
                <div class="px-4 pt-4 pb-3 border-b border-slate-100 dark:border-slate-700 ${metaAtingida ? 'bg-green-50/60 dark:bg-green-900/10' : ''}">
                    <div class="flex items-center justify-between mb-1.5">
                        <div class="flex items-center gap-2">
                            <span class="text-xs font-bold text-slate-500 uppercase tracking-wide">Total do grupo</span>
                            ${metaAtingida ? `<span class="flex items-center gap-1 text-[10px] font-bold text-green-700 bg-green-100 dark:bg-green-800/30 dark:text-green-400 px-2 py-0.5 rounded-full"><span class="material-symbols-outlined text-[12px]">check_circle</span> Meta atingida</span>` : ''}
                        </div>
                        <span class="text-xs font-bold ${metaAtingida ? 'text-green-700 dark:text-green-400' : 'text-slate-700 dark:text-slate-200'}">
                            ${formatNumber(totalReal)} <span class="text-slate-300 mx-0.5">/</span> ${formatNumber(grupaMeta)}
                        </span>
                    </div>
                    <div class="flex items-center gap-2">
                        <div class="flex-1 bg-slate-200 dark:bg-slate-700 rounded-full h-2.5">
                            <div class="${totalBarColor} h-2.5 rounded-full transition-all" style="width:${totalProgress}%"></div>
                        </div>
                        <span class="text-xs font-bold ${metaAtingida ? 'text-green-600' : 'text-slate-500'} w-10 text-right">${Math.round(totalProgress)}%</span>
                    </div>
                </div>
                <!-- Detalhamento por instituto -->
                <div class="px-4 pt-2 pb-1">
                    <span class="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Contribuição por instituto</span>
                </div>
                ${instEntries.map(([instId, stats]) => {
                    const inst = allInstitutes.find(i => i.id === instId);
                    const instSigla = inst ? (inst.sigla || inst.nome) : instId;
                    const instNome = inst?.nome || instId;
                    const isUser = userInstIds.has(instId);
                    const contrib = grupaMeta > 0 ? Math.min((stats.real / grupaMeta) * 100, 100) : 0;
                    const userBadge = isUser
                        ? `<span class="ml-1 text-[9px] font-bold uppercase tracking-wide text-primary bg-primary/10 px-1.5 py-0.5 rounded">Seu inst.</span>`
                        : '';
                    const metaBadge = metaAtingida
                        ? `<span class="flex items-center gap-0.5 text-[9px] font-bold text-green-700 dark:text-green-400"><span class="material-symbols-outlined text-[11px]">check_circle</span> Meta atingida</span>`
                        : '';
                    return `
                    <div class="flex items-center gap-3 px-4 py-2.5 ${metaAtingida ? 'bg-green-50/40 dark:bg-green-900/5' : isUser ? 'bg-blue-50/60 dark:bg-blue-900/10' : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'} transition-colors">
                        <div class="w-28 shrink-0">
                            <span class="text-sm font-semibold ${isUser ? 'text-primary' : 'text-slate-700 dark:text-slate-200'} truncate block" title="${instNome}">${instSigla}</span>
                            ${userBadge}
                            ${metaBadge}
                        </div>
                        <div class="flex-1 flex items-center gap-2">
                            <div class="flex-1 bg-slate-100 dark:bg-slate-700 rounded-full h-1.5">
                                <div class="${metaAtingida ? 'bg-green-500' : isUser ? 'bg-primary' : 'bg-slate-400'} h-1.5 rounded-full" style="width:${contrib}%"></div>
                            </div>
                        </div>
                        <span class="text-sm font-bold ${metaAtingida ? 'text-green-700 dark:text-green-400' : isUser ? 'text-primary' : 'text-slate-700 dark:text-slate-200'} shrink-0 w-8 text-right">${formatNumber(stats.real)}</span>
                    </div>`;
                }).join('')}
            `;
        }
    } else {
        // ── PROCEDIMENTO INDIVIDUAL: comparativo por instituto com meta própria ──
        const allForSigtap = allPactuacoes.filter(p =>
            cleanSigtapFn(p.sigtap) === cleanSigtapFn(sigtap) &&
            p.competencia === currentComp
        );

        const byInst = {};
        allForSigtap.forEach(p => {
            if (!byInst[p.instId]) byInst[p.instId] = { meta: 0, real: 0 };
            byInst[p.instId].meta = Math.max(byInst[p.instId].meta, parseInt(p.ofertaMinima || 0));
            byInst[p.instId].real += parseInt(p.producao?.realizada || 0);
        });

        const instEntries = Object.entries(byInst).sort(([aId], [bId]) => {
            const aIsUser = userInstIds.has(aId), bIsUser = userInstIds.has(bId);
            if (aIsUser !== bIsUser) return aIsUser ? -1 : 1;
            const aName = allInstitutes.find(i => i.id === aId)?.sigla || aId;
            const bName = allInstitutes.find(i => i.id === bId)?.sigla || bId;
            return aName.localeCompare(bName);
        });

        if (redeBody) {
            if (instEntries.length === 0) {
                redeBody.innerHTML = `<div class="px-4 py-6 text-center text-sm text-slate-400">Nenhum dado encontrado para esta competência.</div>`;
            } else {
                redeBody.innerHTML = instEntries.map(([instId, stats]) => {
                    const inst = allInstitutes.find(i => i.id === instId);
                    const instSigla = inst ? (inst.sigla || inst.nome) : instId;
                    const instNome = inst?.nome || instId;
                    const isUser = userInstIds.has(instId);
                    const progress = stats.meta > 0 ? Math.min((stats.real / stats.meta) * 100, 100) : 0;
                    const atingida = progress >= 100;
                    let barColor = 'bg-primary';
                    if (atingida) barColor = 'bg-green-500';
                    else if (progress < 50) barColor = 'bg-yellow-400';
                    const userBadge = isUser
                        ? `<span class="ml-1 text-[9px] font-bold uppercase tracking-wide text-primary bg-primary/10 px-1.5 py-0.5 rounded">Seu inst.</span>`
                        : '';
                    const metaBadge = atingida
                        ? `<span class="flex items-center gap-0.5 text-[9px] font-bold text-green-700 dark:text-green-400"><span class="material-symbols-outlined text-[11px]">check_circle</span> Meta atingida</span>`
                        : '';
                    return `
                    <div class="flex items-center gap-3 px-4 py-3 ${atingida ? 'bg-green-50/50 dark:bg-green-900/10' : isUser ? 'bg-blue-50/60 dark:bg-blue-900/10' : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'} transition-colors">
                        <div class="w-28 shrink-0">
                            <span class="text-sm font-semibold ${atingida ? 'text-green-700 dark:text-green-400' : isUser ? 'text-primary' : 'text-slate-700 dark:text-slate-200'} truncate block" title="${instNome}">${instSigla}</span>
                            ${userBadge}
                            ${metaBadge}
                        </div>
                        <div class="flex-1 flex items-center gap-2">
                            <div class="flex-1 bg-slate-200 dark:bg-slate-700 rounded-full h-1.5">
                                <div class="${barColor} h-1.5 rounded-full" style="width:${progress}%"></div>
                            </div>
                            <span class="text-[10px] font-bold ${atingida ? 'text-green-600' : 'text-slate-400'} w-8 text-right">${Math.round(progress)}%</span>
                        </div>
                        <div class="text-xs shrink-0 text-right">
                            <span class="font-bold ${atingida ? 'text-green-700 dark:text-green-400' : 'text-slate-800 dark:text-white'}">${formatNumber(stats.real)}</span>
                            <span class="mx-0.5 text-slate-300">/</span><span class="text-slate-500">${formatNumber(stats.meta)}</span>
                        </div>
                    </div>`;
                }).join('');
            }
        }
    }

    modal.classList.remove('hidden');
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
