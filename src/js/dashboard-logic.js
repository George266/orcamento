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

let localUsers = []; // Cache functionality
let currentPeriod = null;
let currentCommData = null; // Store data for the active modal

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
    localUsers = await Repository.getUsers();
    localProcs = await Repository.getProcedimentos();
    window.localProgramas = await Repository.getProgramas(); // Make available for charts

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
    const elPactuado = document.getElementById('kpi-pactuado');
    if (elPactuado) elPactuado.textContent = formatNumber(totalPactuado);

    const elOfertado = document.getElementById('kpi-ofertado');
    if (elOfertado) elOfertado.textContent = formatNumber(totalRealizado);

    const atingimento = totalPactuado > 0 ? (totalRealizado / totalPactuado) * 100 : 0;
    const elAtingimentoPct = document.getElementById('kpi-atingimento-percent');
    if (elAtingimentoPct) elAtingimentoPct.textContent = atingimento.toFixed(1) + '%';

    const elAtingimentoBar = document.getElementById('kpi-atingimento-bar');
    if (elAtingimentoBar) elAtingimentoBar.style.width = Math.min(atingimento, 100) + '%';

    const elFinanceiro = document.getElementById('kpi-financeiro');
    if (elFinanceiro) elFinanceiro.textContent = formatCurrency(totalFinanceiro);

    const elFinanceiroDetail = document.getElementById('kpi-financeiro-detail');
    if (elFinanceiroDetail) elFinanceiroDetail.textContent = `Total (SIGTAP + Incentivos) p/ Produção`;

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
                ofertado: 0,
                progIds: new Set()
            };
        }
        groupsMap[key].pactuado += parseInt(p.ofertaMinima || 0);
        groupsMap[key].ofertado += parseInt(p.producao?.realizada || 0);
        if (p.progId) groupsMap[key].progIds.add(p.progId);
    });

    const groups = Object.values(groupsMap).map(g => ({
        ...g,
        status: g.pactuado > 0 ? Math.round((g.ofertado / g.pactuado) * 100) : 0,
        programNames: Array.from(g.progIds).map(id => {
            const prog = window.localProgramas?.find(pr => pr.id === id);
            return prog ? prog.nome : id;
        }).join(', ') || '-'
    })).sort((a, b) => b.pactuado - a.pactuado);

    // Update Table
    const tableBody = document.getElementById('dashboard-table-body');
    if (tableBody) {
        if (groups.length === 0) {
            tableBody.innerHTML = `<tr><td colspan="6" class="px-6 py-10 text-center text-slate-400 italic">Sem dados para este período.</td></tr>`;
        } else {
            tableBody.innerHTML = groups.map(item => `
                <tr class="bg-white dark:bg-[#101822] hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                    <td class="px-6 py-4 font-medium text-slate-900 dark:text-white">
                        <div class="flex items-center gap-3">
                            <div class="size-2 rounded-full ${item.status >= 90 ? 'bg-green-500' : item.status >= 70 ? 'bg-yellow-500' : 'bg-red-500'}"></div>
                            <span class="truncate max-w-[300px]" title="${item.nome}">${item.nome}</span>
                        </div>
                    </td>
                    <td class="px-6 py-4 text-xs text-slate-500 dark:text-slate-400">
                        <span class="truncate max-w-[150px] block" title="${item.programNames}">${item.programNames}</span>
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
                        <div class="flex items-start justify-between gap-3">
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
                            <!-- Contact Buttons (Right Side) -->
                            ${renderContactButtons(p, inst, proc)}
                        </div>
                    </div>
                `;
            }).slice(0, 5).join('');
        }
    }

    renderCharts(filtered, currentPactuacoes);
}

