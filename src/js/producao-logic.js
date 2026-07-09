import { Repository } from './repository.js';
import { auth } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { DateUtils } from './utils/date-utils.js';
import { getOferta, getProduzido, getRetornoSMSA, getMeta, calcIncentivo, mapaOfertaRede, chaveOfertaRede } from './business-rules.js';

function formatNumber(v) { return new Intl.NumberFormat('pt-BR').format(v || 0); }
function formatCurrency(v) { return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0); }
function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

let allPactuacoes = [];
let localProcs = [];
let localProgs = [];
let localInsts = [];
let localGruposOferta = [];
let currentComp = '';
let groupsByKey = {}; // key -> grupo (instituto+procedimento)

function initProducao() {
    onAuthStateChanged(auth, async (user) => {
        if (!user) return;
        const profile = await Repository.getUserByEmail(user.email);
        const role = (profile?.role || '').toString().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
        // Página exclusiva do perfil Orçamento (central)
        if (role !== 'orcamento') {
            const tbody = document.getElementById('producao-table-body');
            if (tbody) tbody.innerHTML = `<tr><td colspan="8" class="px-6 py-12 text-center text-red-500 font-medium">Acesso restrito ao perfil Orçamento.</td></tr>`;
            return;
        }

        [allPactuacoes, localProcs, localProgs, localInsts, localGruposOferta] = await Promise.all([
            Repository.getPactuacoes(),
            Repository.getProcedimentos(),
            Repository.getProgramas(),
            Repository.getInstitutos(),
            Repository.getGruposOferta(),
        ]);

        populateFilters();
        render();

        document.getElementById('filter-comp')?.addEventListener('change', (e) => { currentComp = e.target.value; render(); });
        document.getElementById('filter-inst')?.addEventListener('change', render);
        document.getElementById('search-input')?.addEventListener('input', render);
    });
}

function populateFilters() {
    const compSel = document.getElementById('filter-comp');
    if (compSel) {
        const comps = [...new Set(allPactuacoes.map(p => p.competencia).filter(Boolean))]
            .sort((a, b) => DateUtils.parseCompetencia(b) - DateUtils.parseCompetencia(a));
        compSel.innerHTML = comps.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
        currentComp = DateUtils.competenciaPadrao(comps);
        if (currentComp) compSel.value = currentComp;
    }

    const instSel = document.getElementById('filter-inst');
    if (instSel) {
        const instIds = [...new Set(allPactuacoes.map(p => p.instId))];
        const insts = instIds.map(id => localInsts.find(i => i.id === id)).filter(Boolean);
        insts.sort((a, b) => (a.sigla || a.nome || '').localeCompare(b.sigla || b.nome || ''));
        instSel.innerHTML = `<option value="">Todos os institutos</option>` +
            insts.map(i => `<option value="${escapeHtml(i.id)}">${escapeHtml(i.sigla || i.nome)}</option>`).join('');
    }
}

// Agrupa por (instituto + procedimento): a produção é lançada por instituto/procedimento
// e replicada entre os incentivos (programas) que compartilham o mesmo procedimento.
function buildGroups() {
    const instFilter = document.getElementById('filter-inst')?.value || '';
    const search = (document.getElementById('search-input')?.value || '').toLowerCase().trim();

    let items = allPactuacoes.filter(p => p.competencia === currentComp);
    if (instFilter) items = items.filter(p => p.instId === instFilter);

    const groups = {};
    items.forEach(p => {
        const key = `${p.instId}__${p.sigtap}`;
        if (!groups[key]) {
            const proc = localProcs.find(pr => pr.sigtap === p.sigtap);
            const inst = localInsts.find(i => i.id === p.instId);
            groups[key] = {
                key, instId: p.instId, sigtap: p.sigtap,
                instNome: inst?.sigla || inst?.nome || p.instId,
                procNome: proc?.nome || p.sigtap,
                items: [], progNomes: new Set(),
                meta: 0, oferta: 0, produzido: 0, aprovada: 0, vInc: 0,
            };
        }
        const g = groups[key];
        g.items.push(p);
        const prog = localProgs.find(pg => pg.id === p.progId);
        if (prog?.nome) g.progNomes.add(prog.nome);
        g.meta = Math.max(g.meta, getMeta(p, localGruposOferta));
        g.oferta = Math.max(g.oferta, getOferta(p));
        g.produzido = Math.max(g.produzido, getProduzido(p));
        g.aprovada = Math.max(g.aprovada, getRetornoSMSA(p));
        g.vInc = Math.max(g.vInc, parseFloat(p.vlrIncentivo || 0));
    });

    let list = Object.values(groups);
    if (search) {
        list = list.filter(g =>
            String(g.sigtap).includes(search) ||
            g.procNome.toLowerCase().includes(search) ||
            g.instNome.toLowerCase().includes(search));
    }
    list.sort((a, b) => a.instNome.localeCompare(b.instNome) || a.procNome.localeCompare(b.procNome));
    return list;
}

