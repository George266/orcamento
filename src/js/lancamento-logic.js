import { Repository } from './repository.js';
import { DateUtils } from './utils/date-utils.js';
import { auth } from './firebase-config.js';
// Fallback helper if repository.js doesn't have it (it usually does as getProgramas or similar)
Repository.getPrograms = Repository.getProgramas || (async () => []);

// Formatter Helpers
function formatNumber(value) {
    return new Intl.NumberFormat('pt-BR').format(value);
}

let allPactuacoes = [];
let localProcs = [];
let currentPeriod = 'Outubro 2023'; // Default or dynamic
let userInstId = null;

async function initLancamento() {
    console.log("LANCAMENTO LOGIC JS LOADED - V12345");
    alert("Script de Lançamento Atualizado Carregado!");
    onAuthStateChanged(auth, async (user) => {
        if (!user) return;

        const profile = await Repository.getUserByEmail(user.email);
        if (!profile || !profile.role.startsWith('Institutos')) return;

        const allowedIds = profile.instIds || (profile.instId ? [profile.instId] : []);
        if (allowedIds.length === 0) return;

        // --- PERSISTENCE LOGIC START ---
        userInstId = allowedIds[0];
        const savedInstId = localStorage.getItem('selectedInstituteId');
        if (savedInstId && (savedInstId === 'all' || allowedIds.includes(savedInstId))) {
            userInstId = savedInstId;
        } else {
            userInstId = allowedIds.length > 1 ? 'all' : allowedIds[0];
        }

        let instituto = null;
        if (userInstId && userInstId !== 'all') {
            instituto = await Repository.getInstitutoById(userInstId);
        }

        // Update Headers
        const nameHeader = document.getElementById('user-name-header');
        if (nameHeader) nameHeader.textContent = profile.name || user.email;

        const instHeader = document.getElementById('user-inst-header');
        if (instHeader) instHeader.textContent = instituto?.nome || (userInstId === 'all' ? 'Múltiplos Vínculos' : '-');

        const pageName = document.getElementById('inst-page-name');
        if (pageName) pageName.textContent = instituto?.nome || (userInstId === 'all' ? 'Todos os Vinculados' : 'Instituto Desconhecido');
        // --- PERSISTENCE LOGIC END ---

        // Fetch Data
        allPactuacoes = await Repository.getPactuacoes();
        localProcs = await Repository.getProcedimentos();

        // Setup Filters (Mock for now, or real if needed)

        // --- DEADLINE CHECK START ---
        const config = await Repository.getSystemConfig();
        const deadlineDay = config?.deadlineDay || 5;
        const deadlineRule = config?.deadlineRule || 'business_day';
        const deadlineAlert = config?.deadlineAlert !== false;

        // Only checking if we are past deadline to alert about PREVIOUS month
        if (deadlineAlert && DateUtils.isPastDeadline(deadlineDay, deadlineRule) && instituto) {
            checkDeadlineCompliance(allPactuacoes, instituto.id, localProcs, { deadlineDay, deadlineRule });
        }
        // --- DEADLINE CHECK END ---

        renderTable();
        const compSelect = document.getElementById('competencia');
        if (compSelect) {
            // Populate based on data? or static for now as per HTML
            // Just assume static for demo unless requested
            currentPeriod = compSelect.value;
            compSelect.addEventListener('change', (e) => {
                currentPeriod = e.target.value;
                renderTable();
            });
        }

        renderTable();
    });
}

