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

    // Data Correction: User confirmed that existing 'Production' values are actually 'Offers'.
    // We will move them to the correct field and clear Production.
    let migrationNeeded = false;
    allPactuacoes.forEach(p => {
        // Robust parsing to avoid NaN issues
        let off = parseInt(p.ofertado);
        if (isNaN(off)) off = 0;

        let prod = parseInt(p.producao?.realizada);
        if (isNaN(prod)) prod = 0;

        let pact = parseInt(p.ofertaMinima);
        if (isNaN(pact)) pact = 0;

        // Logic: If there is 'Production' but no 'Offer' (and user says Production should be 0),
        // we assume the Production value is actually the Offer.
        if (off === 0 && prod > 0 && pact > 0) {
            console.log(`Fixing row ${p.id}: Moving Production (${prod}) to Offer.`); // Log for debugging
            p.ofertado = prod; // Move value in memory
            if (!p.producao) p.producao = {};
            p.producao.realizada = 0; // Clear production in memory

            // Save correction
            Repository.savePactuacao({
                id: p.id,
                ofertado: prod,
                producao: { ...p.producao, realizada: 0 }
            });
            migrationNeeded = true;
        }
    });

    if (migrationNeeded) {
        console.log('Fixed data: Moved misplaced Production values to Ofertado column.');
    }

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
                allPactuacoes[idx].producao.realizada = newVal;
                await Repository.savePactuacao({ id, producao: { ...allPactuacoes[idx].producao, realizada: newVal } });
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
        tbody.innerHTML = `<tr><td colspan="10" class="px-6 py-12 text-center text-slate-400 italic">Nenhum dado encontrado para os filtros selecionados.</td></tr>`; // Colspan increased
        updateStats(0, 0, 0);
        renderPagination(0, 0, 0); // Clear pagination
        return;
    }

    // Pagination Slice
    const totalItems = filtered.length;
    const totalPages = Math.ceil(totalItems / itemsPerPage);

    // Adjust current page if out of bounds
    if (currentPage > totalPages) currentPage = totalPages;
    if (currentPage < 1) currentPage = 1;

    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = Math.min(startIndex + itemsPerPage, totalItems);
    const paginatedData = filtered.slice(startIndex, endIndex);

    let statsTotalPact = 0;
    let statsTotalReal = 0;
    let statsTotalFinanceiro = 0;

    // Calculate totals based on ALL filtered data (not just current page) for the top stats
    filtered.forEach(p => {
        statsTotalPact += parseInt(p.ofertaMinima || 0);
        statsTotalReal += parseInt(p.producao?.realizada || 0);
        // We might want to track Total Offer for KPI if the label matches.
        // User might want "Total Offer" in stats too? Let's check updateStats function. 
        // For now, let's keep statsTotalReal as production because 'produção assistencial' logic usually tracks reality.

        // Actually, if status reflects Offer, maybe stats should reflect Offer too? 
        // Let's stick to the requested TABLE changes first. 

        const vSigtap = parseFloat(p.vlrSigtapBase || 0);
        const vInc = parseFloat(p.vlrIncentivo || 0);
        statsTotalFinanceiro += (vSigtap + vInc) * parseInt(p.producao?.realizada || 0);
    });

    tbody.innerHTML = paginatedData.map(p => {
        const inst = localInsts.find(i => i.id === p.instId);
        const proc = localProcs.find(pr => pr.sigtap === p.sigtap);
        const prog = localProgramas.find(pg => pg.id === p.progId); // Resolve Program
        const progName = prog ? prog.nome : (p.progId || '-');

        const pactuado = parseInt(p.ofertaMinima || 0);
        const ofertado = parseInt(p.ofertado || 0); // Explicit offer from user input
        const realizado = parseInt(p.producao?.realizada || 0); // Actual production

        const vSigtap = parseFloat(p.vlrSigtapBase || 0);
        const vInc = parseFloat(p.vlrIncentivo || 0);
        const totalUnit = vSigtap + vInc;
        // Financial usually tracks what was actually paid/produced, so logic stays on 'realizado' for money?
        // "o produzido é pego no final". Financial implies payment for production. I will keep financial on realized.
        const totalLinha = totalUnit * realizado;

        // Status based on OFFER vs MINIMUM (User request: "percentual de oferta... foi direcionado")
        const currentOffer = isNaN(ofertado) ? 0 : ofertado;
        const statusVal = pactuado > 0 ? (currentOffer / pactuado) * 100 : 100;
        let statusLabel = 'Atingido';
        let statusClass = 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400';

        if (currentOffer === 0 && pactuado > 0) {
            statusLabel = 'Sem oferta';
            statusClass = 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400';
        } else if (statusVal < 100) {
            statusLabel = 'Crítico';
            statusClass = 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400';
        }

        // Offer Display
        // Editable for: Institutos_Editor
        // Read-only for: Orçamento, Institutos_Leitor
        let offerDisplay = ''; // Define early
        const valOfertado = isNaN(ofertado) ? 0 : ofertado;
        const canEditOffer = userRole === 'Institutos_Editor';

        const renderBar = (val, max) => {
            const pct = max > 0 ? Math.min((val / max) * 100, 100) : 0;
            const colorClass = pct < 70 ? 'bg-red-500' : pct < 100 ? 'bg-amber-500' : 'bg-emerald-500';
            return `
                <div class="h-1.5 w-16 bg-slate-100 dark:bg-slate-700 rounded-full mt-1 overflow-hidden">
                    <div class="h-full ${colorClass}" style="width: ${pct}%"></div>
                </div>
            `;
        };

        if (pactuado === 0) {
            // Badge State
            if (canEditOffer) {
                offerDisplay = `
                   <div data-offer-idx="${p.id}" class="editable-cell cursor-pointer flex flex-col items-end gap-1 group">
                       <span class="inline-flex items-center justify-center px-2 py-0.5 rounded text-[10px] font-medium uppercase bg-slate-100 text-slate-500 group-hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:group-hover:bg-slate-700 transition-colors w-full">
                           Não ofertado <span class="material-symbols-outlined text-[10px] ml-1 opacity-0 group-hover:opacity-100 transition-opacity">edit</span>
                       </span>
                   </div>
               `;
            } else {
                offerDisplay = `
                    <span class="flex items-center justify-center px-2 py-0.5 rounded text-[10px] font-medium uppercase bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400 w-full">
                        Não ofertado
                    </span>
                 `;
            }
        } else {
            // Value + Bar State
            const pctBar = renderBar(valOfertado, pactuado);
            if (canEditOffer) {
                offerDisplay = `
                   <div data-offer-idx="${p.id}" class="editable-cell cursor-pointer flex flex-col items-end gap-1 group hover:bg-slate-100 dark:hover:bg-slate-800/50 p-1 rounded -mr-1 transition-colors">
                       <div class="flex items-center gap-1">
                           <span>${formatNumber(valOfertado)}</span>
                           <span class="material-symbols-outlined text-[10px] text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity">edit</span>
                       </div>
                       ${pctBar}
                   </div>
                `;
            } else {
                offerDisplay = `
                    <div class="flex flex-col items-end gap-1">
                        <span>${formatNumber(valOfertado)}</span>
                        ${pctBar}
                    </div>
                 `;
            }
        }

        // Production Display (Editable for Orçamento)
        let prodDisplay = formatNumber(realizado);
        const canEditProd = userRole === 'Orçamento';

        if (canEditProd) {
            if (pactuado > 0) {
                prodDisplay = `<input type="number" data-prod-id="${p.id}" value="${realizado}" min="0" class="w-full min-w-[60px] max-w-[100px] text-right text-xs border border-slate-300 dark:border-slate-600 rounded px-1.5 py-1 focus:ring-2 focus:ring-primary focus:border-primary bg-white dark:bg-slate-700 dark:text-white transition-all shadow-sm">`;
            } else {
                prodDisplay = `
                    <span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium uppercase bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                        -
                    </span>
                `;
            }
        }
        return `
            <tr class="group hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors border-b border-slate-100 dark:border-slate-800">
                <td class="px-6 py-4">
                    <div class="text-sm font-bold text-slate-900 dark:text-white">${inst?.sigla || (inst?.nome ? inst.nome.substring(0, 15) : '???')}</div>
                    <div class="text-[10px] text-slate-400 uppercase">${p.competencia}</div>
                </td>
                <td class="px-6 py-4">
                    <div class="text-xs font-medium text-slate-700 dark:text-slate-300 truncate max-w-[250px]" title="${proc?.nome || '???'}">${proc?.nome || '???'}</div>
                    <div class="text-[10px] font-mono text-slate-400">${p.sigtap}</div>
                </td>
                <td class="px-6 py-4">
                    <div class="text-[11px] font-bold text-slate-600 dark:text-slate-300 truncate max-w-[120px]" title="${progName}">${progName}</div>
                </td>
                <td class="px-6 py-4 text-right font-mono text-xs">${formatNumber(pactuado)}</td>
                <td class="px-6 py-4 text-right font-mono text-xs text-slate-700 dark:text-slate-300">${offerDisplay}</td>
                <td class="px-6 py-4 text-right font-mono text-xs">${prodDisplay}</td>
                <td class="px-6 py-4 text-right font-mono text-[11px]">${formatCurrency(vSigtap * realizado)}</td>
                <td class="px-6 py-4 text-right font-mono text-[11px]">${formatCurrency(vInc * realizado)}</td>
                <td class="px-6 py-4 text-right font-mono text-sm font-black text-primary">${formatCurrency(totalLinha)}</td>
                <td class="px-6 py-4 text-center">
                    <span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-black uppercase ${statusClass}">
                        ${statusLabel}
                    </span>
                </td>
            </tr>
        `;
    }).join('');

    updateStats(statsTotalPact, statsTotalReal, statsTotalFinanceiro, filtered);
    renderPagination(totalItems, startIndex + 1, endIndex);
}

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

function updateStats(pact, real, fin, filteredList = []) {
    // Stats cards in acompanhamento_orcamento.html
    const elements = document.querySelectorAll('.text-2xl.font-bold');
    if (elements.length >= 3) {
        elements[0].textContent = formatNumber(pact);
        elements[1].textContent = formatNumber(real);
        elements[2].textContent = formatCurrency(fin);

        // Critical institutes count - Based on Offer vs Minimum (User preference seems to be tracking Offer sufficiency)
        // Or is it Production vs Offer? 
        // "percentual de oferta... foi direcionado". 
        // If Offer < 0.7 * Min -> Critical.
        if (elements[3]) {
            const criticalCount = filteredList.filter(p => {
                const pactVal = parseInt(p.ofertaMinima || 0);
                const offerVal = parseInt(p.ofertado || 0); // Use OFFER for status
                return pactVal > 0 && (offerVal / pactVal) < 0.7;
            }).length;
            elements[3].textContent = criticalCount;
        }
    }
}

initAcompanhamento();
