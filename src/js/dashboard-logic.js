import { Repository } from './repository.js';

function formatCurrency(value) {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}

function formatNumber(value) {
    return new Intl.NumberFormat('pt-BR').format(value);
}

// Local caches for drill-down
let currentPactuacoes = [];
let localInsts = [];
let localProcs = [];
let currentPeriod = null;

export async function initDashboard() {
    const pactuacoes = await Repository.getPactuacoes();
    const monthSelector = document.getElementById('month-selector');

    if (monthSelector && pactuacoes.length > 0) {
        // Extract unique competencies
        const competencias = [...new Set(pactuacoes.map(p => p.competencia))].sort().reverse();

        monthSelector.innerHTML = competencias.map(c =>
            `<option value="${c}">${c}</option>`
        ).join('');

        monthSelector.addEventListener('change', (e) => {
            currentPeriod = e.target.value;
            updateDashboard(currentPeriod, pactuacoes);
        });

        currentPeriod = monthSelector.value;
        updateDashboard(currentPeriod, pactuacoes);
    } else {
        updateDashboard(null, pactuacoes);
    }
}

async function updateDashboard(period = null, allPactuacoes = null) {
    currentPactuacoes = allPactuacoes || await Repository.getPactuacoes();
    localInsts = await Repository.getInstitutos();
    localProcs = await Repository.getProcedimentos();

    // Filter by period if provided (matching "competencia")
    const filtered = period ? currentPactuacoes.filter(p => p.competencia === period) : currentPactuacoes;

    // Calculate Totals
    let totalPactuado = 0;
    let totalRealizado = 0;
    let totalFinanceiro = 0;

    filtered.forEach(p => {
        const pact = parseInt(p.ofertaMinima || 0);
        const real = parseInt(p.producao?.realizada || 0);

        // Financial impact = (Base SIGTAP + Incentive) * Production
        const vBase = parseFloat(p.vlrSigtapBase || 0);
        const vInc = parseFloat(p.vlrIncentivo || 0);
        const financeiroLinha = (vBase + vInc) * real;

        totalPactuado += pact;
        totalRealizado += real;
        totalFinanceiro += financeiroLinha;
    });

    // Update Indicators
    document.getElementById('kpi-pactuado').textContent = formatNumber(totalPactuado);
    document.getElementById('kpi-ofertado').textContent = formatNumber(totalRealizado);

    const atingimento = totalPactuado > 0 ? (totalRealizado / totalPactuado) * 100 : 0;
    document.getElementById('kpi-atingimento-percent').textContent = atingimento.toFixed(1) + '%';
    document.getElementById('kpi-atingimento-bar').style.width = Math.min(atingimento, 100) + '%';

    document.getElementById('kpi-financeiro').textContent = formatCurrency(totalFinanceiro);
    document.getElementById('kpi-financeiro-detail').textContent = `Total (SIGTAP + Incentivos) p/ Produção`;

    // Grouping for Table (by Procedimento)
    const groupsMap = {};
    filtered.forEach(p => {
        const key = p.sigtap;
        if (!groupsMap[key]) {
            const proc = localProcs.find(pr => pr.sigtap === p.sigtap);
            groupsMap[key] = {
                sigtap: key,
                nome: proc ? proc.nome : `SIGTAP: ${p.sigtap}`,
                pactuado: 0,
                ofertado: 0
            };
        }
        groupsMap[key].pactuado += parseInt(p.ofertaMinima || 0);
        groupsMap[key].ofertado += parseInt(p.producao?.realizada || 0);
    });

    const groups = Object.values(groupsMap).map(g => ({
        ...g,
        status: g.pactuado > 0 ? Math.round((g.ofertado / g.pactuado) * 100) : 0
    })).sort((a, b) => b.pactuado - a.pactuado);

    // Update Table
    const tableBody = document.getElementById('dashboard-table-body');
    if (tableBody) {
        if (groups.length === 0) {
            tableBody.innerHTML = `<tr><td colspan="5" class="px-6 py-10 text-center text-slate-400 italic">Sem dados para este período.</td></tr>`;
        } else {
            tableBody.innerHTML = groups.map(item => `
                <tr class="bg-white dark:bg-[#101822] hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                    <td class="px-6 py-4 font-medium text-slate-900 dark:text-white">
                        <div class="flex items-center gap-3">
                            <div class="size-2 rounded-full ${item.status >= 90 ? 'bg-green-500' : item.status >= 70 ? 'bg-yellow-500' : 'bg-red-500'}"></div>
                            <span class="truncate max-w-[300px]" title="${item.nome}">${item.nome}</span>
                        </div>
                    </td>
                    <td class="px-6 py-4 text-right font-mono text-xs">${formatNumber(item.pactuado)}</td>
                    <td class="px-6 py-4 text-right font-mono text-xs font-bold">${formatNumber(item.ofertado)}</td>
                    <td class="px-6 py-4 text-center">
                        <span class="text-[10px] font-black px-2 py-0.5 rounded border ${item.status >= 90 ? 'bg-green-100 text-green-800 border-green-200' : item.status >= 70 ? 'bg-yellow-100 text-yellow-800 border-yellow-200' : 'bg-red-100 text-red-800 border-red-200'}">
                            ${item.status}%
                        </span>
                    </td>
                    <td class="px-6 py-4 text-center">
                        <button onclick="window.openDetalhamento('${item.sigtap}')" class="text-slate-300 hover:text-primary transition-colors">
                            <span class="material-symbols-outlined text-[18px]">visibility</span>
                        </button>
                    </td>
                </tr>
            `).join('');
        }
    }

    // Alerts
    const alertsContainer = document.getElementById('alerts-container');
    if (alertsContainer) {
        const critical = filtered.filter(p => {
            const status = p.ofertaMinima > 0 ? (p.producao?.realizada / p.ofertaMinima) * 100 : 100;
            return status < 70;
        });

        if (critical.length === 0) {
            alertsContainer.innerHTML = `<div class="p-8 text-center text-slate-400 text-xs italic">Nenhuma oferta mínima crítica. Produção dentro do esperado.</div>`;
        } else {
            alertsContainer.innerHTML = critical.map(p => {
                const inst = localInsts.find(i => i.id === p.instId);
                const proc = localProcs.find(pr => pr.sigtap === p.sigtap);
                const status = Math.round((p.producao?.realizada / p.ofertaMinima) * 100);
                return `
                    <div class="p-4 rounded-xl bg-slate-50 dark:bg-slate-900/50 border-l-4 ${status < 50 ? 'border-red-500' : 'border-orange-500'} shadow-sm">
                        <div class="flex items-start gap-3">
                            <span class="material-symbols-outlined ${status < 50 ? 'text-red-500' : 'text-orange-500'} text-[20px]">
                                ${status < 50 ? 'error' : 'warning'}
                            </span>
                            <div>
                                <h4 class="text-xs font-bold text-slate-900 dark:text-white">${proc?.nome || p.sigtap}</h4>
                                <p class="text-[10px] text-slate-500 dark:text-slate-400 mt-1">
                                    Atingimento: <span class="font-bold">${status}%</span> no ${inst?.sigla || inst?.nome || 'Instituto'}
                                </p>
                            </div>
                        </div>
                    </div>
                `;
            }).slice(0, 5).join('');
        }
    }
}