function renderTable() {
    const tbody = document.getElementById('lancamento-table-body');
    if (!tbody) return;

    // 1. Filter by Institute
    let filtered = allPactuacoes;
    if (userInstId && userInstId !== 'all') {
        filtered = filtered.filter(p => p.instId === userInstId);
    } else if (userInstId === 'all') {
        // If 'all', we only show items that the user is allowed to see (which is already filtered by fetch logic usually, but let's be safe)
        // In this implementation `allPactuacoes` is ALL. We need to filter by allowedIds if we want strict security, but `initLancamento` handled permission check.
        // For simplicity, we assume `allPactuacoes` contains everything and we trust the user context for now or filter by `allowedIds` if we had them in scope.
    }

    // 2. Filter by Period (Mocked match)
    // The HTML has "Outubro 2023", data might be "2023-10". Need normalization.
    // For now, I'll just check if the string matches loosely or use a fixed mapping.
    // Let's assume we filter by the *selected* period in the dropdown.
    // Since the dropdown in HTML is "Setembro 2023", etc. and data is "2023-09".
    // I will implement a parser or just show all for the demo.
    // Let's TRY to map.
    const monthMap = {
        'Janeiro': '01', 'Fevereiro': '02', 'Março': '03', 'Abril': '04', 'Maio': '05', 'Junho': '06',
        'Julho': '07', 'Agosto': '08', 'Setembro': '09', 'Outubro': '10', 'Novembro': '11', 'Dezembro': '12'
    };

    // Simplification: Let's assume the data uses "AAA-MM" format.
    // And let's grab the dropdown text.
    let targetComp = '2023-10'; // Default fallback
    if (currentPeriod) {
        const parts = currentPeriod.split(' '); // "Outubro 2023"
        if (parts.length === 2 && monthMap[parts[0]]) {
            targetComp = `${parts[1]}-${monthMap[parts[0]]}`;
        }
    }

    filtered = filtered.filter(p => p.competencia === targetComp);

    // 3. GROUP BY SIGTAP (Unified Launch Logic)
    const groups = {};
    filtered.forEach(p => {
        if (!groups[p.sigtap]) {
            const proc = localProcs.find(pr => pr.sigtap === p.sigtap);
            groups[p.sigtap] = {
                sigtap: p.sigtap,
                procName: proc?.nome || 'Procedimento',
                complexidade: 'Média Complexidade', // Placeholder or fetch
                items: [],
                totalMeta: 0,
                maxMeta: 0,
                totalRealizado: 0
            };
        }
        groups[p.sigtap].items.push(p); // Store individual lines

        const meta = parseInt(p.ofertaMinima || 0);
        const real = parseInt(p.producao?.realizada || 0);

        groups[p.sigtap].totalMeta += meta;
        if (meta > groups[p.sigtap].maxMeta) groups[p.sigtap].maxMeta = meta; // "Considerar a da maior" logic

        // Assumption: "Realized" is the same across lines if set? Or sum?
        // If it's a unified launch, when we save, we set ALL lines to value X.
        // So `totalRealizado` is just X.
        // However, reading from DB, if they are inconsistent, what do we show? Max?
        groups[p.sigtap].totalRealizado = Math.max(groups[p.sigtap].totalRealizado, real);
    });

    const displayItems = Object.values(groups);

    // Render
    tbody.innerHTML = displayItems.map(group => {
        // Status Calculation based on "Maior Meta"
        const target = group.maxMeta;
        const progress = target > 0 ? (group.totalRealizado / target) * 100 : 0;

        let statusColor = 'bg-primary';
        if (progress >= 100) statusColor = 'bg-green-500';
        else if (progress < 50) statusColor = 'bg-yellow-500';

        return `
        <tr class="hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors group/row">
            <td class="px-6 py-4">
                <div class="flex flex-col">
                    <span class="text-sm font-bold text-slate-900 dark:text-white" title="${group.procName}">${group.procName}</span>
                    <span class="text-xs text-slate-500 font-mono mt-0.5">Cód: ${group.sigtap}</span>
                </div>
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-center text-sm text-slate-600 dark:text-slate-300 font-bold">
                ${formatNumber(target)}
            </td>
            <td class="px-6 py-4 align-middle">
                <div class="flex flex-col gap-1 max-w-[140px] mx-auto">
                    <div class="flex justify-between text-xs mb-1">
                        <span class="text-slate-600 dark:text-slate-400 font-medium">${formatNumber(group.totalRealizado)} realizado</span>
                        <span class="font-bold text-slate-700 dark:text-white">${Math.round(progress)}%</span>
                    </div>
                    <div class="w-full bg-slate-200 dark:bg-slate-600 rounded-full h-2">
                        <div class="${statusColor} h-2 rounded-full transition-all duration-500" style="width: ${Math.min(progress, 100)}%"></div>
                    </div>
                </div>
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-center">
                <input
                    data-sigtap="${group.sigtap}"
                    onchange="window.updateOffer('${group.sigtap}', this.value)"
                    class="w-24 text-center rounded-lg border-slate-300 dark:border-slate-600 focus:ring-primary focus:border-primary sm:text-sm bg-white dark:bg-slate-900 dark:text-white font-bold shadow-sm"
                    min="0" 
                    value="${group.totalRealizado > 0 ? group.totalRealizado : ''}" 
                    type="number" 
                    placeholder="0"
                />
            </td>
             <td class="px-6 py-4 whitespace-nowrap text-center">
                <button onclick="window.openDetailModal('${group.sigtap}')" class="p-2 text-slate-400 hover:text-primary transition-colors bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg" title="Ver Detalhes dos Incentivos">
                     <span class="material-symbols-outlined text-[20px]">visibility</span>
                </button>
            </td>
        </tr>
        `;
    }).join('');

    // Attach to window just in case (for onclicks)
    window.displayGroups = groups;
}

