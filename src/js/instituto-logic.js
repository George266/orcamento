import { Repository } from './repository.js';
import { auth } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

function formatCurrency(value) {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}

function formatNumber(value) {
    return new Intl.NumberFormat('pt-BR').format(value);
}

let currentPactuacoes = [];
let localProcs = [];
let currentPeriod = null;
let userInstId = null;

async function initInstituteDashboard() {
    onAuthStateChanged(auth, async (user) => {
        if (!user) return;

        const profile = await Repository.getUserByEmail(user.email);
        if (!profile || profile.role !== 'Institutos' || !profile.instId) {
            console.warn("Acesso não autorizado ou instituto não vinculado.");
            return;
        }

        userInstId = profile.instId;
        const instituto = await Repository.getInstitutoById(userInstId);

        // Update UI with institute name
        const welcomeHeader = document.getElementById('inst-welcome-name');
        if (welcomeHeader) welcomeHeader.textContent = `Painel: ${instituto?.sigla || instituto?.nome || 'Meu Instituto'}`;

        const nameHeader = document.getElementById('user-name-header');
        if (nameHeader) nameHeader.textContent = profile.name || user.email;

        const instHeader = document.getElementById('user-inst-header');
        if (instHeader) instHeader.textContent = instituto?.nome || 'Instituto Vinc.';

        setupProfileMenu();

        // Fetch Data
        const allPactuacoes = await Repository.getPactuacoes();
        currentPactuacoes = allPactuacoes.filter(p => p.instId === userInstId);
        localProcs = await Repository.getProcedimentos();

        const monthSelector = document.getElementById('periodo-select');
        if (monthSelector && currentPactuacoes.length > 0) {
            const competencias = [...new Set(currentPactuacoes.map(p => p.competencia))].sort().reverse();
            monthSelector.innerHTML = competencias.map(c => `<option value="${c}">${c}</option>`).join('');

            monthSelector.addEventListener('change', (e) => {
                currentPeriod = e.target.value;
                renderDashboard();
            });

            currentPeriod = monthSelector.value;
            renderDashboard();
        } else {
            renderDashboard();
        }
    });
}

async function renderDashboard() {
    // 1. Determine Current and Previous Periods
    const uniqueCompetencias = [...new Set(currentPactuacoes.map(p => p.competencia))].sort().reverse(); // e.g. ['ago-2025', 'jul-2025']
    const currentIndex = uniqueCompetencias.indexOf(currentPeriod);
    const prevPeriod = currentIndex !== -1 && currentIndex + 1 < uniqueCompetencias.length ? uniqueCompetencias[currentIndex + 1] : null;

    // 2. Helper to calculate stats for a specific period
    const getStats = (period) => {
        if (!period) return { pact: 0, real: 0, fin: 0, items: 0 };
        const data = currentPactuacoes.filter(p => p.competencia === period);
        let pact = 0, real = 0, fin = 0, items = data.length;
        data.forEach(p => {
            const vBase = parseFloat(p.vlrSigtapBase || 0);
            const vInc = parseFloat(p.vlrIncentivo || 0);
            const r = parseInt(p.producao?.realizada || 0);
            pact += parseInt(p.ofertaMinima || 0);
            real += r;
            fin += (vBase + vInc) * r;
        });
        return { pact, real, fin, items };
    };

    const curStats = getStats(currentPeriod);
    const prevStats = getStats(prevPeriod);

    // 3. Logic for Critical Items (Split: Not Started vs In Progress)
    let notStartedItems = 0;
    let inProgressItems = 0;

    // Using filtered (Current Period)
    const filtered = currentPactuacoes.filter(p => p.competencia === currentPeriod);
    filtered.forEach(p => {
        const pact = parseInt(p.ofertaMinima || 0);
        const real = parseInt(p.producao?.realizada || 0);
        const atingimento = pact > 0 ? (real / pact) * 100 : 100;

        if (pact > 0) {
            if (real === 0) {
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
    if (tbody) {
        if (filtered.length === 0) {
            tbody.innerHTML = `<tr><td colspan="2" class="px-6 py-10 text-center text-slate-400 italic">Nenhum dado encontrado para este período.</td></tr>`;
        } else {
            tbody.innerHTML = filtered.map(p => {
                const proc = localProcs.find(pr => pr.sigtap === p.sigtap);
                const pact = parseInt(p.ofertaMinima || 0);
                const real = parseInt(p.producao?.realizada || 0);
                const status = pact > 0 ? (real / pact) * 100 : 0;

                return `
                    <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors">
                        <td class="px-6 py-4">
                            <div class="flex flex-col">
                                <span class="text-sm font-semibold text-slate-900 dark:text-white truncate max-w-[280px]" title="${p.nome || proc?.nome || p.sigtap}">${p.nome || proc?.nome || p.sigtap}</span>
                                <span class="text-[10px] text-slate-500 font-mono">${p.sigtap} | Oferta: ${formatNumber(pact)}</span>
                            </div>
                        </td>
                        <td class="px-6 py-4 text-right">
                            <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase ${status >= 90 ? 'bg-emerald-100 text-emerald-800' : status >= 70 ? 'bg-amber-100 text-amber-800' : 'bg-red-100 text-red-800'}">
                                ${Math.round(status)}% Atingimento
                            </span>
                        </td>
                    </tr>
                `;
            }).join('');
        }
    }

    renderSemesterChart();
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

function renderSemesterChart() {
    const container = document.getElementById('chart-bars-container');
    if (!container) return;

    const now = new Date();
    const months = [];
    const monthNames = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

    for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const comp = `${monthNames[d.getMonth()].toLowerCase()}-${d.getFullYear()}`;
        months.push({
            id: comp,
            label: monthNames[d.getMonth()],
            year: d.getFullYear()
        });
    }

    let totalPeriodo = 0;
    const statsByMonth = months.map(m => {
        const filtered = currentPactuacoes.filter(p => p.competencia === m.id);
        const pact = filtered.reduce((acc, p) => acc + parseInt(p.ofertaMinima || 0), 0);
        const real = filtered.reduce((acc, p) => acc + parseInt(p.producao?.realizada || 0), 0);
        totalPeriodo += real;
        return { ...m, pact, real };
    });

    const totalEl = document.getElementById('chart-total-exams');
    if (totalEl) totalEl.textContent = formatNumber(totalPeriodo);

    const maxVal = Math.max(...statsByMonth.map(s => s.pact), 100);

    container.innerHTML = statsByMonth.map(s => {
        const pactH = maxVal > 0 ? (s.pact / maxVal) * 100 : 0;
        const realPercent = s.pact > 0 ? (s.real / s.pact) * 100 : 0;
        const realH = Math.min(realPercent, 100);

        return `
            <div class="flex flex-col items-center gap-2 h-full justify-end group cursor-pointer">
                <div class="relative w-full max-w-[40px] bg-blue-100 dark:bg-blue-900/40 rounded-t-sm transition-all duration-300 group-hover:bg-blue-200 dark:group-hover:bg-blue-900/60" 
                     style="height: ${Math.max(pactH, 5)}%" title="Oferta: ${formatNumber(s.pact)}">
                    <div class="absolute bottom-0 w-full bg-primary rounded-t-sm transition-all duration-500" 
                         style="height: ${realH}%" 
                         title="Realizado: ${formatNumber(s.real)} (${Math.round(realPercent)}%)"></div>
                </div>
                <div class="flex flex-col items-center">
                    <p class="text-[10px] font-bold text-slate-500 dark:text-slate-400">${s.label}</p>
                    <p class="text-[8px] text-slate-400">${s.year}</p>
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
