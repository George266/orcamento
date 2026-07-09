/**
 * Regras de negócio centrais (fonte única da verdade).
 *
 * Todas as telas (dashboards, acompanhamentos, financeiro, lançamento) devem usar
 * estas funções para calcular atingimento de meta, status e incentivo. O objetivo é
 * eliminar as divergências que surgiam de cada tela reimplementar a mesma fórmula.
 *
 * Convenções de negócio (confirmadas):
 *  - Atingimento da meta = OFERTA (lançada pelo instituto) ÷ META.
 *  - META da rede = soma entre institutos, deduplicando o mesmo procedimento que
 *    aparece em vários incentivos do MESMO instituto (conta uma vez por instituto).
 *  - Incentivo só é pago quando a meta é atingida E há oferta ( > 0 ).
 */

// --- STATUS / ATINGIMENTO -------------------------------------------------

// Limiares unificados de status, em %. Alterar aqui reflete em TODAS as telas.
//   < CRITICO           → 'critico'  (vermelho)
//   CRITICO .. <ATINGIDA → 'alerta'   (amarelo)
//   >= ATINGIDA         → 'ok'       (verde)
export const STATUS_THRESHOLDS = { critico: 70, atingida: 100 };

/** Percentual de atingimento (0..∞), arredondado. Meta 0/ausente → 0. */
export function atingimentoPct(oferta, meta) {
    const m = Number(meta) || 0;
    if (m <= 0) return 0;
    return Math.round((Number(oferta || 0) / m) * 100);
}

/** A meta foi atingida? Meta 0/ausente conta como NÃO atingida (não há meta a bater). */
export function metaAtingida(oferta, meta) {
    const m = Number(meta) || 0;
    if (m <= 0) return false;
    return Number(oferta || 0) >= m;
}

/** Classifica um percentual em 'critico' | 'alerta' | 'ok'. */
export function statusMeta(pct) {
    if (pct >= STATUS_THRESHOLDS.atingida) return 'ok';
    if (pct >= STATUS_THRESHOLDS.critico) return 'alerta';
    return 'critico';
}

// Cores/rótulos associados a cada status — para manter a UI consistente entre telas.
export const STATUS_UI = {
    ok:      { label: 'Meta atingida',  cor: 'green',  hex: '#16a34a' },
    alerta:  { label: 'Em atenção',     cor: 'amber',  hex: '#d97706' },
    critico: { label: 'Crítico',        cor: 'red',    hex: '#dc2626' },
};

// --- MAPEAMENTO DE CAMPOS (fonte única) -----------------------------------
// Conceito de negócio ↔ campo no banco (derivado dos rótulos das colunas da tela central):
//   OFERTA (instituto)      → ofertado             (coluna "Ofertado (Instituto)")
//   PRODUZIDO (central)     → producao.realizada   (coluna "Produzido") — base do pagamento
//   RETORNO SMSA (central)  → producao.aprovada    (coluna "Retorno SMSA")
//   META                    → ofertaMinima         (ou grupo.ofertaMinima quando há grupo de oferta)
export const getOferta      = (p) => Number(p?.ofertado || 0);
export const getProduzido   = (p) => Number(p?.producao?.realizada || 0);
export const getRetornoSMSA = (p) => Number(p?.producao?.aprovada || 0);

/** Meta do item, resolvendo o grupo de oferta quando houver (item de grupo tem ofertaMinima=0). */
export function getMeta(p, gruposOferta = []) {
    if (p?.grupoOfertaId && Array.isArray(gruposOferta)) {
        const g = gruposOferta.find(x => x.id === p.grupoOfertaId);
        if (g) return Number(g.ofertaMinima || 0);
    }
    return Number(p?.ofertaMinima || 0);
}

// --- INCENTIVO ------------------------------------------------------------

/**
 * Calcula o valor de incentivo de um item/grupo.
 *
 * Estrutura extensível por TIPO de cálculo: hoje só existe 'padrao'; regras
 * diferenciadas (ex.: percentual de um valor ao atingir a meta) entram como novos
 * `case` aqui, sem alterar nenhuma tela.
 *
 * @param {object} p
 * @param {string} [p.tipo='padrao'] - tipo de cálculo do incentivo
 * @param {number} p.vlrIncentivo    - valor unitário do incentivo
 * @param {number} p.quantidade      - nº de procedimentos que remuneram o incentivo
 * @param {number} p.oferta          - oferta lançada pelo instituto (gate de atingimento)
 * @param {number} p.meta            - meta pactuada (já resolvida: do grupo, se for grupo)
 * @returns {number} valor de incentivo devido (0 se não faz jus)
 */
