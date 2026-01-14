import { Repository } from './repository.js';
import { auth } from './firebase-config.js';

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
let userRole = null;

// Pagination State
let currentPage = 1;
let itemsPerPage = 30;

export async function initAcompanhamento() {
    // Load initial data
    allPactuacoes = await Repository.getPactuacoes();
    localInsts = await Repository.getInstitutos();
    localProcs = await Repository.getProcedimentos();
    localProgramas = await Repository.getProgramas(); // Fetch programs

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
    document.getElementById('filter-proc')?.addEventListener('change', renderTable);
    document.getElementById('filter-prog')?.addEventListener('change', renderTable); // Added program filter listener
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
        document.getElementById('filter-proc').value = '';
        document.getElementById('filter-prog').value = ''; // Clear program filter
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
}

function populateFilters() {
    const instSelect = document.getElementById('filter-inst');
    if (instSelect) {
        instSelect.innerHTML = `<option value="">Todos os Institutos</option>` +
            localInsts.map(i => `<option value="${i.id}">${i.sigla || i.nome}</option>`).join('');
    }

    const procSelect = document.getElementById('filter-proc');
    if (procSelect) {
        // Unique procs present in pactuacoes
        const uniqueProcIds = [...new Set(allPactuacoes.map(p => p.sigtap))];
        procSelect.innerHTML = `<option value="">Todos os Procedimentos</option>` +
            uniqueProcIds.map(id => {
                const p = localProcs.find(pr => pr.sigtap === id);
                return `<option value="${id}">${id} - ${p?.nome || '???'}</option>`;
            }).join('');
    }

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
        const competencias = [...new Set(allPactuacoes.map(p => p.competencia))].sort().reverse();

        // Strictly by competence, no "All" option to avoid confusion with "Geral"
        if (competencias.length > 0) {
            periodSelect.innerHTML = competencias.map(c => `<option value="${c}">${c}</option>`).join('');
            periodSelect.value = competencias[0];
        } else {
            periodSelect.innerHTML = `<option value="">Nenhuma Competência</option>`;
        }
    }
}

