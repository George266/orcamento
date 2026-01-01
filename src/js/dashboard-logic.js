import { Repository } from './repository.js';

function formatCurrency(value) {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}

function formatNumber(value) {
    return new Intl.NumberFormat('pt-BR').format(value);
}

export async function initDashboard() {
    const monthSelector = document.getElementById('month-selector');

    if (monthSelector) {
        monthSelector.addEventListener('change', (e) => {
            updateDashboard(e.target.value);
        });

        // Use the default or first available
        updateDashboard(monthSelector.value || '2023-10');
    } else {
        updateDashboard();
    }
}

async function updateDashboard(period = null) {
    const pactuacoes = await Repository.getPactuacoes();

    // Filter by period if provided (matching "competencia")
    const filtered = period ? pactuacoes.filter(p => p.competencia === period) : pactuacoes;

    // Calculate Totals
    let totalPactuado = 0;
    let totalOfertado = 0;
    let totalIncentivoTotal = 0;

    filtered.forEach(p => {
        const pact = parseInt(p.ofertaMinima || 0);
        const real = parseInt(p.producao?.realizada || 0);
        const inc = parseFloat(p.vlrIncentivo || 0);

        totalPactuado += pact;
        totalOfertado += real;
        totalIncentivoTotal += (real * inc); // Total incentive based on production
    });

    // Update Indicators
    document.getElementById('kpi-pactuado').textContent = formatNumber(totalPactuado);
    document.getElementById('kpi-ofertado').textContent = formatNumber(totalOfertado);

    const atingimento = totalPactuado > 0 ? (totalOfertado / totalPactuado) * 100 : 0;
    document.getElementById('kpi-atingimento-percent').textContent = atingimento.toFixed(1) + '%';
    document.getElementById('kpi-atingimento-bar').style.width = Math.min(atingimento, 100) + '%';

    document.getElementById('kpi-financeiro').textContent = formatCurrency(totalIncentivoTotal);
    document.getElementById('kpi-financeiro-detail').textContent = `Total de Incentivos sobre Produção`;

    // Grouping for Table (by Sigtap/Procedimento name)
    // For simplicity, we'll fetch procedures to show names
    const procs = await Repository.getProcedimentos();
    const insts = await Repository.getInstitutos();

    const groupsMap = {};
    filtered.forEach(p => {
        const key = p.sigtap;
        if (!groupsMap[key]) {
            const proc = procs.find(pr => pr.sigtap === p.sigtap);
            groupsMap[key] = {
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
    }));

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
                            ${item.nome}
                        </div>
                    </td>
                    <td class="px-6 py-4 text-right">${formatNumber(item.pactuado)}</td>
                    <td class="px-6 py-4 text-right font-medium">${formatNumber(item.ofertado)}</td>
                    <td class="px-6 py-4 text-center">
                        <span class="text-xs font-bold px-2.5 py-0.5 rounded border ${item.status >= 90 ? 'bg-green-100 text-green-800 border-green-200' : item.status >= 70 ? 'bg-yellow-100 text-yellow-800 border-yellow-200' : 'bg-red-100 text-red-800 border-red-200'}">
                            ${item.status}%
                        </span>
                    </td>
                    <td class="px-6 py-4 text-center">
                        <button class="text-slate-400 hover:text-primary transition-colors">
                            <span class="material-symbols-outlined text-[20px]">visibility</span>
                        </button>
                    </td>
                </tr>
            `).join('');
        }
    }

    // Alerts (e.g. status < 50%)
    const alertsContainer = document.getElementById('alerts-container');
    if (alertsContainer) {
        const critical = filtered.filter(p => {
            const status = p.ofertaMinima > 0 ? (p.producao?.realizada / p.ofertaMinima) * 100 : 100;
            return status < 70;
        });

        if (critical.length === 0) {
            alertsContainer.innerHTML = `<div class="p-4 text-center text-slate-400 text-xs italic">Nenhum alerta crítico para este período.</div>`;
        } else {
            alertsContainer.innerHTML = critical.map(p => {
                const inst = insts.find(i => i.id === p.instId);
                const proc = procs.find(pr => pr.sigtap === p.sigtap);
                const status = Math.round((p.producao?.realizada / p.ofertaMinima) * 100);
                return `
                    <div class="p-4 rounded-lg bg-white dark:bg-[#151e2a] border-l-4 ${status < 50 ? 'border-red-500' : 'border-yellow-500'} shadow-sm">
                        <div class="flex items-start gap-3">
                            <span class="material-symbols-outlined ${status < 50 ? 'text-red-500' : 'text-yellow-500'}">
                                ${status < 50 ? 'error' : 'warning'}
                            </span>
                            <div>
                                <h4 class="text-sm font-bold text-slate-900 dark:text-white">${proc?.nome || p.sigtap}</h4>
                                <p class="text-xs text-slate-500 dark:text-slate-400 mt-1">
                                    Atingimento: ${status}% no ${inst?.sigla || inst?.nome || 'Instituto'}
                                </p>
                            </div>
                        </div>
                    </div>
                `;
            }).slice(0, 5).join(''); // Limit to top 5 alerts
        }
    }
}

initDashboard();
