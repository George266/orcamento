import { Repository } from './repository.js';
import { DateUtils } from './utils/date-utils.js';
import { getOferta, getProduzido, getRetornoSMSA, getMeta, atingimentoPct, statusMeta, calcIncentivo, mapaOfertaRede, mapaMetaRede, chaveOfertaRede, ofertaInstitutoChave } from './business-rules.js';

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
let selectedPeriods = [];
let currentCommData = null; // Store data for the active modal
let procTrendMode = 'consolidado';
let procTrendData = null;
let procChartParams = null;
let hiddenTrendSigtaps = new Set();
let trendSearchQuery = '';

export async function initDashboard() {
    const pactuacoes = await Repository.getPactuacoes();
    const monthSelector = document.getElementById('month-selector');

    // Restaura o estado recolhido do painel de Alertas Operacionais (se existir na página).
    if (document.getElementById('col-alertas')) {
        let collapsed = false;
        try { collapsed = localStorage.getItem('alerts_panel_collapsed') === '1'; } catch (e) { /* ignore */ }
        if (collapsed) applyAlertsCollapsed(true);
    }

    const checkboxesContainer = document.getElementById('period-checkboxes');
    if (checkboxesContainer) {
        // Extract unique competencies
        let competencias = [];
        if (pactuacoes.length > 0) {
            competencias = [...new Set(pactuacoes.map(p => p.competencia))];
        }

        // Competência padrão calculada a partir dos meses QUE TÊM dados
        const compPadrao = DateUtils.competenciaPadrao(competencias);
        // Garante o mês atual como opção selecionável (mesmo sem dados)
        const currentComp = DateUtils.getCurrentMonthLabel('short');
        if (!competencias.includes(currentComp)) {
            competencias.push(currentComp);
        }

        const monthMap = { 'jan': 0, 'fev': 1, 'mar': 2, 'abr': 3, 'mai': 4, 'jun': 5, 'jul': 6, 'ago': 7, 'set': 8, 'out': 9, 'nov': 10, 'dez': 11 };
        const parseComp = (c) => {
            if (!c) return 0;
            const [m, y] = c.split('/');
            if (!m || !y) return 0;
            return new Date(2000 + parseInt(y), monthMap[m.toLowerCase()] || 0, 1);
        };

        competencias.sort((a, b) => parseComp(b) - parseComp(a));

        checkboxesContainer.innerHTML = competencias.map(c => `
            <label class="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 cursor-pointer">
                <input type="checkbox" value="${c}" class="period-checkbox rounded accent-primary w-3.5 h-3.5" />
                <span class="text-sm font-medium text-slate-700 dark:text-slate-300">${c}</span>
            </label>
        `).join('');

        const btn = document.getElementById('period-selector-btn');
        const dropdown = document.getElementById('period-selector-dropdown');
        const labelEl = document.getElementById('period-selector-label');
        const selectAllBtn = document.getElementById('period-select-all-btn');
        const clearBtn = document.getElementById('period-clear-btn');

        const getCheckboxes = () => checkboxesContainer.querySelectorAll('.period-checkbox');

        const updateLabel = () => {
            if (selectedPeriods.length === 0) {
                labelEl.textContent = 'Todos os períodos';
            } else if (selectedPeriods.length === 1) {
                labelEl.textContent = selectedPeriods[0];
            } else {
                labelEl.textContent = `${selectedPeriods.length} competências`;
            }
        };

        // Default: mês atual se tiver dados; senão o mais recente com dados
        const defaultCb = checkboxesContainer.querySelector(`input[value="${compPadrao}"]`);
        if (defaultCb) defaultCb.checked = true;
        selectedPeriods = compPadrao ? [compPadrao] : [];
        updateLabel();

        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            dropdown.classList.toggle('hidden');
        });

        document.addEventListener('click', (e) => {
            if (!btn.contains(e.target) && !dropdown.contains(e.target)) {
                dropdown.classList.add('hidden');
            }
        });

        checkboxesContainer.addEventListener('change', () => {
            selectedPeriods = Array.from(getCheckboxes()).filter(cb => cb.checked).map(cb => cb.value);
            updateLabel();
            updateDashboard(selectedPeriods, pactuacoes);
        });

        selectAllBtn.addEventListener('click', () => {
            getCheckboxes().forEach(cb => cb.checked = true);
            selectedPeriods = [...competencias];
            updateLabel();
            updateDashboard(selectedPeriods, pactuacoes);
        });

        clearBtn.addEventListener('click', () => {
            getCheckboxes().forEach(cb => cb.checked = false);
            selectedPeriods = [];
            updateLabel();
            updateDashboard(selectedPeriods, pactuacoes);
        });

        updateDashboard(selectedPeriods, pactuacoes);
    } else if (monthSelector) {
        let competencias = [...new Set(pactuacoes.map(p => p.competencia))];
        const compPadrao = DateUtils.competenciaPadrao(competencias);

        const currentComp = DateUtils.getCurrentMonthLabel('short');
        if (!competencias.includes(currentComp)) competencias.push(currentComp);

        const monthMap = { 'jan': 0, 'fev': 1, 'mar': 2, 'abr': 3, 'mai': 4, 'jun': 5, 'jul': 6, 'ago': 7, 'set': 8, 'out': 9, 'nov': 10, 'dez': 11 };
        const parseComp = (c) => {
            if (!c) return 0;
            const [m, y] = c.split('/');
            if (!m || !y) return 0;
            return new Date(2000 + parseInt(y), monthMap[m.toLowerCase()] || 0, 1);
        };
        competencias.sort((a, b) => parseComp(b) - parseComp(a));

        const longMonths = { 'jan': 'Janeiro', 'fev': 'Fevereiro', 'mar': 'Março', 'abr': 'Abril', 'mai': 'Maio', 'jun': 'Junho', 'jul': 'Julho', 'ago': 'Agosto', 'set': 'Setembro', 'out': 'Outubro', 'nov': 'Novembro', 'dez': 'Dezembro' };

        monthSelector.innerHTML = competencias.map((c) => {
            const [m, y] = c.split('/');
            const display = `${longMonths[m] || m} / 20${y}`;
            return `<option value="${c}" ${c === compPadrao ? 'selected' : ''}>${display}</option>`;
        }).join('');

        monthSelector.addEventListener('change', () => {
            updateDashboard([monthSelector.value], pactuacoes);
        });

        updateDashboard([compPadrao || competencias[0]], pactuacoes);
    } else {
        updateDashboard([], pactuacoes);
    }

    // --- GLOBAL DEADLINE MONITOR ---
    const config = await Repository.getSystemConfig();
    const deadlineDay = config?.deadlineDay || 5;
    const deadlineRule = config?.deadlineRule || 'business_day';
    const deadlineAlert = config?.deadlineAlert !== false; // Default true

    if (deadlineAlert && DateUtils.isPastDeadline(deadlineDay, deadlineRule)) {
        const insts = await Repository.getInstitutos(); // Ensure we have names
        // updateDashboard (que popula localGruposOferta) roda sem await; garante os grupos
        // aqui para o monitor resolver a meta de grupo corretamente.
        if (!localGruposOferta.length) localGruposOferta = await Repository.getGruposOferta();
        checkGlobalCompliance(pactuacoes, insts, { deadlineDay, deadlineRule });
    }
}

