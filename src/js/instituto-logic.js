import { Repository } from './repository.js';
import { auth } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { DateUtils } from './utils/date-utils.js';
import { getOferta, getProduzido, getMeta, atingimentoPct, statusMeta, calcIncentivo, mapaOfertaRede, chaveOfertaRede } from './business-rules.js';

function formatCurrency(value) {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}

function formatNumber(value) {
    return new Intl.NumberFormat('pt-BR').format(value);
}

let currentPactuacoes = [];
let redePactuacoes = []; // rede inteira (todos os institutos) — para avaliar a meta pela rede
let localGruposOferta = [];
let localProcs = [];
let currentPeriod = null;
let userInstId = null;

async function initInstituteDashboard() {
    onAuthStateChanged(auth, async (user) => {
        if (!user) return;

        const profile = await Repository.getUserByEmail(user.email);
        if (!profile || !profile.role.startsWith('Institutos')) {
            console.warn("Acesso não autorizado ou instituto não vinculado.");
            return;
        }

        // --- MULTI-INSTITUTE SUPPORT ---
        const allowedIds = profile.instIds || (profile.instId ? [profile.instId] : []);

        if (allowedIds.length === 0) {
            console.warn('Perfil de Instituto sem vínculos definidos.');
            return;
        }

        // Check for saved selection
        const savedInstId = localStorage.getItem('selectedInstituteId');
        // Validate if saved ID is still allowed, otherwise default to first/all
        if (savedInstId && (savedInstId === 'all' || allowedIds.includes(savedInstId))) {
            userInstId = savedInstId;
        } else {
            // Default behavior: If > 1, show "all", else show the one
            userInstId = allowedIds.length > 1 ? 'all' : allowedIds[0];
        }

        let instituto = null;
        if (userInstId && userInstId !== 'all') {
            instituto = await Repository.getInstitutoById(userInstId);
        }

        // Update UI with institute name
        const welcomeHeader = document.getElementById('inst-welcome-name');
        if (welcomeHeader) welcomeHeader.textContent = `Painel: ${instituto?.sigla || instituto?.nome || 'Multi-Institutos'}`;

        const nameHeader = document.getElementById('user-name-header');
        if (nameHeader) nameHeader.textContent = profile.name || user.email;

        const instHeader = document.getElementById('user-inst-header');
        if (instHeader) instHeader.textContent = instituto?.nome || (userInstId === 'all' ? 'Múltiplos Vínculos' : '-');

        // Update Page Title if "All"
        const pageTitleInst = document.getElementById('inst-page-name');
        if (pageTitleInst && userInstId === 'all') pageTitleInst.textContent = 'Todos os Vinculados';
        else if (pageTitleInst && instituto) pageTitleInst.textContent = instituto.nome;


        setupProfileMenu();

        // --- PROFILE MENU SWITCHER INJECTION ---
        if (allowedIds.length > 1) {
            const institutes = await Repository.getInstitutos();
            const myInsts = institutes.filter(i => allowedIds.includes(i.id));

            // Wait for DOM to be ready or check if dropdown exists
            const profileDropdown = document.getElementById('profile-dropdown');

            if (profileDropdown) {
                // Check if switcher already exists to avoid duplicates
                if (!profileDropdown.querySelector('.inst-switcher-container')) {
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

                    // Add listeners
                    const btns = switcherHtml.querySelectorAll('.inst-switcher-btn');
                    btns.forEach(btn => {
                        btn.addEventListener('click', (e) => {
                            e.stopPropagation();
                            const selectedId = btn.dataset.instId;

                            // SAVE SELECTION
                            localStorage.setItem('selectedInstituteId', selectedId);
                            userInstId = selectedId;

                            if (selectedId === 'all') {
                                currentPactuacoes = allPactuacoes.filter(p => allowedIds.includes(p.instId));
                                document.getElementById('inst-page-name').textContent = 'Todos os Vinculados';
                                document.getElementById('user-inst-header').textContent = 'Múltiplos Vínculos';
                                document.getElementById('inst-welcome-name').textContent = 'Painel: Multi-Institutos';
                            } else {
                                currentPactuacoes = allPactuacoes.filter(p => p.instId === selectedId);
                                const selInst = myInsts.find(i => i.id === selectedId);
                                document.getElementById('inst-page-name').textContent = selInst ? selInst.nome : 'Instituto';
                                document.getElementById('user-inst-header').textContent = selInst ? selInst.nome : '-';
                                document.getElementById('inst-welcome-name').textContent = `Painel: ${selInst?.sigla || '...'}`;
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
                            profileDropdown.classList.add('hidden');

                            // Force re-render of stats
                            renderDashboard();
                        });
                    });
                }
            }
        }

        // Fetch Data
        const allPactuacoes = await Repository.getPactuacoes();
        redePactuacoes = allPactuacoes; // guarda a rede inteira para o gate da meta
        localGruposOferta = await Repository.getGruposOferta();

        // Initial Filter based on stored/determined userInstId
        if (userInstId === 'all') {
            currentPactuacoes = allPactuacoes.filter(p => allowedIds.includes(p.instId));
        } else {
            currentPactuacoes = allPactuacoes.filter(p => p.instId === userInstId);
        }

        localProcs = await Repository.getProcedimentos();

        // Multi-Institute Filter Setup
        const monthSelector = document.getElementById('periodo-select');

        // Populate Month Selector first
        if (monthSelector && currentPactuacoes.length > 0) {
            // Helper for parsing competency (local to ensure availability)
            const parseCompLocal = (comp) => {
                if (!comp) return new Date(0);
                const shortMonths = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
                const parts = comp.toLowerCase().split('/');
                if (parts.length !== 2) return new Date(0);
                const monthIndex = shortMonths.indexOf(parts[0]);
                if (monthIndex === -1) return new Date(0);
                const year = parseInt('20' + parts[1]);
                return new Date(year, monthIndex, 1);
            };

            // Extract unique competencies and sort chronologically (newest first)
            const competencias = [...new Set(currentPactuacoes.map(p => p.competencia))];
            competencias.sort((a, b) => {
                const dateA = parseCompLocal(a);
                const dateB = parseCompLocal(b);
                return dateB - dateA; // Descending (newest first)
            });

            monthSelector.innerHTML = competencias.map(c => `<option value="${c}">${c}</option>`).join('');

            monthSelector.addEventListener('change', (e) => {
                currentPeriod = e.target.value;
                renderDashboard();
            });

            // Mês atual se tiver dados; senão o mais recente com dados
            currentPeriod = DateUtils.competenciaPadrao(competencias);
            monthSelector.value = currentPeriod;
        }

        // Render initially
        renderDashboard();

        // --- DEADLINE ALERT CHECK ---
        const config = await Repository.getSystemConfig();
        const deadlineDay = config?.deadlineDay || 5;
        const deadlineRule = config?.deadlineRule || 'business_day';
        const deadlineAlert = config?.deadlineAlert !== false;

        if (deadlineAlert && DateUtils.isPastDeadline(deadlineDay, deadlineRule)) {
            // Check compliance for ALL allowed institutes (not just the selected one)
            // We want to warn the user if ANY of their institutes is pending.
            const institutes = await Repository.getInstitutos();
            checkDeadlineCompliance(allPactuacoes, allowedIds, institutes, { deadlineDay, deadlineRule });
        }
    });
}

// --- DEADLINE ALERT LOGIC ---
function checkDeadlineCompliance(allPactuacoes, allowedInstIds, allInstitutes, config) {
    const targetComp = DateUtils.getCurrentMonthLabel('short'); // "mmm/yy"

    // Filter pertinent data: Target Month AND User's Institutes
    const relevant = allPactuacoes.filter(p =>
        p.competencia === targetComp &&
        allowedInstIds.includes(p.instId)
    );

    if (relevant.length === 0) return;

    // Identify Pending Items
    // We group by Sigtap + Institute to avoid duplicate alerts for same procedure in different programs
    // Actually, distinct missing items row per institute
    const pendingItems = [];
    const processedKeys = new Set(); // Key: instId_sigtap

    relevant.forEach(p => {
        const key = `${p.instId}_${p.sigtap}`;
        if (processedKeys.has(key)) return;

        // Check the whole group (all programs for this sigtap/inst)
        const groupItems = relevant.filter(i => i.instId === p.instId && i.sigtap === p.sigtap);

        // Max Meta Concept
        const maxMeta = groupItems.reduce((max, i) => Math.max(max, getMeta(i, localGruposOferta)), 0);
        const totalRealized = groupItems.reduce((max, i) => Math.max(max, getOferta(i)), 0);

        if (maxMeta > 0 && totalRealized === 0) {
            pendingItems.push({
                instId: p.instId,
                sigtap: p.sigtap,
                procName: 'Carregando...', // We'll try to look this up or pass procs
                meta: maxMeta
            });
            processedKeys.add(key);
        }
    });

    if (pendingItems.length > 0) {
        showDeadlineAlert(targetComp, pendingItems, allInstitutes, config);
    }
}

function showDeadlineAlert(compLabel, items, allInstitutes, config) {
    const modal = document.getElementById('modal-alert-prazo');
    if (!modal) return;

    // Formatting Date Label
    const [year, month] = compLabel.split('-');
    const months = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
    const humanComp = `${months[parseInt(month) - 1]} ${year}`;

    document.getElementById('alert-month').textContent = humanComp;

    // Calculate Deadline
    const today = new Date();
    let deadlineDate;
    const day = config?.deadlineDay || 5;
    const rule = config?.deadlineRule || 'business_day';

    if (rule === 'fixed_date') {
        deadlineDate = new Date(today.getFullYear(), today.getMonth(), day);
    } else {
        deadlineDate = DateUtils.getBusinessDay(today.getFullYear(), today.getMonth(), day);
    }

    document.getElementById('alert-deadline').textContent = deadlineDate.toLocaleDateString('pt-BR');

    // Render Items
    const tbody = document.getElementById('alert-table-body');
    // Need proc names. Relying on localProcs global (if available) or finding unique logic.
    // 'localProcs' is available in global scope of this file.

    tbody.innerHTML = items.map(item => {
        const inst = allInstitutes.find(i => i.id === item.instId);
        const instName = inst ? (inst.sigla || inst.nome) : 'Inst.';
        const proc = localProcs.find(pr => pr.sigtap === item.sigtap);
        const procName = proc ? proc.nome : `Procedimento ${item.sigtap}`;

        // If user has multiple institutes, show Institute Name clearly.
        const showInst = items.some(i => i.instId !== items[0].instId);

        return `
            <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                <td class="px-4 py-3 font-mono text-slate-500 text-xs">${item.sigtap}</td>
                <td class="px-4 py-3">
                    <div class="flex flex-col">
                        <span class="text-sm font-bold text-slate-800 dark:text-white">${procName}</span>
                         ${showInst ? `<span class="text-[10px] text-slate-500 font-bold uppercase tracking-wider">${instName}</span>` : ''}
                    </div>
                </td>
                <td class="px-4 py-3 text-center">
                    <span class="inline-flex items-center gap-1 rounded-full bg-red-100 px-2.5 py-1 text-xs font-medium text-red-700 dark:bg-red-900/40 dark:text-red-400">
                        <span class="size-1.5 rounded-full bg-red-600"></span> Pendente
                    </span>
                </td>
            </tr>
        `;
    }).join('');

    modal.classList.remove('hidden');
}

async function renderDashboard() {
    // 1. Determine Current and Previous Periods
    const uniqueCompetencias = [...new Set(currentPactuacoes.map(p => p.competencia))].sort((a, b) => DateUtils.parseCompetencia(b) - DateUtils.parseCompetencia(a)); // ordena cronologicamente, mais recente primeiro
    const currentIndex = uniqueCompetencias.indexOf(currentPeriod);
    const prevPeriod = currentIndex !== -1 && currentIndex + 1 < uniqueCompetencias.length ? uniqueCompetencias[currentIndex + 1] : null;

    // 2. Helper to calculate stats for a specific period
    const getStats = (period) => {
        if (!period) return { pact: 0, real: 0, fin: 0, items: 0 };
        const data = currentPactuacoes.filter(p => p.competencia === period);
        // Oferta da REDE (soma de todos os institutos) para avaliar a meta — nunca por instituto.
        const netMap = mapaOfertaRede(redePactuacoes.filter(p => p.competencia === period));
        // Deduplica por sigtap+instituto (considerar a maior); atingimento = OFERTA DA REDE ÷ META
        const byKey = {};
        data.forEach(p => {
            const k = `${p.sigtap}-${p.instId}`;
            if (!byKey[k]) byKey[k] = { meta: 0, oferta: 0, prod: 0, vBase: 0, vInc: 0, chave: chaveOfertaRede(p) };
            byKey[k].meta = Math.max(byKey[k].meta, getMeta(p, localGruposOferta));
            byKey[k].oferta = Math.max(byKey[k].oferta, getOferta(p));
            byKey[k].prod = Math.max(byKey[k].prod, getProduzido(p));
            byKey[k].vBase = Math.max(byKey[k].vBase, parseFloat(p.vlrSigtapBase || 0));
            byKey[k].vInc = Math.max(byKey[k].vInc, parseFloat(p.vlrIncentivo || 0));
        });
        let pact = 0, real = 0, fin = 0;
        Object.values(byKey).forEach(v => {
            pact += v.meta;
            real += v.oferta;
            fin += v.vBase * v.prod + calcIncentivo({ vlrIncentivo: v.vInc, quantidade: v.prod, oferta: netMap[v.chave] || 0, meta: v.meta });
        });
        return { pact, real, fin, items: data.length };
    };

    const curStats = getStats(currentPeriod);
    const prevStats = getStats(prevPeriod);

    // 3. Logic for Critical Items (Split: Not Started vs In Progress)
    let notStartedItems = 0;
    let inProgressItems = 0;

    // Using filtered (Current Period)
    const filtered = currentPactuacoes.filter(p => p.competencia === currentPeriod);
    filtered.forEach(p => {
        const pact = getMeta(p, localGruposOferta);
        const oferta = getOferta(p);
        const atingimento = pact > 0 ? (oferta / pact) * 100 : 100;

        if (pact > 0) {
            if (oferta === 0) {
                notStartedItems++;
            } else if (atingimento < 100) {
                inProgressItems++;
            }
        }
    });

    // 4. Update UI - Main Numbers
    const statOfertas = document.getElementById('stat-ofertas-qtd');
    if (statOfertas) statOfertas.textContent = formatNumber(curStats.pact);

    const curAtingimento = curStats.pact > 0 ? (curStats.real / curStats.pact) * 100 : 0;
    const prevAtingimento = prevStats.pact > 0 ? (prevStats.real / prevStats.pact) * 100 : 0;

    document.getElementById('stat-progress-val').textContent = Math.round(curAtingimento) + '%';
    document.getElementById('stat-progress-bar').style.width = Math.min(curAtingimento, 100) + '%';

    // --- Card 3: Não Iniciados ---
    const cardNotStarted = document.getElementById('card-not-started');
    const iconNotStarted = document.getElementById('icon-not-started');
    const labelNotStarted = document.getElementById('label-not-started');

    if (cardNotStarted && iconNotStarted && labelNotStarted) {
        document.getElementById('stat-not-started-val').textContent = notStartedItems;

        if (notStartedItems === 0 && filtered.length > 0) {
            // Celebration Mode 🎉
            iconNotStarted.className = 'p-2 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg text-emerald-600 dark:text-emerald-400';
            iconNotStarted.innerHTML = '<span class="material-symbols-outlined">check_circle</span>';
            labelNotStarted.className = 'text-emerald-700 dark:text-emerald-400 text-xs font-bold bg-emerald-100 dark:bg-emerald-900/30 px-2 py-0.5 rounded-full';
            labelNotStarted.textContent = 'Tudo iniciado! Parabéns 👏';
        } else {
            // Default Critical Mode 🚨
            iconNotStarted.className = 'p-2 bg-red-50 dark:bg-red-900/20 rounded-lg text-red-600 dark:text-red-400';
            iconNotStarted.innerHTML = '<span class="material-symbols-outlined">error</span>';
            labelNotStarted.className = 'text-red-600 dark:text-red-400 text-xs font-medium bg-red-50 dark:bg-red-900/20 px-2 py-0.5 rounded-md';
            labelNotStarted.textContent = 'Requer atenção imediata';
        }
    }

    // --- Card 4: Em Andamento ---
    const cardInProgress = document.getElementById('card-in-progress');
    const iconInProgress = document.getElementById('icon-in-progress');

    if (cardInProgress && iconInProgress) {
        document.getElementById('stat-in-progress-val').textContent = inProgressItems;

        if (inProgressItems === 0 && notStartedItems === 0 && filtered.length > 0) {
            iconInProgress.className = 'p-2 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg text-emerald-600 dark:text-emerald-400';
            iconInProgress.innerHTML = '<span class="material-symbols-outlined">task_alt</span>';
        } else {
            iconInProgress.className = 'p-2 bg-amber-50 dark:bg-amber-900/20 rounded-lg text-amber-600 dark:text-amber-400';
            iconInProgress.innerHTML = '<span class="material-symbols-outlined">pending_actions</span>';
        }
    }

    // 5. Update Comparison Pills (Trends)
    updateTrendPill('trend-ofertas', curStats.items, prevStats.items, 'itens');
    updateTrendPill('trend-progress', curAtingimento, prevAtingimento, '% pontos');
    // Removed Trend Financeiro pill update

    // Populate Table (Items with Prazos/Stats)
    const tbody = document.getElementById('table-prazos-itens');
    // FIX: Method name is getProgramas (Portuguese)
    const localProgramas = await Repository.getProgramas();

    if (tbody) {
        if (filtered.length === 0) {
            tbody.innerHTML = `<tr><td colspan="2" class="px-6 py-10 text-center text-slate-400 italic">Nenhum dado encontrado para este período.</td></tr>`;
        } else {
            tbody.innerHTML = filtered.map(p => {
                const proc = localProcs.find(pr => pr.sigtap === p.sigtap);
                const prog = localProgramas.find(pg => pg.id === p.progId);
                const progName = prog ? prog.nome : (p.progId || 'Incentivo Padrão');

                const pact = getMeta(p, localGruposOferta);
                const real = getOferta(p);
                const status = pact > 0 ? (real / pact) * 100 : 0;

                return `
                    <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors">
                        <td class="px-6 py-4">
                            <div class="flex flex-col">
                                <span class="text-xs font-bold text-primary uppercase tracking-wider mb-0.5">${progName}</span>
                                <span class="text-sm font-semibold text-slate-900 dark:text-white truncate max-w-[280px]" title="${p.nome || proc?.nome || p.sigtap}">${p.nome || proc?.nome || p.sigtap}</span>
                                <span class="text-[10px] text-slate-500 font-mono">${p.sigtap} | Oferta: ${formatNumber(pact)}</span>
                            </div>
                        </td>
                        <td class="px-6 py-4 text-right">
                            <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase ${status >= 100 ? 'bg-emerald-100 text-emerald-800' : status > 75 ? 'bg-amber-100 text-amber-800' : 'bg-red-100 text-red-800'}">
                                ${Math.round(status)}% Atingimento
                            </span>
                        </td>
                    </tr>
                `;
            }).join('');
        }
    }

    renderWeeklyChart();
}

function updateTrendPill(elementId, current, previous, type) {
    const el = document.getElementById(elementId);
    if (!el) return;

    if (previous === 0) {
        el.innerHTML = `<span class="text-slate-400 text-xs">-</span>`; // No data to compare
        return;
    }

    let diff, percent;
    if (type === '% pontos') {
        diff = current - previous; // Absolute difference for percentages
    } else {
        diff = ((current - previous) / previous) * 100;
    }

    const isPositive = diff >= 0;
    const formattedDiff = Math.abs(Math.round(diff));

    // Logic: More items/money/progress is usually good (green), less is bad (red)
    // For specific scenarios logic might invert, but general rule fits.
    const colorClass = isPositive ? 'text-emerald-700 bg-emerald-100 dark:bg-emerald-900/30 dark:text-emerald-400' : 'text-red-700 bg-red-100 dark:bg-red-900/30 dark:text-red-400';
    const icon = isPositive ? 'trending_up' : 'trending_down';

    el.innerHTML = `
        <span class="${colorClass} text-xs font-bold px-2 py-0.5 rounded-full flex items-center gap-1 w-fit">
            <span class="material-symbols-outlined text-[12px]">${icon}</span> ${formattedDiff}%
        </span>
        <p class="text-slate-500 dark:text-slate-400 text-xs">vs mês anterior</p>
    `;
}

function renderWeeklyChart() {
    const container = document.getElementById('chart-bars-container');
    if (!container) return;

    // 1. Filter data for current period
    const filtered = currentPactuacoes.filter(p => p.competencia === currentPeriod);

    // 2. Initialize Weeks
    const weeks = [
        { id: 'sem1', label: 'Sem 1', real: 0, target: 0 },
        { id: 'sem2', label: 'Sem 2', real: 0, target: 0 },
        { id: 'sem3', label: 'Sem 3', real: 0, target: 0 },
        { id: 'sem4', label: 'Sem 4', real: 0, target: 0 },
        { id: 'sem5', label: 'Sem 5', real: 0, target: 0 }
    ];

    // 3. Aggregate Data
    let totalRealizadoPeriodo = 0;

    filtered.forEach(p => {
        const pact = getMeta(p, localGruposOferta);

        // Meta semanal de referência: meta mensal dividida pelo número de semanas exibidas
        const weeklyTarget = pact > 0 ? pact / weeks.length : 0;

        weeks.forEach(w => {
            const val = parseInt(p.producao?.[w.id] || 0);
            w.real += val;
            w.target += weeklyTarget;
        });

        totalRealizadoPeriodo += getOferta(p);
    });

    const totalEl = document.getElementById('chart-total-exams');
    if (totalEl) totalEl.textContent = formatNumber(totalRealizadoPeriodo);

    // 4. Determine Max Scale
    // We want the highest bar (either real or target) to dictate the height
    const maxVal = Math.max(
        ...weeks.map(w => Math.max(w.real, w.target)),
        10 // Minimum scale to avoid empty chart division by zero
    );

    // 5. Render
    container.innerHTML = weeks.map(w => {
        const targetH = maxVal > 0 ? (w.target / maxVal) * 100 : 0;
        const realH = maxVal > 0 ? (w.real / maxVal) * 100 : 0;

        // Capping at 100% just in case
        const renderTargetH = Math.min(targetH, 100);
        const renderRealH = Math.min(realH, 100);
        // Relative to the height of the container, we want the "target" to be the background bar, 
        // but if Real > Target, it overflows? 
        // Better design: Two separate bars side-by-side OR Stacked? 
        // User asked for "Background" as target.
        // If Real > Target, the bar fills completely and maybe changes color?
        // Let's stick to the visual: Gray bar = Target Height. Blue bar = Real Height.
        // Both start from button.

        return `
            <div class="flex flex-col items-center gap-2 h-full justify-end group cursor-pointer relative w-full">
                <div class="relative w-full max-w-[40px] h-full flex items-end justify-center">
                    <!-- Target Ghost Bar -->
                    <div class="absolute bottom-0 w-full bg-slate-100 dark:bg-slate-700/50 rounded-t-sm transition-all duration-300 border border-slate-200 dark:border-slate-600 border-dashed" 
                         style="height: ${renderTargetH}%" 
                         title="Meta Esperada: ~${formatNumber(Math.round(w.target))}">
                    </div>
                    
                    <!-- Realized Bar -->
                    <div class="absolute bottom-0 w-3/4 bg-primary rounded-t-sm transition-all duration-500 shadow-sm z-10" 
                         style="height: ${renderRealH}%" 
                         title="Realizado: ${formatNumber(w.real)}">
                    </div>
                </div>
                
                <div class="flex flex-col items-center z-20">
                    <p class="text-[10px] font-bold text-slate-500 dark:text-slate-400">${w.label}</p>
                    <p class="text-[9px] font-bold text-primary">${formatNumber(w.real)}</p>
                </div>
            </div>
        `;
    }).join('');
}

function setupProfileMenu() {
    const btn = document.getElementById('profile-menu-btn');
    const dropdown = document.getElementById('profile-dropdown');
    const logoutBtn = document.getElementById('logout-btn');

    if (btn && dropdown) {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            dropdown.classList.toggle('hidden');
        });

        document.addEventListener('click', () => {
            dropdown.classList.add('hidden');
        });

        dropdown.addEventListener('click', (e) => {
            e.stopPropagation();
        });
    }

    if (logoutBtn) {
        logoutBtn.addEventListener('click', async () => {
            const { logout } = await import('./auth-guard.js');
            await logout();
        });
    }

    // Sidebar Toggle
    const sidebarToggle = document.getElementById('sidebar-toggle');
    const sidebar = document.querySelector('aside');
    if (sidebarToggle && sidebar) {
        sidebarToggle.addEventListener('click', () => {
            sidebar.classList.toggle('hidden');
        });
    }
}

// Start
initInstituteDashboard();
