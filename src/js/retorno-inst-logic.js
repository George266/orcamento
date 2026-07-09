import { Repository } from './repository.js';
import { DateUtils } from './utils/date-utils.js';
import { getProduzido, getRetornoSMSA } from './business-rules.js';
import { auth } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

function formatNumber(value) {
    return new Intl.NumberFormat('pt-BR').format(value);
}

let allPactuacoes = [];      // rede inteira (para o switcher)
let localPactuacoes = [];     // pactuações dos institutos vinculados / selecionado
let localProcs = [];
let instMap = {};             // instId -> { sigla, nome }
let currentSort = { column: 'retorno', direction: 'desc' };

async function initRetornoInst() {
    onAuthStateChanged(auth, async (user) => {
        if (!user) return;

        const profile = await Repository.getUserByEmail(user.email);
        if (!profile || !profile.role.startsWith('Institutos')) return;

        const allowedIds = profile.instIds || (profile.instId ? [profile.instId] : []);
        if (allowedIds.length === 0) return;

        // Determina instituto selecionado (respeita seleção salva)
        let userInstId = allowedIds[0];
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

        // Headers
        const nameHeader = document.getElementById('user-name-header');
        if (nameHeader) nameHeader.textContent = profile.name || user.email;

        const instHeader = document.getElementById('inst-header-name');
        if (instHeader) instHeader.textContent = instituto?.nome || (userInstId === 'all' ? 'Múltiplos Vínculos' : '-');

        const pageName = document.getElementById('inst-page-name');
        if (pageName) pageName.textContent = instituto?.nome || (userInstId === 'all' ? 'Todos os Vinculados' : 'Instituto Desconhecido');

        setupProfileMenu();

        // Mapa de institutos (sigla/nome) para exibir a coluna "Instituto"
        const institutes = await Repository.getInstitutos();
        instMap = {};
        institutes.forEach(i => { instMap[i.id] = { sigla: i.sigla, nome: i.nome }; });

        // --- SWITCHER DE INSTITUTO (multi-vínculo) ---
        if (allowedIds.length > 1) {
            const myInsts = institutes.filter(i => allowedIds.includes(i.id));
            const profileDropdown = document.getElementById('profile-dropdown');
            if (profileDropdown && !profileDropdown.querySelector('.inst-switcher-container')) {
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

                const btns = switcherHtml.querySelectorAll('.inst-switcher-btn');
                btns.forEach(btn => {
                    btn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        profileDropdown.classList.add('hidden');

                        const selectedId = btn.dataset.instId;
                        localStorage.setItem('selectedInstituteId', selectedId);
                        userInstId = selectedId;

                        if (selectedId === 'all') {
                            localPactuacoes = allPactuacoes.filter(p => allowedIds.includes(p.instId));
                            document.getElementById('inst-page-name').textContent = 'Todos os Vinculados';
                            document.getElementById('inst-header-name').textContent = 'Múltiplos Vínculos';
                        } else {
                            localPactuacoes = allPactuacoes.filter(p => p.instId === selectedId);
                            const selInst = myInsts.find(i => i.id === selectedId);
                            document.getElementById('inst-page-name').textContent = selInst ? selInst.nome : 'Instituto';
                            document.getElementById('inst-header-name').textContent = selInst ? selInst.nome : '-';
                        }

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

                        renderTable();
                    });
                });
            }
        }

        // Dados
        allPactuacoes = await Repository.getPactuacoes();
        if (userInstId === 'all') {
            localPactuacoes = allPactuacoes.filter(p => allowedIds.includes(p.instId));
        } else {
            localPactuacoes = allPactuacoes.filter(p => p.instId === userInstId);
        }

        localProcs = await Repository.getProcedimentos();

        // Filtro de competência
        const compFilter = document.getElementById('filter-competencia-ret');
        if (compFilter && localPactuacoes.length > 0) {
            const comps = [...new Set(localPactuacoes.map(p => p.competencia))].sort((a, b) => DateUtils.parseCompetencia(b) - DateUtils.parseCompetencia(a));
            compFilter.innerHTML = comps.map(c => `<option value="${c}">${c}</option>`).join('');
            const padrao = DateUtils.competenciaPadrao(comps);
            if (padrao) compFilter.value = padrao;
            compFilter.addEventListener('change', renderTable);
        }

        // Busca
        const searchInput = document.getElementById('buscainteligente-ret');
        if (searchInput) searchInput.addEventListener('input', renderTable);

        // Ordenação
        document.querySelectorAll('th[data-sort]').forEach(th => {
            th.addEventListener('click', () => {
                const col = th.dataset.sort;
                if (currentSort.column === col) {
                    currentSort.direction = currentSort.direction === 'asc' ? 'desc' : 'asc';
                } else {
                    currentSort.column = col;
                    currentSort.direction = 'desc';
                }
                renderTable();
            });
        });

        renderTable();
    });
}

