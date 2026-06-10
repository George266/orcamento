import { Repository } from './repository.js';
import { auth } from './firebase-config.js';
import { DateUtils } from './utils/date-utils.js';

function formatCurrency(value) {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}

function formatNumber(value) {
    return new Intl.NumberFormat('pt-BR').format(value);
}

let allPactuacoes = [];
let localInsts = [];
let localProcs = [];
let localProgramas = []; // Added programs
let localGruposOferta = [];
let userRole = null;

// Pagination State
let currentPage = 1;
let itemsPerPage = 30;

// Sort State
let sortCol = null;
let sortDir = 'asc';

export async function initAcompanhamento() {
    // Load initial data
    allPactuacoes = await Repository.getPactuacoes();
    localInsts = await Repository.getInstitutos();
    localProcs = await Repository.getProcedimentos();
    localProgramas = await Repository.getProgramas();
    localGruposOferta = await Repository.getGruposOferta();

    // Fetch Justifications for current view context (optimized later, for now maybe fetch all or by competence filter?)
    // Since we don't know the filter yet, we might lazy load or fetch strictly by selected competence in renderTable.
    // But init loads data. Let's rely on renderTable to fetch specific competence justifications if needed, 
    // OR fetch all if manageable? Justifications are small. Let's fetch by competence inside renderTable to be safe/clean.

    // Check User Role
    const user = auth.currentUser;
    if (user) {
        const profile = await Repository.getUserByEmail(user.email);
        userRole = profile?.role;
    } else {
        // Retry shortly if auth not ready (though auth-guard usually handles it)
        setTimeout(async () => {
            const u = auth.currentUser;
            if (u) {
                const p = await Repository.getUserByEmail(u.email);
                userRole = p?.role;
                renderTable();
            }
        }, 1000);
    }

    // Data Correction: Removed to prevent future data loss.
    // User will re-import data with correct structure.

    // Populate Filters
    populateFilters();

    // Enable Drag Scroll
    enableDragToScroll();

    // Event Listeners
    document.getElementById('filter-inst')?.addEventListener('change', renderTable);
    document.getElementById('filter-prog')?.addEventListener('change', renderTable);
    document.getElementById('filter-period')?.addEventListener('change', renderTable);

    // Click-to-edit for Offer (only works if element exists/rendered by permissions)
    document.getElementById('monitoring-table-body')?.addEventListener('click', (e) => {
        const cell = e.target.closest('.editable-cell');
        if (cell) {
            const id = cell.getAttribute('data-offer-idx');
            const currentItem = allPactuacoes.find(p => p.id === id);
            const currentVal = currentItem ? (parseInt(currentItem.ofertado) || 0) : 0;

            const parent = cell.parentElement;

            const input = document.createElement('input');
            input.type = 'number';
            input.value = currentVal;
            input.min = 0;
            input.className = 'w-full min-w-[60px] max-w-[100px] text-right text-xs border border-slate-300 dark:border-slate-600 rounded px-1.5 py-1 focus:ring-2 focus:ring-primary focus:border-primary bg-white dark:bg-slate-700 dark:text-white transition-all shadow-sm';
            input.setAttribute('data-offer-id', id);

            input.addEventListener('blur', () => {
                setTimeout(() => {
                    if (document.activeElement !== input) renderTable();
                }, 100);
            });

            parent.innerHTML = '';
            parent.appendChild(input);
            input.focus();
        }
    });

    document.getElementById('monitoring-table-body')?.addEventListener('change', async (e) => {
        if (e.target.matches('input[data-offer-id]')) {
            const id = e.target.getAttribute('data-offer-id');
            const newVal = parseInt(e.target.value) || 0;
            const idx = allPactuacoes.findIndex(p => p.id === id);
            if (idx !== -1) {
                allPactuacoes[idx].ofertado = newVal;
                await Repository.savePactuacao({ id, ofertado: newVal });
                renderTable();
            }
        } else if (e.target.matches('input[data-prod-id]')) {
            const id = e.target.getAttribute('data-prod-id');
            const newVal = parseInt(e.target.value) || 0;
            const idx = allPactuacoes.findIndex(p => p.id === id);
            if (idx !== -1) {
                if (!allPactuacoes[idx].producao) allPactuacoes[idx].producao = {};
                if (!allPactuacoes[idx].producao) allPactuacoes[idx].producao = {};
                allPactuacoes[idx].producao.aprovada = newVal;
                await Repository.savePactuacao({ id, producao: { ...allPactuacoes[idx].producao, aprovada: newVal } });
                renderTable();
            }
        }
    });

    document.getElementById('btn-filter')?.addEventListener('click', renderTable);
    document.getElementById('btn-clear')?.addEventListener('click', () => {
        document.getElementById('filter-inst').value = '';
        clearProcAutocomplete();
        document.getElementById('filter-prog').value = '';
        const periodSelect = document.getElementById('filter-period');
        if (periodSelect) {
            // Re-select the latest competence on clear
            const competencias = [...new Set(allPactuacoes.map(p => p.competencia))].sort().reverse();
            if (competencias.length > 0) periodSelect.value = competencias[0];
        }
        renderTable();
    });

    // Initial Render
    renderTable();

    // Check Budget Deadline Alert
    if (typeof Repository.getSystemConfig === 'function') {
        const config = await Repository.getSystemConfig();
        const deadlineDay = config?.deadlineDay || 5;
        const deadlineRule = config?.deadlineRule || 'business_day';
        const deadlineAlert = config?.deadlineAlert !== false;

        if (deadlineAlert && DateUtils.isPastDeadline(deadlineDay, deadlineRule)) {
            checkBudgetDeadlineCompliance(allPactuacoes, localInsts, { deadlineDay, deadlineRule });
        }
    } else {
        console.warn('Repository.getSystemConfig not found - likely cached version. Please refresh.');
    }
}