function renderTable() {
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

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="13" class="px-6 py-12 text-center text-slate-400 italic">Nenhum dado encontrado para os filtros selecionados.</td></tr>`; // Colspan increased
        updateStats(0, 0, 0);
        renderPagination(0, 0, 0); // Clear pagination
        return;
    }

    // ------------------------------------------------------------------
    // 1. Group Data (Procedure + Program)
    // ------------------------------------------------------------------
    // Helper: Safe Float Parse
    const safeParseFloat = (val) => {
        if (typeof val === 'number') return val;
        if (!val) return 0;
        // Handle "1.234,56" -> "1234.56"
        let str = String(val).replace(/\./g, "").replace(",", ".");
        let num = parseFloat(str);
        return isNaN(num) ? 0 : num;
    };

    const groups = {};
    filtered.forEach(p => {
        // Grouping purely by Procedure (SIGTAP)
        const key = p.sigtap;

        if (!groups[key]) {
            const proc = localProcs.find(pr => pr.sigtap === p.sigtap);
            groups[key] = {
                key,
                sigtap: p.sigtap,
                procName: proc?.nome || 'Procedimento',
                code: p.sigtap,
                items: [],
                // Aggregates
                totalMeta: 0,
                totalOffer: 0,
                totalProd: 0,
                totalFatSigtap: 0,
                potentialFatInc: 0,
                programs: new Set(), // To track unique programs
                competencia: p.competencia,
                // Unit Values (for display, takes first valid found)
                vSigtap: safeParseFloat(p.vlrSigtapBase),
                vInc: safeParseFloat(p.vlrIncentivo)
            };
        }

        // Add item to group
        groups[key].items.push(p);

        // Track Program
        const prog = localProgramas.find(pg => pg.id === p.progId);
        const progName = prog ? prog.nome : (p.progId || '-');
        groups[key].programs.add(progName);

        // Accumulate Values
        const meta = parseInt(p.ofertaMinima || 0);

        let offer = parseInt(p.producao?.realizada);
        if (isNaN(offer)) offer = 0;
        let staticOffer = parseInt(p.ofertado);
        if (isNaN(staticOffer)) staticOffer = 0;
        const finalOffer = offer > 0 ? offer : staticOffer;

        let prod = parseInt(p.producao?.aprovada);
        if (isNaN(prod)) prod = 0;

        // Financials Calculation per Item
        const vSigtap = safeParseFloat(p.vlrSigtapBase);
        const vInc = safeParseFloat(p.vlrIncentivo);

        const itemFatSigtap = prod * vSigtap;
        const itemPotentialInc = prod * vInc;

        groups[key].totalMeta = Math.max(groups[key].totalMeta, meta);
        groups[key].totalOffer += finalOffer;
        groups[key].totalProd += prod;
        groups[key].totalFatSigtap += itemFatSigtap;
        groups[key].potentialFatInc += itemPotentialInc;
    });

    const groupList = Object.values(groups);

    // ------------------------------------------------------------------
    // 2. Pagination (on Groups now)
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
            const title = isMetaMet ? 'Meta Atingida' : 'Meta Não Atingida';

            // Clickable to open modal
            metaStatusHtml = `
                <button onclick="window.openBreakdownModal('${g.key}')" class="p-1 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-full transition-colors" title="Clique para ver detalhes por instituto">
                    <span class="material-symbols-outlined ${color} font-bold text-[22px]">${icon}</span>
                </button>
            `;
        }

        // Financials (Using pre-calculated sums)
        const fatSigtap = g.totalFatSigtap;
        let fatInc = 0;
        // Apply Global Meta Condition to the Sum of Potential Incentives
        if (isMetaMet) {
            fatInc = g.potentialFatInc;
        }

        const totalRow = fatSigtap + fatInc;

        return `
            <tr class="group hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors border-b border-slate-100 dark:border-slate-800">
                <!-- Procedure -->
                <td class="px-6 py-4">
                    <div class="text-xs font-medium text-slate-700 dark:text-slate-300 truncate max-w-[250px]" title="${g.procName}">${g.procName}</div>
                    <div class="text-[10px] font-mono text-slate-400">${g.code}</div>
                    <div class="text-[10px] text-slate-400 uppercase mt-0.5">${g.competencia}</div>
                </td>
                
                <!-- Meta (Total) -->
                <td class="px-6 py-4 text-right font-mono text-xs font-bold">${formatNumber(g.totalMeta)}</td>
                
                <!-- Ofertado (Total) -->
                <td class="px-6 py-4 text-right font-mono text-xs font-bold text-blue-700 dark:text-blue-400">${formatNumber(g.totalOffer)}</td>
                
                <!-- Status Meta (Button) -->
                <td class="px-6 py-4 text-center">${metaStatusHtml}</td>

                <!-- Produced (Total) -->
                <td class="px-6 py-4 text-right font-mono text-xs font-bold text-slate-700 dark:text-slate-300">${formatNumber(g.totalProd)}</td>

                <!-- Values -->
                <td class="px-6 py-4 text-right font-mono text-[11px] text-slate-500">${formatCurrency(g.vSigtap)}</td>
                <td class="px-6 py-4 text-right font-mono text-[11px] text-slate-500">${formatCurrency(g.vInc)}</td>
                
                <!-- Financials -->
                <td class="px-6 py-4 text-right font-mono text-[11px] font-bold text-slate-700 dark:text-slate-300">${formatCurrency(fatSigtap)}</td>
                <td class="px-6 py-4 text-right font-mono text-[11px] font-bold text-slate-700 dark:text-slate-300">
                     ${fatInc > 0 ? formatCurrency(fatInc) : (g.potentialFatInc > 0 ? `0,00 <div class="text-[9px] text-red-500 font-bold">(${formatCurrency(g.potentialFatInc)})</div>` : '0,00')}
                </td>
                
                <!-- Total -->
                <td class="px-6 py-4 text-right font-mono text-sm font-black text-primary">${formatCurrency(totalRow)}</td>
            </tr>
        `;
    }).join('');

    // Save groups globally for modal access
    window.rowGroups = groups;

    updateStats(0, 0, 0, filtered); // Update stats uses filtered list logic which we might need to adjust or keep
    renderPagination(totalItems, startIndex + 1, endIndex);
}

// ------------------------------------------------------------------
// Modal Functions
// ------------------------------------------------------------------
window.openBreakdownModal = (key) => {
    const group = window.rowGroups[key];
    if (!group) return;

    document.getElementById('modal-title').textContent = group.procName;
    const progLabel = group.programs.size > 1 ? 'Múltiplos Incentivos' : Array.from(group.programs)[0];
    document.getElementById('modal-subtitle').textContent = `Incentivo(s): ${progLabel} | Meta Global: ${formatNumber(group.totalMeta)}`;

    const tbody = document.getElementById('modal-breakdown-body');
    tbody.innerHTML = group.items.map(item => {
        const inst = localInsts.find(i => i.id === item.instId);
        const instName = inst?.sigla || inst?.nome || 'Desconhecido';

        let meta = parseInt(item.ofertaMinima || 0);

        let offer = parseInt(item.producao?.realizada);
        if (isNaN(offer)) offer = 0;
        let staticOffer = parseInt(item.ofertado);
        if (isNaN(staticOffer)) staticOffer = 0;
        const finalOffer = offer > 0 ? offer : staticOffer;

        let prod = parseInt(item.producao?.aprovada);
        if (isNaN(prod)) prod = 0;

        // Determine if this row met its specific meta (if applicable) or if we just show values
        // Usually meta is checked globally, but here we show individual contributions.

        const prog = localProgramas.find(pg => pg.id === item.progId);
        const progName = prog ? prog.nome : (item.progId || '-');

        return `
            <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                <td class="py-3 px-2 font-medium text-slate-700 dark:text-slate-300">${instName}</td>
                <td class="py-3 px-2 text-xs text-slate-500">${progName}</td>
                <td class="py-3 px-2 text-right font-mono text-slate-600 dark:text-slate-400">${formatNumber(meta)}</td>
                <td class="py-3 px-2 text-right font-mono text-slate-600 dark:text-slate-400">${formatNumber(finalOffer)}</td>
                <td class="py-3 px-2 text-right">
                    <input 
                        type="number" 
                        value="${prod}" 
                        onchange="window.saveBreakdownItem('${item.id}', this.value, '${key}')"
                        class="w-24 text-right text-xs border border-slate-300 dark:border-slate-600 rounded px-2 py-1 focus:ring-primary focus:border-primary bg-white dark:bg-slate-700 font-bold"
                    />
                </td>
            </tr>
        `;
    }).join('');

    document.getElementById('modal-breakdown').classList.remove('hidden');
};

window.saveBreakdownItem = async (pactId, value, groupKey) => {
    const val = parseInt(value) || 0;

    // Find item locally to update immediately
    const group = window.rowGroups[groupKey];
    const item = group.items.find(i => i.id === pactId);
    if (item) {
        if (!item.producao) item.producao = {};
        item.producao.aprovada = val;

        // Recalc Group Totals
        group.totalProd = group.items.reduce((sum, i) => sum + (parseInt(i.producao?.aprovada) || 0), 0);

        // Update DB
        try {
            await Repository.savePactuacao({ id: pactId, producao: { ...item.producao, aprovada: val } });
            console.log('Saved production:', pactId, val);

            // Re-render table to reflect new totals (stay on same page)
            renderTable();

            // If we re-render, we might lose the modal if we are not careful? 
            // renderTable regenerates HTML.
            // But we don't want to close the modal.
            // Actually renderTable updates the background table. The modal is separate HTML (outside tbody).
            // However, `rowGroups` will be regenerated. We need to make sure the modal refers to valid data.
            // Since `window.rowGroups` is updated, next click works. Does open modal stay open? Yes.
            // But if we want to update the modal subtitle/summary if needed?
        } catch (err) {
            console.error('Error saving production:', err);
            alert('Erro ao salvar valor.');
        }
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
        const gStats = globalStatus[key] || { meta: 0, offer: 0 };
        const isMetaMet = gStats.meta > 0 ? (gStats.offer >= gStats.meta) : true;

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
