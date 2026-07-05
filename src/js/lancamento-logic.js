import { Repository } from './repository.js';
import { DateUtils } from './utils/date-utils.js';
import { getOferta, getMeta, atingimentoPct, statusMeta } from './business-rules.js';
import { auth } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

Repository.getPrograms = Repository.getProgramas || (async () => []);

function formatNumber(value) {
    return new Intl.NumberFormat('pt-BR').format(value);
}

let allPactuacoes = [];
let localProcs = [];
let gruposOferta = [];
let allowedIds = [];
let currentPeriod = '';
let userInstId = null;

async function initLancamento() {
    onAuthStateChanged(auth, async (user) => {
        if (!user) return;

        const profile = await Repository.getUserByEmail(user.email);
        if (!profile || !profile.role.startsWith('Institutos')) return;

        allowedIds = profile.instIds || (profile.instId ? [profile.instId] : []);
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
        gruposOferta = await Repository.getGruposOferta();

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
        currentPeriod = DateUtils.competenciaPadrao(comps);
        compSelect.value = currentPeriod;
    }
}

function renderTable() {
    const tbody = document.getElementById('lancamento-table-body');
    if (!tbody) return;

    // A oferta é do INSTITUTO: mostrar apenas as pactuações do(s) instituto(s) do usuário.
    const visiveis = (userInstId && userInstId !== 'all') ? [userInstId] : allowedIds;
    let filtered = allPactuacoes.filter(p => visiveis.includes(p.instId));

    // Filter by period (format already matches: "abr/26")
    if (currentPeriod) {
        filtered = filtered.filter(p => p.competencia === currentPeriod);
    }

    // Agrupa por (instituto + SIGTAP): a oferta é replicada entre os incentivos do
    // mesmo instituto que compartilham o mesmo procedimento (considera a maior).
    const groups = {};
    filtered.forEach(p => {
        const key = `${p.instId}_${p.sigtap}`;
        if (!groups[key]) {
            const proc = localProcs.find(pr => pr.sigtap === p.sigtap);
            groups[key] = {
                key,
                sigtap: p.sigtap,
                instId: p.instId,
                procName: proc?.nome || 'Procedimento',
                items: [],
                maxMeta: 0,
                totalOferta: 0
            };
        }
        groups[key].items.push(p);
        groups[key].maxMeta = Math.max(groups[key].maxMeta, getMeta(p, gruposOferta));
        groups[key].totalOferta = Math.max(groups[key].totalOferta, getOferta(p));
    });

    window.displayGroups = groups;

    const displayItems = Object.values(groups);

    if (displayItems.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="px-6 py-12 text-center text-slate-400 italic">Nenhum procedimento encontrado para este período.</td></tr>`;
        return;
    }

    tbody.innerHTML = displayItems.map(group => {
        const target = group.maxMeta;
        const progress = atingimentoPct(group.totalOferta, target);

        const status = statusMeta(progress);
        const statusColor = status === 'ok' ? 'bg-green-500' : (status === 'alerta' ? 'bg-yellow-500' : 'bg-red-500');

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
                        <span class="text-slate-600 dark:text-slate-400 font-medium">${formatNumber(group.totalOferta)} ofertado</span>
                        <span class="font-bold text-slate-700 dark:text-white">${Math.round(progress)}%</span>
                    </div>
                    <div class="w-full bg-slate-200 dark:bg-slate-600 rounded-full h-2">
                        <div class="${statusColor} h-2 rounded-full transition-all duration-500" style="width: ${Math.min(progress, 100)}%"></div>
                    </div>
                </div>
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-center">
                <input
                    data-key="${group.key}"
                    onchange="window.updateOffer('${group.key}', this.value)"
                    class="w-24 text-center rounded-lg border-slate-300 dark:border-slate-600 focus:ring-primary focus:border-primary sm:text-sm bg-white dark:bg-slate-900 dark:text-white font-bold shadow-sm"
                    min="0"
                    value="${group.totalOferta || ''}"
                    type="number"
                    placeholder="0"
                />
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-center">
                <button onclick="window.openDetailModal('${group.key}')" class="p-2 text-slate-400 hover:text-primary transition-colors bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg" title="Ver Detalhes dos Incentivos">
                    <span class="material-symbols-outlined text-[20px]">visibility</span>
                </button>
            </td>
        </tr>
        `;
    }).join('');
}