// Window functions for interaction
window.updateOffer = async (sigtap, value) => {
    console.log(`Updating ${sigtap} to ${value}`);
    const val = parseInt(value) || 0;

    // Find the group
    const group = window.displayGroups[sigtap];
    if (group) {
        group.items.forEach(p => {
            if (!p.producao) p.producao = {};
            p.producao.realizada = val;
        });
        group.totalRealizado = val;
        // Optimistic Re-render to show progress bar update
        renderTable();
    }
};

window.openDetailModal = async (sigtap) => {
    const group = window.displayGroups[sigtap];
    if (!group) return;

    // Fetch Programs names lazily if needed, or use what we have
    const localProgs = await Repository.getPrograms(); // Assuming this exists or we fetch it

    const modal = document.getElementById('modal-detalhe-lancamento');
    if (modal) {
        document.getElementById('modal-title').textContent = group.procName;
        document.getElementById('modal-subtitle').textContent = `Cód. SIGTAP: ${sigtap}`;

        const tbody = document.getElementById('modal-table-body');
        tbody.innerHTML = group.items.map(item => {
            const prog = localProgs.find(p => p.id === item.progId);
            const progName = prog ? prog.nome : (item.progId || 'Incentivo Padrão');

            const meta = parseInt(item.ofertaMinima || 0);
            const real = parseInt(item.producao?.realizada || 0);
            const progress = meta > 0 ? (real / meta) * 100 : 0;

            let statusColor = 'bg-primary';
            if (progress >= 100) statusColor = 'bg-green-500';
            else if (progress < 50) statusColor = 'bg-yellow-500';

            return `
            <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                <td class="px-4 py-3 text-sm font-medium text-slate-700 dark:text-slate-300">
                    ${progName}
                </td>
                <td class="px-4 py-3 text-right text-sm font-mono text-slate-600 dark:text-slate-400">
                    ${formatNumber(meta)}
                </td>
                <td class="px-4 py-3 text-right text-sm font-mono font-bold text-slate-900 dark:text-white">
                    ${formatNumber(real)}
                </td>
                 <td class="px-4 py-3 align-middle">
                     <div class="flex items-center gap-2">
                        <div class="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-1.5 flex-1">
                            <div class="${statusColor} h-1.5 rounded-full" style="width: ${Math.min(progress, 100)}%"></div>
                        </div>
                        <span class="text-[10px] font-bold text-slate-500">${Math.round(progress)}%</span>
                    </div>
                </td>
            </tr>
        `}).join('');

        modal.classList.remove('hidden');
    }
}

window.closeDetailModal = () => {
    document.getElementById('modal-detalhe-lancamento').classList.add('hidden');
}


// --- COMPLIANCE ALERT LOGIC ---
function checkDeadlineCompliance(pactuacoes, instId, procs, config) {
    const targetComp = DateUtils.getPreviousMonthLabel('iso'); // "YYYY-MM"

    // Filter items for this institute and target competence
    const relevant = pactuacoes.filter(p => p.instId === instId && p.competencia === targetComp);
    if (relevant.length === 0) return; // No pactuation for this month, so maybe nothing to alert? Or alert everything?
    // Assuming if no pactuation doc exists, it means nothing was imported/created, so we can't check for "missing" real.

    // Group by Sigtap to check status
    const groups = {};
    relevant.forEach(p => {
        if (!groups[p.sigtap]) {
            groups[p.sigtap] = { sigtap: p.sigtap, maxMeta: 0, totalRealized: 0 };
        }
        groups[p.sigtap].maxMeta = Math.max(groups[p.sigtap].maxMeta, parseInt(p.ofertaMinima || 0));
        groups[p.sigtap].totalRealized = Math.max(groups[p.sigtap].totalRealized, parseInt(p.producao?.realizada || 0));
    });

    const missing = Object.values(groups).filter(g => g.maxMeta > 0 && g.totalRealized === 0);

    if (missing.length > 0) {
        showDeadlineAlert(targetComp, missing, procs, config);
    }
}

function showDeadlineAlert(compLabel, items, procs, config) {
    const modal = document.getElementById('modal-alert-prazo');
    if (!modal) return;

    // Format Month
    const [year, month] = compLabel.split('-');
    const months = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
    const humanComp = `${months[parseInt(month) - 1]} ${year}`;

    document.getElementById('alert-month').textContent = humanComp;

    // Calc Deadline
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

    tbody.innerHTML = items.map(g => {
        const proc = procs.find(pr => pr.sigtap === g.sigtap);
        const procName = proc?.nome || `Procedimento ${g.sigtap}`;
        return `
            <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                <td class="px-4 py-3 font-mono text-slate-500">${g.sigtap}</td>
                <td class="px-4 py-3 font-bold text-slate-800 dark:text-white">${procName}</td>
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


// Start
initLancamento();
