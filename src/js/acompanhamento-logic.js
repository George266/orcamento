import { Repository } from './repository.js';

function formatCurrency(value) {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}

function formatNumber(value) {
    return new Intl.NumberFormat('pt-BR').format(value);
}

export async function initAcompanhamento() {
    const pactuacoes = await Repository.getPactuacoes();
    const insts = await Repository.getInstitutos();
    const procs = await Repository.getProcedimentos();

    const tbody = document.getElementById('monitoring-table-body');
    if (!tbody) return;

    if (pactuacoes.length === 0) {
        tbody.innerHTML = `<tr><td colspan="9" class="px-6 py-12 text-center text-slate-400 italic">Nenhum dado importado para acompanhamento.</td></tr>`;
        return;
    }

    tbody.innerHTML = pactuacoes.map(p => {
        const inst = insts.find(i => i.id === p.instId);
        const proc = procs.find(pr => pr.sigtap === p.sigtap);

        const pactuado = parseInt(p.ofertaMinima || 0);
        const realizado = parseInt(p.producao?.realizada || 0);
        const statusVal = pactuado > 0 ? (realizado / pactuado) * 100 : 100;

        let statusLabel = 'Atingido';
        let statusClass = 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400';

        if (realizado === 0) {
            statusLabel = 'Sem oferta';
            statusClass = 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400';
        } else if (statusVal < 90) {
            statusLabel = 'Verificar';
            statusClass = 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400';
        }

        const vlrSigtap = parseFloat(proc?.vlrSigtap || 0);
        const vlrIncentivo = parseFloat(p.vlrIncentivo || 0);
        const totalUnit = vlrSigtap + vlrIncentivo;

        return `
            <tr class="group hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors">
                <td class="px-6 py-4 text-sm font-medium text-text-main dark:text-white">${inst?.sigla || inst?.nome || '???'}</td>
                <td class="px-6 py-4 text-sm text-text-secondary dark:text-slate-300">${proc?.nome || p.sigtap}</td>
                <td class="px-6 py-4 text-right text-sm text-text-main dark:text-white font-medium">${formatNumber(pactuado)}</td>
                <td class="px-6 py-4 text-right text-sm text-text-main dark:text-white">${formatNumber(realizado)}</td>
                <td class="px-6 py-4 text-right text-sm text-text-main dark:text-white">-</td> <!-- 3º Turno or other detail -->
                <td class="px-6 py-4 text-right text-sm text-text-secondary dark:text-slate-400">${formatCurrency(vlrSigtap * realizado)}</td>
                <td class="px-6 py-4 text-right text-sm text-text-secondary dark:text-slate-400">${formatCurrency(vlrIncentivo * realizado)}</td>
                <td class="px-6 py-4 text-right text-sm font-bold text-text-main dark:text-white">${formatCurrency(totalUnit * realizado)}</td>
                <td class="px-6 py-4 text-center">
                    <span class="inline-flex items-center rounded-full ${statusClass} px-2.5 py-1 text-xs font-bold">
                        ${statusLabel}
                    </span>
                </td>
            </tr>
        `;
    }).join('');
}

initAcompanhamento();
