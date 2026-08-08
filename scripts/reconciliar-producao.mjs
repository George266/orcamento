/**
 * Reconciliação de produção E oferta entre incentivos
 * Replica `producao.realizada`, `producao.aprovada`, as semanas `producao.sem1..sem5` e o
 * espelho `ofertado` entre as pactuações do mesmo instituto + procedimento + competência.
 *
 * POR QUÊ:
 *   A pactuação é gravada POR INCENTIVO (id = progId_instId_sigtap_competencia). Mas produção
 *   e oferta são fatos FÍSICOS do par instituto+procedimento: se foi produzido — ou ofertado —
 *   vale para todos os incentivos daquele procedimento. Não existe "produziu no incentivo A
 *   mas não no B", nem "ofertou 605 no A e 0 no B".
 *
 *   Sem isso, a meta (que mora no grupo de oferta e é comum aos incentivos) acaba comparada
 *   contra uma oferta parcial, e o incentivo é reportado como perdido sem ter sido.
 *
 *   A tela Lançar Produção sempre replicou corretamente. A tela de Monitoramento não: ela
 *   replicava apenas dentro do incentivo filtrado, e o `aprovada` não replicava de forma
 *   alguma. Resultado: o mesmo procedimento aparecia com 637 produzidos num incentivo e 0 no
 *   outro, e a agregação (que pega a primeira linha encontrada) reportava zero.
 *
 *   O código já foi corrigido; este script conserta o que ficou gravado errado.
 *
 * REGRA:
 *   Para cada grupo (instId + sigtap normalizado + competencia):
 *
 *   - Produção: o valor correto de `realizada`/`aprovada` é o MAIOR entre as cópias — a mesma
 *     dedup que as telas usam na leitura.
 *
 *   - Oferta: a fonte da verdade é a cópia com a MAIOR soma de semanas, e o conjunto sem1..sem5
 *     dela é replicado inteiro. Não se toma o maior de cada semana isoladamente: isso montaria
 *     um lançamento que nunca existiu (semana 1 de uma cópia, semana 2 de outra). `ofertado`
 *     recebe a soma correspondente. Se nenhuma cópia tem semanas, só o maior `ofertado` é
 *     replicado e as semanas ficam intactas.
 *
 *   Grupos com um único documento são ignorados (não há o que reconciliar).
 *   O campo `incentivoPago` NÃO é tocado: ele depende do vlrIncentivo e da meta de cada
 *   incentivo, e é recalculado e persistido pelas telas ao renderizar.
 *
 * COMO USAR:
 * 1. Instale a dependência (apenas uma vez):
 *    npm install firebase-admin --save-dev
 *
 * 2. Baixe a chave de serviço do Firebase Console:
 *    Firebase Console → Project Settings → Service Accounts → Generate new private key
 *    Salve como "service-account.json" na RAIZ do projeto (orcamento/)
 *    ATENÇÃO: não suba este arquivo para o git!
 *
 * 3. Execute a pré-visualização (não grava nada):
 *    node scripts/reconciliar-producao.mjs --dry-run
 *
 * 4. Execute a reconciliação real:
 *    node scripts/reconciliar-producao.mjs
 */

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const isDryRun = process.argv.includes('--dry-run');

// --- Configuração ---
const PROJECT_ID = 'orcamento-5f8c8';
const COLLECTION = 'pactuacoes';
const BATCH_SIZE = 400;
const SEMANAS = ['sem1', 'sem2', 'sem3', 'sem4', 'sem5'];

