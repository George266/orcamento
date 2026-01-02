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
    const filtered = currentPeriod ? currentPactuacoes.filter(p => p.competencia === currentPeriod) : currentPactuacoes;

    let totalPactuado = 0;
    let totalRealizado = 0;
    let totalFinanceiro = 0;
    let criticalItems = 0;

    filtered.forEach(p => {
        const pact = parseInt(p.ofertaMinima || 0);
        const real = parseInt(p.producao?.realizada || 0);
        const vBase = parseFloat(p.vlrSigtapBase || 0);
        const vInc = parseFloat(p.vlrIncentivo || 0);

        totalPactuado += pact;
        totalRealizado += real;
        totalFinanceiro += (vBase + vInc) * real;

        const atingimento = pact > 0 ? (real / pact) * 100 : 100;
        if (atingimento < 70) criticalItems++;
    });

    // Update KPIs
    document.getElementById('stat-ofertas-qtd').textContent = formatNumber(totalPactuado);

    const atingimentoGlobal = totalPactuado > 0 ? (totalRealizado / totalPactuado) * 100 : 0;
    document.getElementById('stat-progress-val').textContent = Math.round(atingimentoGlobal) + '%';
    document.getElementById('stat-progress-bar').style.width = Math.min(atingimentoGlobal, 100) + '%';

    document.getElementById('stat-alertas-qtd').innerHTML = `${criticalItems} <span class="text-lg font-normal text-slate-500">Críticos</span>`;
    document.getElementById('stat-financeiro').textContent = formatCurrency(totalFinanceiro);

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
                                <span class="text-sm font-semibold text-slate-900 dark:text-white">${proc?.nome || p.sigtap}</span>
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
}

// Start
initInstituteDashboard();