function checkBudgetDeadlineCompliance(allPactuacoes, institutes, config) {
    const targetComp = DateUtils.getPreviousMonthLabel('iso'); // "YYYY-MM" (Standard for deadline check)
    // Actually, "Previous Month" label logic might return YYYY-MM depending on implementation.
    // DateUtils.getPreviousMonthLabel('iso') returns "YYYY-MM" (e.g. "2023-11" if now is Dec).
    // Let's verify if `p.competencia` uses "YYYY-MM" or "mmm/yy".
    // In `acompanhamento-logic.js`, filters use `p.competencia`.
    // Looking at `populateFilters`, it extracts from `allPactuacoes`, likely strings like "mmm/yy" or "YYYY-MM".
    // Most recent data seems to form "oct/23" style (short).
    // Let's infer the format from data or use a standard generator.
    // If the system uses "mmm/yy", we need *that* format for the *previous* month.

    // Check first available competence to guess format or assume "short" based on other files using "jan/26".
    const sample = allPactuacoes[0]?.competencia;
    const isShortFormat = sample && sample.includes('/');

    let targetFilter = '';
    if (isShortFormat) {
        targetFilter = DateUtils.getPreviousMonthLabel('short');
    } else {
        targetFilter = DateUtils.getPreviousMonthLabel('iso'); // Default fallback
    }

    // DEBUG: Force check current if needed or stick to previous?
    // User request: "quando der o 5o dia util... e nao tiver começado".
    // Usually "Launching offers" is for the UPCOMING or CURRENT month in some contexts, but usually "Producão" is retrospective.
    // However, "Plan Operativo" (Pactuacoes) is often set in advance?
    // If "Lançamento de Oferta" means "Setting the Goals/Offer", it might be for the NEXT month?
    // User said "não iniciaram o lançamento de oferta".
    // Let's assume we check the *current* active competence for filling data.
    // Which is usually the one returned by `getCurrentMonthLabel` if we are in the "filling period".
    // Wait, `acompanhamento-inst-logic.js` used `getCurrentMonthLabel('short')` for the alert.
    // So I will use `getCurrentMonthLabel` to match the Institute's own alert.

    if (isShortFormat) {
        targetFilter = DateUtils.getCurrentMonthLabel('short'); // "jan/26"
    }

    console.log(`[Deadline Check] Target: ${targetFilter}, DeadlineDay: ${config.deadlineDay}`);

    const ignoreKey = `budget_ignored_${targetFilter}`;
    if (localStorage.getItem(ignoreKey) === 'true') {
        console.log('[Deadline Check] Alert ignored via localStorage.');
        return;
    }

    // Analyze Data
    const relevantItems = allPactuacoes.filter(p => p.competencia === targetFilter);
    console.log(`[Deadline Check] Found ${relevantItems.length} items for ${targetFilter}`);

    const statusMap = {}; // instId -> { started: false, pendingItems: [] }

    // Iterate items to check status AND collect pending info
    relevantItems.forEach(p => {
        if (!statusMap[p.instId]) statusMap[p.instId] = { started: false, pendingItems: new Set() };

        const prod = parseInt(p.producao?.realizada || 0);
        const offer = parseInt(p.ofertado || 0);

        if (prod > 0 || offer > 0) {
            statusMap[p.instId].started = true;
        } else {
            // Collect info if this item is 0 (and institute overall not started?)
            // We collect everything that is 0. If later we confirm institute started > 0 total, we ignore this list.
            // BUT user wants to know WHAT they didn't launch IF they didn't launch anything.
            // If they launched SOME things but not others, they are technically "Started" but incomplete.
            // The request was "não começaram o lançamento". Defined as Total = 0.
            // So we only show the list if `started` remains false at the end.

            // Get Proc Name from localProcs
            const proc = localProcs.find(pr => pr.sigtap === p.sigtap);
            const name = proc?.nome || p.sigtap;
            statusMap[p.instId].pendingItems.add(name);
        }
    });

    const nonCompliant = [];

    localInsts.forEach(inst => {
        const status = statusMap[inst.id];

        // CASE 1: No rows exist for this institute in this period
        // User requested to REMOVE this alert ("não precisaria desse nenhum item importado").
        // Only show if they HAVE items (Importados) but haven't launched.
        if (!status) return;

        // CASE 2: Rows exist but nothing started (All 0)
        if (!status.started) {
            // Convert Set to Array
            const details = Array.from(status.pendingItems);
            nonCompliant.push({
                inst,
                details: details.length > 0 ? details : ["Nenhuma produção informada."]
            });
        }
    });

    console.log(`[Deadline Check] Non-compliant count: ${nonCompliant.length}`);

    if (nonCompliant.length > 0) {
        showBudgetAlert(targetFilter, nonCompliant, config);
    }
}

function showBudgetAlert(compLabel, dataList, config) {
    const modal = document.getElementById('modal-alert-prazo-orcamento');
    if (!modal) return;

    // Format Month
    const monthMap = { 'jan': 'Janeiro', 'fev': 'Fevereiro', 'mar': 'Março', 'abr': 'Abril', 'mai': 'Maio', 'jun': 'Junho', 'jul': 'Julho', 'ago': 'Agosto', 'set': 'Setembro', 'out': 'Outubro', 'nov': 'Novembro', 'dez': 'Dezembro' };
    let humanComp = compLabel;
    const parts = compLabel.split('/');
    if (parts.length === 2 && monthMap[parts[0].toLowerCase()]) {
        humanComp = `${monthMap[parts[0].toLowerCase()]} 20${parts[1]}`;
    }
    document.getElementById('alert-orc-month').textContent = humanComp;

    // Deadline Format
    const today = new Date();
    let deadlineDate;
    if (config.deadlineRule === 'fixed_date') {
        deadlineDate = new Date(today.getFullYear(), today.getMonth(), config.deadlineDay);
    } else {
        deadlineDate = DateUtils.getBusinessDay(today.getFullYear(), today.getMonth(), config.deadlineDay);
    }
    document.getElementById('alert-orc-deadline').textContent = deadlineDate.toLocaleDateString('pt-BR');

    // Render Table
    const tbody = document.getElementById('alert-orc-table-body');
    tbody.innerHTML = dataList.map(({ inst, details }) => {

        // Contact Logic
        const hasEmail = !!inst.email;
        const hasPhone = !!(inst.celular || inst.telefone || inst.whatsapp);

        // Clean phone for WA link
        const valPhone = inst.celular || inst.telefone || '';
        const cleanPhone = String(valPhone).replace(/\D/g, '');

        // Dynamic Message
        const msgText = `Olá ${inst.sigla || inst.nome}, identificamos pendências no lançamento de produção da competência ${humanComp}. Poderiam verificar?`;
        const waLink = `https://wa.me/55${cleanPhone}?text=${encodeURIComponent(msgText)}`;

        const mailSubject = `Pendência de Lançamento - ${humanComp}`;
        const mailBody = `Olá ${inst.sigla || inst.nome},\n\nIdentificamos pendências no lançamento de produção referente à competência ${humanComp}.\n\nFavor verificar e regularizar o quanto antes.\n\nAtenciosamente,\nGestão de Orçamento`;
        const mailLink = `mailto:${inst.email}?subject=${encodeURIComponent(mailSubject)}&body=${encodeURIComponent(mailBody)}`;

        // Limit details to X items
        const maxItems = 3;
        const totalItems = details.length;
        const displayItems = details.slice(0, maxItems);
        const remaining = totalItems - maxItems;

        const detailsHtml = displayItems.map(d => `<div class="truncate" title="${d}">• ${d}</div>`).join('') +
            (remaining > 0 ? `<div class="text-[10px] text-slate-400 mt-1 italic">+${remaining} outros itens</div>` : '');

        // WhatsApp Icon SVG
        const waIcon = `
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="currentColor" viewBox="0 0 16 16">
                <path d="M13.601 2.326A7.854 7.854 0 0 0 7.994 0C3.627 0 .068 3.558.064 7.926c0 1.399.366 2.76 1.057 3.965L0 16l4.204-1.102a7.933 7.933 0 0 0 3.79.965h.004c4.368 0 7.926-3.558 7.93-7.93A7.898 7.898 0 0 0 13.6 2.326zM7.994 14.521a6.573 6.573 0 0 1-3.356-.92l-.24-.144-2.494.654.666-2.433-.156-.251a6.56 6.56 0 0 1-1.007-3.505c0-3.626 2.957-6.584 6.591-6.584a6.56 6.56 0 0 1 4.66 1.931 6.557 6.557 0 0 1 1.928 4.66c-.004 3.639-2.961 6.592-6.592 6.592zm3.615-4.934c-.197-.099-1.17-.578-1.353-.646-.182-.065-.315-.099-.445.099-.133.197-.513.646-.627.775-.114.133-.232.148-.43.05-.197-.1-.836-.308-1.592-.985-.59-.525-.985-1.175-1.103-1.372-.114-.198-.011-.304.088-.403.087-.088.197-.232.296-.346.1-.114.133-.198.198-.33.065-.134.034-.248-.015-.347-.05-.099-.445-1.076-.612-1.47-.16-.389-.323-.335-.445-.34-.114-.007-.247-.007-.38-.007a.729.729 0 0 0-.529.247c-.182.198-.691.677-.691 1.654 0 .977.71 1.916.81 2.049.098.133 1.394 2.132 3.383 2.992.47.205.84.326 1.129.418.475.152.904.129 1.246.08.38-.058 1.171-.48 1.338-.943.164-.464.164-.86.114-.943-.049-.084-.182-.133-.38-.232z"/>
            </svg>
        `;

        return `
        <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/50 group transition-colors">
            <td class="px-4 py-3 align-top">
                <div class="font-bold text-slate-700 dark:text-slate-300 text-sm">${inst.sigla || inst.nome}</div>
                <div class="text-[10px] text-slate-400 font-mono mt-0.5">${inst.id}</div>
            </td>
            <td class="px-4 py-3 align-top">
                <div class="text-xs text-slate-600 dark:text-slate-400 space-y-0.5">
                    ${detailsHtml}
                </div>
            </td>
            <td class="px-4 py-3 align-middle text-right">
                <div class="flex items-center justify-end gap-2">
                    <!-- WhatsApp -->
                     <a href="${hasPhone ? waLink : '#'}" target="_blank"
                        class="size-8 flex items-center justify-center rounded-lg border transition-all ${hasPhone ? 'border-slate-200 bg-slate-100 text-slate-500 hover:bg-slate-200 hover:text-green-600 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-400 dark:hover:text-green-400' : 'border-slate-100 bg-slate-50 text-slate-300 cursor-not-allowed pointer-events-none'}"
                        title="${hasPhone ? 'Enviar mensagem no WhatsApp' : 'Telefone não cadastrado'}">
                        ${waIcon}
                    </a>

                    <!-- Email -->
                    <a href="${hasEmail ? mailLink : '#'}"
                        class="size-8 flex items-center justify-center rounded-lg border transition-all ${hasEmail ? 'border-slate-200 bg-slate-100 text-slate-500 hover:bg-slate-200 hover:text-blue-600 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-400 dark:hover:text-blue-400' : 'border-slate-100 bg-slate-50 text-slate-300 cursor-not-allowed pointer-events-none'}"
                        title="${hasEmail ? 'Enviar E-mail' : 'E-mail não cadastrado'}">
                        <span class="material-symbols-outlined text-[18px]">mail</span>
                    </a>
                </div>
            </td>
        </tr>
    `}).join('');

    modal.classList.remove('hidden');
}

