import { Repository } from './repository.js';
import { DateUtils } from './utils/date-utils.js';
import { auth } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

Repository.getPrograms = Repository.getProgramas || (async () => []);

function formatNumber(value) {
    return new Intl.NumberFormat('pt-BR').format(value);
}

let allPactuacoes = [];
let localProcs = [];
let currentPeriod = '';
let userInstId = null;

async function initLancamento() {
    onAuthStateChanged(auth, async (user) => {
        if (!user) return;

        const profile = await Repository.getUserByEmail(user.email);
        if (!profile || !profile.role.startsWith('Institutos')) return;

        const allowedIds = profile.instIds || (profile.instId ? [profile.instId] : []);
        if (allowedIds.length === 0) return;

        // Persist selected institute
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

        const nameHeader = document.getElementById('user-name-header');
        if (nameHeader) nameHeader.textContent = profile.name || user.email;

        const instHeader = document.getElementById('user-inst-header');
        if (instHeader) instHeader.textContent = instituto?.nome || (userInstId === 'all' ? 'Múltiplos Vínculos' : '-');

        const pageName = document.getElementById('inst-page-name');
        if (pageName) pageName.textContent = instituto?.nome || (userInstId === 'all' ? 'Todos os Vinculados' : 'Instituto Desconhecido');

        // Fetch data
        allPactuacoes = await Repository.getPactuacoes();
        localProcs = await Repository.getProcedimentos();

        // Populate competência dropdown from real data (format: "abr/26")
        populateCompetenciaSelect();

        // Deadline check
        const config = await Repository.getSystemConfig();
        const deadlineDay = config?.deadlineDay || 5;
        const deadlineRule = config?.deadlineRule || 'business_day';
        const deadlineAlert = config?.deadlineAlert !== false;

        if (deadlineAlert && DateUtils.isPastDeadline(deadlineDay, deadlineRule) && instituto) {
            checkDeadlineCompliance(allPactuacoes, instituto.id, localProcs, { deadlineDay, deadlineRule });
        }

        renderTable();

        const compSelect = document.getElementById('competencia');
        if (compSelect) {
            currentPeriod = compSelect.value;
            compSelect.addEventListener('change', (e) => {
                currentPeriod = e.target.value;
                renderTable();
            });
        }
    });
}

function populateCompetenciaSelect() {
    const compSelect = document.getElementById('competencia');
    if (!compSelect) return;

    // Get unique competencias from real data (format: "abr/26")
    const months = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
    const parseComp = (c) => {
        if (!c) return 0;
        const [m, y] = c.toLowerCase().split('/');
        return parseInt(y) * 12 + (months.indexOf(m) ?? 0);
    };

    const comps = [...new Set(allPactuacoes.map(p => p.competencia).filter(Boolean))];
    comps.sort((a, b) => parseComp(a) - parseComp(b));

    compSelect.innerHTML = comps.map(c =>
        `<option value="${c}">${c.toUpperCase()}</option>`
    ).join('');

    // Default to last (most recent) competência
    if (comps.length > 0) {
        currentPeriod = comps[comps.length - 1];
        compSelect.value = currentPeriod;
    }
}