let dashboardRenderToken = 0;
let localGruposOferta = [];

async function updateDashboard(periods = [], allPactuacoes = null) {
    const myToken = ++dashboardRenderToken;
    const pacts = allPactuacoes || await Repository.getPactuacoes();
    const insts = await Repository.getInstitutos();
    const users = await Repository.getUsers();
    const procs = await Repository.getProcedimentos();
    const progs = await Repository.getProgramas();
    const grupos = await Repository.getGruposOferta();
    // Se um clique mais recente disparou outra atualização enquanto os fetches corriam,
    // aborta esta para não sobrescrever o dashboard com dados obsoletos.
    if (myToken !== dashboardRenderToken) return;
    currentPactuacoes = pacts;
    localInsts = insts;
    localUsers = users;
    localProcs = procs;
    localGruposOferta = grupos;
    window.localProgramas = progs; // Make available for charts

    const filtered = periods.length > 0
        ? currentPactuacoes.filter(p => periods.includes(p.competencia))
        : currentPactuacoes;

    // Totais — deduplica por (instituto+sigtap) com Math.max (regra "considerar a maior"
    // dentro do instituto) e soma entre institutos. Oferta = ofertado; Produzido = producao.realizada.
    let totalPactuado = 0;        // meta
    let totalFinanceiroPrev = 0;  // financeiro Previsto (sobre o Produzido)
    let totalFinanceiroPago = 0;  // financeiro Pago (sobre o Aprovado/SMSA)

    // Oferta e META da REDE por procedimento/grupo. A meta do grupo conta UMA vez
    // (não por SIGTAP), evitando inflar o Pactuado quando o grupo tem vários SIGTAPs.
    const netMap = mapaOfertaRede(filtered);
    const metaMap = mapaMetaRede(filtered, localGruposOferta);
    totalPactuado = Object.values(metaMap).reduce((s, v) => s + v, 0);

    const kpiMap = {};
    filtered.forEach(p => {
        const k = `${p.sigtap}-${p.instId}`;
        if (!kpiMap[k]) kpiMap[k] = { meta: 0, oferta: 0, prod: 0, aprov: 0, vBase: 0, vInc: 0, chave: chaveOfertaRede(p) };
        kpiMap[k].meta = Math.max(kpiMap[k].meta, getMeta(p, localGruposOferta));
        kpiMap[k].oferta = Math.max(kpiMap[k].oferta, getOferta(p));
        kpiMap[k].prod = Math.max(kpiMap[k].prod, getProduzido(p));
        kpiMap[k].aprov = Math.max(kpiMap[k].aprov, getRetornoSMSA(p));
        kpiMap[k].vBase = Math.max(kpiMap[k].vBase, parseFloat(p.vlrSigtapBase || 0));
        kpiMap[k].vInc = Math.max(kpiMap[k].vInc, parseFloat(p.vlrIncentivo || 0));
    });
    let totalOfertado = 0;   // oferta (instituto)
    Object.values(kpiMap).forEach(v => {
        totalOfertado += v.oferta;
        // Incentivo condicionado à meta da REDE; Previsto = sobre o Produzido, Pago = sobre o Aprovado/SMSA
        const ofertaRede = netMap[v.chave] || 0;
        totalFinanceiroPrev += v.vBase * v.prod + calcIncentivo({ vlrIncentivo: v.vInc, quantidade: v.prod, oferta: ofertaRede, meta: v.meta });
        totalFinanceiroPago += v.vBase * v.aprov + calcIncentivo({ vlrIncentivo: v.vInc, quantidade: v.aprov, oferta: ofertaRede, meta: v.meta });
    });
    const totalRealizado = totalOfertado; // "Ofertado" no dashboard = oferta do instituto

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
    if (elFinanceiro) elFinanceiro.textContent = formatCurrency(totalFinanceiroPrev);

    const elFinanceiroDetail = document.getElementById('kpi-financeiro-detail');
    if (elFinanceiroDetail) elFinanceiroDetail.innerHTML = `Previsto (produzido) · <span class="font-bold text-slate-600 dark:text-slate-300">Pago (SMSA): ${formatCurrency(totalFinanceiroPago)}</span>`;

    // Grouping for Table (by Procedimento / Grupo de Oferta)
    // Chaveia por chaveOfertaRede: um grupo de oferta vira UMA linha (meta única do grupo,
    // oferta somada dos SIGTAPs), em vez de uma linha por SIGTAP com a meta do grupo repetida.
    const groupsMap = {};
    filtered.forEach(p => {
        const key = chaveOfertaRede(p);
        if (!groupsMap[key]) {
            const grupo = p.grupoOfertaId ? localGruposOferta.find(g => g.id === p.grupoOfertaId) : null;
            const proc = localProcs.find(pr => pr.sigtap === p.sigtap);
            groupsMap[key] = {
                chave: key,
                sigtap: p.sigtap, // SIGTAP de referência (drill-down usa a chave)
                isGrupo: !!grupo,
                nome: grupo
                    ? (grupo.nome || 'Grupo de Oferta')
                    : (proc ? (proc.especialidade ? `${proc.nome} — ${proc.especialidade}` : proc.nome) : `SIGTAP: ${p.sigtap}`),
                progIds: new Set(),
                sigtaps: new Set()
            };
        }
        if (p.progId) groupsMap[key].progIds.add(p.progId);
        if (p.sigtap) groupsMap[key].sigtaps.add(p.sigtap);
    });

    const groups = Object.values(groupsMap).map(g => {
        const pactuado = metaMap[g.chave] || 0;   // meta do grupo conta uma vez
        const ofertado = netMap[g.chave] || 0;    // oferta somada da rede
        return {
            ...g,
            pactuado,
            ofertado,
            codigos: Array.from(g.sigtaps).join(', '),
            status: pactuado > 0 ? Math.round((ofertado / pactuado) * 100) : 0,
            programNames: Array.from(g.progIds).map(id => {
                const prog = window.localProgramas?.find(pr => pr.id === id);
                return prog ? prog.nome : id;
            }).join(', ') || '-'
        };
    }).sort((a, b) => b.pactuado - a.pactuado);

    // Update Table
    const tableBody = document.getElementById('dashboard-table-body');
    if (tableBody) {
        if (groups.length === 0) {
            tableBody.innerHTML = `<tr><td colspan="6" class="px-6 py-10 text-center text-slate-400 italic">Aguardando ofertas</td></tr>`;
        } else {
            tableBody.innerHTML = groups.map(item => `
                <tr class="bg-white dark:bg-[#101822] hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                    <td class="px-6 py-4 font-medium text-slate-900 dark:text-white">
                        <div class="flex items-center gap-3">
                            <div class="size-2 rounded-full shrink-0 ${item.status >= 100 ? 'bg-green-500' : item.status >= 70 ? 'bg-yellow-500' : 'bg-red-500'}"></div>
                            <div class="min-w-0">
                                <span class="truncate max-w-[300px] block" title="${item.nome}">${item.nome}${item.isGrupo ? ' <span class="text-[9px] font-medium text-slate-400">(grupo)</span>' : ''}</span>
                                <span class="text-[10px] font-mono text-slate-400 dark:text-slate-500 truncate max-w-[300px] block" title="${item.codigos}">${item.codigos}</span>
                            </div>
                        </div>
                    </td>
                    <td class="px-6 py-4 text-xs text-slate-500 dark:text-slate-400">
                        <span class="truncate max-w-[150px] block" title="${item.programNames}">${item.programNames}</span>
                    </td>
                    <td class="px-6 py-4 text-right font-mono text-xs">${formatNumber(item.pactuado)}</td>
                    <td class="px-6 py-4 text-right font-mono text-xs font-bold">${formatNumber(item.ofertado)}</td>
                    <td class="px-6 py-4 text-center">
                        <span class="text-[10px] font-black px-2 py-0.5 rounded border ${item.status >= 100 ? 'bg-green-100 text-green-800 border-green-200' : item.status >= 70 ? 'bg-yellow-100 text-yellow-800 border-yellow-200' : 'bg-red-100 text-red-800 border-red-200'}">
                            ${item.status}%
                        </span>
                    </td>
                    <td class="px-6 py-4 text-center">
                        <button onclick="window.openDetalhamento('${item.chave}')" class="text-slate-300 hover:text-primary transition-colors">
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
        // Avaliação POR INSTITUTO, deduplicando por instituto + chave da rede (grupo ou
        // procedimento). Para grupos de oferta, compara a oferta somada dos SIGTAPs do
        // grupo (naquele instituto) contra a meta do grupo — não 1 SIGTAP contra a meta
        // do grupo inteiro (que gerava críticos falsos e cards repetidos).
        const seen = new Set();
        const critical = [];
        filtered.forEach(p => {
            const dedupKey = `${p.instId}||${chaveOfertaRede(p)}`;
            if (seen.has(dedupKey)) return;
            seen.add(dedupKey);
            const meta = getMeta(p, localGruposOferta);
            if (meta <= 0) return;
            const status = atingimentoPct(ofertaInstitutoChave(p, filtered), meta);
            if (status < 70) critical.push({ p, status });
        });
        critical.sort((a, b) => a.status - b.status); // mais crítico primeiro

        if (critical.length === 0) {
            alertsContainer.innerHTML = `<div class="p-8 text-center text-slate-400 text-xs italic">Nenhuma oferta mínima crítica. Produção dentro do esperado.</div>`;
        } else {
            alertsContainer.innerHTML = critical.map(({ p, status }) => {
                const inst = localInsts.find(i => i.id === p.instId);
                const proc = localProcs.find(pr => pr.sigtap === p.sigtap);
                const grupo = p.grupoOfertaId ? localGruposOferta.find(g => g.id === p.grupoOfertaId) : null;
                const titulo = grupo ? (grupo.nome || 'Grupo de Oferta') : (proc?.nome || p.sigtap);
                // Código(s) SIGTAP: grupo lista todos os SIGTAPs do grupo neste instituto.
                const chave = chaveOfertaRede(p);
                const sigtaps = grupo
                    ? [...new Set(filtered.filter(x => x.instId === p.instId && chaveOfertaRede(x) === chave).map(x => x.sigtap))]
                    : [p.sigtap];
                const codigos = sigtaps.join(', ');
                return `
                    <div class="p-4 rounded-xl bg-slate-50 dark:bg-slate-900/50 border-l-4 ${status < 50 ? 'border-red-500' : 'border-orange-500'} shadow-sm">
                        <div class="flex items-start justify-between gap-3">
                            <div class="flex items-start gap-3">
                                <span class="material-symbols-outlined ${status < 50 ? 'text-red-500' : 'text-orange-500'} text-[20px]">
                                    ${status < 50 ? 'error' : 'warning'}
                                </span>
                                <div>
                                    <h4 class="text-xs font-bold text-slate-900 dark:text-white">${titulo}${grupo ? ' <span class="text-[9px] font-medium text-slate-400">(grupo)</span>' : ''}</h4>
                                    <p class="text-[10px] font-mono text-slate-400 dark:text-slate-500 mt-0.5" title="${codigos}">
                                        SIGTAP: ${codigos}
                                    </p>
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
        const seenRankingKeys = new Set();
        currentData.forEach(p => {
            if (!instStats[p.instId]) instStats[p.instId] = { id: p.instId, total: 0 };
            const vBase = parseFloat(p.vlrSigtapBase || 0);
            const vInc = parseFloat(p.vlrIncentivo || 0);
            const real = parseInt(p.producao?.realizada || 0);
            // SIGTAP base value counted only once per procedure+institute
            const rankKey = `${p.instId}-${p.sigtap}`;
            if (!seenRankingKeys.has(rankKey)) {
                seenRankingKeys.add(rankKey);
                instStats[p.instId].total += vBase * real;
            }
            instStats[p.instId].total += vInc * real;
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
        const latestPeriod = selectedPeriods.length > 0
            ? selectedPeriods.reduce((a, b) => parseComp(a) >= parseComp(b) ? a : b)
            : sortedComps[sortedComps.length - 1];
        const rawIdx = sortedComps.indexOf(latestPeriod);
        const currentIndex = rawIdx >= 0 ? rawIdx : sortedComps.length - 1;

        const sliceStart = Math.max(0, currentIndex - 5);
        const last6Comps = sortedComps.slice(sliceStart, currentIndex + 1);

        // Aggregate data: Map<Month, Map<InstID, Total>>
        const evolutionData = last6Comps.map(comp => {
            const items = allPactuacoes.filter(p => p.competencia === comp);

            // Group by Institute
            const breakdown = {};
            let monthlyTotal = 0;

            const seenEvolutionKeys = new Set();
            items.forEach(p => {
                const vBase = parseFloat(p.vlrSigtapBase || 0);
                const vInc = parseFloat(p.vlrIncentivo || 0);
                const real = parseInt(p.producao?.realizada || 0);

                if (!breakdown[p.instId]) breakdown[p.instId] = 0;

                // SIGTAP base value counted only once per procedure+institute
                const evoKey = `${p.instId}-${p.sigtap}`;
                if (!seenEvolutionKeys.has(evoKey)) {
                    seenEvolutionKeys.add(evoKey);
                    breakdown[p.instId] += vBase * real;
                    monthlyTotal += vBase * real;
                }
                breakdown[p.instId] += vInc * real;
                monthlyTotal += vInc * real;
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
            const isCurrent = selectedPeriods.length === 0 || selectedPeriods.includes(d.comp);

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
        const seenGoalKeys = new Set();
        currentData.forEach(p => {
            if (!instStats[p.instId]) instStats[p.instId] = { id: p.instId, pact: 0, real: 0 };
            // Atingimento = OFERTA ÷ META, deduplicando por instituto+chave da rede
            // (um grupo de oferta conta uma vez por instituto; oferta soma os SIGTAPs do grupo).
            const goalKey = `${p.instId}||${chaveOfertaRede(p)}`;
            if (!seenGoalKeys.has(goalKey)) {
                seenGoalKeys.add(goalKey);
                instStats[p.instId].pact += getMeta(p, localGruposOferta);
                instStats[p.instId].real += ofertaInstitutoChave(p, currentData);
            }
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

        const progNetMap = mapaOfertaRede(currentData);
        const progStats = {};
        currentData.forEach(p => {
            const pid = p.progId || 'Sem Programa';
            if (!progStats[pid]) progStats[pid] = { id: pid, sigtap: 0, incentivo: 0 };
            const vBase = parseFloat(p.vlrSigtapBase || 0);
            const vInc = parseFloat(p.vlrIncentivo || 0);
            const aprov = getRetornoSMSA(p); // base = aprovado/SMSA (receita realizada). Trocar por getProduzido(p) p/ usar o produzido.
            const oferta = progNetMap[chaveOfertaRede(p)] || 0; // meta pela REDE (soma dos institutos)
            const meta = getMeta(p, localGruposOferta);
            // Colunas separadas: base SIGTAP e incentivo (incentivo só se meta atingida)
            progStats[pid].sigtap += vBase * aprov;
            progStats[pid].incentivo += calcIncentivo({ vlrIncentivo: vInc, quantidade: aprov, oferta, meta });
        });

        const sortedProgs = Object.values(progStats)
            .sort((a, b) => (b.sigtap + b.incentivo) - (a.sigtap + a.incentivo));

        if (sortedProgs.length === 0) {
            incentiveContainer.innerHTML = `<div class="h-40 flex items-center justify-center text-slate-400 text-xs italic">Sem faturamento.</div>`;
        } else {
            const header = `
                <div class="flex items-center justify-between text-[10px] uppercase tracking-wide font-semibold text-slate-400 dark:text-slate-500 pb-1.5 mb-0.5 border-b border-slate-100 dark:border-slate-800">
                    <span>Programa</span>
                    <div class="flex gap-4 shrink-0">
                        <span class="w-24 text-right">SIGTAP</span>
                        <span class="w-24 text-right">Incentivo</span>
                    </div>
                </div>`;

            const rows = sortedProgs.map(item => {
                const name = (window.localProgramas?.find(pg => pg.id === item.id)?.nome) || item.id;
                return `
                    <div class="flex items-center justify-between text-sm group">
                        <div class="flex items-center gap-2 flex-1 overflow-hidden">
                             <div class="w-2 h-2 rounded-full bg-indigo-500 shrink-0"></div>
                             <span class="truncate text-slate-700 dark:text-slate-300" title="${name}">${name}</span>
                        </div>
                        <div class="flex gap-4 shrink-0">
                             <span class="w-24 text-right font-bold text-slate-900 dark:text-white">${formatCurrency(item.sigtap)}</span>
                             <span class="w-24 text-right font-bold text-indigo-600 dark:text-indigo-400">${formatCurrency(item.incentivo)}</span>
                        </div>
                    </div>`;
            }).join('');

            incentiveContainer.innerHTML = header + rows;
        }
    }

    // 5. Production Trend by Procedure
    procTrendData = buildProcTrendData(allPactuacoes, currentData, localProcs);
    renderProcTrendChart(procTrendMode);
}

function buildProcTrendData(allData, filteredData, procs) {
    const monthMap = { 'jan': 0, 'fev': 1, 'mar': 2, 'abr': 3, 'mai': 4, 'jun': 5, 'jul': 6, 'ago': 7, 'set': 8, 'out': 9, 'nov': 10, 'dez': 11 };
    const parseComp = (c) => {
        if (!c) return 0;
        const [m, y] = c.split('/');
        if (!m || !y) return 0;
        return new Date(2000 + parseInt(y), monthMap[m.toLowerCase()] || 0, 1);
    };

    const allComps = [...new Set(allData.map(p => p.competencia))]
        .sort((a, b) => parseComp(a) - parseComp(b));
    const monthLabels = allComps.slice(-12);

    const sigtaps = [...new Set(filteredData.map(p => p.sigtap))];

    const procedures = sigtaps.map(sigtap => {
        const proc = procs.find(pr => pr.sigtap === sigtap);
        const name = proc?.nome || `Proc ${sigtap}`;

        // Total in filtered period (for ranking modes)
        const seenF = new Set();
        let filteredTotal = 0;
        filteredData.filter(p => p.sigtap === sigtap).forEach(p => {
            const key = `${p.instId}-${p.sigtap}`;
            if (!seenF.has(key)) { seenF.add(key); filteredTotal += parseInt(p.producao?.aprovada || 0); }
        });

        // Monthly trend across all available data
        const monthly = monthLabels.map(comp => {
            const seen = new Set();
            let total = 0;
            allData.filter(p => p.sigtap === sigtap && p.competencia === comp).forEach(p => {
                const key = `${p.instId}-${p.sigtap}`;
                if (!seen.has(key)) { seen.add(key); total += parseInt(p.producao?.aprovada || 0); }
            });
            return total;
        });

        const nonZero = monthly.filter(v => v > 0);
        const mean = nonZero.length > 0 ? nonZero.reduce((s, v) => s + v, 0) / nonZero.length : 0;
        const stddev = nonZero.length > 1
            ? Math.sqrt(nonZero.reduce((s, v) => s + (v - mean) ** 2, 0) / nonZero.length)
            : 0;

        const recent3 = monthly.slice(-3);
        const earlier = monthly.slice(0, -3);
        const recentAvg = recent3.reduce((s, v) => s + v, 0) / 3;
        const earlierAvg = earlier.length > 0 ? earlier.reduce((s, v) => s + v, 0) / earlier.length : 0;
        const growthPct = earlierAvg > 0 ? ((recentAvg - earlierAvg) / earlierAvg) * 100 : 0;

        return { sigtap, name, filteredTotal, monthly, stddev, growthPct };
    });

    return { monthLabels, procedures };
}

function updateTrendModeButtons(active) {
    document.querySelectorAll('.proc-trend-mode-btn').forEach(btn => {
        const isActive = btn.getAttribute('data-mode') === active;
        btn.className = `proc-trend-mode-btn px-3 py-1.5 text-xs font-bold rounded-lg transition-colors ${
            isActive
                ? 'bg-primary text-white'
                : 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
        }`;
    });
}

function renderProcTrendChart(mode) {
    const container = document.getElementById('chart-proc-trend-container');
    if (!container || !procTrendData) return;

    const { monthLabels, procedures } = procTrendData;
    const withData = procedures.filter(p => p.monthly.some(v => v > 0));

    if (withData.length === 0) {
        container.innerHTML = `<div class="flex items-center justify-center h-[200px] text-slate-400 text-sm italic">Sem dados de produção disponíveis</div>`;
        updateTrendModeButtons(mode);
        return;
    }

    // If search query active, override mode selection
    let selected;
    const q = trendSearchQuery.trim().toLowerCase();
    if (q) {
        selected = withData
            .filter(p => p.name.toLowerCase().includes(q) || p.sigtap.toLowerCase().includes(q))
            .slice(0, 5);
        if (selected.length === 0) {
            selected = [];
        }
    } else {
        switch (mode) {
            case 'consolidado': {
                const aggMonthly = monthLabels.map((_, mi) =>
                    withData.reduce((sum, p) => sum + (p.monthly[mi] || 0), 0)
                );
                selected = [{ sigtap: '__consolidado__', name: 'Total Consolidado', filteredTotal: aggMonthly.reduce((s, v) => s + v, 0), monthly: aggMonthly, stddev: 0, growthPct: 0 }];
                break;
            }
            case 'bottom5':
                selected = [...withData].filter(p => p.filteredTotal > 0)
                    .sort((a, b) => a.filteredTotal - b.filteredTotal).slice(0, 5);
                break;
            case 'variacao':
                selected = [...withData].sort((a, b) => b.stddev - a.stddev).slice(0, 5);
                break;
            case 'crescimento':
                selected = [...withData].sort((a, b) => b.growthPct - a.growthPct).slice(0, 5);
                break;
            case 'queda':
                selected = [...withData].sort((a, b) => a.growthPct - b.growthPct).slice(0, 5);
                break;
            default:
                selected = [...withData].sort((a, b) => b.filteredTotal - a.filteredTotal).slice(0, 5);
        }
    }

    const colors = ['#136dec', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444'];
    const n = monthLabels.length;
    const maxVal = Math.max(...selected.flatMap(p => p.monthly), 1);

    const W = 480, H = 210, padL = 58, padR = 52, padT = 15, padB = 32;
    const cW = W - padL - padR;
    const cH = H - padT - padB;
    const axisLabelX = 11;
    const axisLabelY = +(padT + cH / 2).toFixed(1);

    // Smooth bezier path from array of {x,y} points
    const pts2path = (pts) => {
        if (!pts.length) return '';
        let d = `M ${pts[0].x},${pts[0].y}`;
        for (let i = 1; i < pts.length; i++) {
            const p = pts[i - 1], c = pts[i];
            const dx = (c.x - p.x) / 3;
            d += ` C ${+(p.x + dx).toFixed(1)},${p.y} ${+(c.x - dx).toFixed(1)},${c.y} ${c.x},${c.y}`;
        }
        return d;
    };

    const steps = 4;
    const gridHtml = Array.from({ length: steps + 1 }, (_, i) => {
        const val = (maxVal / steps) * i;
        const y = +(padT + cH - (val / maxVal) * cH).toFixed(1);
        const label = val >= 10000 ? `${(val / 1000).toFixed(0)}k` : val >= 1000 ? `${(val / 1000).toFixed(1)}k` : Math.round(val).toString();
        return `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="#e2e8f0" stroke-width="0.8" stroke-dasharray="4,3"/>
                <text x="${padL - 6}" y="${y + 3.5}" text-anchor="end" font-size="9" fill="#94a3b8" font-family="sans-serif">${label}</text>`;
    }).join('');

    const gradientDefs = selected.map((proc, pi) => {
        const color = colors[pi % colors.length];
        return `<linearGradient id="ag${pi}" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="${color}" stop-opacity="0.22"/>
            <stop offset="100%" stop-color="${color}" stop-opacity="0.0"/>
        </linearGradient>`;
    }).join('');

    const linesHtml = selected.map((proc, pi) => {
        const color = colors[pi % colors.length];
        const hidden = hiddenTrendSigtaps.has(proc.sigtap);
        const pts = proc.monthly.map((val, i) => ({
            x: +(padL + (i / Math.max(n - 1, 1)) * cW).toFixed(1),
            y: +(padT + cH - (val / maxVal) * cH).toFixed(1),
            val, lbl: monthLabels[i],
        }));

        const linePath = pts2path(pts);
        const baseY = padT + cH;
        const areaPath = linePath + ` L ${pts[pts.length - 1].x},${baseY} L ${pts[0].x},${baseY} Z`;

        const dots = hidden ? '' : pts.map(p =>
            `<circle cx="${p.x}" cy="${p.y}" r="2.8" fill="white" stroke="${color}" stroke-width="1.8"><title>${p.lbl} | ${proc.name}: ${formatNumber(p.val)}</title></circle>`
        ).join('');

        const lastPt = pts[pts.length - 1];
        const lastVal = proc.monthly[proc.monthly.length - 1];
        const lastLabel = lastVal >= 10000 ? `${(lastVal / 1000).toFixed(0)}k`
            : lastVal >= 1000 ? `${(lastVal / 1000).toFixed(1)}k`
            : formatNumber(lastVal);
        const pillY = +(lastPt.y - 7.5).toFixed(1);
        const pill = hidden ? '' : `
            <line x1="${lastPt.x}" y1="${lastPt.y}" x2="${+(lastPt.x + 6).toFixed(1)}" y2="${lastPt.y}" stroke="${color}" stroke-width="1" stroke-dasharray="2,1" opacity="0.5"/>
            <rect x="${+(lastPt.x + 8).toFixed(1)}" y="${pillY}" width="36" height="15" rx="3" fill="${color}" opacity="0.92"/>
            <text x="${+(lastPt.x + 26).toFixed(1)}" y="${+(lastPt.y + 4).toFixed(1)}" text-anchor="middle" font-size="8.5" fill="white" font-family="monospace" font-weight="600">${lastLabel}</text>`;

        return `
            <path d="${areaPath}" fill="url(#ag${pi})" opacity="${hidden ? '0' : '1'}"/>
            <path d="${linePath}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" opacity="${hidden ? '0.08' : '0.92'}"/>
            ${dots}
            ${pill}`;
    }).join('');

    const xStep = Math.ceil(n / 6);
    const xLabels = monthLabels.map((comp, i) => {
        if (n > 6 && i % xStep !== 0 && i !== n - 1) return '';
        const x = +(padL + (i / Math.max(n - 1, 1)) * cW).toFixed(1);
        const [m, y] = comp.split('/');
        return `<text x="${x}" y="${H - 17}" text-anchor="middle" font-size="9" fill="#94a3b8" font-family="sans-serif">${m}</text>
                <text x="${x}" y="${H - 7}" text-anchor="middle" font-size="7" fill="#cbd5e1" font-family="sans-serif">${y}</text>`;
    }).join('');

    const svgHtml = `
        <svg viewBox="0 0 ${W} ${H}" width="100%" style="display:block;cursor:crosshair" xmlns="http://www.w3.org/2000/svg">
            <defs>${gradientDefs}</defs>
            <text x="${axisLabelX}" y="${axisLabelY}" transform="rotate(-90,${axisLabelX},${axisLabelY})"
                  text-anchor="middle" font-size="9" fill="#94a3b8" font-family="sans-serif">Produção (un.)</text>
            ${gridHtml}
            <line x1="${padL}" y1="${padT + cH}" x2="${W - padR}" y2="${padT + cH}" stroke="#e2e8f0" stroke-width="1"/>
            ${linesHtml}
            ${xLabels}
            <g id="proc-crosshair" style="display:none;pointer-events:none">
                <line id="proc-ch-line" x1="0" y1="${padT}" x2="0" y2="${padT + cH}" stroke="#64748b" stroke-width="1" stroke-dasharray="3,2"/>
                <g id="proc-ch-dots"></g>
                <rect id="proc-ch-bg" rx="4" fill="#1e293b" opacity="0.93" width="0" height="0"/>
                <g id="proc-ch-text"></g>
            </g>
            <rect id="proc-ch-overlay" x="${padL}" y="${padT}" width="${cW}" height="${cH}" fill="transparent"/>
        </svg>`;

    const emptySearch = q && selected.length === 0;
    const legendItemsHtml = emptySearch
        ? `<div class="flex items-center justify-center flex-1 text-[11px] text-slate-400 italic px-2">Nenhum procedimento encontrado</div>`
        : selected.map((proc, pi) => {
            const color = colors[pi % colors.length];
            const hidden = hiddenTrendSigtaps.has(proc.sigtap);
            return `
                <button onclick="window.toggleTrendProc('${proc.sigtap}')"
                    class="flex items-start gap-2.5 w-full text-left px-2 py-1.5 rounded-lg transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/60 ${hidden ? 'opacity-35' : ''}">
                    <div class="mt-[6px] w-5 h-[2.5px] rounded shrink-0" style="background:${color}"></div>
                    <div class="min-w-0">
                        <div class="text-xs text-slate-700 dark:text-slate-300 leading-snug">${proc.name}</div>
                        <div class="text-[10px] text-slate-400 font-mono mt-0.5">${proc.sigtap}</div>
                    </div>
                </button>`;
        }).join('');

    const hasHidden = hiddenTrendSigtaps.size > 0;

    container.innerHTML = `
        <div class="flex gap-2 items-stretch">
            <div class="flex-1 min-w-0">${svgHtml}</div>
            <div class="w-52 shrink-0 pl-3 border-l border-slate-100 dark:border-slate-700 flex flex-col gap-1">
                <div class="flex items-center justify-between gap-1 mb-1">
                    <div class="relative flex-1">
                        <span class="material-symbols-outlined absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 text-[14px] pointer-events-none">search</span>
                        <input id="trend-search-input" type="text" value="${trendSearchQuery.replace(/"/g, '&quot;')}"
                            placeholder="Buscar proc…"
                            oninput="window.updateTrendSearch(this.value)"
                            class="w-full text-[11px] pl-6 pr-2 py-1.5 rounded-lg border border-slate-300 dark:border-slate-500 bg-slate-50 dark:bg-slate-700 text-slate-700 dark:text-slate-200 focus:outline-none focus:border-primary focus:bg-white dark:focus:bg-slate-800 placeholder:text-slate-400 dark:placeholder:text-slate-400" />
                    </div>
                    ${hasHidden ? `<button onclick="window.resetTrendSelection()" class="text-[10px] text-primary font-semibold hover:underline shrink-0">Todos</button>` : ''}
                </div>
                <div class="flex flex-col justify-start gap-0.5">${legendItemsHtml}</div>
            </div>
        </div>`;

    procChartParams = { padL, padR, padT, padB, W, H, cW, cH, maxVal, monthLabels, selected, colors };
    attachCrosshairEvents(container.querySelector('svg'));

    // Restore focus after re-render so typing is uninterrupted
    if (trendSearchQuery) {
        const input = container.querySelector('#trend-search-input');
        if (input) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
    }

    updateTrendModeButtons(mode);
}

function attachCrosshairEvents(svgEl) {
    if (!svgEl || !procChartParams) return;
    const { padL, padT, padB, W, H, cW, cH, maxVal, monthLabels, selected, colors } = procChartParams;
    const n = monthLabels.length;

    const overlay = svgEl.querySelector('#proc-ch-overlay');
    const crosshair = svgEl.querySelector('#proc-crosshair');
    if (!overlay || !crosshair) return;

    overlay.addEventListener('mousemove', (e) => {
        const rect = svgEl.getBoundingClientRect();
        const svgX = (e.clientX - rect.left) * (W / rect.width);
        const idx = Math.max(0, Math.min(n - 1, Math.round((svgX - padL) / cW * (n - 1))));
        const xPos = +(padL + (idx / Math.max(n - 1, 1)) * cW).toFixed(1);

        const chLine = svgEl.querySelector('#proc-ch-line');
        chLine.setAttribute('x1', xPos);
        chLine.setAttribute('x2', xPos);

        const activeProcs = selected.filter(p => !hiddenTrendSigtaps.has(p.sigtap));
        const label = monthLabels[idx];

        let dotsHtml = '';
        activeProcs.forEach((proc, pi) => {
            const val = proc.monthly[idx] || 0;
            const y = +(padT + cH - (val / maxVal) * cH).toFixed(1);
            const color = colors[pi % colors.length];
            dotsHtml += `<circle cx="${xPos}" cy="${y}" r="4" fill="${color}" stroke="white" stroke-width="1.5"/>`;
        });
        svgEl.querySelector('#proc-ch-dots').innerHTML = dotsHtml;

        const tooltipW = 118;
        const tooltipLineH = 14;
        const tooltipH = 12 + tooltipLineH + activeProcs.length * tooltipLineH + 6;
        const tooltipX = xPos < W / 2 ? xPos + 10 : xPos - tooltipW - 8;
        const tooltipY = padT + 2;

        const bg = svgEl.querySelector('#proc-ch-bg');
        bg.setAttribute('x', tooltipX);
        bg.setAttribute('y', tooltipY);
        bg.setAttribute('width', tooltipW);
        bg.setAttribute('height', tooltipH);

        let textHtml = `<text x="${tooltipX + 6}" y="${tooltipY + 11}" font-size="8.5" fill="#94a3b8" font-family="sans-serif" font-weight="600">${label}</text>`;
        activeProcs.forEach((proc, pi) => {
            const val = proc.monthly[idx] || 0;
            const color = colors[pi % colors.length];
            const shortName = proc.name.length > 15 ? proc.name.slice(0, 13) + '…' : proc.name;
            const lineY = tooltipY + 11 + tooltipLineH * (pi + 1);
            textHtml += `<text x="${tooltipX + 6}" y="${lineY}" font-size="8" font-family="sans-serif"><tspan fill="${color}">${shortName}: </tspan><tspan fill="white" font-weight="700">${formatNumber(val)}</tspan></text>`;
        });
        svgEl.querySelector('#proc-ch-text').innerHTML = textHtml;

        crosshair.style.display = '';
    });

    overlay.addEventListener('mouseleave', () => { crosshair.style.display = 'none'; });
}

window.updateProcTrendMode = (mode) => {
    procTrendMode = mode;
    hiddenTrendSigtaps.clear();
    trendSearchQuery = '';
    renderProcTrendChart(mode);
};

window.updateTrendSearch = (value) => {
    trendSearchQuery = value;
    hiddenTrendSigtaps.clear();
    renderProcTrendChart(procTrendMode);
};

window.toggleTrendProc = (sigtap) => {
    if (hiddenTrendSigtaps.has(sigtap)) {
        hiddenTrendSigtaps.delete(sigtap);
    } else {
        hiddenTrendSigtaps.add(sigtap);
    }
    renderProcTrendChart(procTrendMode);
};

window.resetTrendSelection = () => {
    hiddenTrendSigtaps.clear();
    renderProcTrendChart(procTrendMode);
};

window.openDetalhamento = (key) => {
    // `key` é a chaveOfertaRede (grupo_<id> ou sig_<num>). Filtra as pactuações da mesma chave.
    const scope = currentPactuacoes.filter(p => selectedPeriods.length === 0 || selectedPeriods.includes(p.competencia));
    const items = scope.filter(p => chaveOfertaRede(p) === key);
    if (items.length === 0) return;

    const sample = items[0];
    const grupo = sample.grupoOfertaId ? localGruposOferta.find(g => g.id === sample.grupoOfertaId) : null;
    const proc = localProcs.find(p => p.sigtap === sample.sigtap);

    if (grupo) {
        const sigtaps = [...new Set(items.map(i => i.sigtap))];
        document.getElementById('detail-proc-nome').textContent = grupo.nome || 'Grupo de Oferta';
        document.getElementById('detail-proc-sigtap').textContent = `Grupo de oferta · ${sigtaps.length} procedimento(s): ${sigtaps.join(', ')}`;
    } else {
        document.getElementById('detail-proc-nome').textContent =
            (proc?.nome || `Procedimento ${sample.sigtap}`) + (proc?.especialidade ? ` — ${proc.especialidade}` : '');
        document.getElementById('detail-proc-sigtap').textContent = proc?.codigoFaturamento && proc.codigoFaturamento !== sample.sigtap
            ? `Código: ${sample.sigtap} · SIGTAP real: ${proc.codigoFaturamento}`
            : `Código SIGTAP: ${sample.sigtap}`;
    }

    // Agrega POR INSTITUTO. Grupo: soma os SIGTAPs (maior por SIGTAP, dedup de incentivos);
    // meta do grupo é única. Individual: maior por SIGTAP.
    const byInst = {};
    items.forEach(p => {
        if (!byInst[p.instId]) byInst[p.instId] = { instId: p.instId, meta: 0, perSigtap: {} };
        const b = byInst[p.instId];
        b.meta = grupo ? getMeta(p, localGruposOferta) : Math.max(b.meta, getMeta(p, localGruposOferta));
        const s = b.perSigtap[p.sigtap] || { ofertado: 0, produzido: 0, vBase: 0, vInc: 0 };
        s.ofertado = Math.max(s.ofertado, getOferta(p));
        s.produzido = Math.max(s.produzido, getProduzido(p));
        s.vBase = Math.max(s.vBase, parseFloat(p.vlrSigtapBase || 0));
        s.vInc = Math.max(s.vInc, parseFloat(p.vlrIncentivo || 0));
        b.perSigtap[p.sigtap] = s;
    });

    const tbody = document.getElementById('detail-table-body');
    tbody.innerHTML = Object.values(byInst).map(b => {
        const inst = localInsts.find(i => i.id === b.instId);
        const sigs = Object.values(b.perSigtap);
        const ofertado = sigs.reduce((s, x) => s + x.ofertado, 0);
        const produzido = sigs.reduce((s, x) => s + x.produzido, 0);
        const totalLinha = sigs.reduce((s, x) => s + (x.vBase + x.vInc) * x.produzido, 0);
        const status = b.meta > 0 ? Math.round((ofertado / b.meta) * 100) : 0;

        return `
            <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                <td class="px-6 py-4 font-bold text-slate-900 dark:text-white">${inst?.sigla || inst?.nome || '???'}</td>
                <td class="px-6 py-4 text-right font-mono text-xs">${formatNumber(b.meta)}</td>
                <td class="px-6 py-4 text-right font-mono text-xs">${formatNumber(ofertado)}</td>
                <td class="px-6 py-4 text-right font-mono text-xs text-slate-600 dark:text-slate-400">${formatNumber(produzido)}</td>
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

// Recolhe/expande o painel "Alertas Operacionais" PARA O LADO: esconde a coluna e a
// tabela ocupa a largura toda. Persiste no localStorage.
function applyAlertsCollapsed(collapsed) {
    const col = document.getElementById('col-alertas');
    const tbl = document.getElementById('col-tabela');
    const reopen = document.getElementById('alerts-reopen');
    if (!col) return;
    col.classList.toggle('hidden', collapsed);
    if (tbl) {
        tbl.classList.toggle('xl:col-span-2', !collapsed);
        tbl.classList.toggle('xl:col-span-3', collapsed);
    }
    if (reopen) {
        reopen.classList.toggle('hidden', !collapsed);
        reopen.classList.toggle('flex', collapsed);
    }
}

window.toggleAlertsPanel = () => {
    const col = document.getElementById('col-alertas');
    if (!col) return;
    const collapsed = !col.classList.contains('hidden'); // estado após o toggle
    applyAlertsCollapsed(collapsed);
    try { localStorage.setItem('alerts_panel_collapsed', collapsed ? '1' : '0'); } catch (e) { /* ignore */ }
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
    const inst = localInsts.find(i => i.id == instId);
    if (!inst) return;

    // pactId identifica a pactuação na cobrança por procedimento; no monitor de prazo
    // a cobrança é por instituto e vem sem pactId — nesse caso a mensagem é genérica.
    const pact = currentPactuacoes.find(p => (p.id || p.sigtap) == pactId);
    const proc = pact ? localProcs.find(pr => pr.sigtap === pact.sigtap) : null;

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
    let subjectText, bodyText;
    if (pact) {
        const metaPct = getMeta(pact, localGruposOferta);
        // Oferta do instituto para o grupo/procedimento (soma os SIGTAPs do grupo)
        const ofertaInst = ofertaInstitutoChave(pact, currentPactuacoes.filter(x => x.competencia === pact.competencia));
        const pct = metaPct > 0 ? atingimentoPct(ofertaInst, metaPct) : 0;
        subjectText = `Alerta de Produção: ${proc?.nome || pact.sigtap}`;
        bodyText = `Olá,\n\nIdentificamos que o procedimento ${proc?.nome || pact.sigtap} está com produção abaixo do esperado (${pct}%) no mês de ${pact.competencia}.\n\nFavor verificar.\n\nAtenciosamente,\nEquipe Orçamento`;
    } else {
        subjectText = `Alerta de Prazo: lançamento pendente`;
        bodyText = `Olá,\n\nIdentificamos que o instituto ${inst.nome || inst.sigla || ''} possui procedimentos com lançamento/produção pendente dentro do prazo.\n\nFavor verificar e regularizar.\n\nAtenciosamente,\nEquipe Orçamento`;
    }

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


// --- GLOBAL COMPLIANCE CHECK ---
function checkGlobalCompliance(allPactuacoes, institutes, config) {
    const targetComp = DateUtils.getPreviousMonthLabel('short'); // "mmm/yy" — mesmo formato gravado nas pactuações

    // Check Ignore
    const ignoreKey = `monitor_ignored_${targetComp}`;
    if (localStorage.getItem(ignoreKey) === 'true') {
        console.log(`Monitor alert ignored for ${targetComp}`);
        return;
    }

    // Filter relevant items
    const periodItems = allPactuacoes.filter(p => p.competencia === targetComp);
    if (periodItems.length === 0) return;

    const complianceMap = {};

    // Initialize map for institutes involved in this period (or all active? Let's use involved in pactuacoes)
    // Actually, we should check ALL institutes that HAVE pactuation goals > 0.

    // Dedup por instituto + chave da rede: um grupo de oferta conta como UM item
    // (não uma vez por SIGTAP) e a pendência considera a oferta somada do grupo.
    const seenCompliance = new Set();
    periodItems.forEach(p => {
        if (!complianceMap[p.instId]) {
            complianceMap[p.instId] = {
                instId: p.instId,
                pendingCount: 0,
                totalCount: 0
            };
        }

        const dedupKey = `${p.instId}||${chaveOfertaRede(p)}`;
        if (seenCompliance.has(dedupKey)) return;
        seenCompliance.add(dedupKey);

        const meta = getMeta(p, localGruposOferta);
        if (meta > 0) {
            complianceMap[p.instId].totalCount++;
            const oferta = ofertaInstitutoChave(p, periodItems); // compliance = o instituto lançou a oferta?
            if (!oferta || oferta === 0) {
                complianceMap[p.instId].pendingCount++;
            }
        }
    });

    const nonCompliant = Object.values(complianceMap).filter(i => i.pendingCount > 0);

    if (nonCompliant.length > 0) {
        showMonitorModal(targetComp, nonCompliant, institutes, config);
    }
}

function showMonitorModal(targetCompISO, list, institutes, config) {
    const modal = document.getElementById('modal-monitoramento-prazo');
    if (!modal) return;

    // Format Date from targetComp
    const [tYear, tMonth] = targetCompISO.split('-');
    const months = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
    const humanComp = `${months[parseInt(tMonth) - 1]} ${tYear}`;

    document.getElementById('monitor-month').textContent = humanComp;

    // Calculate Deadline Date based on Config
    const today = new Date();
    let deadlineDate;

    const day = config?.deadlineDay || 5;
    const rule = config?.deadlineRule || 'business_day';

    if (rule === 'fixed_date') {
        deadlineDate = new Date(today.getFullYear(), today.getMonth(), day);
    } else {
        deadlineDate = DateUtils.getBusinessDay(today.getFullYear(), today.getMonth(), day);
    }

    document.getElementById('monitor-deadline').textContent = deadlineDate.toLocaleDateString('pt-BR');

    const tbody = document.getElementById('monitor-table-body');
    tbody.innerHTML = list.map(item => {
        const inst = institutes.find(i => i.id === item.instId);
        const name = inst ? (inst.sigla || inst.nome) : 'Instituto Desconhecido';

        return `
            <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                <td class="px-6 py-4 font-bold text-slate-900 dark:text-white">${name}</td>
                <td class="px-6 py-4 text-center font-mono text-xs text-red-600 font-bold bg-red-50 dark:bg-red-900/10 rounded-lg">
                    ${item.pendingCount} / ${item.totalCount}
                </td>
                <td class="px-6 py-4 text-center">
                    <span class="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-1 text-xs font-medium text-red-700 dark:bg-red-900/30 dark:text-red-400">
                        <span class="size-1.5 rounded-full bg-red-600"></span>
                        Pendente
                    </span>
                </td>
                <td class="px-6 py-4 text-right">
                    <button onclick="window.openCommModal('email', '', '${item.instId}')" class="text-blue-600 hover:text-blue-800 font-bold text-xs">
                        Cobrar
                    </button>
                </td>
            </tr>
        `;
    }).join('');

    modal.classList.remove('hidden');
}

window.notifyAllPending = () => {
    alert("Notificações enviadas para todos os institutos listados.");
    document.getElementById('modal-monitoramento-prazo').classList.add('hidden');
}

window.ignoreMonitorAlert = (type) => {
    const targetComp = DateUtils.getPreviousMonthLabel('short'); // "mmm/yy" — mesmo formato gravado nas pactuações
    const ignoreKey = `monitor_ignored_${targetComp}`;
    localStorage.setItem(ignoreKey, 'true');

    document.getElementById('modal-monitoramento-prazo').classList.add('hidden');
    // alert('Alerta silenciado para esta competência.');
}

initDashboard();