function render() {
    const tbody = document.getElementById('producao-table-body');
    if (!tbody) return;

    const list = buildGroups();
    groupsByKey = {};
    // Oferta da REDE por procedimento/grupo (soma entre institutos) para avaliar a meta.
    const netMap = mapaOfertaRede(allPactuacoes.filter(p => p.competencia === currentComp));
    list.forEach(g => {
        g.ofertaRede = netMap[chaveOfertaRede(g.items[0])] || 0;
        groupsByKey[g.key] = g;
    });

    const countEl = document.getElementById('row-count');
    if (countEl) countEl.textContent = `${list.length} linha(s)`;

    if (list.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" class="px-6 py-12 text-center text-slate-400 italic">Nenhum procedimento para esta competência/filtro.</td></tr>`;
        return;
    }

    tbody.innerHTML = list.map(g => {
        const incPrev = calcIncentivo({ vlrIncentivo: g.vInc, quantidade: g.produzido, oferta: g.ofertaRede, meta: g.meta });
        const incPago = calcIncentivo({ vlrIncentivo: g.vInc, quantidade: g.aprovada, oferta: g.ofertaRede, meta: g.meta });
        const progLabel = [...g.progNomes].join(', ');
        return `
        <tr class="even:bg-slate-50/70 dark:even:bg-slate-800/20 hover:bg-blue-50/60 dark:hover:bg-slate-800/50 transition-colors">
            <td class="px-4 py-3 font-medium text-slate-700 dark:text-slate-200">${escapeHtml(g.instNome)}</td>
            <td class="px-4 py-3">
                <div class="text-slate-700 dark:text-slate-200">${escapeHtml(g.procNome)}</div>
                <div class="text-[11px] text-slate-400 font-mono">${escapeHtml(g.sigtap)}${progLabel ? ' · ' + escapeHtml(progLabel) : ''}</div>
            </td>
            <td class="px-4 py-3 text-right font-mono text-slate-500">${formatNumber(g.meta)}</td>
            <td class="px-4 py-3 text-right font-mono text-blue-700 dark:text-blue-400 font-bold">${formatNumber(g.oferta)}</td>
            <td class="px-4 py-3 text-center bg-blue-50/40 dark:bg-blue-900/10">
                <input type="number" min="0" value="${g.produzido || ''}" data-key="${escapeHtml(g.key)}" data-field="produzido"
                    class="w-20 text-center rounded-lg border-slate-300 dark:border-slate-600 focus:ring-primary focus:border-primary text-sm bg-white dark:bg-slate-800 dark:text-white font-bold shadow-sm" placeholder="0" />
            </td>
            <td class="px-4 py-3 text-center bg-emerald-50/40 dark:bg-emerald-900/10">
                <input type="number" min="0" value="${g.aprovada || ''}" data-key="${escapeHtml(g.key)}" data-field="aprovada"
                    class="w-20 text-center rounded-lg border-slate-300 dark:border-slate-600 focus:ring-primary focus:border-primary text-sm bg-white dark:bg-slate-800 dark:text-white font-bold shadow-sm" placeholder="0" />
            </td>
            <td class="px-4 py-3 text-right font-mono text-slate-500" data-incprev="${escapeHtml(g.key)}">${formatCurrency(incPrev)}</td>
            <td class="px-4 py-3 text-right font-mono font-bold text-emerald-700 dark:text-emerald-400" data-incpago="${escapeHtml(g.key)}">${formatCurrency(incPago)}</td>
        </tr>`;
    }).join('');
}

// Salva ao sair do campo (delegação de evento)
document.addEventListener('change', async (e) => {
    const input = e.target.closest && e.target.closest('input[data-key][data-field]');
    if (!input) return;

    const key = input.getAttribute('data-key');
    const field = input.getAttribute('data-field'); // 'produzido' | 'aprovada'
    const val = parseInt(input.value) || 0;
    const g = groupsByKey[key];
    if (!g) return;

    const prodField = field === 'produzido' ? 'realizada' : 'aprovada';
    input.disabled = true;
    try {
        // Persiste em todas as pactuações do mesmo instituto+procedimento
        await Promise.all(g.items.map(p => {
            if (!p.producao) p.producao = {};
            p.producao[prodField] = val;
            return Repository.savePactuacao({ id: p.id, producao: { [prodField]: val } });
        }));
        if (field === 'produzido') g.produzido = val; else g.aprovada = val;

        // Recalcula e persiste o Incentivo Pago (por pactuação, com o vlrIncentivo de cada uma)
        if (field === 'aprovada') {
            await Promise.all(g.items.map(p => {
                const inc = calcIncentivo({
                    vlrIncentivo: parseFloat(p.vlrIncentivo || 0),
                    quantidade: g.aprovada,
                    oferta: g.ofertaRede, // meta pela REDE (soma dos institutos)
                    meta: getMeta(p, localGruposOferta),
                });
                p.incentivoPago = inc;
                return Repository.savePactuacao({ id: p.id, incentivoPago: inc });
            }));
        }

        // Atualiza as células de incentivo (resumo do grupo)
        const incPrev = calcIncentivo({ vlrIncentivo: g.vInc, quantidade: g.produzido, oferta: g.ofertaRede, meta: g.meta });
        const incPago = calcIncentivo({ vlrIncentivo: g.vInc, quantidade: g.aprovada, oferta: g.ofertaRede, meta: g.meta });
        const elPrev = document.querySelector(`[data-incprev="${key}"]`);
        const elPago = document.querySelector(`[data-incpago="${key}"]`);
        if (elPrev) elPrev.textContent = formatCurrency(incPrev);
        if (elPago) elPago.textContent = formatCurrency(incPago);

        toast('Salvo');
    } catch (err) {
        console.error('Erro ao salvar produção:', err);
        toast('Erro ao salvar. Tente novamente.', true);
    } finally {
        input.disabled = false;
    }
});

let toastTimer = null;
function toast(msg, isError = false) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.className = `fixed bottom-6 right-6 z-50 px-4 py-2 rounded-lg text-white text-sm shadow-lg ${isError ? 'bg-red-600' : 'bg-slate-900'}`;
    el.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add('hidden'), 1500);
}

initProducao();
