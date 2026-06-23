/**
 * Limpeza de Competências
 * Apaga pactuacoes e justificativas com competencia >= fev/25
 * Mantém apenas jan/25 e anteriores.
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
 * 3. Execute a pré-visualização (sem apagar nada):
 *    node scripts/limpar-competencias.mjs --dry-run
 *
 * 4. Execute a limpeza real:
 *    node scripts/limpar-competencias.mjs
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
const CUTOFF = { month: 1, year: 2025 }; // fev = índice 1 (0-based), manter apenas < fev/25
const COLLECTIONS = ['pactuacoes', 'justificativas'];
const BATCH_SIZE = 400;

const SHORT_MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

function parseCompetencia(comp) {
    if (!comp) return null;
    const parts = comp.toLowerCase().split('/');
    if (parts.length !== 2) return null;
    const monthIndex = SHORT_MONTHS.indexOf(parts[0]);
    if (monthIndex === -1) return null;
    const year = 2000 + parseInt(parts[1]);
    return new Date(year, monthIndex, 1);
}

function shouldDelete(competencia) {
    const date = parseCompetencia(competencia);
    if (!date) return false; // formato desconhecido → não apaga
    const cutoffDate = new Date(CUTOFF.year, CUTOFF.month, 1);
    return date >= cutoffDate;
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

    console.log(`\n${'='.repeat(60)}`);
    console.log(`  LIMPEZA DE COMPETÊNCIAS ${isDryRun ? '(DRY RUN — nada será apagado)' : '(REAL)'}`);
    console.log(`  Apaga competencias >= fev/25 | Mantém: jan/25 e anteriores`);
    console.log(`${'='.repeat(60)}\n`);

    let totalPreview = {};

    for (const collName of COLLECTIONS) {
        console.log(`🔍 Verificando coleção: ${collName}...`);
        const snapshot = await db.collection(collName).get();
        const toDelete = snapshot.docs.filter(d => shouldDelete(d.data().competencia));

        // Agrupar por competencia para preview
        const byComp = {};
        toDelete.forEach(d => {
            const c = d.data().competencia || '(sem competencia)';
            byComp[c] = (byComp[c] || 0) + 1;
        });

        // Ordenar por data
        const sorted = Object.entries(byComp).sort(([a], [b]) => {
            const da = parseCompetencia(a) || new Date(0);
            const db2 = parseCompetencia(b) || new Date(0);
            return da - db2;
        });

        console.log(`   Total encontrado: ${snapshot.size} docs | Para apagar: ${toDelete.length} docs`);
        if (sorted.length > 0) {
            console.log(`   Competências a apagar:`);
            sorted.forEach(([comp, count]) => {
                console.log(`     - ${comp}: ${count} docs`);
            });
        }

        totalPreview[collName] = toDelete.length;

        if (!isDryRun && toDelete.length > 0) {
            console.log(`   🗑️  Apagando ${toDelete.length} documentos...`);
            for (let i = 0; i < toDelete.length; i += BATCH_SIZE) {
                const chunk = toDelete.slice(i, i + BATCH_SIZE);
                const batch = db.batch();
                chunk.forEach(d => batch.delete(d.ref));
                await batch.commit();
                console.log(`     Lote ${Math.floor(i / BATCH_SIZE) + 1}: ${chunk.length} docs apagados`);
            }
            console.log(`   ✅ ${collName} limpo!\n`);
        } else if (!isDryRun) {
            console.log(`   ✅ Nenhum documento para apagar.\n`);
        } else {
            console.log(`   (dry-run: nenhuma alteração feita)\n`);
        }
    }

    console.log(`${'='.repeat(60)}`);
    console.log(`  RESUMO:`);
    COLLECTIONS.forEach(c => console.log(`  - ${c}: ${totalPreview[c]} docs ${isDryRun ? 'encontrados' : 'apagados'}`));

    if (isDryRun) {
        console.log(`\n  Execute sem --dry-run para apagar de verdade:`);
        console.log(`  node scripts/limpar-competencias.mjs\n`);
    } else {
        console.log(`\n  ✅ Limpeza concluída!\n`);
    }
}

main().catch(err => {
    console.error('Erro:', err);
    process.exit(1);
});
