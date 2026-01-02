import { db, auth } from './firebase-config';
import {
    collection,
    addDoc,
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

    // BATCH IMPORT
    async batchSaveImport(data) {
        const batch = writeBatch(db);
        const uniqueProgs = new Map();
        const uniqueInsts = new Map();
        const uniqueProcs = new Map();

        // Helper to get value from row regardless of trailing space, case, accents or symbols in header
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
            const comp = getCol(item, 'Competencia', 'Mes', 'Referencia', 'Data', 'Periodo', 'Ano', 'Comp').toString().trim() || 'Geral';
            let sCod = getCol(item, 'SIGTAP').toString().trim();

            // Pad SIGTAP code with zeros (should be 10 digits)
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

        // Save metadata groups first
        uniqueProgs.forEach((nome, id) => {
            batch.set(doc(db, COLL_PROGRAMAS, id), { nome, status: 'Ativo', updatedAt: new Date() }, { merge: true });
        });
        uniqueInsts.forEach((nome, id) => {
            batch.set(doc(db, COLL_INSTITUTOS, id), { nome, status: 'Ativo', updatedAt: new Date() }, { merge: true });
        });
        uniqueProcs.forEach((info, id) => {
            batch.set(doc(db, COLL_PROCEDIMENTOS, id), {
                sigtap: id,
                nome: info.nome,
                vlrSigtap: info.vlr,
                status: 'Ativo'
            }, { merge: true });
        });

        // Save relations
        data.forEach(row => {
            const pNome = getCol(row, 'Programa').toString().trim();
            const iNome = getCol(row, 'Instituto').toString().trim();
            let sCod = getCol(row, 'SIGTAP').toString().trim();
            const comp = getCol(row, 'Competencia', 'Mes', 'Referencia', 'Data', 'Periodo', 'Ano', 'Comp').toString().trim() || 'Geral';

            if (sCod && /^\d+$/.test(sCod)) {
                sCod = sCod.padStart(10, '0');
            }

            if (!pNome || !iNome || !sCod) return;

            const progId = normalizeId(pNome);
            const instId = normalizeId(iNome);
            const pactId = normalizeId(`${progId}_${instId}_${sCod}_${comp}`);

            // Map ALL columns from the comprehensive SUS spreadsheet
            batch.set(doc(db, COLL_PACTUACOES, pactId), {
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

                // Values (Auditing)
                vlrSigtapBase: parseFloat(getCol(row, 'Valor Sigtap', 'Valor Unitário').toString().replace(',', '.') || 0),
                vlrIncentivo: parseFloat(getCol(row, 'Incentivo').toString().replace(',', '.') || 0),
                vlrTotalLinha: parseFloat(getCol(row, 'TOTAL').toString().replace(',', '.') || 0),

                // Weekly Production
                producao: {
                    sem1: getCol(row, '1º') || 0,
                    sem2: getCol(row, '2º') || 0,
                    sem3: row['3º'] || 0, // Fallback to direct access if needed
                    sem4: getCol(row, '4º') || 0,
                    sem5: getCol(row, '5º') || 0,
                    realizada: getCol(row, 'Qtd Produção') || 0
                },

                importedAt: new Date()
            });
        });

        await batch.commit();

        // Log the import activity
        await this.logActivity('IMPORT_DATA', {
            lines: data.length,
            procs: uniqueProcs.size,
            insts: uniqueInsts.size
        });

        return {
            progs: uniqueProgs.size,
            insts: uniqueInsts.size,
            procs: uniqueProcs.size,
            rows: data.length
        };
    }
};