function renderTable() {
    const tbody = document.getElementById('lancamento-table-body');
    if (!tbody) return;

    // Produção é compartilhada entre institutos: mostrar todos os procedimentos
    // ofertados na competência, independente do instituto. Assim, o lançamento
    // feito em um instituto fica visível e conta para todos que ofertam o mesmo SIGTAP.
    let filtered = allPactuacoes;

    // Filter by period (format already matches: "abr/26")
    if (currentPeriod) {
        filtered = filtered.filter(p => p.competencia === currentPeriod);
    }

    // Group by SIGTAP
    const groups = {};
    filtered.forEach(p => {
        if (!groups[p.sigtap]) {
            const proc = localProcs.find(pr => pr.sigtap === p.sigtap);
            groups[p.sigtap] = {
                sigtap: p.sigtap,
                procName: proc?.nome || 'Procedimento',
                items: [],
                maxMeta: 0,
                totalRealizado: 0
            };
        }
        groups[p.sigtap].items.push(p);

        const meta = parseInt(p.ofertaMinima || 0);
        const real = parseInt(p.producao?.realizada || 0);

        if (meta > groups[p.sigtap].maxMeta) groups[p.sigtap].maxMeta = meta;
        // Production is unified: all rows for same sigtap+inst share the same value
        groups[p.sigtap].totalRealizado = Math.max(groups[p.sigtap].totalRealizado, real);
    });

    window.displayGroups = groups;

    const displayItems = Object.values(groups);

    if (displayItems.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="px-6 py-12 text-center text-slate-400 italic">Nenhum procedimento encontrado para este período.</td></tr>`;
        return;
    }

    tbody.innerHTML = displayItems.map(group => {
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
                    value="${group.totalRealizado || ''}"
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
}

window.updateOffer = async (sigtap, value) => {
    const val = parseInt(value) || 0;
    const group = window.displayGroups?.[sigtap];
    if (!group) return;

    // Update in memory and re-render optimistically
    group.items.forEach(p => {
        if (!p.producao) p.producao = {};
        p.producao.realizada = val;
    });
    group.totalRealizado = val;
    renderTable();

    // Persist all rows for this sigtap+institute to the database
    try {
        await Promise.all(
            group.items.map(p =>
                Repository.savePactuacao({ id: p.id, producao: { ...p.producao, realizada: val } })
            )
        );
    } catch (err) {
        console.error('Erro ao salvar oferta:', err);
        alert('Erro ao salvar. Tente novamente.');
    }
};

window.openDetailModal = async (sigtap) => {
    const group = window.displayGroups?.[sigtap];
    if (!group) return;

    const localProgs = await Repository.getPrograms();

    const modal = document.getElementById('modal-detalhe-lancamento');
    if (!modal) return;

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
            <td class="px-4 py-3 text-sm font-medium text-slate-700 dark:text-slate-300">${progName}</td>
            <td class="px-4 py-3 text-right text-sm font-mono text-slate-600 dark:text-slate-400">${formatNumber(meta)}</td>
            <td class="px-4 py-3 text-right text-sm font-mono font-bold text-slate-900 dark:text-white">${formatNumber(real)}</td>
            <td class="px-4 py-3 align-middle">
                <div class="flex items-center gap-2">
                    <div class="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-1.5 flex-1">
                        <div class="${statusColor} h-1.5 rounded-full" style="width: ${Math.min(progress, 100)}%"></div>
                    </div>
                    <span class="text-[10px] font-bold text-slate-500">${Math.round(progress)}%</span>
                </div>
            </td>
        </tr>
        `;
    }).join('');

    modal.classList.remove('hidden');
};

window.closeDetailModal = () => {
    document.getElementById('modal-detalhe-lancamento').classList.add('hidden');
};

// --- COMPLIANCE ALERT LOGIC ---
function checkDeadlineCompliance(pactuacoes, instId, procs, config) {
    const targetComp = DateUtils.getPreviousMonthLabel('iso');

    const relevant = pactuacoes.filter(p => p.instId === instId && p.competencia === targetComp);
    if (relevant.length === 0) return;

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

    const [year, month] = compLabel.split('-');
    const months = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
    const humanComp = `${months[parseInt(month) - 1]} ${year}`;

    document.getElementById('alert-month').textContent = humanComp;

    const today = new Date();
    const day = config?.deadlineDay || 5;
    const rule = config?.deadlineRule || 'business_day';
    const deadlineDate = rule === 'fixed_date'
        ? new Date(today.getFullYear(), today.getMonth(), day)
        : DateUtils.getBusinessDay(today.getFullYear(), today.getMonth(), day);

    document.getElementById('alert-deadline').textContent = deadlineDate.toLocaleDateString('pt-BR');

    // Render into the <ul id="alert-list"> that exists in the HTML
    const list = document.getElementById('alert-list');
    if (list) {
        list.innerHTML = items.map(g => {
            const proc = procs.find(pr => pr.sigtap === g.sigtap);
            const procName = proc?.nome || `Procedimento ${g.sigtap}`;
            return `<li><span class="font-mono text-[10px]">${g.sigtap}</span> — ${procName}</li>`;
        }).join('');
    }

    modal.classList.remove('hidden');
}

initLancamento();
