import { db, auth } from './firebase-config';
import {
    collection,
    addDoc,
    getDoc,
    setDoc,
    doc,
    getDocs,
    query,
    where,
    deleteDoc,
    writeBatch,
    orderBy,
    limit
} from "firebase/firestore";

// --- COLLECTIONS NAMES ---
const COLL_INSTITUTOS = "institutos";
const COLL_PROCEDIMENTOS = "procedimentos";
const COLL_PROGRAMAS = "programas"; // Level 1 (Groups)
const COLL_USUARIOS = "usuarios";
const COLL_PACTUACOES = "pactuacoes"; // Level 2 (Relations)
const COLL_PRODUCAO = "producao";
const COLL_LOGS = "logs";
const COLL_CONFIG = "config"; // New Collection

// --- HELPERS ---
const normalizeId = (text) => {
    if (!text) return Date.now().toString();
    return text.toString()
        .toLowerCase()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // remove accents
        .replace(/[^a-z0-9]/g, '_') // replace non-alphanumeric with _
        .replace(/_+/g, '_')       // remove double underscores
        .replace(/^_|_$/g, '');    // remove leading/trailing underscores
};

/**
 * Repository to handle all Firestore operations.
 */
export const Repository = {
    // USUÁRIOS
    async getUsers() {
        const snapshot = await getDocs(collection(db, COLL_USUARIOS));
        return snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    },

    async getUserByEmail(email) {
        if (!email) return null;
        const q = query(collection(db, COLL_USUARIOS), where("email", "==", email));
        const snapshot = await getDocs(q);
        if (snapshot.empty) return null;
        return { id: snapshot.docs[0].id, ...snapshot.docs[0].data() };
    },

    async saveUser(user) {
        if (user.id) {
            const docRef = doc(db, COLL_USUARIOS, user.id.toString());
            await setDoc(docRef, user, { merge: true });
            return user.id;
        }
        const res = await addDoc(collection(db, COLL_USUARIOS), user);
        return res.id;
    },

    async deleteUser(id) {
        await deleteDoc(doc(db, COLL_USUARIOS, id));
    },

    // INSTITUTOS
    async getInstitutos() {
        const snapshot = await getDocs(collection(db, COLL_INSTITUTOS));
        return snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    },

    async getInstitutoById(id) {
        const d = await getDoc(doc(db, COLL_INSTITUTOS, id));
        return d.exists() ? { id: d.id, ...d.data() } : null;
    },

    async saveInstituto(inst) {
        const id = inst.id || normalizeId(inst.nome);
        const ref = doc(db, COLL_INSTITUTOS, id);
        await setDoc(ref, { ...inst, id }, { merge: true });
        return id;
    },

    async deleteInstituto(id) {
        await deleteDoc(doc(db, COLL_INSTITUTOS, id));
    },

    // PROCEDIMENTOS
    async getProcedimentos() {
        const snapshot = await getDocs(collection(db, COLL_PROCEDIMENTOS));
        return snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    },

    async saveProcedimento(proc) {
        // Procedure ID is always the sigtap code
        const id = proc.id || proc.sigtap;
        const ref = doc(db, COLL_PROCEDIMENTOS, id);
        await setDoc(ref, { ...proc, id }, { merge: true });
        return id;
    },

    async deleteProcedimento(id) {
        await deleteDoc(doc(db, COLL_PROCEDIMENTOS, id));
    },

    // PROGRAMAS (L1)
    async getProgramas() {
        const snapshot = await getDocs(collection(db, COLL_PROGRAMAS));
        return snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    },

    async savePrograma(prog) {
        const id = prog.id || normalizeId(prog.nome);
        const ref = doc(db, COLL_PROGRAMAS, id);
        await setDoc(ref, { ...prog, id }, { merge: true });
        return id;
    },

    async deletePrograma(id) {
        await deleteDoc(doc(db, COLL_PROGRAMAS, id));
    },

    // PACTUAÇÕES (L2)
    async getPactuacoes(progId = null) {
        let q = collection(db, COLL_PACTUACOES);
        if (progId) q = query(q, where("progId", "==", progId));
        const snapshot = await getDocs(q);
        return snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    },

    // --- LOGS & ANALYTICS ---
    async logActivity(action, details = {}) {
        try {
            const user = auth.currentUser;
            await addDoc(collection(db, COLL_LOGS), {
                action,
                details,
                userEmail: user?.email || 'Sistema',
                userName: user?.displayName || 'Anônimo',
                timestamp: new Date()
            });
        } catch (err) {
            console.error('Erro ao registrar log:', err);
        }
    },

    async getLogs(limitCount = 50) {
        const q = query(
            collection(db, COLL_LOGS),
            orderBy('timestamp', 'desc'),
            limit(limitCount)
        );
        const snapshot = await getDocs(q);
        return snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    },

    async getSystemStats() {
        const [insts, procs, pacts, logs] = await Promise.all([
            getDocs(collection(db, COLL_INSTITUTOS)),
            getDocs(collection(db, COLL_PROCEDIMENTOS)),
            getDocs(collection(db, COLL_PACTUACOES)),
            getDocs(query(collection(db, COLL_LOGS), where('action', 'in', ['LOGIN', 'IMPORT_DATA'])))
        ]);

        const totalProcs = procs.docs.length;
        const procsWithValues = procs.docs.filter(d => d.data().baseValue > 0).length;

        const pactInsts = new Set(pacts.docs.map(d => d.data().instId));
        const totalInsts = insts.docs.length;

        return {
            totalInsts,
            activeInsts: pactInsts.size,
            totalProcs,
            procsWithValues,
            logins: logs.docs.filter(d => d.data().action === 'LOGIN').length,
            imports: logs.docs.filter(d => d.data().action === 'IMPORT_DATA').length
        };
    },

    async savePactuacao(pact) {
        const id = pact.id || Date.now().toString();
        const ref = doc(db, COLL_PACTUACOES, id);
        await setDoc(ref, { ...pact, id }, { merge: true });
        return id;
    },

    async deletePactuacao(id) {
        await deleteDoc(doc(db, COLL_PACTUACOES, id));
    },

    async deleteAllPactuacoes() {
        const snapshot = await getDocs(collection(db, COLL_PACTUACOES));
        const batchSize = 400;
        const chunks = [];
        for (let i = 0; i < snapshot.docs.length; i += batchSize) {
            chunks.push(snapshot.docs.slice(i, i + batchSize));
        }

        for (const chunk of chunks) {
            const batch = writeBatch(db);
            chunk.forEach(doc => batch.delete(doc.ref));
            await batch.commit();
        }

        await this.logActivity('DELETE_ALL_PACTUACOES', { count: snapshot.size });
    },

    async duplicateCompetencia(sourceComp, targetComp) {
        if (!sourceComp || !targetComp) throw new Error("Competências inválidas.");

        // 1. Get Source Docs
        const q = query(collection(db, COLL_PACTUACOES), where("competencia", "==", sourceComp));
        const snapshot = await getDocs(q);

        if (snapshot.empty) throw new Error(`Nenhuma pactuação encontrada para ${sourceComp}.`);

        // 2. Batch Write
        const batchSize = 400;
        const chunks = [];
        for (let i = 0; i < snapshot.docs.length; i += batchSize) {
            chunks.push(snapshot.docs.slice(i, i + batchSize));
        }

        let count = 0;
        for (const chunk of chunks) {
            const batch = writeBatch(db);
            chunk.forEach(d => {
                const data = d.data();
                // Create new ID: prog_inst_sigtap_targetComp
                const newId = normalizeId(`${data.progId}_${data.instId}_${data.sigtap}_${targetComp}`);

                const newData = {
                    ...data,
                    id: newId,
                    competencia: targetComp,
                    // Reset production for new month
                    producao: { sem1: 0, sem2: 0, sem3: 0, sem4: 0, sem5: 0, realizada: 0 },
                    importedAt: new Date(),
                    updatedAt: new Date()
                };

                const ref = doc(db, COLL_PACTUACOES, newId);
                batch.set(ref, newData, { merge: true });
                count++;
            });
            await batch.commit();
        }

        await this.logActivity('DUPLICATE_COMPETENCIA', { source: sourceComp, target: targetComp, count });
        return count;
    },


    // --- SYSTEM CONFIG ---
    async getSystemConfig() {
        // We use a singleton document named 'system'
        const d = await getDoc(doc(db, COLL_CONFIG, "system"));
        return d.exists() ? d.data() : null;
    },

    async saveSystemConfig(config) {
        await setDoc(doc(db, COLL_CONFIG, "system"), config, { merge: true });
        await this.logActivity('UPDATE_CONFIG', config);
    },

    // BATCH IMPORT
    async importData(data, onProgress) {
        // 1. Analyze Data & Prepare Metadata
        if (onProgress) onProgress(0, 'Analisando dados...');

        const uniqueProgs = new Map();
        const uniqueInsts = new Map();
        const uniqueProcs = new Map();

        const getCol = (row, ...names) => {
            const keys = Object.keys(row);
            const clean = (t) => t.toString().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");

            for (let name of names) {
                const target = clean(name);
                if (!target) continue;
                const foundKey = keys.find(k => clean(k).includes(target));
                if (foundKey !== undefined) return row[foundKey];
            }
            return '';
        };

        data.forEach(item => {
            const pNome = getCol(item, 'Programa').toString().trim();
            const iNome = getCol(item, 'Instituto').toString().trim();
            let sCod = getCol(item, 'SIGTAP').toString().trim();

            if (sCod && /^\d+$/.test(sCod)) {
                sCod = sCod.padStart(10, '0');
            }

            if (pNome) uniqueProgs.set(normalizeId(pNome), pNome);
            if (iNome) uniqueInsts.set(normalizeId(iNome), iNome);
            if (sCod) {
                const pNomeProc = getCol(item, 'Procedimento', 'Proc', 'Desc').toString().trim();
                const vBaseRaw = getCol(item, 'Valor Sigtap', 'Valor Unitário').toString().replace(',', '.');
                const vBase = parseFloat(vBaseRaw || 0);
                uniqueProcs.set(sCod, { nome: pNomeProc, vlr: vBase });
            }
        });

        if (onProgress) onProgress(10, `Metadados identificados: ${uniqueProgs.size} Programas, ${uniqueInsts.size} Institutos.`);

        // 2. Batch Processor Helper
        const processBatch = async (items, processorFn, startProgress, endProgress) => {
            const BATCH_SIZE = 450; // Safety margin below 500
            const chunks = [];
            for (let i = 0; i < items.length; i += BATCH_SIZE) {
                chunks.push(items.slice(i, i + BATCH_SIZE));
            }

            for (let i = 0; i < chunks.length; i++) {
                const batch = writeBatch(db);
                chunks[i].forEach(item => processorFn(batch, item));
                await batch.commit();

                const percent = startProgress + ((i + 1) / chunks.length) * (endProgress - startProgress);
                if (onProgress) onProgress(percent, `Processando lote ${i + 1} de ${chunks.length}...`);
            }
        };

        // 3. Save Metadata (Programs, Institutes, Procedures)
        const metadataItems = [
            ...Array.from(uniqueProgs).map(([id, nome]) => ({ type: 'prog', id, nome })),
            ...Array.from(uniqueInsts).map(([id, nome]) => ({ type: 'inst', id, nome })),
            ...Array.from(uniqueProcs).map(([id, info]) => ({ type: 'proc', id, ...info }))
        ];

        await processBatch(metadataItems, (batch, item) => {
            if (item.type === 'prog') {
                batch.set(doc(db, COLL_PROGRAMAS, item.id), { nome: item.nome, status: 'Ativo', updatedAt: new Date() }, { merge: true });
            } else if (item.type === 'inst') {
                batch.set(doc(db, COLL_INSTITUTOS, item.id), { nome: item.nome, status: 'Ativo', updatedAt: new Date() }, { merge: true });
            } else if (item.type === 'proc') {
                batch.set(doc(db, COLL_PROCEDIMENTOS, item.id), { sigtap: item.id, nome: item.nome, vlrSigtap: item.vlr, status: 'Ativo' }, { merge: true });
            }
        }, 10, 30);

        // 4. Save Pactuacoes (Main Data)
        await processBatch(data, (batch, row) => {
            const pNome = getCol(row, 'Programa').toString().trim();
            const iNome = getCol(row, 'Instituto').toString().trim();
            let sCod = getCol(row, 'SIGTAP').toString().trim();
            let comp = getCol(row, 'Competencia', 'Mes', 'Referencia', 'Data', 'Periodo', 'Ano', 'Comp').toString().trim() || 'Geral';

            if (sCod && /^\d+$/.test(sCod)) sCod = sCod.padStart(10, '0');
            if (!pNome || !iNome || !sCod) return;

            // Fix Excel Date Serial (e.g., 46023 -> jan/26)
            if (/^\d{5}$/.test(comp)) {
                const serial = parseInt(comp);
                // Excel base date logic
                const date = new Date((serial - 25569) * 86400 * 1000);
                // Adjust for timezone offset if needed, but UTC is safer for simple date
                // Using getUTCMonth/Year to avoid timezone shifts
                const months = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
                const m = months[date.getUTCMonth()];
                const y = date.getUTCFullYear().toString().slice(-2);
                // Check validity
                if (m && y) {
                    // Override comp with formatted string
                    comp = `${m}/${y}`;
                }
            }

            const progId = normalizeId(pNome);
            const instId = normalizeId(iNome);
            const pactId = normalizeId(`${progId}_${instId}_${sCod}_${comp}`);

            const pactData = {
                progId,
                instId,
                sigtap: sCod,
                competencia: comp,
                // Metadata
                processamento: getCol(row, 'Processamento'),
                responsavel: getCol(row, 'Responsável'),
                mes: getCol(row, 'Mês'),
                indicacaoFeriado: getCol(row, 'Indicação Feriado'),
                statusLinha: getCol(row, 'STATUS'),
                // Quantification
                ofertado: getCol(row, 'Ofertado') || 0,
                ofertaMinima: getCol(row, 'SIGRAH', 'Minima', 'Pactuado') || 0,
                totalOferta: getCol(row, 'Total Oferta') || 0,
                // Values
                vlrSigtapBase: parseFloat(getCol(row, 'Valor Sigtap', 'Valor Unitário').toString().replace(',', '.') || 0),
                vlrIncentivo: parseFloat(getCol(row, 'Incentivo').toString().replace(',', '.') || 0),
                vlrTotalLinha: parseFloat(getCol(row, 'TOTAL').toString().replace(',', '.') || 0),
                // Weekly Production - Fallback logic for various formats
                producao: {
                    sem1: getCol(row, '1º') || 0,
                    sem2: getCol(row, '2º') || 0,
                    sem3: getCol(row, '3º') || 0,
                    sem4: getCol(row, '4º') || 0,
                    sem5: getCol(row, '5º') || 0,
                    realizada: getCol(row, 'Qtd Produção') || 0
                },
                importedAt: new Date()
            };
            batch.set(doc(db, COLL_PACTUACOES, pactId), pactData, { merge: true });

        }, 30, 100);

        // Log Activity
        await this.logActivity('IMPORT_DATA', {
            lines: data.length,
            procs: uniqueProcs.size,
            insts: uniqueInsts.size
        });

        return { success: true, rows: data.length };
    }
};
