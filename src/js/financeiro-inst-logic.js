import { Repository } from './repository.js';
import { DateUtils } from './utils/date-utils.js';
import { getOferta, getProduzido, getRetornoSMSA, getMeta, calcIncentivo, mapaOfertaRede, chaveOfertaRede } from './business-rules.js';
import { auth } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

function formatCurrency(value) {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}

function formatNumber(value) {
    return new Intl.NumberFormat('pt-BR').format(value);
}

let localPactuacoes = [];
let localProcs = [];
let localProgs = [];
let localGruposOferta = [];
let currentSort = { column: 'total', direction: 'desc' };

// Monta o filtro de incentivo a partir das pactuações do instituto atual. Precisa ser
// chamado no init E na troca de instituto, senão o dropdown congela com os incentivos
// do instituto carregado inicialmente (bug do incentivo "sumido").
function populateProgramFilterFin(preserveSelection = true) {
    const progFilter = document.getElementById('filter-programa-fin');
    if (!progFilter) return;

    const previousVal = progFilter.value;
    const uniqueProgIds = [...new Set(localPactuacoes.map(p => p.progId))].filter(Boolean);
    const progs = uniqueProgIds.map(id => {
        const prog = localProgs.find(pg => pg.id === id);
        if (!prog) {
            console.warn(`[INTEGRIDADE] Incentivo órfão: pactuação usa progId "${id}" sem cadastro em 'programas'. Exibindo com rótulo provisório.`);
            return { id, nome: `⚠ ${id} (programa não cadastrado)` };
        }
        return prog;
    });
    progs.sort((a, b) => a.nome.localeCompare(b.nome));

    progFilter.innerHTML = `<option value="">Todos os Incentivos</option>` +
        progs.map(pg => `<option value="${pg.id}">${pg.nome}</option>`).join('');

    if (preserveSelection && previousVal && progs.some(pg => pg.id === previousVal)) {
        progFilter.value = previousVal;
    } else {
        progFilter.value = '';
    }
}

// Reconstrói o filtro de competência a partir do instituto atual (evita competência
// obsoleta ao trocar de instituto).
function populateCompetenceFilterFin(preserveSelection = true) {
    const compFilter = document.getElementById('filter-competencia-fin');
    if (!compFilter) return;
    const previousVal = compFilter.value;
    if (localPactuacoes.length > 0) {
        const comps = [...new Set(localPactuacoes.map(p => p.competencia))].sort((a, b) => DateUtils.parseCompetencia(b) - DateUtils.parseCompetencia(a));
        compFilter.innerHTML = comps.map(c => `<option value="${c}">${c}</option>`).join('');
        if (preserveSelection && previousVal && comps.includes(previousVal)) {
            compFilter.value = previousVal;
        } else {
            const padraoFin = DateUtils.competenciaPadrao(comps);
            if (padraoFin) compFilter.value = padraoFin;
        }
    } else {
        compFilter.innerHTML = '<option value="">Sem dados</option>';
    }
}

async function initFinanceiroInst() {
    onAuthStateChanged(auth, async (user) => {
        if (!user) return;

        const profile = await Repository.getUserByEmail(user.email);
        if (!profile || !profile.role.startsWith('Institutos')) return;

        const allowedIds = profile.instIds || (profile.instId ? [profile.instId] : []);

        if (allowedIds.length === 0) return;

        let userInstId = allowedIds[0];
        // Check for saved selection
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

        const instHeader = document.getElementById('inst-header-name');
        if (instHeader) instHeader.textContent = instituto?.nome || (userInstId === 'all' ? 'Múltiplos Vínculos' : '-');

        const pageName = document.getElementById('inst-page-name');
        if (pageName) pageName.textContent = instituto?.nome || (userInstId === 'all' ? 'Todos os Vinculados' : 'Instituto Desconhecido');

        setupProfileMenu();

        // --- PROFILE MENU SWITCHER INJECTION ---
        if (allowedIds.length > 1) {
            const institutes = await Repository.getInstitutos();
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
                        profileDropdown.classList.add('hidden'); // Close first

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

                        // REFRESH FILTROS — sem isso os dropdowns de competência e incentivo
                        // ficam com os dados do instituto anterior (bug do incentivo "sumido").
                        populateCompetenceFilterFin(true);
                        populateProgramFilterFin(true);

                        // Force re-render
                        renderTable();
                    });
                });
            }
        }

        // Init Data
        allPactuacoes = await Repository.getPactuacoes();

        // Initial Filter
        if (userInstId === 'all') {
            localPactuacoes = allPactuacoes.filter(p => allowedIds.includes(p.instId));
        } else {
            localPactuacoes = allPactuacoes.filter(p => p.instId === userInstId);
        }

        localProcs = await Repository.getProcedimentos();
        localProgs = await Repository.getProgramas();
        localGruposOferta = await Repository.getGruposOferta();

        // Populate Competence Filter
        const compFilter = document.getElementById('filter-competencia-fin');
        populateCompetenceFilterFin(false);
        if (compFilter) {
            compFilter.addEventListener('change', renderTable);
        }

        // Populate Program Filter (incentivo)
        const progFilter = document.getElementById('filter-programa-fin');
        if (progFilter) {
            populateProgramFilterFin(false);
            progFilter.addEventListener('change', renderTable);
        }

        // Search Filter
        const searchInput = document.getElementById('buscainteligente-fin');
        if (searchInput) {
            searchInput.addEventListener('input', renderTable);
        }

        // Setup Sort Headers
        document.querySelectorAll('th[data-sort]').forEach(th => {
            th.addEventListener('click', () => {
                const col = th.dataset.sort;
                if (currentSort.column === col) {
                    currentSort.direction = currentSort.direction === 'asc' ? 'desc' : 'asc';
                } else {
                    currentSort.column = col;
                    currentSort.direction = 'desc'; // Default to desc for financial
                }
                renderTable();
            });
        });

        setupDragScroll();
        renderTable();
    });
}