window.ignoreBudgetAlert = (type) => {
    // Re-calculate or pass the compLabel?
    // We can just grab it from the UI or recalculate.
    const targetComp = DateUtils.getCurrentMonthLabel('short');
    localStorage.setItem(`budget_ignored_${targetComp}`, 'true');
    document.getElementById('modal-alert-prazo-orcamento').classList.add('hidden');
};

function initProcAutocomplete(items) {
    const input = document.getElementById('filter-proc-input');
    const hidden = document.getElementById('filter-proc');
    const dropdown = document.getElementById('proc-dropdown');
    const clearBtn = document.getElementById('proc-clear-btn');
    if (!input || !hidden || !dropdown || !clearBtn) return;

    function showDropdown(filtered) {
        if (filtered.length === 0) {
            dropdown.classList.add('hidden');
            return;
        }
        dropdown.innerHTML = filtered.map(item =>
            `<li data-value="${item.value}"
                class="px-3 py-2 text-sm cursor-pointer hover:bg-primary/10 dark:hover:bg-slate-700 text-text-main dark:text-white">
                ${item.label}
            </li>`
        ).join('');
        dropdown.classList.remove('hidden');
    }

    function selectItem(value, label) {
        hidden.value = value;
        input.value = label;
        dropdown.classList.add('hidden');
        clearBtn.classList.remove('hidden');
        renderTable();
    }

    input.addEventListener('input', () => {
        const q = input.value.trim().toLowerCase();
        hidden.value = '';
        clearBtn.classList.toggle('hidden', q === '');
        if (q === '') {
            dropdown.classList.add('hidden');
            renderTable();
            return;
        }
        const filtered = items.filter(it => it.label.toLowerCase().includes(q));
        showDropdown(filtered);
    });

    input.addEventListener('focus', () => {
        const q = input.value.trim().toLowerCase();
        if (q && !hidden.value) {
            const filtered = items.filter(it => it.label.toLowerCase().includes(q));
            showDropdown(filtered);
        }
    });

    dropdown.addEventListener('mousedown', (e) => {
        const li = e.target.closest('li[data-value]');
        if (li) selectItem(li.dataset.value, li.textContent.trim());
    });

    clearBtn.addEventListener('click', () => {
        clearProcAutocomplete();
        renderTable();
    });

    document.addEventListener('click', (e) => {
        if (!document.getElementById('proc-autocomplete-wrapper')?.contains(e.target)) {
            dropdown.classList.add('hidden');
        }
    });
}

function clearProcAutocomplete() {
    const input = document.getElementById('filter-proc-input');
    const hidden = document.getElementById('filter-proc');
    const dropdown = document.getElementById('proc-dropdown');
    const clearBtn = document.getElementById('proc-clear-btn');
    if (input) input.value = '';
    if (hidden) hidden.value = '';
    if (dropdown) dropdown.classList.add('hidden');
    if (clearBtn) clearBtn.classList.add('hidden');
}

