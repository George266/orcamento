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

async function initAcompanhamentoInst() {
    onAuthStateChanged(auth, async (user) => {
        if (!user) return;

        const profile = await Repository.getUserByEmail(user.email);
        if (!profile || profile.role !== 'Institutos' || !profile.instId) return;

        const instId = profile.instId;
        const instituto = await Repository.getInstitutoById(instId);

        // Update Headers
        const nameHeader = document.getElementById('user-name-header');
        if (nameHeader) nameHeader.textContent = profile.name || user.email;

        const instHeader = document.getElementById('inst-header-name');
        if (instHeader) instHeader.textContent = instituto?.nome || 'Ponto de Pactuação';

        const pageName = document.getElementById('inst-page-name');
        if (pageName) pageName.textContent = instituto?.nome || 'Instituto';

        setupProfileMenu();

        const allPactuacoes = await Repository.getPactuacoes();
        localPactuacoes = allPactuacoes.filter(p => p.instId === instId);
        localProcs = await Repository.getProcedimentos();

        // Populate Filters
        const compFilter = document.getElementById('filter-competencia');

        if (localPactuacoes.length > 0) {
            const comps = [...new Set(localPactuacoes.map(p => p.competencia))].sort().reverse();
            compFilter.innerHTML = comps.map(c => `<option value="${c}">${c}</option>`).join('');
        }

        // Action Buttons
        // Use 'input' event on search box for real-time filtering or keep button for manual trigger
        const searchInput = document.getElementById('buscainteligente');
        if (searchInput) {
            searchInput.addEventListener('input', renderTable);
        }

        const filterComp = document.getElementById('filter-competencia');
        if (filterComp) {
            filterComp.addEventListener('change', renderTable);
        }

        // Remove old button listener if button doesn't exist, or keep if new layout has one
        // In new layout we removed the explicit "Filtrar" button for text search, it's real-time or implicit
        // checking html: there is NO filter-button ID in new html. There is filter-competencia and buscainteligente.

        renderTable();

        renderTable();
    });
}

// Add autoSave function near the top or export it
window.autoSave = async function (pactId, field, value) {
    const pact = localPactuacoes.find(p => p.id === pactId);
    if (!pact) return;

    if (!pact.producao) pact.producao = { realizada: 0, sem1: 0, sem2: 0, sem3: 0, sem4: 0 };

    // Update local state
    pact.producao[field] = parseInt(value) || 0;

    // Recalculate Total Realizada
    pact.producao.realizada =
        (parseInt(pact.producao.sem1) || 0) +
        (parseInt(pact.producao.sem2) || 0) +
        (parseInt(pact.producao.sem3) || 0) +
        (parseInt(pact.producao.sem4) || 0);

    // Update Firestore
    try {
        await Repository.savePactuacao(pact);
        // console.log(`Pact ${pactId} updated: ${field} = ${value}`);

        // Update Row UI calculations immediately without re-rendering everything
        updateRowUI(pactId, pact);
        // updateTotalStats(); // Removed in Phase 13 (No totals on this page)
    } catch (error) {
        console.error("AutoSave Error:", error);
    }
};

function updateRowUI(pactId, pact) {
    const row = document.querySelector(`tr[data-id="${pactId}"]`);
    if (!row) return;

    const offer = parseInt(pact.ofertaMinima || 0);
    const real = pact.producao.realizada;
    const status = offer > 0 ? (real / offer) * 100 : 0;

    // Update Status Badge
    const badgeCell = row.querySelector('.status-cell');
    if (badgeCell) {
        badgeCell.innerHTML = `
             <div class="flex flex-col items-center gap-1">
                <span class="text-[10px] font-black ${status >= 100 ? 'text-emerald-600' : 'text-slate-400'}">${Math.round(status)}%</span>
                <div class="w-12 bg-slate-100 h-1 rounded-full overflow-hidden">
                    <div class="h-full ${status >= 100 ? 'bg-emerald-500' : 'bg-primary'}" style="width: ${Math.min(status, 100)}%"></div>
                </div>
            </div>
        `;
    }
}

// Phase 13: Removed updateTotalStats function as it is now in Financeiro page