function setupDragScroll() {
    const slider = document.getElementById('table-container-fin');
    if (!slider) return;

    let isDown = false;
    let startX;
    let scrollLeft;

    slider.addEventListener('mousedown', (e) => {
        isDown = true;
        slider.classList.add('active');
        startX = e.pageX - slider.offsetLeft;
        scrollLeft = slider.scrollLeft;
    });
    slider.addEventListener('mouseleave', () => {
        isDown = false;
        slider.classList.remove('active');
    });
    slider.addEventListener('mouseup', () => {
        isDown = false;
        slider.classList.remove('active');
    });
    slider.addEventListener('mousemove', (e) => {
        if (!isDown) return;
        e.preventDefault();
        const x = e.pageX - slider.offsetLeft;
        const walk = (x - startX) * 2; //scroll-fast
        slider.scrollLeft = scrollLeft - walk;
    });
}

function renderTable() {
    const compValue = document.getElementById('filter-competencia-fin')?.value;
    const progValue = document.getElementById('filter-programa-fin')?.value;
    const searchValue = document.getElementById('buscainteligente-fin')?.value.toLowerCase();

    const tbody = document.getElementById('table-financeiro-inst');
    if (!tbody) return;

    if (!compValue) {
        tbody.innerHTML = `<tr><td colspan="7" class="px-6 py-10 text-center text-slate-400 italic">Selecione uma competência para visualizar.</td></tr>`;
        return;
    }

    let filtered = localPactuacoes.filter(p => p.competencia === compValue);

    // Filter by Program
    if (progValue) {
        filtered = filtered.filter(p => p.progId === progValue);
    }

    // Filter by Search
    if (searchValue) {
        filtered = filtered.filter(p => {
            const proc = localProcs.find(pr => pr.sigtap === p.sigtap);
            return (proc && proc.nome.toLowerCase().includes(searchValue)) || p.sigtap.includes(searchValue);
        });
    }

    // O incentivo é condicionado à meta da REDE (soma das ofertas de todos os institutos),
    // nunca à oferta isolada deste instituto. Usa a rede inteira (allPactuacoes) da competência.
    const netMap = mapaOfertaRede(allPactuacoes.filter(p => p.competencia === compValue));

    // 2. Aggregate Data (Group by SIGTAP)
    const aggregated = {};

    filtered.forEach(p => {
        if (!aggregated[p.sigtap]) {
            aggregated[p.sigtap] = {
                items: [],
                sigtap: p.sigtap,
                competencia: p.competencia,
                progId: p.progId,
                // Aggregated stats
                ofertado: 0,
                realizado: 0,
                aprovada: 0,
                meta: 0,
                totalBase: 0,
                totalInc: 0,
                totalRow: 0,
                // Valor unitário (maior encontrado)
                vBaseUnit: 0,
                vIncUnit: 0
            };
        }

        const group = aggregated[p.sigtap];
        group.items.push(p);

        // Oferta = ofertado (instituto); Produzido = producao.realizada; Aprovado = producao.aprovada.
        // Dedup por procedimento (considerar a maior) entre os incentivos do mesmo instituto.
        group.ofertado = Math.max(group.ofertado, getOferta(p));
        group.realizado = Math.max(group.realizado, getProduzido(p));
        group.aprovada = Math.max(group.aprovada, getRetornoSMSA(p));
        group.meta = Math.max(group.meta, getMeta(p, localGruposOferta));

        // Valor unitário: maior encontrado (não o "primeiro não-zero")
        group.vBaseUnit = Math.max(group.vBaseUnit, parseFloat(p.vlrSigtapBase || 0));
        group.vIncUnit = Math.max(group.vIncUnit, parseFloat(p.vlrIncentivo || 0));
    });

    // 3. Prepare Display Data
    let displayData = Object.values(aggregated).map(d => {
        const proc = localProcs.find(pr => pr.sigtap === d.sigtap);

        // Meta atingida = OFERTA DA REDE (soma dos institutos) >= meta. A meta é sempre da rede.
        const ofertaRede = netMap[chaveOfertaRede(d.items[0])] || 0;
        const isMetaMet = d.meta > 0 && ofertaRede >= d.meta;

        // Faturamento SIGTAP e Incentivo — Previsto (sobre o Produzido) e Pago (sobre o Aprovado/SMSA)
        d.totalBase = d.realizado * d.vBaseUnit;           // Faturado SIGTAP Previsto
        d.totalBasePago = d.aprovada * d.vBaseUnit;        // Faturado SIGTAP Pago
        d.totalInc = isMetaMet ? (d.realizado * d.vIncUnit) : 0;     // Incentivo Previsto
        d.totalIncPago = isMetaMet ? (d.aprovada * d.vIncUnit) : 0;  // Incentivo Pago
        d.totalRow = d.totalBase + d.totalInc;
        d.totalRowPago = d.totalBasePago + d.totalIncPago;
        d.isMetaMet = isMetaMet;

        return {
            ...d,
            procName: proc?.nome || 'Procedimento',
        };
    });

    // 4. Sorting
    if (currentSort.column) {
        displayData.sort((a, b) => {
            let valA, valB;
            switch (currentSort.column) {
                case 'procedimento': valA = a.procName.toLowerCase(); valB = b.procName.toLowerCase(); break;
                case 'qtd': valA = a.ofertado; valB = b.ofertado; break;
                case 'status': valA = a.isMetaMet ? 1 : 0; valB = b.isMetaMet ? 1 : 0; break;
                case 'realizado': valA = a.realizado; valB = b.realizado; break;
                case 'vlrSigtapUnit': valA = a.vBaseUnit; valB = b.vBaseUnit; break;
                case 'vlrIncUnit': valA = a.vIncUnit; valB = b.vIncUnit; break;
                case 'fatSigtap': valA = a.totalBase; valB = b.totalBase; break;
                case 'fatInc': valA = a.totalInc; valB = b.totalInc; break;
                case 'fatIncPago': valA = a.totalIncPago; valB = b.totalIncPago; break;
                case 'total': valA = a.totalRow; valB = b.totalRow; break;
                default: valA = a.totalRow; valB = b.totalRow;
            }
            if (valA < valB) return currentSort.direction === 'asc' ? -1 : 1;
            if (valA > valB) return currentSort.direction === 'asc' ? 1 : -1;
            return 0;
        });
    }

    let totalSigtap = 0;       // Faturado SIGTAP Previsto
    let totalSigtapPago = 0;   // Faturado SIGTAP Pago
    let totalIncentivo = 0;    // Incentivo Previsto
    let totalIncPago = 0;      // Incentivo Pago

    if (displayData.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="px-6 py-10 text-center text-slate-400 italic">Nenhum dado encontrado para os filtros selecionados.</td></tr>`;
    } else {
        tbody.innerHTML = displayData.map(d => {
            totalSigtap += d.totalBase;
            totalSigtapPago += d.totalBasePago;
            totalIncentivo += d.totalInc;
            totalIncPago += d.totalIncPago;

            return `
                <tr class="even:bg-slate-50/70 dark:even:bg-slate-800/20 hover:bg-blue-50/60 dark:hover:bg-slate-800/50 transition-colors">
                    <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-slate-900 dark:text-white">
                        <div class="flex flex-col">
                            <span class="font-bold truncate max-w-[220px]" title="${d.procName}">${d.procName}</span>
                            <span class="text-[10px] text-slate-500 font-mono">${d.sigtap}</span>
                        </div>
                    </td>
                    <td class="px-6 py-4 text-center font-mono text-sm font-bold text-blue-700 dark:text-blue-400">${formatNumber(d.ofertado)}</td>
                    <td class="px-6 py-4 text-center font-mono text-sm leading-tight">
                        <div class="font-bold text-slate-800 dark:text-slate-200">${formatNumber(d.realizado)}</div>
                        <div class="text-[10px] text-slate-400">aprov: ${formatNumber(d.aprovada)}</div>
                    </td>
                    <td class="px-6 py-4 text-right font-mono text-xs text-slate-600 dark:text-slate-400 leading-tight">
                        <div class="font-bold">Pago: ${formatCurrency(d.totalBasePago)}</div>
                    </td>
                    <td class="px-6 py-4 text-right font-mono text-sm text-slate-600 dark:text-slate-400">${formatCurrency(d.totalInc)}</td>
                    <td class="px-6 py-4 text-right font-mono text-sm font-bold text-emerald-700 dark:text-emerald-400">${formatCurrency(d.totalIncPago)}</td>
                </tr>
            `;
        }).join('');
    }

    // Update Footer Totals
    const elFootSigtap = document.getElementById('foot-sigtap');
    if (elFootSigtap) elFootSigtap.innerHTML = `Pago: ${formatCurrency(totalSigtapPago)}`;
    const elFootIncPrev = document.getElementById('foot-inc-prev');
    if (elFootIncPrev) elFootIncPrev.textContent = formatCurrency(totalIncentivo);
    const elFootIncPago = document.getElementById('foot-inc-pago');
    if (elFootIncPago) elFootIncPago.textContent = formatCurrency(totalIncPago);
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

    // Export Button
    const exportBtn = document.getElementById('btn-export-fin');
    if (exportBtn) {
        exportBtn.addEventListener('click', exportToCSV);
    }
}

let allPactuacoes = []; // Helper for switcher

initFinanceiroInst();