function populateFilters() {
    const instSelect = document.getElementById('filter-inst');
    if (instSelect) {
        instSelect.innerHTML = `<option value="">Todos os Institutos</option>` +
            localInsts.map(i => `<option value="${i.id}">${i.sigla || i.nome}</option>`).join('');
    }

    // Autocomplete para Procedimento
    const uniqueProcIds = [...new Set(allPactuacoes.map(p => p.sigtap))];
    const procItems = uniqueProcIds.map(id => {
        const p = localProcs.find(pr => pr.sigtap === id);
        return { value: id, label: `${id} - ${p?.nome || '???'}` };
    }).sort((a, b) => a.label.localeCompare(b.label));
    initProcAutocomplete(procItems);

    // Populate Program Filter
    const progSelect = document.getElementById('filter-prog');
    if (progSelect) {
        // Unique programs present in pactuacoes + programs from repo
        // Filter those actually used if desired, or show all available?
        // Let's show all valid programs available in `localProgramas`
        progSelect.innerHTML = `<option value="">Todos os Incentivos</option>` +
            localProgramas.map(pg => `<option value="${pg.id}">${pg.nome}</option>`).join('');
    }

    const periodSelect = document.getElementById('filter-period');
    if (periodSelect) {
        let competencias = [];
        if (allPactuacoes.length > 0) {
            competencias = [...new Set(allPactuacoes.map(p => p.competencia))];
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

        // Strictly by competence, no "All" option to avoid confusion with "Geral"
        if (competencias.length > 0) {
            periodSelect.innerHTML = competencias.map(c => `<option value="${c}">${c}</option>`).join('');

            // Default to current month
            periodSelect.value = currentComp;

            // Fallback if currentComp somehow failed selection (shouldn't happen if in list)
            if (!periodSelect.value) periodSelect.value = competencias[0];
        } else {
            periodSelect.innerHTML = `<option value="">Nenhuma Competência</option>`;
        }
    }
}

async function renderTable() {
    const tbody = document.getElementById('monitoring-table-body');
    if (!tbody) return;

    const fInst = document.getElementById('filter-inst')?.value;
    const fProc = document.getElementById('filter-proc')?.value;
    const fPeriod = document.getElementById('filter-period')?.value;
    const fProg = document.getElementById('filter-prog')?.value; // Get Filter Value

    // Filter Logic
    let filtered = allPactuacoes;
    if (fInst) filtered = filtered.filter(p => p.instId === fInst);
    if (fProc) filtered = filtered.filter(p => p.sigtap === fProc);
    if (fPeriod) filtered = filtered.filter(p => p.competencia === fPeriod);
    if (fProg) filtered = filtered.filter(p => p.progId === fProg); // Apply Filter

    // FETCH JUSTIFICATIONS if competence is selected
    let currentJustificativas = [];
    if (fPeriod) {
        // Optimization: We could cache this
        try {
            currentJustificativas = await Repository.getJustificativas(fPeriod);
        } catch (e) { console.error("Error fetching justifications", e); }
    }
    const justMap = new Map(); // key: instId_sigtap -> text
    currentJustificativas.forEach(j => justMap.set(`${j.instId}_${j.sigtap}`, j));

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="13" class="px-6 py-12 text-center text-slate-400 italic">Aguardando ofertas</td></tr>`; // Colspan increased
        updateStats(0, 0, 0);
        renderPagination(0, 0, 0); // Clear pagination
        return;
    }

    // ------------------------------------------------------------------
    // 1. Group Data (Procedure + Program)
    // ------------------------------------------------------------------
    // Helper: Clean SIGTAP (strip leading zeros and symbols)
    const cleanSigtap = (s) => String(s || "").replace(/^0+/, "").replace(/[^0-9]/g, "");

    const safeParseFloat = (val) => {
        if (typeof val === 'number') return val;
        if (!val) return 0;
        // Robust parsing for Brazilian/International formats
        let str = String(val).replace(/[R$\s\u00A0]/g, "").trim();
        if (str.includes(',') && str.includes('.')) {
            // Assume Brazilian format: 1.500,00
            str = str.replace(/\./g, "").replace(",", ".");
        } else if (str.includes(',')) {
            // Only comma: 1500,00
            str = str.replace(",", ".");
        }
        let num = parseFloat(str);
        return isNaN(num) ? 0 : num;
    };

    const groups = {};
    filtered.forEach(p => {
        // If item belongs to a unified offer group, key is "grupo_<grupoId>"
        // Otherwise key is the cleaned SIGTAP
        const grupo = p.grupoOfertaId ? localGruposOferta.find(g => g.id === p.grupoOfertaId) : null;
        const key = grupo ? `grupo_${grupo.id}` : cleanSigtap(p.sigtap);

        if (!groups[key]) {
            const proc = localProcs.find(pr => cleanSigtap(pr.sigtap) === cleanSigtap(p.sigtap));
            groups[key] = {
                key,
                sigtap: p.sigtap,
                procName: grupo ? grupo.nome : (proc?.nome || 'Procedimento'),
                code: p.sigtap,
                isGrupo: !!grupo,
                grupoId: grupo?.id || null,
                items: [],
                // Aggregates
                totalMeta: grupo ? parseInt(grupo.ofertaMinima || 0) : 0,
                totalOffer: 0,
                totalProd: 0,
                totalFatSigtap: 0,
                potentialFatInc: 0,
                programs: new Set(),
                competencia: p.competencia,
                justifications: [],
                // Unit Values (Best available)
                vSigtap: Math.max(safeParseFloat(p.vlrSigtapBase), safeParseFloat(proc?.vlrSigtap), 0),
                vInc: safeParseFloat(p.vlrIncentivo),
                // Track seen institutes to avoid double-counting production
                seenProdInstIds: new Set(),
                // Track max offer per institute (handles multiple incentive entries)
                instMaxOffer: {}
            };
        }

        // Check for Justification
        const justKey = `${p.instId}_${p.sigtap}`;
        if (justMap.has(justKey)) {
            const justObj = justMap.get(justKey);
            if (!groups[key].justifications.find(j => j.id === justObj.id)) {
                groups[key].justifications.push(justObj);
            }
        }

        // Add item to group
        groups[key].items.push(p);

        // Track Program
        const prog = localProgramas.find(pg => pg.id === p.progId);
        const progName = prog ? prog.nome : (p.progId || '-');
        groups[key].programs.add(progName);

        // ** Multi-source Unit Value Collection **
        const vSigtap = safeParseFloat(p.vlrSigtapBase);
        if (vSigtap > groups[key].vSigtap) groups[key].vSigtap = vSigtap;

        const vInc = safeParseFloat(p.vlrIncentivo);
        if (vInc > groups[key].vInc) groups[key].vInc = vInc;

        // Meta: for grupo items, fixed from group definition; for individual, take max
        if (!grupo) {
            const meta = parseInt(p.ofertaMinima || 0);
            groups[key].totalMeta = Math.max(groups[key].totalMeta, meta);
        }

        // Production: deduplicate by institute (first occurrence only)
        if (!groups[key].seenProdInstIds.has(p.instId)) {
            groups[key].seenProdInstIds.add(p.instId);
            const prod = parseInt(p.producao?.aprovada || 0);
            groups[key].totalProd += prod;
        }

        // Offer: track max per institute (handles multiple incentive entries for same procedure)
        // Uses weekly sums as primary source, falls back to realizada or static ofertado
        const semOffer = (parseInt(p.producao?.sem1 || 0) + parseInt(p.producao?.sem2 || 0) +
            parseInt(p.producao?.sem3 || 0) + parseInt(p.producao?.sem4 || 0) + parseInt(p.producao?.sem5 || 0));
        const realizadaOffer = parseInt(p.producao?.realizada || 0);
        const staticOfertado = parseInt(p.ofertado || 0);
        const thisInstOffer = Math.max(realizadaOffer, semOffer, staticOfertado);
        if (grupo) {
            // Grupos unificados: cada sigtap é independente, soma as contribuições
            groups[key].instMaxOffer[p.instId] = (groups[key].instMaxOffer[p.instId] || 0) + thisInstOffer;
        } else {
            // Procedimentos individuais: max para evitar dupla contagem por incentivo
            groups[key].instMaxOffer[p.instId] = Math.max(groups[key].instMaxOffer[p.instId] || 0, thisInstOffer);
        }
    });

    // Finalize totalOffer from per-institute max offers
    Object.values(groups).forEach(g => {
        g.totalOffer = Object.values(g.instMaxOffer).reduce((sum, v) => sum + v, 0);
    });

    // Remove standalone entries for SIGTAPs already covered by a unified group
    const sigtapsInGrupos = new Set();
    Object.values(groups).forEach(g => {
        if (g.isGrupo) g.items.forEach(item => sigtapsInGrupos.add(cleanSigtap(item.sigtap)));
    });
    Object.keys(groups).forEach(key => {
        if (!groups[key].isGrupo && sigtapsInGrupos.has(cleanSigtap(groups[key].sigtap))) {
            delete groups[key];
        }
    });

    const groupList = Object.values(groups);

    // 2.1 Calculate Incentive Status per Program within Group
    const programStatusMap = {}; // Key: "Sigtap-ProgId" -> Boolean (isMet)

    groupList.forEach(g => {
        // Partition items by program to check meta
        // 1. Finalize SIGTAP Financial based on best unit value found
        g.totalFatSigtap = g.totalProd * g.vSigtap;

        // 2. Calculate Total Production for the Procedure (Group)
        let totalGroupProd = g.totalProd;

        // 2. Partition items by program to check meta
        const usageByProg = {};
        g.items.forEach(item => {
            const pId = item.progId || 'default';
            if (!usageByProg[pId]) usageByProg[pId] = { meta: 0, offer: 0, unitVal: 0, instProds: {} };

            const itemMeta = parseInt(item.ofertaMinima || 0);

            const itemSemOffer = (parseInt(item.producao?.sem1 || 0) + parseInt(item.producao?.sem2 || 0) +
                parseInt(item.producao?.sem3 || 0) + parseInt(item.producao?.sem4 || 0) + parseInt(item.producao?.sem5 || 0));
            const itemRealizada = parseInt(item.producao?.realizada || 0);
            const itemStaticOffer = parseInt(item.ofertado || 0);
            const itemOffer = Math.max(itemRealizada, itemSemOffer, itemStaticOffer);

            // Fallback for incentive unit value only when field is truly absent (null/undefined/empty)
            const rawVlrInc = item.vlrIncentivo;
            const hasVlrInc = rawVlrInc !== null && rawVlrInc !== undefined && rawVlrInc !== '';
            const itemValInc = hasVlrInc ? safeParseFloat(rawVlrInc) : (g.vInc || 0);

            usageByProg[pId].meta = Math.max(usageByProg[pId].meta, itemMeta);
            usageByProg[pId].offer += itemOffer;

            // Capture Unit Value (use max found or first non-zero)
            if (itemValInc > 0) usageByProg[pId].unitVal = itemValInc;

            // Track production per institute+sigtap to avoid double-counting
            // when the same procedure+institute appears in multiple incentives,
            // but allow different procedures from the same institute to be summed.
            const prod = parseInt(item.producao?.aprovada || 0);
            const instId = item.instId;
            const instSigtapKey = `${instId}-${item.sigtap}`;
            if (!(instSigtapKey in usageByProg[pId].instProds)) {
                usageByProg[pId].instProds[instSigtapKey] = prod;
            } else {
                usageByProg[pId].instProds[instSigtapKey] = Math.max(usageByProg[pId].instProds[instSigtapKey], prod);
            }
        });

        // Calculate Realized vs Missed for the Group
        g.realizedInc = 0;
        g.missedInc = 0;

        Object.keys(usageByProg).forEach(pId => {
            const prog = usageByProg[pId];
            const isMet = prog.meta > 0 ? (prog.offer >= prog.meta) : true;

            // Sum production per institute (deduplicated) to avoid double-counting
            // when the same procedure appears in multiple incentives
            const progProd = Object.values(prog.instProds).reduce((sum, v) => sum + v, 0);
            const potential = progProd * prog.unitVal;

            // Store status for global stats
            programStatusMap[`${g.sigtap}-${pId}`] = isMet;

            if (isMet) {
                g.realizedInc += potential;
            } else {
                g.missedInc += potential;
            }
        });
    });

    // ------------------------------------------------------------------
    // 2. Sort
    // ------------------------------------------------------------------
    if (sortCol) {
        groupList.sort((a, b) => {
            let va, vb;
            const totalIncA = a.realizedInc + a.missedInc;
            const totalIncB = b.realizedInc + b.missedInc;
            switch (sortCol) {
                case 'proc':    va = a.procName.toLowerCase(); vb = b.procName.toLowerCase(); break;
                case 'meta':    va = a.totalMeta;   vb = b.totalMeta;   break;
                case 'offer':   va = a.totalOffer;  vb = b.totalOffer;  break;
                case 'prod':    va = a.totalProd;   vb = b.totalProd;   break;
                case 'sigtap':  va = a.totalFatSigtap; vb = b.totalFatSigtap; break;
                case 'inc':     va = totalIncA;     vb = totalIncB;     break;
                case 'total':   va = a.totalFatSigtap + totalIncA; vb = b.totalFatSigtap + totalIncB; break;
                default:        va = 0; vb = 0;
            }
            if (va < vb) return sortDir === 'asc' ? -1 : 1;
            if (va > vb) return sortDir === 'asc' ? 1 : -1;
            return 0;
        });
    }

    // ------------------------------------------------------------------
    // 3. Pagination (on Groups now)
    // ------------------------------------------------------------------
    const totalItems = groupList.length;
    const totalPages = Math.ceil(totalItems / itemsPerPage);

    if (currentPage > totalPages) currentPage = totalPages || 1;
    if (currentPage < 1) currentPage = 1;

    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = Math.min(startIndex + itemsPerPage, totalItems);
    const paginatedGroups = groupList.slice(startIndex, endIndex);

    // ------------------------------------------------------------------
    // 3. Render Rows (Aggregated)
    // ------------------------------------------------------------------
    tbody.innerHTML = paginatedGroups.map(g => {
        // Meta Status
        const isMetaMet = g.totalMeta > 0 ? (g.totalOffer >= g.totalMeta) : true;

        // Status Icon / Button
        let metaStatusHtml = '<span class="text-slate-300">-</span>';
        if (g.totalMeta > 0) {
            const icon = isMetaMet ? 'check_circle' : 'warning';
            const color = isMetaMet ? 'text-emerald-500' : 'text-amber-500';

            // Check if ANY item in this group has (Justification AND Offer < Meta)
            const hasRelevantJustification = g.items.some(item => {
                const just = g.justifications ? g.justifications.find(j => j.instId === item.instId) : null;
                const finalOffer = parseInt(item.producao?.realizada || 0);
                const meta = parseInt(item.ofertaMinima || 0);
                return just && finalOffer < meta;
            });

            // Clickable to open modal
            metaStatusHtml = `
                <button onclick="window.openBreakdownModal('${g.key}')" class="flex flex-col items-center gap-1 p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors group/btn" title="Clique para ver detalhes por instituto">
                    <div class="flex items-center gap-2">
                        <span class="material-symbols-outlined ${color} font-bold text-[22px]">${icon}</span>
                        ${hasRelevantJustification ?
                    `<span class="material-symbols-outlined text-amber-500 text-[18px]" title="Existem justificativas para itens abaixo da meta">assignment_late</span>`
                    : ''}
                    </div>
                    <span class="text-[10px] text-slate-400 font-medium group-hover/btn:text-primary transition-colors leading-none">clique para ver detalhes</span>
                </button>
            `;
        }

        // Financials (Using calculated sums)
        const fatSigtap = g.totalFatSigtap;

        // Incentive is now strictly the Realized amount
        const fatInc = g.realizedInc;

        // Missed Incentive (Potential)
        const missedInc = g.missedInc;

        const totalRow = fatSigtap + fatInc;

        let procCellHtml;
        if (g.isGrupo) {
            const grupoObj = localGruposOferta.find(gr => gr.id === g.grupoId);
            const procNames = (grupoObj?.procedimentos || []).map(s => {
                const pr = localProcs.find(x => x.sigtap === s);
                return pr ? pr.nome : s;
            });
            procCellHtml = `
                <div class="flex items-center gap-2 flex-wrap">
                    <span class="text-sm font-bold text-slate-700 dark:text-slate-300">${g.procName}</span>
                    <span class="px-1.5 py-0.5 rounded text-[10px] font-black bg-indigo-100 text-indigo-700 border border-indigo-200 uppercase tracking-wide whitespace-nowrap">Oferta Unificada</span>
                </div>
                <div class="text-[11px] text-slate-400 mt-1 max-w-[280px]" title="${procNames.join(' + ')}">${procNames.join(' + ')}</div>
                <div class="text-xs text-slate-400 uppercase mt-0.5">${g.competencia}</div>
            `;
        } else {
            procCellHtml = `
                <div class="text-sm font-medium text-slate-700 dark:text-slate-300 truncate max-w-[250px]" title="${g.procName}">${g.procName}</div>
                <div class="text-xs font-mono text-slate-400">${g.code}</div>
                <div class="text-xs text-slate-400 uppercase mt-0.5">${g.competencia}</div>
            `;
        }

        return `
            <tr class="group hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors border-b border-slate-100 dark:border-slate-800">
                <!-- Procedure -->
                <td class="px-6 py-4">${procCellHtml}</td>
                
                <!-- Meta (Total) -->
                <td class="px-6 py-4 text-right font-mono text-sm font-bold">${formatNumber(g.totalMeta)}</td>
                
                <!-- Ofertado (Total) -->
                <td class="px-6 py-4 text-right font-mono text-sm font-bold text-blue-700 dark:text-blue-400">${formatNumber(g.totalOffer)}</td>
                
                <!-- Status Meta (Button) -->
                <td class="px-6 py-4 text-center">${metaStatusHtml}</td>

                <!-- Produced (Total) -->
                <td class="px-6 py-4 text-right font-mono text-sm font-bold text-slate-700 dark:text-slate-300">${formatNumber(g.totalProd)}</td>

                <!-- Values -->
                <td class="px-6 py-4 text-right font-mono text-xs text-slate-500">${formatCurrency(g.vSigtap)}</td>
                <td class="px-6 py-4 text-center">
                    <button onclick="window.openBreakdownModal('${g.key}')" class="p-1 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-full transition-colors text-slate-400 hover:text-primary" title="Ver detalhes do incentivo">
                        <span class="material-symbols-outlined text-[20px]">visibility</span>
                    </button>
                </td>
                
                <!-- Financials -->
                <td class="px-6 py-4 text-right font-mono text-xs font-bold text-slate-700 dark:text-slate-300">${formatCurrency(fatSigtap)}</td>

                <td class="px-6 py-4 text-right">
                    <button onclick="window.openBreakdownModal('${g.key}')" class="flex flex-col items-end w-full group/inc" title="Clique para ver detalhes do incentivo">
                        <span class="font-mono text-sm font-bold text-slate-700 dark:text-slate-300">
                             ${formatCurrency(fatInc)}
                             ${missedInc > 0 ? `<span class="text-[10px] text-red-500 font-bold ml-1">(${formatCurrency(missedInc)})</span>` : ''}
                        </span>
                        <span class="text-[10px] text-slate-400 font-medium group-hover/inc:text-primary transition-colors leading-none mt-0.5">clique para ver detalhes</span>
                    </button>
                </td>
                
                <!-- Total -->
                <td class="px-6 py-4 text-right font-mono text-sm font-black text-primary">${formatCurrency(totalRow)}</td>
            </tr>
        `;
    }).join('');

    // Save groups globally for modal access
    window.rowGroups = groups;

    // Update sort icons in header
    document.querySelectorAll('thead button[onclick^="window.sortTable"]').forEach(btn => {
        const col = btn.getAttribute('onclick').match(/'(\w+)'/)?.[1];
        const icon = btn.querySelector('.material-symbols-outlined');
        if (!icon) return;
        if (col === sortCol) {
            icon.textContent = sortDir === 'asc' ? 'arrow_upward' : 'arrow_downward';
            icon.classList.add('text-primary');
        } else {
            icon.textContent = 'unfold_more';
            icon.classList.remove('text-primary');
        }
    });

    updateStats(0, 0, 0, filtered, programStatusMap); // Pass computed status map
    renderPagination(totalItems, startIndex + 1, endIndex);
}

// ------------------------------------------------------------------
// Modal Functions
// ------------------------------------------------------------------
window.sortTable = (col) => {
    if (sortCol === col) {
        sortDir = sortDir === 'asc' ? 'desc' : 'asc';
    } else {
        sortCol = col;
        sortDir = 'asc';
    }
    currentPage = 1;
    renderTable();
};

window.openBreakdownModal = (key) => {
    const group = window.rowGroups[key];
    if (!group) return;

    document.getElementById('modal-title').textContent = group.procName;
    const progLabel = group.programs.size > 1 ? 'Múltiplos Incentivos' : Array.from(group.programs)[0];
    document.getElementById('modal-subtitle').textContent = `Incentivo(s): ${progLabel} | Meta Global: ${formatNumber(group.totalMeta)}`;

    const tbody = document.getElementById('modal-breakdown-body');

    // Group items by instId to support rowspan on Instituto and Produzido columns
    const itemsByInst = {};
    const instOrder = [];
    group.items.forEach(item => {
        if (!itemsByInst[item.instId]) {
            itemsByInst[item.instId] = [];
            instOrder.push(item.instId);
        }
        itemsByInst[item.instId].push(item);
    });

    const rows = [];
    instOrder.forEach(instId => {
        const instItems = itemsByInst[instId];
        const rowspan = instItems.length;

        instItems.forEach((item, idx) => {
            const isFirst = idx === 0;
            const inst = localInsts.find(i => i.id === item.instId);
            const instName = inst?.sigla || inst?.nome || 'Desconhecido';

            let meta = parseInt(item.ofertaMinima || 0);

            const semOfferModal = (parseInt(item.producao?.sem1 || 0) + parseInt(item.producao?.sem2 || 0) +
                parseInt(item.producao?.sem3 || 0) + parseInt(item.producao?.sem4 || 0) + parseInt(item.producao?.sem5 || 0));
            let offer = parseInt(item.producao?.realizada);
            if (isNaN(offer)) offer = 0;
            let staticOffer = parseInt(item.ofertado);
            if (isNaN(staticOffer)) staticOffer = 0;
            const finalOffer = Math.max(offer, semOfferModal, staticOffer);

            let prod = parseInt(item.producao?.aprovada);
            if (isNaN(prod)) prod = 0;

            const prog = localProgramas.find(pg => pg.id === item.progId);
            const progName = prog ? prog.nome : (item.progId || '-');

            const itemProc = group.isGrupo ? localProcs.find(pr => pr.sigtap === item.sigtap) : null;
            const itemProcName = itemProc?.nome || item.sigtap;

            let instCellHtml = '';

            if (isFirst) {
                // Instituto cell spanning all rows of this institute
                const just = group.justifications ? group.justifications.find(j => j.instId === instId) : null;
                let instNameDisplay = `<span>${instName}</span>`;

                // Se a meta global da rede já foi atingida, nenhum instituto recebe alerta
                const isGlobalMetaMet = group.totalMeta > 0 && group.totalOffer >= group.totalMeta;

                // Check if any item for this institute is below its meta (only when global meta not met)
                const anyBelowMeta = !isGlobalMetaMet && instItems.some(i => {
                    const iSem = (parseInt(i.producao?.sem1 || 0) + parseInt(i.producao?.sem2 || 0) +
                        parseInt(i.producao?.sem3 || 0) + parseInt(i.producao?.sem4 || 0) + parseInt(i.producao?.sem5 || 0));
                    const iOffer = Math.max(parseInt(i.producao?.realizada || 0), iSem, parseInt(i.ofertado || 0));
                    return iOffer < parseInt(i.ofertaMinima || 0);
                });

                if (anyBelowMeta) {
                    const safeInst = instName.replace(/"/g, '&quot;');
                    if (just) {
                        const safeText = just.texto.replace(/"/g, '&quot;');
                        instNameDisplay += `<button onclick="window.viewJustification('${safeInst}', '${safeText}')" class="inline-flex items-center justify-center p-1 rounded hover:bg-amber-50 dark:hover:bg-amber-900/30 transition-colors ml-2" title="Ver Justificativa"><span class="material-symbols-outlined text-amber-500 text-[18px]">assignment_late</span></button>`;
                    } else {
                        instNameDisplay += `<button onclick="window.openContactModal('${instId}', '${safeInst}', '${group.sigtap}', '${group.procName}')" class="inline-flex items-center justify-center p-1 rounded hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors ml-2" title="Solicitar Justificativa"><span class="material-symbols-outlined text-red-500 text-[18px]">assignment_late</span></button>`;
                    }
                }

                const rowspanAttr = rowspan > 1 ? ` rowspan="${rowspan}"` : '';
                instCellHtml = `<td${rowspanAttr} class="py-3 px-2 font-medium text-slate-700 dark:text-slate-300 align-middle${rowspan > 1 ? ' border-r border-slate-200 dark:border-slate-700' : ''}">
                    <div class="flex items-center">${instNameDisplay}</div>
                </td>`;
            }

            // Each row gets its own Produzido input (different SIGTAPs = independent production)
            const prodCellHtml = `<td class="py-3 px-2 text-right align-middle">
                <input
                    type="number"
                    value="${prod}"
                    onchange="window.saveBreakdownItem('${item.id}', this.value, '${key}')"
                    class="w-24 text-right text-xs border border-slate-300 dark:border-slate-600 rounded px-2 py-1 focus:ring-primary focus:border-primary bg-white dark:bg-slate-700 font-bold"
                />
            </td>`;

            rows.push(`
                <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/50${!isFirst ? ' border-t border-slate-100 dark:border-slate-800' : ''}">
                    ${instCellHtml}
                    <td class="py-3 px-2 text-xs text-slate-500">
                        ${group.isGrupo ? `<div class="font-medium text-slate-700 dark:text-slate-300">${itemProcName}</div>` : ''}
                        <div class="${group.isGrupo ? 'text-[11px] text-slate-400 mt-0.5' : ''}">${progName}</div>
                    </td>
                    <td class="py-3 px-2 text-right font-mono text-xs text-slate-500">${formatCurrency(item.vlrIncentivo || 0)}</td>
                    <td class="py-3 px-2 text-right font-mono text-slate-600 dark:text-slate-400">${formatNumber(meta)}</td>
                    <td class="py-3 px-2 text-right font-mono text-slate-600 dark:text-slate-400">${formatNumber(finalOffer)}</td>
                    ${prodCellHtml}
                    <td class="py-3 px-2 text-right font-mono text-xs font-bold text-slate-700 dark:text-slate-300">${formatCurrency((item.vlrIncentivo || 0) * prod)}</td>
                </tr>
            `);
        });
    });

    tbody.innerHTML = rows.join('');

    document.getElementById('modal-breakdown').classList.remove('hidden');
};

window.viewJustification = (instName, text) => {
    document.getElementById('modal-just-inst-name').textContent = instName;
    document.getElementById('modal-just-text').textContent = text; // textContent handles HTML entites safely usually, but if we passed encoded...
    // The clicked attribute was encoded. textContent will decode if browser handles it, or we might need simple decode.
    // Actually, onclick string will be parsed, and if we passed '&quot;', the JS receiver sees ".
    // Let's rely on standard behavior.
    document.getElementById('modal-justification-view').classList.remove('hidden');
};

window.openContactModal = (instId, instName, sigtap, procName) => {
    document.getElementById('modal-contact-inst').textContent = instName;

    // Find Institute Data
    const inst = localInsts.find(i => i.id === instId);

    // Setup WhatsApp
    const btnWa = document.getElementById('btn-contact-whatsapp');
    if (inst && inst.telefone) {
        const phone = inst.telefone.replace(/\D/g, '');
        const msg = encodeURIComponent(`Olá, ${instName}. Consta pendência de justificativa para o procedimento ${procName} (Cód: ${sigtap}). Poderiam verificar?`);
        btnWa.href = `https://wa.me/55${phone}?text=${msg}`;
        btnWa.classList.remove('opacity-50', 'pointer-events-none');
    } else {
        btnWa.href = '#';
        btnWa.classList.add('opacity-50', 'pointer-events-none');
    }

    // Setup Email
    const btnEmail = document.getElementById('btn-contact-email');
    if (inst && inst.email) {
        const subject = encodeURIComponent(`Pendência de Justificativa - ${procName}`);
        const body = encodeURIComponent(`Olá,\n\nVerificamos que não foi atingida a meta para o procedimento ${procName} (Cód: ${sigtap}) na competência atual e não consta justificativa lançado no sistema.\n\nFavor regularizar.\n\nAtt,\nGestão Orçamentária`);
        btnEmail.href = `mailto:${inst.email}?subject=${subject}&body=${body}`;
        btnEmail.classList.remove('opacity-50', 'pointer-events-none');
    } else {
        btnEmail.href = '#';
        btnEmail.classList.add('opacity-50', 'pointer-events-none');
    }

    document.getElementById('modal-contact-view').classList.remove('hidden');
};