function renderCharts(currentData, allPactuacoes) {
    // 1. Ranking Chart (Top 5 Institutes by Financial Execution)
    const rankingContainer = document.getElementById('chart-ranking-container');
    if (rankingContainer) {
        // Aggregate by Institute
        const instStats = {};
        currentData.forEach(p => {
            if (!instStats[p.instId]) instStats[p.instId] = { id: p.instId, total: 0 };
            const vBase = parseFloat(p.vlrSigtapBase || 0);
            const vInc = parseFloat(p.vlrIncentivo || 0);
            const real = parseInt(p.producao?.realizada || 0);
            instStats[p.instId].total += (vBase + vInc) * real;
        });

        // Convert to array, sort, take top 5
        const sortedInsts = Object.values(instStats)
            .sort((a, b) => b.total - a.total)
            .slice(0, 5);

        if (sortedInsts.length === 0) {
            rankingContainer.innerHTML = `<div class="h-40 flex items-center justify-center text-slate-400 text-xs italic">Sem produção registrada.</div>`;
        } else {
            const maxVal = sortedInsts[0]?.total || 0; // For scaling
            rankingContainer.innerHTML = sortedInsts.map((item, index) => {
                const inst = localInsts.find(i => i.id === item.id);
                const pct = maxVal > 0 ? (item.total / maxVal) * 100 : 0;
                const name = inst ? (inst.sigla || inst.nome) : 'Desc.';

                // Color logic: #1 Gold, #2 Silver, #3 Bronze, others Slate
                let barColor = 'bg-slate-200 dark:bg-slate-700';
                let textColor = 'text-slate-600 dark:text-slate-400';
                if (index === 0) { barColor = 'bg-amber-400'; textColor = 'text-amber-600'; }
                if (index === 1) { barColor = 'bg-slate-400'; textColor = 'text-slate-500'; }
                if (index === 2) { barColor = 'bg-orange-400'; textColor = 'text-orange-600'; }

                return `
                    <div class="flex items-center gap-3">
                        <div class="w-8 text-xs font-bold ${textColor} text-right">#${index + 1}</div>
                        <div class="flex-1">
                            <div class="flex justify-between mb-1">
                                <span class="text-xs font-bold text-slate-700 dark:text-slate-300">${name}</span>
                                <span class="text-[10px] font-mono font-medium text-slate-500">${formatCurrency(item.total)}</span>
                            </div>
                            <div class="w-full bg-slate-50 dark:bg-slate-800/50 rounded-full h-2">
                                <div class="h-2 rounded-full ${barColor}" style="width: ${pct}%"></div>
                            </div>
                        </div>
                    </div>
                `;
            }).join('');
        }
    }

    // 2. Evolution Chart (Last 6 Months) - Stacked by Institute
    const evolutionContainer = document.getElementById('chart-evolution-container');
    if (evolutionContainer) {

        const allCompetencias = [...new Set(allPactuacoes.map(p => p.competencia))];
        const monthMap = { 'jan': 0, 'fev': 1, 'mar': 2, 'abr': 3, 'mai': 4, 'jun': 5, 'jul': 6, 'ago': 7, 'set': 8, 'out': 9, 'nov': 10, 'dez': 11 };

        const parseComp = (c) => {
            if (!c) return 0;
            const [m, y] = c.split('/');
            if (!m || !y) return 0;
            return new Date(2000 + parseInt(y), monthMap[m.toLowerCase()] || 0, 1);
        };

        const sortedComps = allCompetencias.sort((a, b) => parseComp(a) - parseComp(b));
        const currentIndex = sortedComps.indexOf(currentPeriod);

        // Take up to 6 items ending at currentIndex
        const sliceStart = Math.max(0, currentIndex - 5);
        const last6Comps = sortedComps.slice(sliceStart, currentIndex + 1);

        // Aggregate data: Map<Month, Map<InstID, Total>>
        const evolutionData = last6Comps.map(comp => {
            const items = allPactuacoes.filter(p => p.competencia === comp);

            // Group by Institute
            const breakdown = {};
            let monthlyTotal = 0;

            items.forEach(p => {
                const vBase = parseFloat(p.vlrSigtapBase || 0);
                const vInc = parseFloat(p.vlrIncentivo || 0);
                const real = parseInt(p.producao?.realizada || 0); // User confirmed "Realizado"
                const value = (vBase + vInc) * real;

                if (!breakdown[p.instId]) breakdown[p.instId] = 0;
                breakdown[p.instId] += value;
                monthlyTotal += value;
            });

            return { comp, monthlyTotal, breakdown };
        });

        const maxVal = Math.max(...evolutionData.map(d => d.monthlyTotal), 10);

        // Color Palette for Institutes (Consistent across months)
        const colors = [
            'bg-blue-500', 'bg-orange-500', 'bg-emerald-500', 'bg-purple-500', 'bg-pink-500', 'bg-cyan-500'
        ];

        // 1. Render Bars
        const chartHTML = evolutionData.map(d => {
            const parts = d.comp.split('/');
            const m = parts[0];
            const y = parts[1];
            const isCurrent = d.comp === currentPeriod;

            // Generate stacked segments
            const segments = Object.entries(d.breakdown).map(([instId, val], idx) => {
                if (val === 0) return '';
                const inst = localInsts.find(i => i.id === instId);
                const instName = inst ? (inst.sigla || inst.nome) : 'Outros';

                const instIdx = localInsts.findIndex(i => i.id === instId);
                const color = instIdx >= 0 ? colors[instIdx % colors.length] : 'bg-slate-400';

                const heightPct = (val / maxVal) * 100;

                return `
                    <div class="w-full ${color} first:rounded-t-sm relative group/segment" 
                         style="height: ${heightPct}%">
                         <!-- Custom Tooltip -->
                         <div class="hidden group-hover/segment:block absolute bottom-full left-1/2 -translate-x-1/2 mb-1 z-50 whitespace-nowrap bg-slate-900 text-white text-[10px] rounded px-2 py-1 shadow-lg pointer-events-none">
                            <strong>${instName}</strong><br/>
                            ${formatCurrency(val)}
                         </div>
                    </div>
                `;
            }).reverse().join('');

            return `
                <div class="flex flex-col items-center gap-2 h-full justify-end group cursor-pointer w-full">
                     <div class="relative w-full max-w-[40px] flex flex-col-reverse items-end justify-start h-full bg-slate-100 dark:bg-slate-800/50 rounded-t-sm overflow-visible">
                        ${segments}
                     </div>
                     <div class="text-center">
                        <p class="text-[10px] uppercase font-bold ${isCurrent ? 'text-slate-900 dark:text-white' : 'text-slate-400'}">${m}</p>
                        <p class="text-[8px] text-slate-300">${y}</p>
                     </div>
                </div>
            `;
        }).join('');

        // 2. Render Legend (Participating Institutes only)
        // Find unique institutes present in the data
        const presentInstIds = new Set();
        evolutionData.forEach(d => Object.keys(d.breakdown).forEach(k => presentInstIds.add(k)));

        const legendHTML = Array.from(presentInstIds).map(id => {
            const inst = localInsts.find(i => i.id === id);
            const name = inst ? (inst.sigla || inst.nome) : 'Outros';
            const instIdx = localInsts.findIndex(i => i.id === id);
            const color = instIdx >= 0 ? colors[instIdx % colors.length] : 'bg-slate-400';

            return `
                <div class="flex items-center gap-1.5">
                    <div class="size-2 rounded-full ${color}"></div>
                    <span class="text-[10px] text-slate-500 dark:text-slate-400 font-medium">${name}</span>
                </div>
            `;
        }).join('');

        evolutionContainer.innerHTML = `
            <div class="flex-1 flex items-end justify-between gap-2 min-h-[140px] px-2">
                ${chartHTML}
            </div>
            <div class="mt-4 flex flex-wrap justify-center gap-4 pt-4 border-t border-slate-100 dark:border-slate-800/50">
                ${legendHTML}
            </div>
        `;

        evolutionContainer.className = "flex-1 flex flex-col justify-between";
    }

    // 3. Goal Achievement Chart (Institute Comparison)
    const goalContainer = document.getElementById('chart-goal-container');
    if (goalContainer) {
        const instStats = {};
        currentData.forEach(p => {
            if (!instStats[p.instId]) instStats[p.instId] = { id: p.instId, pact: 0, real: 0 };
            instStats[p.instId].pact += parseInt(p.ofertaMinima || 0);
            instStats[p.instId].real += parseInt(p.producao?.realizada || 0);
        });

        const sortedStats = Object.values(instStats)
            .map(i => ({ ...i, pct: i.pact > 0 ? (i.real / i.pact) * 100 : 0 }))
            .sort((a, b) => b.pct - a.pct); // Sort by achievement %

        if (sortedStats.length === 0) {
            goalContainer.innerHTML = `<div class="h-40 flex items-center justify-center text-slate-400 text-xs italic">Sem dados de metas.</div>`;
        } else {
            goalContainer.innerHTML = sortedStats.map(item => {
                const inst = localInsts.find(i => i.id === item.id);
                const name = inst ? (inst.sigla || inst.nome) : 'Desc.';
                // Cap bar at 100 visual, but show real text
                const barWidth = Math.min(item.pct, 100);

                let colorClass = 'bg-red-500';
                if (item.pct >= 90) colorClass = 'bg-emerald-500';
                else if (item.pct >= 70) colorClass = 'bg-amber-500';

                return `
                    <div class="flex flex-col gap-1">
                        <div class="flex justify-between text-xs">
                             <span class="font-bold text-slate-700 dark:text-slate-300">${name}</span>
                             <span class="font-mono text-slate-500">${Math.round(item.pct)}%</span>
                        </div>
                        <div class="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-2 overflow-hidden">
                             <div class="h-full ${colorClass}" style="width: ${barWidth}%"></div>
                        </div>
                    </div>
                `;
            }).join('');
        }
    }

    // 4. Revenue by Incentive Chart
    const incentiveContainer = document.getElementById('chart-incentive-container');
    if (incentiveContainer) {
        // Need programs loaded. Check existing 'localProcs'. 
        // Wait, 'Incentivo' = Program Name? 
        // In `dashboard-logic.js`, we typically fetch `getPactuacoes`. 
        // The `p.progId` connects to Programs. We need `localProgramas` too!
        // We might need to fetch programs in `initDashboard` or `updateDashboard`.
        // Let's assume `localProcs` has procedure names, but `p.progId` is what we want.

        // Assuming we can access `Repository` to get programs or we rely on `progId` if name not available?
        // Ideally, fetch programs. I'll add `localProgramas` cache and fetch it in `updateDashboard` or use repository.
        // Since I cannot change `updateDashboard` signature easily here without re-writing, 
        // I will check if I can fetch it on fly or if I need to update `updateDashboard` first.

        // Let's rely on standard logic: Aggregating by `progId`. 
        // If `localProgramas` is not available globally in this file, we might show ID or fetch.
        // I'll check if I need to add `localProgramas` global.
        // For now, let's aggregate.

        // Note: `dashboard-logic.js` doesn't currently seem to fetch programs in `initDashboard` (based on previous file read).
        // I should probably add `localProgramas = await Repository.getProgramas()` in `updateDashboard`.

        // For this step to work cleanly, I should probably update `updateDashboard` to fetch programs first.
        // But I'm only modifying `renderCharts` block here. 
        // I will code it to use `progId` for now and plan a follow-up fix if needed, 
        // OR better: I'll include the fetch in the update block in a separate step?
        // No, I can do it here if I modify `updateDashboard` too. 
        // Or I can just fetch it inside `renderCharts` (async)?

        // RenderCharts is not async in the call site `renderCharts(filtered...)`.
        // I should make `renderCharts` async or fetch data before.

        // Let's keep it simple: Aggregate by `vlrIncentivo` or `progId`?
        // The user said "Faturamento por Incentivo" (Program).
        // I will list by `progId` and show ID if name missing, or try to infer.
        // Actually, `dashboard_orcamento.html` doesn't import `Repository` inside `renderCharts`.

        // Strategy: Update `updateDashboard` in a separate step to fetch programs?
        // Or just hack it: The table previously added `getProgramas`. 
        // I will use `Repository.getProgramas` inside `updateDashboard` and pass it.

        // Let's implement the container logic here assuming `localProgramas` will be available or just grouping by ID for now.

        const progStats = {};
        currentData.forEach(p => {
            const pid = p.progId || 'Sem Programa';
            if (!progStats[pid]) progStats[pid] = { id: pid, total: 0 };
            const vBase = parseFloat(p.vlrSigtapBase || 0);
            const vInc = parseFloat(p.vlrIncentivo || 0);
            // Revenue usually implies full value? Or just Incentive value?
            // "Faturamento por Incentivo" -> "Revenue by Incentive Program". Usually total revenue associated with that program.
            progStats[pid].total += (vBase + vInc) * parseInt(p.producao?.realizada || 0);
        });

        const sortedProgs = Object.values(progStats).sort((a, b) => b.total - a.total);
        const totalRev = sortedProgs.reduce((acc, i) => acc + i.total, 0);

        if (sortedProgs.length === 0) {
            incentiveContainer.innerHTML = `<div class="h-40 flex items-center justify-center text-slate-400 text-xs italic">Sem faturamento.</div>`;
        } else {
            // We need names. I'll fetch them in `updateDashboard`.
            // Here I'll try to find name from a global `localProgramas` if it exists, else ID.

            incentiveContainer.innerHTML = sortedProgs.map(item => {
                const pct = totalRev > 0 ? (item.total / totalRev) * 100 : 0;
                // Placeholder for name lookup
                const name = (window.localProgramas?.find(pg => pg.id === item.id)?.nome) || item.id;

                return `
                    <div class="flex items-center justify-between text-sm group">
                        <div class="flex items-center gap-2 flex-1 overflow-hidden">
                             <div class="w-2 h-2 rounded-full bg-indigo-500 shrink-0"></div>
                             <span class="truncate text-slate-700 dark:text-slate-300" title="${name}">${name}</span>
                        </div>
                        <div class="text-right flex flex-col items-end">
                             <span class="font-bold text-slate-900 dark:text-white">${formatCurrency(item.total)}</span>
                             <span class="text-[10px] text-slate-400">${pct.toFixed(1)}%</span>
                        </div>
                    </div>
                 `;
            }).join('');
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

        // Safe Parsing
        const rawPact = p.ofertaMinima;
        const rawOff = p.ofertado;
        const rawReal = p.producao?.realizada;

        const pact = !isNaN(parseInt(rawPact)) ? parseInt(rawPact) : 0;
        const ofertado = !isNaN(parseInt(rawOff)) ? parseInt(rawOff) : 0;
        const realizado = !isNaN(parseInt(rawReal)) ? parseInt(rawReal) : 0;

        const vBase = parseFloat(p.vlrSigtapBase || 0);
        const vInc = parseFloat(p.vlrIncentivo || 0);
        const totalLinha = (vBase + vInc) * realizado;

        // Status typically tracks Offer vs Pactuado now
        const status = pact > 0 ? Math.round((ofertado / pact) * 100) : 0;

        return `
            <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                <td class="px-6 py-4 font-bold text-slate-900 dark:text-white">${inst?.sigla || inst?.nome || '???'}</td>
                <td class="px-6 py-4 text-right font-mono text-xs">${formatNumber(pact)}</td>
                <td class="px-6 py-4 text-right font-mono text-xs">${formatNumber(ofertado)}</td>
                <td class="px-6 py-4 text-right font-mono text-xs text-slate-600 dark:text-slate-400">${formatNumber(realizado)}</td>
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

function renderContactButtons(pact, inst, proc) {
    if (!inst) return '';

    // Find users
    const recipients = localUsers.filter(u => {
        const isInstUser = u.role && u.role.startsWith('Institutos');
        if (!isInstUser) return false;
        if (u.instIds && Array.isArray(u.instIds)) return u.instIds.includes(inst.id);
        return u.instId === inst.id;
    });

    if (recipients.length === 0) return '';

    const pactId = pact.id || pact.sigtap;
    const hasPhone = recipients.some(u => !!u.phone);

    return `
        <div class="flex flex-col gap-1 shrink-0">
            <button onclick="window.openCommModal('email', '${pactId}', '${inst.id}')" 
                class="flex items-center justify-center size-7 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition-colors" title="Enviar Email">
                <span class="material-symbols-outlined text-[16px]">mail</span>
            </button>
            <button onclick="window.openCommModal('whatsapp', '${pactId}', '${inst.id}')" ${!hasPhone ? 'disabled' : ''}
                class="flex items-center justify-center size-7 bg-green-50 text-green-600 rounded-lg hover:bg-green-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed" title="${hasPhone ? 'Enviar WhatsApp' : 'Nenhum telefone cadastrado'}">
                <span class="material-symbols-outlined text-[16px]">chat</span>
            </button>
        </div>
    `;
}

// --- COMMUNICATION MODAL LOGIC ---
window.openCommModal = (type, pactId, instId) => {
    const pact = currentPactuacoes.find(p => (p.id || p.sigtap) == pactId);
    const inst = localInsts.find(i => i.id == instId);
    const proc = localProcs.find(pr => pr.sigtap === pact.sigtap);

    if (!pact || !inst) return;

    // Filter recipients
    const recipients = localUsers.filter(u => {
        const isInstUser = u.role && u.role.startsWith('Institutos');
        if (!isInstUser) return false;
        if (u.instIds && Array.isArray(u.instIds)) return u.instIds.includes(inst.id);
        return u.instId === inst.id;
    });

    if (recipients.length === 0) return alert('Nenhum usuário cadastrado para este Instituto.');

    currentCommData = { type, recipients };

    const modal = document.getElementById('modal-comunicacao');
    const recipientContainer = document.getElementById('comm-recipients');
    const subjectInput = document.getElementById('comm-subject');
    const messageInput = document.getElementById('comm-message');
    const sendBtn = document.getElementById('comm-send-btn');
    const title = document.getElementById('comm-title');

    // Reset UI
    recipientContainer.innerHTML = '';

    // Populate Data
    const subjectText = `Alerta de Produção: ${proc?.nome || pact.sigtap}`;
    const bodyText = `Olá,\n\nIdentificamos que o procedimento ${proc?.nome || pact.sigtap} está com produção abaixo do esperado (${Math.round((pact.producao?.realizada / pact.ofertaMinima) * 100)}%) no mês de ${pact.competencia}.\n\nFavor verificar.\n\nAtenciosamente,\nEquipe Orçamento`;

    subjectInput.value = subjectText;
    messageInput.value = bodyText;

    if (type === 'email') {
        title.innerHTML = '<span class="material-symbols-outlined text-blue-600">mail</span> Enviar E-mail';
        sendBtn.classList.remove('hidden');
        sendBtn.innerHTML = '<span>Enviar Email</span><span class="material-symbols-outlined text-[16px]">send</span>';

        recipients.forEach(u => {
            recipientContainer.innerHTML += `
                <div class="px-2 py-1 bg-blue-100 text-blue-700 rounded-md text-xs font-bold flex items-center gap-1">
                    <span class="material-symbols-outlined text-[12px]">person</span>
                    ${u.name.split(' ')[0]}
                </div>`;
        });
    } else {
        title.innerHTML = '<span class="material-symbols-outlined text-green-600">chat</span> Enviar WhatsApp';
        sendBtn.classList.add('hidden'); // Hide main button for WA

        recipients.forEach(u => {
            const hasPhone = !!u.phone;
            recipientContainer.innerHTML += `
                <div class="flex items-center justify-between w-full p-2 bg-white border border-slate-200 rounded-lg">
                    <div class="flex items-center gap-2">
                         <span class="material-symbols-outlined text-slate-400">person</span>
                         <span class="font-bold text-slate-700">${u.name}</span>
                         ${!hasPhone ? '<span class="text-xs text-red-400">(Sem telefone)</span>' : ''}
                    </div>
                    ${hasPhone ? `
                    <button onclick="window.sendToIndividual('${u.phone}')" class="px-3 py-1 bg-green-100 text-green-700 rounded-lg text-xs font-bold hover:bg-green-200 transition-colors flex items-center gap-1">
                        Enviar
                        <span class="material-symbols-outlined text-[14px]">send</span>
                    </button>
                    ` : ''}
                </div>`;
        });
    }

    modal.classList.remove('hidden');
};

window.closeCommModal = () => {
    document.getElementById('modal-comunicacao').classList.add('hidden');
    currentCommData = null;
};

window.sendCommunication = () => {
    if (!currentCommData || currentCommData.type !== 'email') return;

    const emails = currentCommData.recipients.map(u => u.email).filter(e => e).join(',');
    const subject = encodeURIComponent(document.getElementById('comm-subject').value);
    const body = encodeURIComponent(document.getElementById('comm-message').value);

    window.location.href = `mailto:?bcc=${emails}&subject=${subject}&body=${body}`;
    setTimeout(window.closeCommModal, 1000);
};

window.sendToIndividual = (phone) => {
    const cleanPhone = phone.replace(/\D/g, '');
    const body = encodeURIComponent(document.getElementById('comm-message').value);
    window.open(`https://wa.me/55${cleanPhone}?text=${body}`, '_blank');
};

initDashboard();
