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

async function initFinanceiroInst() {
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
        if (instHeader) instHeader.textContent = instituto?.nome || 'Financeiro';

        const pageName = document.getElementById('inst-page-name');
        if (pageName) pageName.textContent = instituto?.nome || 'Instituto';

        setupProfileMenu();

        const allPactuacoes = await Repository.getPactuacoes();
        localPactuacoes = allPactuacoes.filter(p => p.instId === instId);
        localProcs = await Repository.getProcedimentos();

        // Populate Filters
        const compFilter = document.getElementById('filter-competencia-fin');

        if (localPactuacoes.length > 0) {
            const comps = [...new Set(localPactuacoes.map(p => p.competencia))].sort().reverse();
            compFilter.innerHTML = comps.map(c => `<option value="${c}">${c}</option>`).join('');

            // Default to newest
            if (comps.length > 0) compFilter.value = comps[0];
        }

        // Action Buttons
        document.getElementById('filter-button-fin').addEventListener('click', renderTable);

        renderTable();
    });
}

function renderTable() {
    const compValue = document.getElementById('filter-competencia-fin').value;

    let filtered = localPactuacoes.filter(p => p.competencia === compValue);

    let totalSigtap = 0;
    let totalIncentivo = 0;
    let totalGeral = 0;

    const tbody = document.getElementById('table-financeiro-inst');
    if (!tbody) return;

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="px-6 py-10 text-center text-slate-400 italic">Nenhum dado financeiro encontrado para este período.</td></tr>`;
    } else {
        tbody.innerHTML = filtered.map(p => {
            const proc = localProcs.find(pr => pr.sigtap === p.sigtap);
            const real = parseInt(p.producao?.realizada || 0);

            // Unit Values
            const vBaseUnit = parseFloat(p.vlrSigtapBase || 0);
            const vIncUnit = parseFloat(p.vlrIncentivo || 0);

            // Total Values
            const totalBase = vBaseUnit * real;
            const totalInc = vIncUnit * real;
            const totalRow = totalBase + totalInc;

            totalSigtap += totalBase;
            totalIncentivo += totalInc;
            totalGeral += totalRow;

            return `
                <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors">
                    <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-slate-900 dark:text-white">
                        <div class="flex flex-col">
                            <span class="font-bold">${proc?.nome || 'Procedimento'}</span>
                            <span class="text-[10px] text-slate-500 font-mono">${p.sigtap}</span>
                        </div>
                    </td>
                    <td class="px-6 py-4 text-center font-mono text-sm font-bold text-slate-800 dark:text-slate-200">${formatNumber(real)}</td>
                    <td class="px-6 py-4 text-right font-mono text-sm text-slate-600 dark:text-slate-400">${formatCurrency(totalBase)}</td>
                    <td class="px-6 py-4 text-right font-mono text-sm text-slate-600 dark:text-slate-400">${formatCurrency(totalInc)}</td>
                    <td class="px-6 py-4 text-right font-mono text-sm font-black text-primary">${formatCurrency(totalRow)}</td>
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

    // Export Button
    const exportBtn = document.getElementById('btn-export-fin');
    if (exportBtn) {
        exportBtn.addEventListener('click', exportToCSV);
    }
}

function exportToCSV() {
    const compValue = document.getElementById('filter-competencia-fin')?.value;
    let filtered = localPactuacoes.filter(p => p.competencia === compValue);

    if (filtered.length === 0) {
        alert("Não há dados para exportar nesta competência.");
        return;
    }

    // Header
    let csvContent = "data:text/csv;charset=utf-8,";
    csvContent += "Competencia;Codigo SIGTAP;Procedimento;Qtd Produzida;Vlr Unit SIGTAP;Vlr Unit Incentivo;Total SIGTAP;Total Incentivo;Total Geral\r\n";

    filtered.forEach(p => {
        const proc = localProcs.find(pr => pr.sigtap === p.sigtap);
        const real = parseInt(p.producao?.realizada || 0);
        const vBaseUnit = parseFloat(p.vlrSigtapBase || 0);
        const vIncUnit = parseFloat(p.vlrIncentivo || 0);
        const totalBase = vBaseUnit * real;
        const totalInc = vIncUnit * real;
        const totalRow = totalBase + totalInc;

        const row = [
            p.competencia,
            `"${p.sigtap}"`, // Quote to avoid scientific notation in Excel
            `"${proc?.nome || 'Procedimento'}"`,
            real,
            vBaseUnit.toFixed(2).replace('.', ','),
            vIncUnit.toFixed(2).replace('.', ','),
            totalBase.toFixed(2).replace('.', ','),
            totalInc.toFixed(2).replace('.', ','),
            totalRow.toFixed(2).replace('.', ',')
        ].join(";");
        csvContent += row + "\r\n";
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `Financeiro_${compValue || 'Geral'}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

initFinanceiroInst();