window.saveBreakdownItem = async (pactId, value, groupKey) => {
    const val = parseInt(value) || 0;

    // Find item locally to update immediately
    const group = window.rowGroups[groupKey];
    if (!group) return;

    // Find the master item that triggered the change
    const masterItem = group.items.find(i => i.id === pactId);
    if (!masterItem) return;

    const targetInstId = masterItem.instId;
    const targetSigtap = String(masterItem.sigtap || '').replace(/\D/g, '');

    // Update only items with the same SIGTAP+Institute (same procedure, possibly multiple programs)
    const itemsToUpdate = group.items.filter(i => {
        const iSigtap = String(i.sigtap || '').replace(/\D/g, '');
        return i.instId === targetInstId && iSigtap === targetSigtap;
    });

    try {
        const updatePromises = itemsToUpdate.map(item => {
            if (!item.producao) item.producao = {};
            item.producao.aprovada = val;
            return Repository.savePactuacao({ id: item.id, producao: { ...item.producao, aprovada: val } });
        });

        await Promise.all(updatePromises);
        console.log(`Synced production ${val} for ${itemsToUpdate.length} items (Inst: ${targetInstId}, SIGTAP: ${targetSigtap})`);

        // Recalc Group Totals (deduplicate by instId+sigtap to avoid double-counting multiple programs for same procedure)
        const seenRecalcKeys = new Set();
        group.totalProd = group.items.reduce((sum, i) => {
            const k = `${i.instId}_${String(i.sigtap || '').replace(/\D/g, '')}`;
            if (seenRecalcKeys.has(k)) return sum;
            seenRecalcKeys.add(k);
            return sum + (parseInt(i.producao?.aprovada) || 0);
        }, 0);
        group.totalFatSigtap = group.totalProd * group.vSigtap;

        // Re-render table to reflect new totals (and financial calculations)
        renderTable();

        // Re-open/Refresh modal to show updated values in other inputs
        // This ensures if user typed in Row 1, Row 2 also updates visibly.
        window.openBreakdownModal(groupKey);

    } catch (err) {
        console.error('Error saving production:', err);
        alert('Erro ao salvar valor.');
    }
};