/** Mesma normalização de business-rules.js: preserva o sufixo de variante (ex.: -CARD). */
function normalizarCodigo(sigtap) {
    return String(sigtap || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
}

async function main() {
    const serviceAccountPath = join(__dirname, '..', 'service-account.json');
    let serviceAccount;
    try {
        serviceAccount = JSON.parse(readFileSync(serviceAccountPath, 'utf8'));
    } catch {
        console.error('\n❌ Arquivo service-account.json não encontrado em:', serviceAccountPath);
        console.error('Siga as instruções no topo deste arquivo para baixar a chave de serviço.\n');
        process.exit(1);
    }

    initializeApp({ credential: cert(serviceAccount), projectId: PROJECT_ID });
    const db = getFirestore();

    console.log(`\n${'='.repeat(70)}`);
    console.log(`  RECONCILIAÇÃO DE PRODUÇÃO E OFERTA ${isDryRun ? '(DRY RUN — nada será gravado)' : '(REAL)'}`);
    console.log(`  realizada/aprovada := maior entre os incentivos do mesmo`);
    console.log(`  instituto + procedimento + competência`);
    console.log(`  semanas/ofertado   := conjunto da cópia com maior soma de semanas`);
    console.log(`${'='.repeat(70)}\n`);

    console.log(`🔍 Lendo coleção: ${COLLECTION}...`);
    const snapshot = await db.collection(COLLECTION).get();
    console.log(`   Total de documentos: ${snapshot.size}\n`);

    // 1. Agrupa por instituto + procedimento + competência
    const grupos = new Map();
    snapshot.docs.forEach(d => {
        const data = d.data();
        const chave = `${data.instId}|${normalizarCodigo(data.sigtap)}|${data.competencia}`;
        if (!grupos.has(chave)) grupos.set(chave, []);
        grupos.get(chave).push({ ref: d.ref, id: d.id, data });
    });

    // 2. Em cada grupo, consolida produção (maior) e oferta (conjunto de semanas vencedor)
    const toUpdate = [];
    let gruposUnicos = 0;    // um só incentivo: nada a replicar
    let gruposCoerentes = 0; // todas as cópias já iguais

    const somaSemanas = (data) => SEMANAS.reduce((s, w) => s + (parseInt(data?.producao?.[w]) || 0), 0);

    for (const [chave, docs] of grupos) {
        if (docs.length < 2) { gruposUnicos++; continue; }

        const maiorRealizada = docs.reduce((m, x) => Math.max(m, parseInt(x.data.producao?.realizada) || 0), 0);
        const maiorAprovada  = docs.reduce((m, x) => Math.max(m, parseInt(x.data.producao?.aprovada)  || 0), 0);

        // Oferta: a cópia com a maior soma de semanas é a fonte; replica o conjunto inteiro.
        const fonteOferta = docs.reduce((melhor, x) => somaSemanas(x.data) > somaSemanas(melhor.data) ? x : melhor, docs[0]);
        const somaFonte = somaSemanas(fonteOferta.data);
        const semanasAlvo = somaFonte > 0 ? SEMANAS.map(w => parseInt(fonteOferta.data.producao?.[w]) || 0) : null;
        const ofertadoAlvo = somaFonte > 0
            ? somaFonte
            : docs.reduce((m, x) => Math.max(m, parseInt(x.data.ofertado) || 0), 0);

        const divergentes = [];
        docs.forEach(x => {
            const r = parseInt(x.data.producao?.realizada) || 0;
            const a = parseInt(x.data.producao?.aprovada)  || 0;
            const o = parseInt(x.data.ofertado) || 0;
            const patch = {};
            const mudou = [];

            if (r !== maiorRealizada) { patch['producao.realizada'] = maiorRealizada; mudou.push(`realizada ${r} → ${maiorRealizada}`); }
            if (a !== maiorAprovada)  { patch['producao.aprovada']  = maiorAprovada;  mudou.push(`aprovada ${a} → ${maiorAprovada}`); }

            // Semanas: só mexe se o conjunto inteiro divergir da fonte, e então grava as 5.
            if (semanasAlvo && SEMANAS.some((w, i) => (parseInt(x.data.producao?.[w]) || 0) !== semanasAlvo[i])) {
                SEMANAS.forEach((w, i) => { patch[`producao.${w}`] = semanasAlvo[i]; });
                mudou.push(`semanas → [${semanasAlvo.join(', ')}]`);
            }
            if (o !== ofertadoAlvo) { patch.ofertado = ofertadoAlvo; mudou.push(`ofertado ${o} → ${ofertadoAlvo}`); }

            if (Object.keys(patch).length > 0) {
                divergentes.push({ ref: x.ref, id: x.id, patch, mudou });
            }
        });

        if (divergentes.length === 0) { gruposCoerentes++; continue; }
        divergentes.forEach(x => toUpdate.push({ ...x, chave }));
    }

    console.log(`   Grupos com um único incentivo (ignorados): ${gruposUnicos}`);
    console.log(`   Grupos já coerentes entre incentivos: ${gruposCoerentes}`);
    console.log(`   Documentos a reconciliar: ${toUpdate.length}\n`);

    if (toUpdate.length > 0) {
        console.log(`   Amostra das correções (até 20):`);
        toUpdate.slice(0, 20).forEach(u => {
            console.log(`     - ${u.id}: ${u.mudou.join(', ')}`);
        });
        if (toUpdate.length > 20) console.log(`     ... e mais ${toUpdate.length - 20} documento(s).`);
        console.log('');
    }

    if (!isDryRun && toUpdate.length > 0) {
        console.log(`   💾 Gravando ${toUpdate.length} correções...`);
        for (let i = 0; i < toUpdate.length; i += BATCH_SIZE) {
            const chunk = toUpdate.slice(i, i + BATCH_SIZE);
            const batch = db.batch();
            // Caminhos com ponto atualizam só o campo aninhado, preservando sem1..sem5.
            chunk.forEach(u => batch.update(u.ref, u.patch));
            await batch.commit();
            console.log(`     Lote ${Math.floor(i / BATCH_SIZE) + 1}: ${chunk.length} docs atualizados`);
        }
        console.log(`   ✅ Reconciliação concluída!\n`);
    }

    console.log(`${'='.repeat(70)}`);
    console.log(`  RESUMO: ${toUpdate.length} documento(s) ${isDryRun ? 'seriam reconciliados' : 'reconciliados'}.`);
    if (isDryRun) {
        console.log(`\n  Execute sem --dry-run para gravar de verdade:`);
        console.log(`  node scripts/reconciliar-producao.mjs\n`);
    } else {
        console.log('');
    }
}

main().catch(err => {
    console.error('Erro:', err);
    process.exit(1);
});
