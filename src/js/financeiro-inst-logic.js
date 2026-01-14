import { Repository } from './repository.js';
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
let currentSort = { column: 'total', direction: 'desc' };

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

        // Populate Competence Filter
        const compFilter = document.getElementById('filter-competencia-fin');
        if (localPactuacoes.length > 0) {
            const comps = [...new Set(localPactuacoes.map(p => p.competencia))].sort().reverse();
            compFilter.innerHTML = comps.map(c => `<option value="${c}">${c}</option>`).join('');
            if (comps.length > 0) compFilter.value = comps[0];
        }

        if (compFilter) {
            compFilter.addEventListener('change', renderTable);
        }

        // Populate Program Filter
        const progFilter = document.getElementById('filter-programa-fin');
        if (progFilter) {
            const uniqueProgIds = [...new Set(localPactuacoes.map(p => p.progId))];
            const progs = uniqueProgIds.map(id => localProgs.find(pg => pg.id === id)).filter(Boolean);
            progs.sort((a, b) => a.nome.localeCompare(b.nome));
            progFilter.innerHTML = `<option value="">Todos os Incentivos</option>` +
                progs.map(pg => `<option value="${pg.id}">${pg.nome}</option>`).join('');

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

    // 1. Calculate Global Status (Pre-process ALL data to check network goals)
    const globalStatus = {};
    allPactuacoes.forEach(p => {
        if (!globalStatus[p.sigtap]) {
            globalStatus[p.sigtap] = { meta: 0, offer: 0 };
        }

        // Meta: Take the Maximum Meta found (Shared Goal Logic)
        const currentMeta = parseInt(p.ofertaMinima || 0);
        if (currentMeta > globalStatus[p.sigtap].meta) {
            globalStatus[p.sigtap].meta = currentMeta;
        }

        const prod = p.producao || {};
        const offer = (parseInt(prod.sem1) || 0) + (parseInt(prod.sem2) || 0) + (parseInt(prod.sem3) || 0) + (parseInt(prod.sem4) || 0) + (parseInt(prod.sem5) || 0);
        globalStatus[p.sigtap].offer += offer;
    });

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
                totalBase: 0,
                totalInc: 0,
                totalRow: 0,
                // Unit prices (take first non-zero found)
                vBaseUnit: parseFloat(p.vlrSigtapBase || 0),
                vIncUnit: parseFloat(p.vlrIncentivo || 0)
            };
        }

        const group = aggregated[p.sigtap];
        group.items.push(p);

        // --- Calculate "Ofertado" (Sum of Weeks) ---
        const prod = p.producao || {};
        const ofertado = (parseInt(prod.sem1) || 0) + (parseInt(prod.sem2) || 0) + (parseInt(prod.sem3) || 0) + (parseInt(prod.sem4) || 0) + (parseInt(prod.sem5) || 0);
        group.ofertado += ofertado;

        // --- Calculate "Realizado" (Budget Input) ---
        const realizado = parseInt(prod.realizada || 0);
        group.realizado += realizado;

        // Update unit prices if current zero and new one has value
        if (group.vBaseUnit === 0) group.vBaseUnit = parseFloat(p.vlrSigtapBase || 0);
        if (group.vIncUnit === 0) group.vIncUnit = parseFloat(p.vlrIncentivo || 0);
    });

    // 3. Prepare Display Data
    let displayData = Object.values(aggregated).map(d => {
        const proc = localProcs.find(pr => pr.sigtap === d.sigtap);

        // Check Global Status
        const gStats = globalStatus[d.sigtap] || { meta: 0, offer: 0 };
        const isMetaMet = gStats.meta > 0 && gStats.offer >= gStats.meta;

        // Financial Calculations
        const rowBase = d.realizado * d.vBaseUnit; // Base always on Realized
        const rowInc = isMetaMet ? (d.realizado * d.vIncUnit) : 0; // Incentive only if Met

        d.totalBase = rowBase;
        d.totalInc = rowInc;
        d.totalRow = rowBase + rowInc;
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
                case 'total': valA = a.totalRow; valB = b.totalRow; break;
                default: valA = a.totalRow; valB = b.totalRow;
            }
            if (valA < valB) return currentSort.direction === 'asc' ? -1 : 1;
            if (valA > valB) return currentSort.direction === 'asc' ? 1 : -1;
            return 0;
        });
    }

    let totalSigtap = 0;
    let totalIncentivo = 0;
    let totalGeral = 0;

    if (displayData.length === 0) {
        tbody.innerHTML = `<tr><td colspan="9" class="px-6 py-10 text-center text-slate-400 italic">Nenhum dado encontrado para os filtros selecionados.</td></tr>`;
    } else {
        tbody.innerHTML = displayData.map(d => {
            totalSigtap += d.totalBase;
            totalIncentivo += d.totalInc;
            totalGeral += d.totalRow;

            // Status Badge
            const gStats = globalStatus[d.sigtap] || { meta: 0, offer: 0 };

            const statusHtml = d.isMetaMet
                ? `<div class="flex items-center justify-center"><span class="material-symbols-outlined text-emerald-500 font-bold" title="Meta da Rede Atingida (${formatNumber(gStats.meta)})">check_circle</span></div>`
                : `<div class="flex items-center justify-center"><span class="material-symbols-outlined text-amber-500 font-bold" title="Abaixo da Meta da Rede (Meta: ${formatNumber(gStats.meta)} | Oferta: ${formatNumber(gStats.offer)})">warning</span></div>`;

            return `
                <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors">
                    <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-slate-900 dark:text-white">
                        <div class="flex flex-col">
                            <span class="font-bold truncate max-w-[200px]" title="${d.procName}">${d.procName}</span>
                            <span class="text-[10px] text-slate-500 font-mono">${d.sigtap}</span>
                        </div>
                    </td>
                    <td class="px-6 py-4 text-center font-mono text-sm font-bold text-slate-800 dark:text-slate-200">${formatNumber(d.ofertado)}</td>
                    <td class="px-6 py-4 text-center">${statusHtml}</td>
                    <td class="px-6 py-4 text-center font-mono text-sm font-bold text-blue-600 dark:text-blue-400">${formatNumber(d.realizado)}</td>
                    <td class="px-6 py-4 text-right font-mono text-xs text-slate-500">${formatCurrency(d.vBaseUnit)}</td>
                    <td class="px-6 py-4 text-right font-mono text-xs text-slate-500">${formatCurrency(d.vIncUnit)}</td>
                    <td class="px-6 py-4 text-right font-mono text-sm text-slate-600 dark:text-slate-400">${formatCurrency(d.totalBase)}</td>
                    <td class="px-6 py-4 text-right font-mono text-sm text-slate-600 dark:text-slate-400">
                        ${d.totalInc > 0 ? formatCurrency(d.totalInc) : `R$ 0,00 <span class="text-red-500 text-[10px] block">(${formatCurrency(d.realizado * d.vIncUnit)})</span>`}
                    </td>
                    <td class="px-6 py-4 text-right font-mono text-sm font-black text-primary">${formatCurrency(d.totalRow)}</td>
                </tr>
            `;
        }).join('');
    }

    // Update Footer Totals
    document.getElementById('foot-sigtap').textContent = formatCurrency(totalSigtap);
    document.getElementById('foot-incentivo').textContent = formatCurrency(totalIncentivo);
    document.getElementById('foot-total').textContent = formatCurrency(totalGeral);
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