function enableDragToScroll() {
    const slider = document.getElementById('table-scroll-container');
    if (!slider) return;

    let isDown = false;
    let startX;
    let scrollLeft;

    slider.addEventListener('mousedown', (e) => {
        isDown = true;
        startX = e.pageX - slider.offsetLeft;
        scrollLeft = slider.scrollLeft;
    });

    slider.addEventListener('mouseleave', () => {
        isDown = false;
    });

    slider.addEventListener('mouseup', () => {
        isDown = false;
    });

    slider.addEventListener('mousemove', (e) => {
        if (!isDown) return;
        e.preventDefault();
        const x = e.pageX - slider.offsetLeft;
        const walk = (x - startX) * 2; // Scroll-fast
        slider.scrollLeft = scrollLeft - walk;
    });
}

function renderPagination(totalItems, start, end) {
    const paginationContainer = document.getElementById('pagination-container');
    if (!paginationContainer) return;

    if (totalItems === 0) {
        paginationContainer.innerHTML = '';
        return;
    }

    const totalPages = Math.ceil(totalItems / itemsPerPage);

    // Items per page selector HTML
    const itemsPerPageSelect = `
        <select id="items-per-page" class="ml-2 rounded border border-border-light dark:border-border-dark bg-white dark:bg-slate-800 text-xs py-1 px-2 focus:ring-primary focus:border-primary">
            <option value="30" ${itemsPerPage === 30 ? 'selected' : ''}>30</option>
            <option value="50" ${itemsPerPage === 50 ? 'selected' : ''}>50</option>
            <option value="100" ${itemsPerPage === 100 ? 'selected' : ''}>100</option>
        </select>
    `;

    paginationContainer.innerHTML = `
        <div class="flex flex-col sm:flex-row items-center justify-between w-full gap-4">
            <div class="text-sm text-text-secondary dark:text-slate-400 flex items-center">
                Mostrando <span class="font-bold text-text-main dark:text-white mx-1">${start}</span> a <span class="font-bold text-text-main dark:text-white mx-1">${end}</span> de <span class="font-bold text-text-main dark:text-white mx-1">${totalItems}</span> resultados
                <span class="mx-2 hidden sm:inline">|</span>
                <span class="hidden sm:inline">Por página: ${itemsPerPageSelect}</span>
            </div>
            
            <div class="flex gap-2 items-center">
                <div class="sm:hidden mr-2">
                    ${itemsPerPageSelect}
                </div>
                <button id="prev-page" class="inline-flex h-8 w-8 items-center justify-center rounded border border-border-light dark:border-border-dark bg-white dark:bg-slate-800 text-text-secondary dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed" ${currentPage === 1 ? 'disabled' : ''}>
                    <span class="material-symbols-outlined text-[16px]">chevron_left</span>
                </button>
                
                <span class="text-sm font-medium text-slate-600 dark:text-slate-300">Página ${currentPage} de ${totalPages}</span>

                <button id="next-page" class="inline-flex h-8 w-8 items-center justify-center rounded border border-border-light dark:border-border-dark bg-white dark:bg-slate-800 text-text-secondary dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed" ${currentPage === totalPages ? 'disabled' : ''}>
                    <span class="material-symbols-outlined text-[16px]">chevron_right</span>
                </button>
            </div>
        </div>
    `;

    // Add event listeners
    document.getElementById('prev-page')?.addEventListener('click', () => {
        if (currentPage > 1) {
            currentPage--;
            renderTable();
        }
    });

    document.getElementById('next-page')?.addEventListener('click', () => {
        if (currentPage < totalPages) {
            currentPage++;
            renderTable();
        }
    });

    const select = document.querySelectorAll('#items-per-page');
    select.forEach(s => {
        s.addEventListener('change', (e) => {
            itemsPerPage = parseInt(e.target.value);
            currentPage = 1; // Reset to first page
            renderTable();
        });
    });
}