// Add to window for inline onclick
window.deletePact = async function (id) {
    if (!confirm('Tem certeza que deseja excluir esta linha do Plano Operativo?')) return;

    try {
        await Repository.deletePactuacao(id);

        // Update local state
        localPactuacoes = localPactuacoes.filter(p => p.id !== id);

        // Update UI
        const row = document.querySelector(`tr[data-id="${id}"]`);
        if (row) row.remove();

        // Phase 13: Removed updateTotalStats call

        // Re-check empty state
        const tbody = document.getElementById('table-acompanhamento-inst');
        if (localPactuacoes.length === 0 && tbody) {
            tbody.innerHTML = `<tr><td colspan="11" class="px-6 py-10 text-center text-slate-400 italic">Nenhum dado encontrado.</td></tr>`;
        }

    } catch (error) {
        console.error('Erro ao excluir:', error);
        alert('Erro ao excluir linha.');
    }
};

function renderTable() {
    const compValue = document.getElementById('filter-competencia')?.value;
    const searchValue = document.getElementById('buscainteligente')?.value.toLowerCase();

    if (!compValue) return; // Wait for population

    let filtered = localPactuacoes.filter(p => p.competencia === compValue);

    if (searchValue) {
        filtered = filtered.filter(p => {
            const proc = localProcs.find(pr => pr.sigtap === p.sigtap);
            const term = searchValue;
            return (
                p.sigtap.includes(term) ||
                (proc && proc.nome.toLowerCase().includes(term))
            );
        });
    }

    const tbody = document.getElementById('table-acompanhamento-inst');
    if (!tbody) return;

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="11" class="px-6 py-10 text-center text-slate-400 italic">Nenhum dado encontrado para os filtros selecionados.</td></tr>`;
    } else {
        tbody.innerHTML = filtered.map(p => {
            const proc = localProcs.find(pr => pr.sigtap === p.sigtap);
            // Assuming we can get Program Name, if not, use placeholder or fetch programs
            const progName = "Programa Padrão"; // TODO: Fetch real program name if needed or use ID

            const pact = parseInt(p.ofertaMinima || 0);
            const vBase = parseFloat(p.vlrSigtapBase || 0);
            const vInc = parseFloat(p.vlrIncentivo || 0);

            const prod = p.producao || { sem1: 0, sem2: 0, sem3: 0, sem4: 0 };

            return `
                <tr data-id="${p.id}" class="hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors group">
                    <td class="px-3 py-3 whitespace-nowrap text-xs font-medium text-slate-900 dark:text-white">
                        <span class="text-[10px] text-slate-500 uppercase tracking-widest">${progName}</span>
                    </td>
                    <td class="px-2 py-3 whitespace-nowrap text-xs text-center font-mono text-slate-500">
                        ${p.sigtap}
                    </td>
                    <td class="px-3 py-3 whitespace-nowrap text-xs font-medium text-slate-900 dark:text-white">
                        <div class="flex flex-col">
                            <span class="font-bold truncate max-w-[180px]" title="${proc?.nome}">${proc?.nome || 'Procedimento'}</span>
                        </div>
                    </td>
                    <td class="px-2 py-3 text-center font-mono text-xs font-bold text-slate-500 bg-slate-50/50">${formatNumber(pact)}</td>
                    <td class="px-2 py-3 text-right font-mono text-xs text-slate-500">${formatCurrency(vBase)}</td>
                    <td class="px-2 py-3 text-right font-mono text-xs text-slate-500">${formatCurrency(vInc)}</td>
                    
                    <!-- Week Inputs -->
                    <td class="p-1"><input type="number" value="${prod.sem1 || 0}" onchange="autoSave('${p.id}', 'sem1', this.value)" class="w-full text-center text-xs border-slate-200 rounded px-1 py-1 focus:ring-primary focus:border-primary"></td>
                    <td class="p-1"><input type="number" value="${prod.sem2 || 0}" onchange="autoSave('${p.id}', 'sem2', this.value)" class="w-full text-center text-xs border-slate-200 rounded px-1 py-1 focus:ring-primary focus:border-primary"></td>
                    <td class="p-1"><input type="number" value="${prod.sem3 || 0}" onchange="autoSave('${p.id}', 'sem3', this.value)" class="w-full text-center text-xs border-slate-200 rounded px-1 py-1 focus:ring-primary focus:border-primary"></td>
                    <td class="p-1"><input type="number" value="${prod.sem4 || 0}" onchange="autoSave('${p.id}', 'sem4', this.value)" class="w-full text-center text-xs border-slate-200 rounded px-1 py-1 focus:ring-primary focus:border-primary"></td>

                    <td class="px-2 py-3 text-center status-cell">
                        <!-- Populated by updateRowUI -->
                        <span class="text-[10px] text-slate-400">---</span>
                    </td>
                    
                </tr>
            `;
        }).join('');

        // Initial UI update for all rows
        filtered.forEach(p => updateRowUI(p.id, p));
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
}

initAcompanhamentoInst();