export function calcIncentivo({ tipo = 'padrao', vlrIncentivo = 0, quantidade = 0, oferta = 0, meta = 0 } = {}) {
    const temOferta = Number(oferta || 0) > 0;
    const atingiu = metaAtingida(oferta, meta);

    switch (tipo) {
        case 'padrao':
        default:
            // Regra atual: meta atingida + oferta > 0 → incentivo unitário por procedimento.
            // Senão, 0 (o valor "perdido" pode ser exibido à parte, mas não entra no total).
            if (!temOferta || !atingiu) return 0;
            return Number(vlrIncentivo || 0) * Number(quantidade || 0);

        // case 'percentual':
        //   Espaço reservado: incentivo = percentual * baseDeCalculo quando a meta é atingida.
        //   Aguardando as regras específicas para habilitar.
    }
}

// --- AGREGAÇÃO POR SIGTAP (dedup instituto+procedimento, soma entre institutos) ----

/**
 * Consolida uma lista de pactuações de um MESMO procedimento (mesmo SIGTAP), aplicando:
 *  - dedup por instituto: o procedimento conta uma vez por instituto, mesmo que apareça
 *    em vários incentivos (usa o maior valor encontrado entre as linhas do instituto);
 *  - soma entre institutos.
 *
 * Os acessores permitem que cada tela informe DE ONDE vêm oferta/produção/meta, já que os
 * nomes de campo variam (producao.realizada, ofertado, producao.aprovada, grupo.ofertaMinima).
 *
 * @param {Array} itens - pactuações do mesmo SIGTAP
 * @param {object} acc  - acessores { instId, meta, oferta, producao }
 * @returns {{ meta:number, oferta:number, producao:number, porInstituto:Object }}
 */
export function consolidarSigtap(itens, acc) {
    const getInst = acc.instId  || (p => p.instId);
    const getMeta = acc.meta    || (p => Number(p.ofertaMinima || 0));
    const getOfer = acc.oferta  || (p => Number(p.producao?.realizada || 0));
    const getProd = acc.producao || (p => Number(p.producao?.aprovada || 0));

    const porInstituto = {};
    for (const p of itens) {
        const inst = getInst(p);
        if (!porInstituto[inst]) porInstituto[inst] = { meta: 0, oferta: 0, producao: 0 };
        // maior valor por instituto (dedup de linhas repetidas em vários incentivos)
        porInstituto[inst].meta     = Math.max(porInstituto[inst].meta, getMeta(p));
        porInstituto[inst].oferta   = Math.max(porInstituto[inst].oferta, getOfer(p));
        porInstituto[inst].producao = Math.max(porInstituto[inst].producao, getProd(p));
    }

    const total = Object.values(porInstituto).reduce((acc2, v) => ({
        meta: acc2.meta + v.meta,
        oferta: acc2.oferta + v.oferta,
        producao: acc2.producao + v.producao,
    }), { meta: 0, oferta: 0, producao: 0 });

    return { ...total, porInstituto };
}

// --- OFERTA DA REDE (gate da meta) ----------------------------------------
// A meta NUNCA é avaliada por instituto: ela é da REDE. O atingimento usa a soma
// das ofertas de todos os institutos para o mesmo procedimento (ou grupo de oferta).
// Estes helpers dão a "fonte única" desse cálculo para todas as telas.

/** Chave de agregação da oferta da rede: grupo de oferta (se houver) ou SIGTAP normalizado. */
export function chaveOfertaRede(p) {
    if (p?.grupoOfertaId) return `grupo_${p.grupoOfertaId}`;
    return `sig_${String(p?.sigtap || '').replace(/\D/g, '')}`;
}

/**
 * Mapa { chave -> oferta somada da REDE } a partir de pactuações de UMA competência.
 * Regra por instituto: grupo de oferta soma os SIGTAPs do grupo; procedimento individual
 * usa a MAIOR oferta entre incentivos. Entre institutos: soma.
 *
 * IMPORTANTE: passe apenas pactuações da mesma competência (a oferta varia por mês).
 *
 * @param {Array} pactuacoes - pactuações da rede inteira, já filtradas por competência
 * @returns {Object} mapa chave (via chaveOfertaRede) -> oferta total da rede
 */
export function mapaOfertaRede(pactuacoes = []) {
    const porChaveInst = {}; // chave -> { instId -> oferta }
    for (const p of pactuacoes) {
        const chave = chaveOfertaRede(p);
        if (!porChaveInst[chave]) porChaveInst[chave] = {};
        const atual = porChaveInst[chave][p.instId] || 0;
        porChaveInst[chave][p.instId] = p?.grupoOfertaId
            ? atual + getOferta(p)          // grupo: soma os sigtaps do mesmo instituto
            : Math.max(atual, getOferta(p)); // individual: maior oferta do instituto
    }
    const mapa = {};
    for (const chave of Object.keys(porChaveInst)) {
        mapa[chave] = Object.values(porChaveInst[chave]).reduce((s, v) => s + v, 0);
    }
    return mapa;
}