function itemProgress(percent) {
    const val = Math.min(Math.max(percent, 0), 100);
    return `
        <div class="flex items-center justify-end gap-2">
            <span class="text-[10px] font-bold">${val.toFixed(0)}%</span>
            <div class="w-12 bg-slate-100 dark:bg-slate-700 h-1.5 rounded-full overflow-hidden">
                <div class="h-full ${val < 70 ? 'bg-red-500' : val < 90 ? 'bg-amber-500' : 'bg-emerald-500'}" style="width: ${val}%"></div>
            </div>
        </div>
    `;
}

function updateStats(pact, real, fin, filteredList = [], globalStatus = {}) {
    // We need to RE-CALCULATE the financial total to match the table (Incentive only if met)
    // The passed 'fin' was calculated in the iterator before logic changes, so likely incorrect now.
    // Let's iterate filteredList and use globalStatus to sum up correctly.

    let correctFinancialTotal = 0;

    filteredList.forEach(p => {
        const realiz = parseInt(p.producao?.aprovada || 0);
        const vSigtap = parseFloat(p.vlrSigtapBase || 0);
        const vInc = parseFloat(p.vlrIncentivo || 0);

        const progId = p.progId || 'default';
        const key = `${p.sigtap}-${progId}`;

        // Use Pre-calculated Status for this Prog/Sigtap
        const isMetaMet = globalStatus[key] === true;

        const rowSigtap = realiz * vSigtap;
        const rowInc = isMetaMet ? (realiz * vInc) : 0;

        correctFinancialTotal += (rowSigtap + rowInc);
    });

    const elements = document.querySelectorAll('.text-2xl.font-bold');
    if (elements.length >= 3) {
        elements[0].textContent = formatNumber(pact);
        elements[1].textContent = formatNumber(real);
        elements[2].textContent = formatCurrency(correctFinancialTotal);

        if (elements[3]) {
            // Critical count based on Global Status? Or Row status?
            // Let's keep distinct Critical count based on Rows where offer < 70% of min?
            // "Se for ofertad... contabiliza". 
            // Users usually want to know how many PROCEDURES are critical.
            // Using the existing logic for now.
            const criticalCount = filteredList.filter(p => {
                const pactVal = parseInt(p.ofertaMinima || 0);
                const offerVal = parseInt(p.ofertado || 0);
                return pactVal > 0 && (offerVal / pactVal) < 0.7;
            }).length;
            elements[3].textContent = criticalCount;
        }
    }
}

initAcompanhamento();
