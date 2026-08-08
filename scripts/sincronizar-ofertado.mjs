/**
 * Sincronização do campo `ofertado`
 * Recalcula, em cada pactuação, `ofertado` = soma das semanas (producao.sem1..sem5).
 *
 * POR QUÊ:
 *   A OFERTA do instituto é lançada por semana (producao.sem1..sem5). O campo `ofertado`
 *   deveria ser apenas o espelho dessa soma, mas registros antigos/importados ficaram com
 *   `ofertado` desatualizado (0/stale) enquanto as semanas estavam preenchidas. Isso fazia
 *   a tela do Orçamento (e dashboard/financeiro) enxergar oferta 0 e reportar "meta não
 *   atingida", divergindo da tela do Instituto (que soma as semanas).
 *
 * REGRA (idêntica ao getOferta em business-rules.js):
 *   - Se a soma das semanas > 0  → `ofertado` = soma das semanas.
 *   - Se a soma das semanas == 0 → NÃO altera `ofertado` (pode ter vindo da tela de
 *     lançamento, que grava `ofertado` diretamente sem usar semanas).
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
 *    node scripts/sincronizar-ofertado.mjs --dry-run
 *
 * 4. Execute a sincronização real:
 *    node scripts/sincronizar-ofertado.mjs
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

/** Soma das semanas (producao.sem1..sem5) — a OFERTA lançada pelo instituto. */
function somaSemanas(data) {
    const prod = data?.producao || {};
    return [1, 2, 3, 4, 5].reduce((s, w) => s + (parseInt(prod[`sem${w}`]) || 0), 0);
}

async function main() {
    // Inicializar Firebase Admin
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

    console.log(`\n${'='.repeat(64)}`);
    console.log(`  SINCRONIZAÇÃO DE OFERTADO ${isDryRun ? '(DRY RUN — nada será gravado)' : '(REAL)'}`);
    console.log(`  ofertado := soma das semanas (só quando soma > 0)`);
    console.log(`${'='.repeat(64)}\n`);

    console.log(`🔍 Lendo coleção: ${COLLECTION}...`);
    const snapshot = await db.collection(COLLECTION).get();
    console.log(`   Total de documentos: ${snapshot.size}\n`);

    // Descobre o que precisa mudar
    const toUpdate = [];
    let semSemanas = 0; // soma == 0, ignorados (preserva ofertado)
    let jaCorretos = 0; // soma == ofertado atual

    snapshot.docs.forEach(d => {
        const data = d.data();
        const soma = somaSemanas(data);
        if (soma <= 0) { semSemanas++; return; }
        const atual = parseInt(data.ofertado) || 0;
        if (atual === soma) { jaCorretos++; return; }
        toUpdate.push({ ref: d.ref, id: d.id, de: atual, para: soma, comp: data.competencia });
    });

    console.log(`   Já corretos (ofertado == soma): ${jaCorretos}`);
    console.log(`   Sem semanas preenchidas (preservados): ${semSemanas}`);
    console.log(`   A corrigir (ofertado != soma): ${toUpdate.length}\n`);

    if (toUpdate.length > 0) {
        console.log(`   Amostra das correções (até 20):`);
        toUpdate.slice(0, 20).forEach(u => {
            console.log(`     - ${u.id} [${u.comp || 's/comp'}]: ofertado ${u.de} → ${u.para}`);
        });
        if (toUpdate.length > 20) console.log(`     ... e mais ${toUpdate.length - 20} documento(s).`);
        console.log('');
    }

    if (!isDryRun && toUpdate.length > 0) {
        console.log(`   💾 Gravando ${toUpdate.length} correções...`);
        for (let i = 0; i < toUpdate.length; i += BATCH_SIZE) {
            const chunk = toUpdate.slice(i, i + BATCH_SIZE);
            const batch = db.batch();
            chunk.forEach(u => batch.update(u.ref, { ofertado: u.para }));
            await batch.commit();
            console.log(`     Lote ${Math.floor(i / BATCH_SIZE) + 1}: ${chunk.length} docs atualizados`);
        }
        console.log(`   ✅ Sincronização concluída!\n`);
    }

    console.log(`${'='.repeat(64)}`);
    console.log(`  RESUMO: ${toUpdate.length} documento(s) ${isDryRun ? 'seriam corrigidos' : 'corrigidos'}.`);
    if (isDryRun) {
        console.log(`\n  Execute sem --dry-run para gravar de verdade:`);
        console.log(`  node scripts/sincronizar-ofertado.mjs\n`);
    } else {
        console.log('');
    }
}

main().catch(err => {
    console.error('Erro:', err);
    process.exit(1);
});
