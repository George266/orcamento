/**
 * Reconciliação da produção entre incentivos
 * Replica `producao.realizada` e `producao.aprovada` entre as pactuações do mesmo
 * instituto + procedimento + competência.
 *
 * POR QUÊ:
 *   A pactuação é gravada POR INCENTIVO (id = progId_instId_sigtap_competencia). Mas um
 *   atendimento realizado é um fato FÍSICO do par instituto+procedimento: se foi produzido,
 *   vale para todos os incentivos daquele procedimento — não existe "produziu no incentivo A
 *   mas não no B".
 *
 *   A tela Lançar Produção sempre replicou corretamente. A tela de Monitoramento não: ela
 *   replicava apenas dentro do incentivo filtrado, e o `aprovada` não replicava de forma
 *   alguma. Resultado: o mesmo procedimento aparecia com 637 produzidos num incentivo e 0 no
 *   outro, e a agregação (que pega a primeira linha encontrada) reportava zero.
 *
 *   O código já foi corrigido; este script conserta o que ficou gravado errado.
 *
 * REGRA:
 *   Para cada grupo (instId + sigtap normalizado + competencia), o valor correto é o MAIOR
 *   encontrado entre as cópias — a mesma dedup que as telas usam na leitura. Esse valor é
 *   gravado nas cópias que divergirem.
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
    console.log(`  RECONCILIAÇÃO DE PRODUÇÃO ${isDryRun ? '(DRY RUN — nada será gravado)' : '(REAL)'}`);
    console.log(`  realizada/aprovada := maior valor entre os incentivos do mesmo`);
    console.log(`  instituto + procedimento + competência`);
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

    // 2. Em cada grupo, o valor correto é o MAIOR entre as cópias
    const toUpdate = [];
    let gruposUnicos = 0;    // um só incentivo: nada a replicar
    let gruposCoerentes = 0; // todas as cópias já iguais

    for (const [chave, docs] of grupos) {
        if (docs.length < 2) { gruposUnicos++; continue; }

        const maiorRealizada = docs.reduce((m, x) => Math.max(m, parseInt(x.data.producao?.realizada) || 0), 0);
        const maiorAprovada  = docs.reduce((m, x) => Math.max(m, parseInt(x.data.producao?.aprovada)  || 0), 0);

        const divergentes = [];
        docs.forEach(x => {
            const r = parseInt(x.data.producao?.realizada) || 0;
            const a = parseInt(x.data.producao?.aprovada)  || 0;
            const patch = {};
            if (r !== maiorRealizada) patch['producao.realizada'] = maiorRealizada;
            if (a !== maiorAprovada)  patch['producao.aprovada']  = maiorAprovada;
            if (Object.keys(patch).length > 0) {
                divergentes.push({ ref: x.ref, id: x.id, patch, de: { r, a }, para: { r: maiorRealizada, a: maiorAprovada } });
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
            const partes = [];
            if ('producao.realizada' in u.patch) partes.push(`realizada ${u.de.r} → ${u.para.r}`);
            if ('producao.aprovada'  in u.patch) partes.push(`aprovada ${u.de.a} → ${u.para.a}`);
            console.log(`     - ${u.id}: ${partes.join(', ')}`);
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