window.updateOffer = async (key, value) => {
    const val = parseInt(value) || 0;
    const group = window.displayGroups?.[key];
    if (!group) return;

    // Atualiza em memória e re-renderiza otimista
    group.items.forEach(p => { p.ofertado = val; });
    group.totalOferta = val;
    renderTable();

    // Persiste a OFERTA (ofertado) em todas as linhas do mesmo instituto+procedimento
    try {
        await Promise.all(
            group.items.map(p => Repository.savePactuacao({ id: p.id, ofertado: val }))
        );
    } catch (err) {
        console.error('Erro ao salvar oferta:', err);
        alert('Erro ao salvar. Tente novamente.');
    }
};

window.openDetailModal = async (key) => {
    const group = window.displayGroups?.[key];
    if (!group) return;

    const localProgs = await Repository.getPrograms();

    const modal = document.getElementById('modal-detalhe-lancamento');
    if (!modal) return;

    document.getElementById('modal-title').textContent = group.procName;
    document.getElementById('modal-subtitle').textContent = `Cód. SIGTAP: ${group.sigtap}`;

    const tbody = document.getElementById('modal-table-body');
    tbody.innerHTML = group.items.map(item => {
        const prog = localProgs.find(p => p.id === item.progId);
        const progName = prog ? prog.nome : (item.progId || 'Incentivo Padrão');

        const meta = getMeta(item, gruposOferta);
        const oferta = getOferta(item);
        const progress = atingimentoPct(oferta, meta);

        const status = statusMeta(progress);
        const statusColor = status === 'ok' ? 'bg-green-500' : (status === 'alerta' ? 'bg-yellow-500' : 'bg-red-500');

        return `
        <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/50">
            <td class="px-4 py-3 text-sm font-medium text-slate-700 dark:text-slate-300">${progName}</td>
            <td class="px-4 py-3 text-right text-sm font-mono text-slate-600 dark:text-slate-400">${formatNumber(meta)}</td>
            <td class="px-4 py-3 text-right text-sm font-mono font-bold text-slate-900 dark:text-white">${formatNumber(oferta)}</td>
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
    const targetComp = DateUtils.getPreviousMonthLabel('short'); // "mmm/yy" — mesmo formato gravado nas pactuações

    const relevant = pactuacoes.filter(p => p.instId === instId && p.competencia === targetComp);
    if (relevant.length === 0) return;

    const groups = {};
    relevant.forEach(p => {
        if (!groups[p.sigtap]) {
            groups[p.sigtap] = { sigtap: p.sigtap, maxMeta: 0, totalOferta: 0 };
        }
        groups[p.sigtap].maxMeta = Math.max(groups[p.sigtap].maxMeta, getMeta(p, gruposOferta));
        groups[p.sigtap].totalOferta = Math.max(groups[p.sigtap].totalOferta, getOferta(p));
    });

    // Alerta: itens com meta mas sem OFERTA lançada pelo instituto
    const missing = Object.values(groups).filter(g => g.maxMeta > 0 && g.totalOferta === 0);
    if (missing.length > 0) {
        showDeadlineAlert(targetComp, missing, procs, config);
    }
}

function showDeadlineAlert(compLabel, items, procs, config) {
    const modal = document.getElementById('modal-alert-prazo');
    if (!modal) return;

    const shortM = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
    const months = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
    const [mm, yy] = compLabel.split('/');
    const humanComp = `${months[shortM.indexOf(mm)] || mm} 20${yy}`;

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
