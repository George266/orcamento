import { Repository } from './repository.js';

function formatCurrency(value) {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}

function formatNumber(value) {
    return new Intl.NumberFormat('pt-BR').format(value);
}

let allPactuacoes = [];
let localInsts = [];
let localProcs = [];

export async function initAcompanhamento() {
    // Load initial data
    allPactuacoes = await Repository.getPactuacoes();
    localInsts = await Repository.getInstitutos();
    localProcs = await Repository.getProcedimentos();

    // Populate Filters
    populateFilters();

    // Event Listeners
    document.getElementById('btn-filter')?.addEventListener('click', renderTable);
    document.getElementById('btn-clear')?.addEventListener('click', () => {
        document.getElementById('filter-inst').value = '';
        document.getElementById('filter-proc').value = '';
        document.getElementById('filter-period').value = '';
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

    const periodSelect = document.getElementById('filter-period');
    if (periodSelect) {
        const competencias = [...new Set(allPactuacoes.map(p => p.competencia))].sort().reverse();
        periodSelect.innerHTML = `<option value="">Todo o Período</option>` +
            competencias.map(c => `<option value="${c}">${c}</option>`).join('');
    }
}

function renderTable() {
    const tbody = document.getElementById('monitoring-table-body');
    if (!tbody) return;

    const fInst = document.getElementById('filter-inst')?.value;
    const fProc = document.getElementById('filter-proc')?.value;
    const fPeriod = document.getElementById('filter-period')?.value;

    let filtered = allPactuacoes;
    if (fInst) filtered = filtered.filter(p => p.instId === fInst);
    if (fProc) filtered = filtered.filter(p => p.sigtap === fProc);
    if (fPeriod) filtered = filtered.filter(p => p.competencia === fPeriod);

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="9" class="px-6 py-12 text-center text-slate-400 italic">Nenhum dado encontrado para os filtros selecionados.</td></tr>`;
        updateStats(0, 0, 0);
        return;
    }

    let statsTotalPact = 0;
    let statsTotalReal = 0;
    let statsTotalFinanceiro = 0;

    tbody.innerHTML = filtered.map(p => {
        const inst = localInsts.find(i => i.id === p.instId);
        const proc = localProcs.find(pr => pr.sigtap === p.sigtap);

        const pactuado = parseInt(p.ofertaMinima || 0);
        const realizado = parseInt(p.producao?.realizada || 0);
        const vSigtap = parseFloat(p.vlrSigtapBase || 0);
        const vInc = parseFloat(p.vlrIncentivo || 0);
        const totalUnit = vSigtap + vInc;
        const totalLinha = totalUnit * realizado;

        statsTotalPact += pactuado;
        statsTotalReal += realizado;
        statsTotalFinanceiro += totalLinha;

        const statusVal = pactuado > 0 ? (realizado / pactuado) * 100 : 100;
        let statusLabel = 'Atingido';
        let statusClass = 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400';

        if (realizado === 0) {
            statusLabel = 'Pendente';
            statusClass = 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400';
        } else if (statusVal < 70) {
            statusLabel = 'Crítico';
            statusClass = 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400';
        } else if (statusVal < 90) {
            statusLabel = 'Atenção';
            statusClass = 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400';
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
                <td class="px-6 py-4 text-right font-mono text-xs">${formatNumber(pactuado)}</td>
                <td class="px-6 py-4 text-right font-mono text-xs">${formatNumber(realizado)}</td>
                <td class="px-6 py-4 text-right font-mono text-xs text-slate-400">${itemProgress(statusVal)}</td>
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

    updateStats(statsTotalPact, statsTotalReal, statsTotalFinanceiro);
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

function updateStats(pact, real, fin) {
    // Stats cards in acompanhamento_orcamento.html
    const elements = document.querySelectorAll('.text-2xl.font-bold');
    if (elements.length >= 3) {
        elements[0].textContent = formatNumber(pact);
        elements[1].textContent = formatNumber(real);
        elements[2].textContent = formatCurrency(fin);

        // Critical institutes count (mock for now or calculated if context exists)
        if (elements[3]) {
            const criticalCount = allPactuacoes.filter(p => (p.producao?.realizada / p.ofertaMinima) < 0.7).length;
            elements[3].textContent = criticalCount;
        }
    }
}

initAcompanhamento();