function renderTable() {
    const compValue = document.getElementById('filter-competencia-ret')?.value;
    const searchValue = (document.getElementById('buscainteligente-ret')?.value || '').toLowerCase();

    const tbody = document.getElementById('table-retorno-inst');
    if (!tbody) return;

    if (!compValue) {
        tbody.innerHTML = `<tr><td colspan="6" class="px-6 py-10 text-center text-slate-400 italic">Selecione uma competência para visualizar.</td></tr>`;
        return;
    }

    let filtered = localPactuacoes.filter(p => p.competencia === compValue);

    if (searchValue) {
        filtered = filtered.filter(p => {
            const proc = localProcs.find(pr => pr.sigtap === p.sigtap);
            return (proc && proc.nome.toLowerCase().includes(searchValue)) || String(p.sigtap).includes(searchValue);
        });
    }

    // Agrega por instituto + SIGTAP (dedup de linhas que aparecem em vários incentivos → maior valor)
    const aggregated = {};
    filtered.forEach(p => {
        const key = `${p.instId}_${p.sigtap}`;
        if (!aggregated[key]) {
            aggregated[key] = { instId: p.instId, sigtap: p.sigtap, produzido: 0, retorno: 0 };
        }
        const g = aggregated[key];
        g.produzido = Math.max(g.produzido, getProduzido(p));
        g.retorno = Math.max(g.retorno, getRetornoSMSA(p));
    });

    let displayData = Object.values(aggregated).map(d => {
        const proc = localProcs.find(pr => pr.sigtap === d.sigtap);
        return {
            ...d,
            procName: proc?.nome || 'Procedimento',
            instSigla: instMap[d.instId]?.sigla || instMap[d.instId]?.nome || d.instId,
            diff: d.retorno - d.produzido,
        };
    });

    // Ordenação
    if (currentSort.column) {
        displayData.sort((a, b) => {
            let valA, valB;
            switch (currentSort.column) {
                case 'instituto': valA = a.instSigla.toLowerCase(); valB = b.instSigla.toLowerCase(); break;
                case 'sigtap': valA = String(a.sigtap); valB = String(b.sigtap); break;
                case 'procedimento': valA = a.procName.toLowerCase(); valB = b.procName.toLowerCase(); break;
                case 'produzido': valA = a.produzido; valB = b.produzido; break;
                case 'diff': valA = a.diff; valB = b.diff; break;
                case 'retorno':
                default: valA = a.retorno; valB = b.retorno;
            }
            if (valA < valB) return currentSort.direction === 'asc' ? -1 : 1;
            if (valA > valB) return currentSort.direction === 'asc' ? 1 : -1;
            return 0;
        });
    }

    let totProduzido = 0, totRetorno = 0;

    if (displayData.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="px-6 py-10 text-center text-slate-400 italic">Nenhum dado encontrado para os filtros selecionados.</td></tr>`;
    } else {
        tbody.innerHTML = displayData.map(d => {
            totProduzido += d.produzido;
            totRetorno += d.retorno;

            // Diferença: retorno - produzido. Negativo (glosa) em vermelho; zerado neutro; positivo verde.
            const diffColor = d.diff < 0
                ? 'text-red-600 dark:text-red-400'
                : d.diff > 0
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-slate-400';
            const diffLabel = d.diff > 0 ? `+${formatNumber(d.diff)}` : formatNumber(d.diff);

            return `
                <tr class="even:bg-slate-50/70 dark:even:bg-slate-800/20 hover:bg-blue-50/60 dark:hover:bg-slate-800/50 transition-colors">
                    <td class="px-6 py-4 whitespace-nowrap text-sm font-bold text-slate-700 dark:text-slate-200 uppercase tracking-tight">${d.instSigla}</td>
                    <td class="px-6 py-4 whitespace-nowrap font-mono text-xs text-slate-500 dark:text-slate-400">${d.sigtap}</td>
                    <td class="px-6 py-4 text-sm font-medium text-slate-900 dark:text-white">
                        <span class="truncate max-w-[280px] block" title="${d.procName}">${d.procName}</span>
                    </td>
                    <td class="px-6 py-4 text-center font-mono text-sm font-bold text-slate-800 dark:text-slate-200">${formatNumber(d.produzido)}</td>
                    <td class="px-6 py-4 text-center font-mono text-sm font-bold text-blue-700 dark:text-blue-400">${formatNumber(d.retorno)}</td>
                    <td class="px-6 py-4 text-center font-mono text-sm font-bold ${diffColor}">${diffLabel}</td>
                </tr>
            `;
        }).join('');
    }

    const totDiff = totRetorno - totProduzido;
    const footProd = document.getElementById('foot-produzido');
    if (footProd) footProd.textContent = formatNumber(totProduzido);
    const footRet = document.getElementById('foot-retorno');
    if (footRet) footRet.textContent = formatNumber(totRetorno);
    const footDiff = document.getElementById('foot-diff');
    if (footDiff) {
        footDiff.textContent = totDiff > 0 ? `+${formatNumber(totDiff)}` : formatNumber(totDiff);
        footDiff.className = 'px-6 py-4 whitespace-nowrap text-base font-black text-right font-mono ' +
            (totDiff < 0 ? 'text-red-600 dark:text-red-400' : totDiff > 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-500');
    }
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
        document.addEventListener('click', () => dropdown.classList.add('hidden'));
        dropdown.addEventListener('click', (e) => e.stopPropagation());
    }

    if (logoutBtn) {
        logoutBtn.addEventListener('click', async () => {
            const { logout } = await import('./auth-guard.js');
            await logout();
        });
    }

    const sidebarToggle = document.getElementById('sidebar-toggle');
    const sidebar = document.querySelector('aside');
    if (sidebarToggle && sidebar) {
        sidebarToggle.addEventListener('click', () => sidebar.classList.toggle('hidden'));
    }
}

initRetornoInst();