window.openDetalhamento = (sigtap) => {
    const proc = localProcs.find(p => p.sigtap === sigtap);
    const filtered = currentPactuacoes.filter(p => p.sigtap === sigtap && p.competencia === currentPeriod);

    document.getElementById('detail-proc-nome').textContent = proc?.nome || `Procedimento ${sigtap}`;
    document.getElementById('detail-proc-sigtap').textContent = `Código SIGTAP: ${sigtap}`;

    const tbody = document.getElementById('detail-table-body');
    tbody.innerHTML = filtered.map(p => {
        const inst = localInsts.find(i => i.id === p.instId);
        const pact = parseInt(p.ofertaMinima || 0);
        const real = parseInt(p.producao?.realizada || 0);
        const vBase = parseFloat(p.vlrSigtapBase || 0);
        const vInc = parseFloat(p.vlrIncentivo || 0);
        const totalLinha = (vBase + vInc) * real;
        const status = pact > 0 ? Math.round((real / pact) * 100) : 0;

        return `
            <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                <td class="px-6 py-4 font-bold text-slate-900 dark:text-white">${inst?.sigla || inst?.nome || '???'}</td>
                <td class="px-6 py-4 text-right font-mono text-xs">${formatNumber(pact)}</td>
                <td class="px-6 py-4 text-right font-mono text-xs">${formatNumber(real)}</td>
                <td class="px-6 py-4 text-center">
                    <span class="text-[10px] font-black px-2 py-0.5 rounded border ${status >= 90 ? 'bg-green-100 text-green-800 border-green-200' : status >= 70 ? 'bg-yellow-100 text-yellow-800 border-yellow-200' : 'bg-red-100 text-red-800 border-red-200'}">
                        ${status}%
                    </span>
                </td>
                <td class="px-6 py-4 text-right font-mono text-sm font-black text-primary">${formatCurrency(totalLinha)}</td>
            </tr>
        `;
    }).join('');

    document.getElementById('modal-detalhe-procedimento').classList.remove('hidden');
};

window.closeDetailModal = () => {
    document.getElementById('modal-detalhe-procedimento').classList.add('hidden');
};

initDashboard();
