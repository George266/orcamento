import { db } from './firebase-config';
import {
    collection,
    addDoc,
    setDoc,
    doc,
    getDocs,
    query,
    where,
    deleteDoc,
    writeBatch
} from "firebase/firestore";

// --- COLLECTIONS NAMES ---
const COLL_INSTITUTOS = "institutos";
const COLL_PROCEDIMENTOS = "procedimentos";
const COLL_PROGRAMAS = "programas"; // Level 1 (Groups)
const COLL_USUARIOS = "usuarios";
const COLL_PACTUACOES = "pactuacoes"; // Level 2 (Relations)
const COLL_PRODUCAO = "producao";

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

        data.forEach(item => {
            const pNome = (item['Programa'] || '').trim();
            const iNome = (item['Instituto '] || '').trim();
            const sCod = (item['Código SIGTAP '] || '').toString().trim();

            if (pNome) uniqueProgs.set(normalizeId(pNome), pNome);
            if (iNome) uniqueInsts.set(normalizeId(iNome), iNome);
            if (sCod) uniqueProcs.set(sCod, (item['Procedimento '] || '').trim());
        });

        // Save metadata groups first
        uniqueProgs.forEach((nome, id) => {
            batch.set(doc(db, COLL_PROGRAMAS, id), { nome, status: 'Ativo', updatedAt: new Date() }, { merge: true });
        });
        uniqueInsts.forEach((nome, id) => {
            batch.set(doc(db, COLL_INSTITUTOS, id), { nome, status: 'Ativo', updatedAt: new Date() }, { merge: true });
        });
        uniqueProcs.forEach((nome, id) => {
            batch.set(doc(db, COLL_PROCEDIMENTOS, id), { sigtap: id, nome, status: 'Ativo' }, { merge: true });
        });

        // Save relations
        data.forEach(row => {
            const pNome = (row['Programa'] || '').trim();
            const iNome = (row['Instituto '] || '').trim();
            const sCod = (row['Código SIGTAP '] || '').toString().trim();
            const comp = row['Competência'] || row['Mês'] || 'Geral';

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
                processamento: row['Processamento'] || '',
                responsavel: row['Responsável'] || '',
                mes: row['Mês'] || '',
                indicacaoFeriado: row['Indicação Feriado'] || '',
                statusLinha: row['STATUS'] || '',

                // Quantification
                ofertado: row['Ofertado'] || 0,
                ofertaMinima: row['Oferta Mínima mensal SIGRAH'] || 0,
                totalOferta: row['Total Oferta'] || 0,

                // Values (Auditing)
                vlrSigtapBase: parseFloat(row['Valor Sigtap '] || row['Valor Sigtap'] || 0),
                vlrIncentivo: parseFloat(row['Valor do Incentivo '] || row['Valor Incentivo '] || 0),
                vlrTotalLinha: parseFloat(row['Valor TOTAL '] || row['Valor TOTAL'] || 0),

                // Weekly Production
                producao: {
                    sem1: row['1º'] || 0,
                    sem2: row['2º'] || 0,
                    sem3: row['3º'] || 0,
                    sem4: row['4º'] || 0,
                    sem5: row['5º'] || 0,
                    realizada: row['Qtd Produção'] || 0
                },

                importedAt: new Date()
            });
        });

        await batch.commit();
    }
};
