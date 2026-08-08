// Quadro de Demandas (Kanban) — módulo Orçamento.
// Espelha o Kanban do projeto feluma-on, adaptado para a stack vanilla-JS deste
// repositório (MPA + Firebase modular).
// Acrescenta campos do domínio: área alvo, página do sistema e subitem.
//
// Anexos (imagens + PDF + prints via Ctrl+V): espelham o feluma-on. Ficam no
// Storage (kanban-images/{cardId} e kanban-comment-images/{cardId}); no card,
// o campo `imageUrls[]` guarda as URLs. Habilitado após a mudança de plano.
//
// Regra de negócio: uma demanda NUNCA é apagada. Ela pode ser arquivada
// (quando concluída) ou cancelada (registrando o responsável). Cada estado
// terminal tem sua própria lista.
//
// Documento Firestore: kanban_cards/{id}  (+ subcoleção comments/{id})

import { db, auth, storage } from './firebase-config.js';
import { onAuthStateChanged } from 'firebase/auth';
import {
    addDoc,
    arrayRemove,
    arrayUnion,
    collection,
    deleteDoc,
    doc,
    onSnapshot,
    orderBy,
    query,
    serverTimestamp,
    updateDoc,
} from 'firebase/firestore';
import {
    deleteObject,
    getDownloadURL,
    ref as storageRef,
    uploadBytes,
} from 'firebase/storage';

const COL = 'kanban_cards';

// Anexos: mesmos limites do feluma-on — PNG/JPEG/WebP/PDF, até 5 MB.
const ALLOWED_ATTACHMENT_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'];
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

// ── Domínio ────────────────────────────────────────────────────────────────

const COLUMNS = [
    { id: 'reportado', label: 'Solicitação', accent: 'border-t-slate-400' },
    { id: 'em_analise', label: 'Em Análise', accent: 'border-t-amber-400' },
    { id: 'em_backlog', label: 'Em Backlog', accent: 'border-t-orange-400' },
    { id: 'em_desenvolvimento', label: 'Em Desenvolvimento', accent: 'border-t-blue-400' },
    { id: 'homologacao', label: 'Homologação', accent: 'border-t-purple-400' },
    { id: 'concluido', label: 'Concluído', accent: 'border-t-emerald-400' },
];
const COLUMN_LABEL = Object.fromEntries(COLUMNS.map((c) => [c.id, c.label]));

const PRIORITIES = {
    baixa: { label: 'Baixa', badge: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300' },
    media: { label: 'Média', badge: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' },
    alta: { label: 'Alta', badge: 'bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-300' },
};

// Perfil/área a que a demanda se refere (base: papéis do auth-guard).
const AREAS = {
    central: { label: 'Central (Orçamento)', badge: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' },
    institutos: { label: 'Institutos', badge: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' },
    ambos: { label: 'Ambos / Geral', badge: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300' },
};

// Páginas reais do sistema, agrupadas por área. `id` = arquivo .html (permite
// deep-link no futuro); `label` = nome amigável (título/nav de cada página).
const PAGES = [
    { id: 'dashboard_orcamento.html', label: 'Dashboard (Orçamento)', area: 'central' },
    { id: 'acompanhamento_orcamento.html', label: 'Monitoramento de Ofertas', area: 'central' },
    { id: 'lancamento_producao.html', label: 'Lançar Produção', area: 'central' },
    { id: 'configuracao.html', label: 'Parâmetros do Incentivo', area: 'central' },
    { id: 'usuarios.html', label: 'Gestão de Usuários', area: 'central' },
    { id: 'alertas.html', label: 'Alertas', area: 'central' },
    { id: 'dashboard_instituto.html', label: 'Dashboard (Instituto)', area: 'institutos' },
    { id: 'acompanhamento_instituto.html', label: 'Lançamentos de Ofertas (Instituto)', area: 'institutos' },
    { id: 'retorno_instituto.html', label: 'Produzido / Retorno (Instituto)', area: 'institutos' },
    { id: 'financeiro_instituto.html', label: 'Financeiro (Instituto)', area: 'institutos' },
    { id: 'lancamento.html', label: 'Lançamento de Ofertas', area: 'institutos' },
    { id: 'perfil.html', label: 'Meu Perfil', area: 'ambos' },
];
const PAGE_LABEL = Object.fromEntries(PAGES.map((p) => [p.id, p.label]));

// ── Estado ───────────────────────────────────────────────────────────────────

let cards = [];          // ativos (no quadro)
let archived = [];       // arquivados (concluídos e filed)
let cancelled = [];      // cancelados (com responsável)
let currentUser = null;  // { uid, email, name }
let view = 'board';      // 'board' | 'arquivados' | 'cancelados'
let areaFilter = '';     // '' | 'central' | 'institutos' | 'ambos'
let ownerFilter = '';    // '' = todos | 'none' = sem responsável | e-mail
let teamUsers = [];      // candidatos a responsável (perfil Orçamento, ativos)
let dragId = null;
let boardUnsub = null;
let commentsUnsub = null;

// ── Utilidades ─────────────────────────────────────────────────────────────

function escapeHtml(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function toMs(v) {
    if (v && typeof v.toMillis === 'function') return v.toMillis();
    if (typeof v === 'number') return v;
    return Date.now();
}

function fmtDate(ms) {
    return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(ms));
}

function timeAgo(ms) {
    const diff = Date.now() - ms;
    const min = Math.round(diff / 60000);
    if (min < 1) return 'agora';
    if (min < 60) return `há ${min} min`;
    const h = Math.round(min / 60);
    if (h < 24) return `há ${h} h`;
    const d = Math.round(h / 24);
    if (d < 30) return `há ${d} d`;
    return fmtDate(ms);
}

function initials(name) {
    return String(name || '?').trim().slice(0, 2).toUpperCase();
}

function toast(message, type = 'success') {
    const root = document.getElementById('kanban-toast-root');
    if (!root) return;
    const colors = {
        success: 'bg-emerald-600',
        error: 'bg-red-600',
        info: 'bg-slate-800',
    };
    const el = document.createElement('div');
    el.className = `${colors[type] || colors.info} text-white text-sm font-medium px-4 py-2.5 rounded-lg shadow-lg animate-pulse`;
    el.textContent = message;
    root.appendChild(el);
    setTimeout(() => el.classList.remove('animate-pulse'), 300);
    setTimeout(() => el.remove(), 3200);
}

function toCard(id, data) {
    return {
        id,
        title: data.title ?? '—',
        description: data.description ?? '',
        column: data.column ?? 'reportado',
        priority: data.priority ?? 'media',
        area: data.area ?? 'central',
        page: data.page ?? '',
        subitem: data.subitem ?? '',
        // Responsável — chaveado por e-mail, não por uid: o doc de `usuarios`
        // não usa o uid do Auth como id (o auth-guard acha o perfil por email),
        // então o email é a única identidade compartilhada entre os dois.
        assigneeEmail: (data.assigneeEmail ?? '').toLowerCase(),
        assigneeName: data.assigneeName ?? '',
        order: typeof data.order === 'number' ? data.order : 0,
        imageUrls: Array.isArray(data.imageUrls) ? data.imageUrls : [],
        createdBy: data.createdBy ?? '',
        createdByName: data.createdByName ?? '',
        createdAt: toMs(data.createdAt),
        updatedAt: toMs(data.updatedAt),
        openedBy: data.openedBy ?? {},
        archived: data.archived ?? false,
        archivedAt: data.archivedAt ? toMs(data.archivedAt) : null,
        archivedByName: data.archivedByName ?? '',
        cancelled: data.cancelled ?? false,
        cancelledAt: data.cancelledAt ? toMs(data.cancelledAt) : null,
        cancelledByName: data.cancelledByName ?? '',
        cancelReason: data.cancelReason ?? '',
    };
}

function visibleCards() {
    return cards.filter((c) => {
        if (areaFilter && c.area !== areaFilter) return false;
        if (ownerFilter === 'none') return !c.assigneeEmail;
        if (ownerFilter) return c.assigneeEmail === ownerFilter;
        return true;
    });
}

// Mesma normalização do auth-guard: o papel é gravado como "Orçamento" (com
// acento e maiúscula), então comparar cru não bate.
function normalizeRole(str) {
    return str ? str.toString().toLowerCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '') : '';
}

// Candidatos a responsável = perfil Orçamento e ativos. Institutos não abrem o
// kanban.html (auth-guard trata como página de admin), então atribuir a eles
// seria criar uma demanda que o dono nunca veria.
async function loadTeam() {
    try {
        const { Repository } = await import('./repository.js');
        const all = await Repository.getUsers();
        teamUsers = all
            .filter((u) => normalizeRole(u.role) === 'orcamento' && (u.status || 'Ativo') !== 'Inativo')
            .map((u) => ({ email: (u.email || '').toLowerCase(), name: u.name || u.email || 'Sem nome' }))
            .filter((u) => u.email)
            .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
        renderOwnerFilter();
    } catch (err) {
        console.error('[Kanban] loadTeam:', err);
    }
}

// Opções montadas a partir dos próprios cards (e não de teamUsers): quem saiu
// da equipe continua filtrável enquanto tiver demanda aberta.
function renderOwnerFilter() {
    const sel = document.getElementById('filter-owner');
    if (!sel) return;
    const map = new Map();
    cards.forEach((c) => { if (c.assigneeEmail) map.set(c.assigneeEmail, c.assigneeName || c.assigneeEmail); });
    const semDono = cards.filter((c) => !c.assigneeEmail).length;
    const opts = [...map].sort((a, b) => a[1].localeCompare(b[1], 'pt-BR'));

    sel.innerHTML = `<option value="">Todos os responsáveis</option>`
        + opts.map(([email, name]) => `<option value="${escapeHtml(email)}">${escapeHtml(name)}</option>`).join('')
        + (semDono ? `<option value="none">Sem responsável (${semDono})</option>` : '');

    // O filtro selecionado pode ter deixado de existir (último card dele saiu).
    if (ownerFilter && !sel.querySelector(`option[value="${CSS.escape(ownerFilter)}"]`)) ownerFilter = '';
    sel.value = ownerFilter;
}

// ── Firestore ────────────────────────────────────────────────────────────────

function subscribeBoard() {
    if (boardUnsub) boardUnsub();
    const q = query(collection(db, COL), orderBy('order', 'asc'));
    boardUnsub = onSnapshot(
        q,
        (snap) => {
            const all = snap.docs.map((d) => toCard(d.id, d.data()));
            cards = all.filter((c) => !c.archived && !c.cancelled);
            archived = all
                .filter((c) => c.archived && !c.cancelled)
                .sort((a, b) => (b.archivedAt ?? 0) - (a.archivedAt ?? 0));
            cancelled = all
                .filter((c) => c.cancelled)
                .sort((a, b) => (b.cancelledAt ?? 0) - (a.cancelledAt ?? 0));
            render();
        },
        (err) => {
            console.error('[Kanban] onSnapshot error:', err.code, err.message);
            toast('Erro ao carregar o quadro.', 'error');
        },
    );
}

function maxOrderIn(column) {
    const inCol = cards.filter((c) => c.column === column);
    return inCol.length ? Math.max(...inCol.map((c) => c.order)) : 0;
}

async function createCard(data) {
    const ref = await addDoc(collection(db, COL), {
        ...data,
        order: maxOrderIn(data.column) + 1,
        imageUrls: [],
        createdBy: currentUser?.uid ?? '',
        createdByName: currentUser?.name ?? '',
        archived: false,
        cancelled: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
    });
    return ref.id;
}

async function updateCard(id, patch) {
    await updateDoc(doc(db, COL, id), { ...patch, updatedAt: serverTimestamp() });
}

async function moveCard(id, column) {
    await updateDoc(doc(db, COL, id), {
        column,
        order: maxOrderIn(column) + 1,
        updatedAt: serverTimestamp(),
    });
}

async function archiveCard(id) {
    await updateDoc(doc(db, COL, id), {
        archived: true,
        archivedAt: serverTimestamp(),
        archivedBy: currentUser?.uid ?? '',
        archivedByName: currentUser?.name ?? '',
        updatedAt: serverTimestamp(),
    });
}

async function restoreCard(id) {
    await updateDoc(doc(db, COL, id), { archived: false, updatedAt: serverTimestamp() });
}

// Cancelamento: registra o responsável (usuário atual) e o motivo. A demanda
// sai do quadro e passa a viver na lista de Cancelados. Nunca é apagada.
async function cancelCard(id, reason) {
    await updateDoc(doc(db, COL, id), {
        cancelled: true,
        cancelReason: reason || '',
        cancelledAt: serverTimestamp(),
        cancelledBy: currentUser?.uid ?? '',
        cancelledByName: currentUser?.name ?? '',
        updatedAt: serverTimestamp(),
    });
}

async function reopenCancelled(id) {
    await updateDoc(doc(db, COL, id), {
        cancelled: false,
        cancelReason: '',
        updatedAt: serverTimestamp(),
    });
}

async function recordOpen(cardId) {
    if (!currentUser) return;
    try {
        await updateDoc(doc(db, COL, cardId), {
            [`openedBy.${currentUser.uid}`]: {
                name: currentUser.name,
                email: currentUser.email,
                openedAt: Date.now(),
            },
        });
    } catch { /* silencioso */ }
}

async function addComment(cardId, text, imageUrls = []) {
    await addDoc(collection(db, COL, cardId, 'comments'), {
        text: text.trim(),
        authorUid: currentUser?.uid ?? '',
        authorName: currentUser?.name ?? 'Usuário',
        authorEmail: currentUser?.email ?? '',
        createdAt: serverTimestamp(),
        ...(imageUrls.length ? { imageUrls } : {}),
    });
}

async function deleteComment(cardId, commentId) {
    await deleteDoc(doc(db, COL, cardId, 'comments', commentId));
}

// ── Anexos (Storage) ─────────────────────────────────────────────────────────

// Valida um arquivo (input ou paste). Retorna mensagem de erro ou null se OK.
function validateAttachment(file) {
    if (!ALLOWED_ATTACHMENT_TYPES.includes(file.type)) return 'Formato inválido. Use PNG, JPEG, WebP ou PDF.';
    if (file.size > MAX_ATTACHMENT_BYTES) return 'O arquivo deve ter no máximo 5 MB.';
    return null;
}

function isPdfFile(file) {
    return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
}

// A URL do Storage carrega o caminho (com a extensão) antes do "?token=…".
function isPdfUrl(url) {
    try {
        return decodeURIComponent(new URL(url).pathname).toLowerCase().endsWith('.pdf');
    } catch {
        return url.toLowerCase().endsWith('.pdf');
    }
}

function extOf(file) {
    const fromName = file.name.includes('.') ? file.name.split('.').pop() : '';
    if (fromName) return fromName;
    return file.type === 'application/pdf' ? 'pdf' : (file.type.split('/')[1] || 'bin');
}

// Sobe o anexo da DEMANDA e registra a URL em imageUrls (arrayUnion).
async function uploadCardImage(cardId, file) {
    const path = `kanban-images/${cardId}/${Date.now()}-${Math.round(Math.random() * 1e6)}.${extOf(file)}`;
    const ref = storageRef(storage, path);
    await uploadBytes(ref, file, { contentType: file.type });
    const url = await getDownloadURL(ref);
    await updateDoc(doc(db, COL, cardId), { imageUrls: arrayUnion(url), updatedAt: serverTimestamp() });
    return url;
}

// Remove a URL do card e apaga o objeto no Storage (ignora se já não existe).
async function removeCardImage(cardId, url) {
    await updateDoc(doc(db, COL, cardId), { imageUrls: arrayRemove(url), updatedAt: serverTimestamp() });
    try { await deleteObject(storageRef(storage, url)); } catch { /* já removido */ }
}

// Sobe o anexo de um COMENTÁRIO e devolve a URL (o doc do comentário guarda a lista).
async function uploadCommentImage(cardId, file) {
    const path = `kanban-comment-images/${cardId}/${Date.now()}-${Math.round(Math.random() * 1e6)}.${extOf(file)}`;
    const ref = storageRef(storage, path);
    await uploadBytes(ref, file, { contentType: file.type });
    return getDownloadURL(ref);
}

// Miniatura de um anexo já salvo (imagem ou PDF). Clique: imagem→lightbox, PDF→nova aba.
function attachmentThumbHtml(url, opts = {}) {
    const { removable = false, size = 'h-20' } = opts;
    const pdf = isPdfUrl(url);
    const inner = pdf
        ? `<div class="w-full h-full flex flex-col items-center justify-center gap-0.5 bg-red-50 dark:bg-red-900/20 text-red-500">
             <span class="material-symbols-outlined text-[22px]">picture_as_pdf</span>
             <span class="text-[9px] font-bold uppercase tracking-wide">PDF</span>
           </div>`
        : `<img src="${escapeHtml(url)}" alt="Anexo" class="w-full h-full object-cover" loading="lazy" />`;
    return `
    <div class="group/att relative ${size} w-24 shrink-0 rounded-lg overflow-hidden border border-border-light dark:border-border-dark bg-slate-50 dark:bg-slate-900">
      <button type="button" class="att-open w-full h-full" data-url="${escapeHtml(url)}" data-pdf="${pdf ? '1' : '0'}" title="${pdf ? 'Abrir PDF' : 'Ampliar'}">${inner}</button>
      ${removable ? `<button type="button" class="att-remove absolute top-1 right-1 h-5 w-5 rounded-full bg-black/60 text-white flex items-center justify-center opacity-0 group-hover/att:opacity-100 transition-opacity" data-url="${escapeHtml(url)}" title="Remover anexo"><span class="material-symbols-outlined text-[14px]">close</span></button>` : ''}
    </div>`;
}

// Área de anexos PENDENTES (ainda não enviados). Gera botão "adicionar",
// aceita colar (Ctrl+V) e mostra previews com remover. Espelha o feluma-on.
// Retorna { files, clear, destroy } — `files()` dá os File[] para o upload.
function createAttachmentStager(container, { pasteTarget, compact = false } = {}) {
    const pending = []; // { file, previewUrl }

    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = 'image/png,image/jpeg,image/webp,application/pdf';
    input.className = 'hidden';

    const strip = document.createElement('div');
    strip.className = 'flex flex-wrap gap-2';

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = compact
        ? 'shrink-0 h-9 w-9 flex items-center justify-center rounded-lg border border-border-light dark:border-border-dark text-text-secondary dark:text-slate-400 hover:text-primary hover:border-primary transition-colors'
        : 'inline-flex items-center gap-1.5 h-9 px-3 text-sm font-medium rounded-lg border border-dashed border-border-light dark:border-border-dark text-text-secondary dark:text-slate-400 hover:text-primary hover:border-primary transition-colors';
    addBtn.innerHTML = compact
        ? '<span class="material-symbols-outlined text-[20px]">attach_file</span>'
        : '<span class="material-symbols-outlined text-[18px]">attach_file</span> Anexar imagem ou PDF';
    addBtn.title = 'Anexar (ou cole um print com Ctrl+V)';

    container.appendChild(strip);
    container.appendChild(addBtn);
    container.appendChild(input);

    function renderStrip() {
        strip.innerHTML = pending.map((p, i) => {
            const inner = isPdfFile(p.file)
                ? `<div class="w-full h-full flex flex-col items-center justify-center gap-0.5 bg-red-50 dark:bg-red-900/20 text-red-500"><span class="material-symbols-outlined text-[20px]">picture_as_pdf</span><span class="text-[8px] font-bold uppercase">PDF</span></div>`
                : `<img src="${p.previewUrl}" alt="" class="w-full h-full object-cover" />`;
            return `
            <div class="relative h-16 w-16 rounded-lg overflow-hidden border border-border-light dark:border-border-dark bg-slate-50 dark:bg-slate-900">
              ${inner}
              <button type="button" data-rm="${i}" class="absolute top-0.5 right-0.5 h-5 w-5 rounded-full bg-black/60 text-white flex items-center justify-center" title="Remover"><span class="material-symbols-outlined text-[13px]">close</span></button>
            </div>`;
        }).join('');
        strip.querySelectorAll('[data-rm]').forEach((b) => {
            b.addEventListener('click', () => remove(Number(b.dataset.rm)));
        });
    }

    function stage(files) {
        for (const f of files) {
            const err = validateAttachment(f);
            if (err) { toast(err, 'error'); continue; }
            pending.push({ file: f, previewUrl: URL.createObjectURL(f) });
        }
        renderStrip();
    }

    function remove(idx) {
        const [p] = pending.splice(idx, 1);
        if (p) URL.revokeObjectURL(p.previewUrl);
        renderStrip();
    }

    addBtn.addEventListener('click', () => input.click());
    input.addEventListener('change', () => { stage(Array.from(input.files || [])); input.value = ''; });

    const onPaste = (e) => {
        const files = Array.from(e.clipboardData?.files || []);
        if (!files.length) return;
        e.preventDefault();
        stage(files);
    };
    if (pasteTarget) pasteTarget.addEventListener('paste', onPaste);

    return {
        files: () => pending.map((p) => p.file),
        count: () => pending.length,
        clear() { pending.splice(0).forEach((p) => URL.revokeObjectURL(p.previewUrl)); renderStrip(); },
        destroy() { if (pasteTarget) pasteTarget.removeEventListener('paste', onPaste); pending.forEach((p) => URL.revokeObjectURL(p.previewUrl)); },
    };
}

// Lightbox simples para ampliar imagens (PDF abre em nova aba, não usa isto).
function openLightbox(url) {
    const root = document.getElementById('kanban-modal-root');
    const box = document.createElement('div');
    box.className = 'fixed inset-0 z-[200] flex items-center justify-center p-6 bg-black/80 cursor-zoom-out';
    box.innerHTML = `<img src="${escapeHtml(url)}" alt="Anexo" class="max-h-full max-w-full rounded-lg shadow-2xl" />`;
    box.addEventListener('click', () => box.remove());
    root.appendChild(box);
}

// Liga cliques de "abrir/ampliar" e "remover" numa área de miniaturas.
function wireAttachmentThumbs(container, { onRemove } = {}) {
    container.querySelectorAll('.att-open').forEach((btn) => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (btn.dataset.pdf === '1') window.open(btn.dataset.url, '_blank', 'noopener,noreferrer');
            else openLightbox(btn.dataset.url);
        });
    });
    if (onRemove) {
        container.querySelectorAll('.att-remove').forEach((btn) => {
            btn.addEventListener('click', (e) => { e.stopPropagation(); onRemove(btn.dataset.url); });
        });
    }
}

// ── Render: barra/abas ─────────────────────────────────────────────────────

function updateTabs() {
    const board = document.getElementById('kanban-board');
    const arch = document.getElementById('kanban-archived');
    const canc = document.getElementById('kanban-cancelled');
    const tabBoard = document.getElementById('tab-board');
    const tabArch = document.getElementById('tab-archived');
    const tabCanc = document.getElementById('tab-cancelled');
    const activeCls = ['bg-primary', 'text-white'];
    const idleCls = ['bg-white', 'dark:bg-slate-800', 'text-text-secondary', 'dark:text-slate-400'];

    const set = (btn, active) => {
        if (active) { btn.classList.add(...activeCls); btn.classList.remove(...idleCls); }
        else { btn.classList.remove(...activeCls); btn.classList.add(...idleCls); }
    };

    board.classList.toggle('hidden', view !== 'board');
    board.classList.toggle('flex', view === 'board');
    arch.classList.toggle('hidden', view !== 'arquivados');
    canc.classList.toggle('hidden', view !== 'cancelados');

    set(tabBoard, view === 'board');
    set(tabArch, view === 'arquivados');
    set(tabCanc, view === 'cancelados');
}

// ── Render: card (face) ────────────────────────────────────────────────────

// Sem responsável fica um círculo tracejado — o buraco precisa ser visível,
// senão demanda órfã se camufla no meio das atribuídas.
function assigneeChipHtml(card) {
    if (!card.assigneeEmail) {
        return `<span title="Sem responsável"
            class="h-6 w-6 shrink-0 rounded-full border border-dashed border-slate-300 dark:border-slate-600 text-slate-300 dark:text-slate-600 text-[10px] font-bold flex items-center justify-center">?</span>`;
    }
    const name = card.assigneeName || card.assigneeEmail;
    return `<span title="Responsável: ${escapeHtml(name)}"
        class="h-6 w-6 shrink-0 rounded-full bg-primary/10 text-primary text-[10px] font-bold flex items-center justify-center">${escapeHtml(initials(name))}</span>`;
}

function cardFaceHtml(card) {
    const prio = PRIORITIES[card.priority] || PRIORITIES.media;
    const area = AREAS[card.area] || AREAS.central;
    const pageLabel = card.page ? (PAGE_LABEL[card.page] || card.page) : '';

    return `
    <div draggable="true" data-card-id="${card.id}"
        class="kanban-card bg-white dark:bg-slate-800 border border-border-light dark:border-border-dark rounded-lg shadow-sm cursor-grab active:cursor-grabbing group relative">
      <button type="button" data-action="view" data-id="${card.id}" class="w-full text-left p-3 pb-1.5">
        <div class="flex items-start gap-1.5">
          <span class="material-symbols-outlined text-[16px] text-slate-300 dark:text-slate-600 mt-0.5 shrink-0">drag_indicator</span>
          <p class="flex-1 text-sm font-semibold text-text-main dark:text-slate-100 leading-snug line-clamp-3">${escapeHtml(card.title)}</p>
        </div>
        ${card.description ? `<p class="text-xs text-text-secondary dark:text-slate-400 mt-1.5 pl-6 line-clamp-2">${escapeHtml(card.description)}</p>` : ''}
        <div class="pl-6 mt-2 flex flex-wrap items-center gap-1">
          <span class="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-full ${area.badge}">${area.label}</span>
          ${pageLabel ? `<span class="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300 inline-flex items-center gap-0.5"><span class="material-symbols-outlined text-[12px]">description</span>${escapeHtml(pageLabel)}</span>` : ''}
        </div>
        ${card.createdByName ? `<p class="text-[10px] text-slate-400 dark:text-slate-500 mt-1.5 pl-6">Aberto por ${escapeHtml(card.createdByName)}</p>` : ''}
      </button>
      <div class="px-3 pb-2.5 pt-1 pl-9 flex items-center gap-2">
        ${assigneeChipHtml(card)}
        <span class="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-full ${prio.badge}">${prio.label}</span>
        ${card.imageUrls?.length ? `<span class="inline-flex items-center gap-0.5 text-[10px] font-medium text-text-secondary dark:text-slate-400" title="${card.imageUrls.length} anexo(s)"><span class="material-symbols-outlined text-[14px]">attachment</span>${card.imageUrls.length}</span>` : ''}
        <div class="ml-auto flex items-center gap-1">
          <button type="button" data-action="edit" data-id="${card.id}" title="Editar"
            class="text-slate-300 dark:text-slate-600 hover:text-primary transition-colors">
            <span class="material-symbols-outlined text-[18px]">edit</span>
          </button>
          ${card.column === 'concluido' ? `
          <button type="button" data-action="archive" data-id="${card.id}" title="Arquivar"
            class="text-slate-300 dark:text-slate-600 hover:text-emerald-600 transition-colors">
            <span class="material-symbols-outlined text-[18px]">inventory_2</span>
          </button>` : ''}
          <button type="button" data-action="cancel" data-id="${card.id}" title="Cancelar"
            class="text-slate-300 dark:text-slate-600 hover:text-red-500 transition-colors">
            <span class="material-symbols-outlined text-[18px]">cancel</span>
          </button>
        </div>
      </div>
    </div>`;
}

// ── Render: quadro ───────────────────────────────────────────────────────────

function render() {
    updateTabs();
    renderOwnerFilter();
    if (view === 'board') renderBoard();
    else if (view === 'arquivados') renderArchived();
    else renderCancelled();
}

function renderBoard() {
    const board = document.getElementById('kanban-board');
    const list = visibleCards();

    board.innerHTML = COLUMNS.map((col) => {
        const colCards = list
            .filter((c) => c.column === col.id)
            .sort((a, b) => a.order - b.order);
        return `
        <div class="w-72 shrink-0 flex flex-col h-full">
          <div class="kanban-col-drop flex flex-col h-full rounded-xl border border-border-light dark:border-border-dark border-t-4 ${col.accent} bg-slate-50 dark:bg-slate-800/40 p-3" data-column="${col.id}">
            <div class="flex items-center justify-between mb-2 shrink-0">
              <span class="text-xs font-bold uppercase tracking-wide text-text-secondary dark:text-slate-400">${col.label}</span>
              <span class="text-xs bg-white dark:bg-slate-700 border border-border-light dark:border-border-dark rounded-full px-2 py-0.5 font-semibold text-text-secondary dark:text-slate-300">${colCards.length}</span>
            </div>
            <div class="flex-1 min-h-0 overflow-y-auto flex flex-col gap-2 pr-0.5">
              ${colCards.map(cardFaceHtml).join('') || `<p class="text-xs text-slate-300 dark:text-slate-600 text-center py-6 italic">Sem demandas</p>`}
            </div>
            <button type="button" data-action="new-in" data-column="${col.id}"
              class="mt-2 shrink-0 w-full flex items-center justify-center gap-1 text-xs text-text-secondary dark:text-slate-400 hover:text-primary transition-colors py-1.5 rounded-lg hover:bg-white/70 dark:hover:bg-slate-700/50">
              <span class="material-symbols-outlined text-[16px]">add</span> Adicionar
            </button>
          </div>
        </div>`;
    }).join('');

    wireBoardEvents(board);
}

function wireBoardEvents(board) {
    // Cliques (delegação)
    board.querySelectorAll('[data-action]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const action = btn.dataset.action;
            const id = btn.dataset.id;
            const card = cards.find((c) => c.id === id);
            if (action === 'view' && card) openViewModal(card);
            else if (action === 'edit' && card) openCardModal(card);
            else if (action === 'archive' && card) doArchive(card);
            else if (action === 'cancel' && card) doCancel(card);
            else if (action === 'new-in') openCardModal(null, btn.dataset.column);
        });
    });

    // Drag & drop
    board.querySelectorAll('.kanban-card').forEach((el) => {
        el.addEventListener('dragstart', () => { dragId = el.dataset.cardId; });
        el.addEventListener('dragend', () => { dragId = null; });
    });
    board.querySelectorAll('.kanban-col-drop').forEach((zone) => {
        zone.addEventListener('dragover', (e) => e.preventDefault());
        zone.addEventListener('dragenter', () => zone.classList.add('drag-over'));
        zone.addEventListener('dragleave', (e) => {
            if (!zone.contains(e.relatedTarget)) zone.classList.remove('drag-over');
        });
        zone.addEventListener('drop', async (e) => {
            e.preventDefault();
            zone.classList.remove('drag-over');
            const id = dragId;
            dragId = null;
            if (!id) return;
            const card = cards.find((c) => c.id === id);
            const target = zone.dataset.column;
            if (!card || card.column === target) return;
            try {
                await moveCard(id, target);
            } catch {
                toast('Não foi possível mover a demanda.', 'error');
            }
        });
    });
}

// ── Render: arquivados ─────────────────────────────────────────────────────

function renderArchived() {
    const wrap = document.getElementById('kanban-archived');
    const list = archived.filter((c) => !areaFilter || c.area === areaFilter);

    if (!list.length) {
        wrap.innerHTML = `
        <div class="h-full flex flex-col items-center justify-center gap-3 text-slate-300 dark:text-slate-600">
          <span class="material-symbols-outlined text-5xl">inventory_2</span>
          <p class="text-sm">Nenhuma demanda arquivada.</p>
        </div>`;
        return;
    }

    wrap.innerHTML = `
      <p class="text-xs text-text-secondary dark:text-slate-400 mb-3">${list.length} ${list.length === 1 ? 'demanda arquivada' : 'demandas arquivadas'}</p>
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 pb-4">
        ${list.map((card) => {
            const area = AREAS[card.area] || AREAS.central;
            return `
            <div class="bg-white dark:bg-slate-800 border border-border-light dark:border-border-dark rounded-xl p-4">
              <div class="flex items-center gap-2 mb-2 flex-wrap">
                <span class="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-full ${area.badge}">${area.label}</span>
                <span class="text-[10px] text-text-secondary border border-border-light dark:border-border-dark rounded-full px-1.5 py-0.5">${COLUMN_LABEL[card.column] || card.column}</span>
              </div>
              <button type="button" data-action="view" data-id="${card.id}" class="text-left w-full">
                <p class="text-sm font-semibold text-text-main dark:text-slate-100 leading-snug line-clamp-2 mb-1 hover:text-primary transition-colors">${escapeHtml(card.title)}</p>
              </button>
              ${card.description ? `<p class="text-xs text-text-secondary dark:text-slate-400 line-clamp-2 mb-2">${escapeHtml(card.description)}</p>` : ''}
              <div class="mt-2 pt-2 border-t border-border-light dark:border-border-dark flex items-center justify-between gap-2">
                <span class="text-[10px] text-slate-400 truncate">${escapeHtml(card.archivedByName || '—')} · ${card.archivedAt ? timeAgo(card.archivedAt) : '—'}</span>
                <button type="button" data-action="restore" data-id="${card.id}" title="Restaurar" class="text-slate-400 hover:text-primary transition-colors shrink-0">
                  <span class="material-symbols-outlined text-[18px]">unarchive</span>
                </button>
              </div>
            </div>`;
        }).join('')}
      </div>`;

    wrap.querySelectorAll('[data-action]').forEach((btn) => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const id = btn.dataset.id;
            const card = archived.find((c) => c.id === id);
            if (!card) return;
            if (btn.dataset.action === 'view') openViewModal(card);
            else if (btn.dataset.action === 'restore') {
                try { await restoreCard(id); toast('Demanda restaurada.'); }
                catch { toast('Não foi possível restaurar.', 'error'); }
            }
        });
    });
}

// ── Render: cancelados ─────────────────────────────────────────────────────

function renderCancelled() {
    const wrap = document.getElementById('kanban-cancelled');
    const list = cancelled.filter((c) => !areaFilter || c.area === areaFilter);

    if (!list.length) {
        wrap.innerHTML = `
        <div class="h-full flex flex-col items-center justify-center gap-3 text-slate-300 dark:text-slate-600">
          <span class="material-symbols-outlined text-5xl">cancel</span>
          <p class="text-sm">Nenhuma demanda cancelada.</p>
        </div>`;
        return;
    }

    wrap.innerHTML = `
      <p class="text-xs text-text-secondary dark:text-slate-400 mb-3">${list.length} ${list.length === 1 ? 'demanda cancelada' : 'demandas canceladas'}</p>
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 pb-4">
        ${list.map((card) => {
            const area = AREAS[card.area] || AREAS.central;
            return `
            <div class="bg-white dark:bg-slate-800 border border-border-light dark:border-border-dark border-l-4 border-l-red-400 rounded-xl p-4">
              <div class="flex items-center gap-2 mb-2 flex-wrap">
                <span class="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-full ${area.badge}">${area.label}</span>
                <span class="text-[10px] text-text-secondary border border-border-light dark:border-border-dark rounded-full px-1.5 py-0.5">${COLUMN_LABEL[card.column] || card.column}</span>
              </div>
              <button type="button" data-action="view" data-id="${card.id}" class="text-left w-full">
                <p class="text-sm font-semibold text-text-main dark:text-slate-100 leading-snug line-clamp-2 mb-1 hover:text-primary transition-colors">${escapeHtml(card.title)}</p>
              </button>
              ${card.cancelReason ? `<p class="text-xs text-text-secondary dark:text-slate-400 italic line-clamp-2 mb-2">"${escapeHtml(card.cancelReason)}"</p>` : ''}
              <div class="mt-2 pt-2 border-t border-border-light dark:border-border-dark">
                <p class="text-[11px] text-text-secondary dark:text-slate-400 flex items-center gap-1">
                  <span class="material-symbols-outlined text-[14px]">person</span>
                  Responsável: <span class="font-semibold text-text-main dark:text-slate-200">${escapeHtml(card.cancelledByName || '—')}</span>
                </p>
                <div class="flex items-center justify-between gap-2 mt-1.5">
                  <span class="text-[10px] text-slate-400">${card.cancelledAt ? timeAgo(card.cancelledAt) : '—'}</span>
                  <button type="button" data-action="reopen" data-id="${card.id}" title="Reabrir demanda" class="text-[11px] font-semibold text-primary hover:underline inline-flex items-center gap-0.5">
                    <span class="material-symbols-outlined text-[14px]">restart_alt</span> Reabrir
                  </button>
                </div>
              </div>
            </div>`;
        }).join('')}
      </div>`;

    wrap.querySelectorAll('[data-action]').forEach((btn) => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const id = btn.dataset.id;
            const card = cancelled.find((c) => c.id === id);
            if (!card) return;
            if (btn.dataset.action === 'view') openViewModal(card);
            else if (btn.dataset.action === 'reopen') {
                try { await reopenCancelled(id); toast('Demanda reaberta.'); }
                catch { toast('Não foi possível reabrir.', 'error'); }
            }
        });
    });
}

// ── Ações com confirmação ──────────────────────────────────────────────────

async function doArchive(card) {
    try { await archiveCard(card.id); toast('Demanda arquivada.'); }
    catch { toast('Não foi possível arquivar.', 'error'); }
}

// Demandas nunca são apagadas: cancelar registra o responsável (usuário atual)
// e o motivo opcional, movendo a demanda para a lista de Cancelados.
async function doCancel(card) {
    const reason = window.prompt(
        `Cancelar a demanda "${card.title}"?\nEla sai do quadro e vai para a lista de Cancelados (registrando você como responsável).\n\nSe quiser, informe o motivo (opcional):`,
        '',
    );
    if (reason === null) return; // usuário desistiu
    try { await cancelCard(card.id, reason.trim()); toast('Demanda cancelada.'); }
    catch { toast('Não foi possível cancelar.', 'error'); }
}

// ── Modal: criar / editar ──────────────────────────────────────────────────

function pageOptionsHtml(area, selected) {
    const relevant = PAGES.filter((p) => !area || p.area === area || p.area === 'ambos');
    return `<option value="">— Nenhuma / não se aplica</option>` +
        relevant.map((p) => `<option value="${p.id}" ${p.id === selected ? 'selected' : ''}>${escapeHtml(p.label)}</option>`).join('');
}

function closeModal() {
    if (commentsUnsub) { commentsUnsub(); commentsUnsub = null; }
    document.getElementById('kanban-modal-root').innerHTML = '';
}

function openCardModal(card, defaultColumn) {
    const isEdit = !!card;
    const c = card || {
        title: '', description: '', priority: 'media',
        area: 'central', page: '', subitem: '',
        column: defaultColumn || 'reportado',
        // Demanda nova já nasce com quem está criando — trocar é um clique.
        assigneeEmail: (currentUser?.email || '').toLowerCase(),
        assigneeName: currentUser?.name || '',
    };
    const root = document.getElementById('kanban-modal-root');

    root.innerHTML = `
    <div class="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
      <div class="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-lg max-h-[92vh] flex flex-col border border-border-light dark:border-border-dark">
        <div class="flex items-center justify-between p-5 border-b border-border-light dark:border-border-dark shrink-0">
          <h2 class="text-base font-bold text-text-main dark:text-white">${isEdit ? 'Editar demanda' : 'Nova demanda'}</h2>
          <button type="button" id="modal-close" class="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors">
            <span class="material-symbols-outlined">close</span>
          </button>
        </div>
        <form id="card-form" class="p-5 space-y-4 overflow-y-auto flex-1">
          <div class="space-y-1.5">
            <label class="text-xs font-semibold text-text-secondary dark:text-slate-400 uppercase tracking-wide">Título *</label>
            <input id="f-title" maxlength="120" value="${escapeHtml(c.title)}" placeholder="Descreva a demanda…" required
              class="w-full rounded-lg border border-border-light dark:border-border-dark bg-white dark:bg-slate-900 text-text-main dark:text-white px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary" />
          </div>
          <div class="space-y-1.5">
            <label class="text-xs font-semibold text-text-secondary dark:text-slate-400 uppercase tracking-wide">Descrição</label>
            <textarea id="f-desc" maxlength="600" rows="3" placeholder="Detalhes adicionais…"
              class="w-full rounded-lg border border-border-light dark:border-border-dark bg-white dark:bg-slate-900 text-text-main dark:text-white px-3 py-2 text-sm resize-none focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary">${escapeHtml(c.description)}</textarea>
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div class="space-y-1.5">
              <label class="text-xs font-semibold text-text-secondary dark:text-slate-400 uppercase tracking-wide">Perfil / Área *</label>
              <select id="f-area" class="w-full rounded-lg border border-border-light dark:border-border-dark bg-white dark:bg-slate-900 text-text-main dark:text-white px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary">
                ${Object.entries(AREAS).map(([id, a]) => `<option value="${id}" ${id === c.area ? 'selected' : ''}>${a.label}</option>`).join('')}
              </select>
            </div>
            <div class="space-y-1.5">
              <label class="text-xs font-semibold text-text-secondary dark:text-slate-400 uppercase tracking-wide">Página</label>
              <select id="f-page" class="w-full rounded-lg border border-border-light dark:border-border-dark bg-white dark:bg-slate-900 text-text-main dark:text-white px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary">
                ${pageOptionsHtml(c.area, c.page)}
              </select>
            </div>
          </div>

          <div class="space-y-1.5">
            <label class="text-xs font-semibold text-text-secondary dark:text-slate-400 uppercase tracking-wide">Subitem da página</label>
            <input id="f-subitem" maxlength="160" value="${escapeHtml(c.subitem)}" placeholder="Ex.: coluna 'Faturado SIGTAP', botão Exportar…"
              class="w-full rounded-lg border border-border-light dark:border-border-dark bg-white dark:bg-slate-900 text-text-main dark:text-white px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary" />
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div class="space-y-1.5">
              <label class="text-xs font-semibold text-text-secondary dark:text-slate-400 uppercase tracking-wide">Coluna</label>
              <select id="f-column" class="w-full rounded-lg border border-border-light dark:border-border-dark bg-white dark:bg-slate-900 text-text-main dark:text-white px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary">
                ${COLUMNS.map((col) => `<option value="${col.id}" ${col.id === c.column ? 'selected' : ''}>${col.label}</option>`).join('')}
              </select>
            </div>
            <div class="space-y-1.5">
              <label class="text-xs font-semibold text-text-secondary dark:text-slate-400 uppercase tracking-wide">Prioridade</label>
              <select id="f-priority" class="w-full rounded-lg border border-border-light dark:border-border-dark bg-white dark:bg-slate-900 text-text-main dark:text-white px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary">
                ${Object.entries(PRIORITIES).map(([id, p]) => `<option value="${id}" ${id === c.priority ? 'selected' : ''}>${p.label}</option>`).join('')}
              </select>
            </div>
          </div>

          <div class="space-y-1.5">
            <label class="text-xs font-semibold text-text-secondary dark:text-slate-400 uppercase tracking-wide">Responsável</label>
            <select id="f-owner" class="w-full rounded-lg border border-border-light dark:border-border-dark bg-white dark:bg-slate-900 text-text-main dark:text-white px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary">
              <option value="">— Sem responsável</option>
              ${teamUsers.map((u) => `<option value="${escapeHtml(u.email)}" ${u.email === c.assigneeEmail ? 'selected' : ''}>${escapeHtml(u.name)}</option>`).join('')}
              ${c.assigneeEmail && !teamUsers.some((u) => u.email === c.assigneeEmail)
                  // Responsável que saiu da equipe continua na lista deste card:
                  // sem isso, salvar qualquer edição apagaria a atribuição.
                  ? `<option value="${escapeHtml(c.assigneeEmail)}" selected>${escapeHtml(c.assigneeName || c.assigneeEmail)}</option>`
                  : ''}
            </select>
          </div>

          <div class="space-y-1.5">
            <label class="text-xs font-semibold text-text-secondary dark:text-slate-400 uppercase tracking-wide">Anexos <span class="normal-case font-normal text-slate-400">(imagem ou PDF · cole um print com Ctrl+V)</span></label>
            ${isEdit && c.imageUrls?.length ? `<div id="saved-attachments" class="flex flex-wrap gap-2 mb-2">${c.imageUrls.map((u) => attachmentThumbHtml(u, { removable: true })).join('')}</div>` : ''}
            <div id="attach-stager" class="space-y-2"></div>
          </div>

          <div class="flex items-center justify-end gap-2 pt-1">
            <button type="button" id="modal-cancel" class="h-9 px-4 text-sm rounded-lg border border-border-light dark:border-border-dark text-text-secondary dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">Cancelar</button>
            <button type="submit" id="modal-save" class="inline-flex items-center gap-1.5 h-9 px-4 text-sm font-bold rounded-lg bg-primary hover:bg-primary-dark text-white disabled:opacity-40 transition-colors">
              ${isEdit ? 'Salvar' : 'Criar demanda'}
            </button>
          </div>
        </form>
      </div>
    </div>`;

    const areaSel = root.querySelector('#f-area');
    const pageSel = root.querySelector('#f-page');
    // Ao trocar a área, refaz as opções de página mantendo a seleção se ainda válida.
    areaSel.addEventListener('change', () => {
        pageSel.innerHTML = pageOptionsHtml(areaSel.value, pageSel.value);
    });

    // Anexos: stager de novos arquivos (aceita colar em qualquer lugar do form).
    const form = root.querySelector('#card-form');
    const stager = createAttachmentStager(root.querySelector('#attach-stager'), { pasteTarget: form });
    const closeEditor = () => { stager.destroy(); closeModal(); };

    // Remoção de anexos JÁ salvos (só no modo edição — o card já existe).
    const savedWrap = root.querySelector('#saved-attachments');
    if (savedWrap && isEdit) {
        wireAttachmentThumbs(savedWrap, {
            onRemove: async (url) => {
                try {
                    await removeCardImage(card.id, url);
                    card.imageUrls = (card.imageUrls || []).filter((u) => u !== url);
                    savedWrap.querySelector(`[data-url="${CSS.escape(url)}"]`)?.closest('.group\\/att')?.remove();
                    toast('Anexo removido.');
                } catch { toast('Não foi possível remover o anexo.', 'error'); }
            },
        });
    }

    root.querySelector('#modal-close').addEventListener('click', closeEditor);
    root.querySelector('#modal-cancel').addEventListener('click', closeEditor);

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const title = root.querySelector('#f-title').value.trim();
        if (!title) return;
        const ownerEmail = root.querySelector('#f-owner').value;
        const ownerOpt = root.querySelector('#f-owner').selectedOptions[0];
        const payload = {
            title,
            description: root.querySelector('#f-desc').value.trim(),
            area: areaSel.value,
            page: pageSel.value,
            subitem: root.querySelector('#f-subitem').value.trim(),
            column: root.querySelector('#f-column').value,
            priority: root.querySelector('#f-priority').value,
            assigneeEmail: ownerEmail,
            // Nome desnormalizado: o rótulo da própria opção, que já é o nome
            // cadastrado em `usuarios` — desenhar a inicial não pode custar
            // uma leitura por card.
            assigneeName: ownerEmail ? (ownerOpt?.textContent.trim() || '') : '',
        };
        const btn = root.querySelector('#modal-save');
        btn.disabled = true;
        try {
            const pendingFiles = stager.files();
            let cardId;
            if (isEdit) { await updateCard(card.id, payload); cardId = card.id; }
            else { cardId = await createCard(payload); }

            // Sobe os anexos pendentes já com o id do card garantido.
            if (pendingFiles.length) {
                btn.innerHTML = `<span class="material-symbols-outlined text-[18px] animate-spin">progress_activity</span> Enviando anexos…`;
                for (const f of pendingFiles) {
                    try { await uploadCardImage(cardId, f); }
                    catch { toast(`Falha ao enviar "${f.name}".`, 'error'); }
                }
            }
            toast(isEdit ? 'Demanda atualizada.' : 'Demanda criada.');
            closeEditor();
        } catch (err) {
            console.error('[Kanban] save error:', err);
            toast('Não foi possível salvar.', 'error');
            btn.disabled = false;
        }
    });
}

// ── Modal: visualização + comentários ──────────────────────────────────────

function openViewModal(card) {
    const root = document.getElementById('kanban-modal-root');
    const prio = PRIORITIES[card.priority] || PRIORITIES.media;
    const area = AREAS[card.area] || AREAS.central;
    const pageLabel = card.page ? (PAGE_LABEL[card.page] || card.page) : '—';
    const opened = Object.values(card.openedBy || {}).sort((a, b) => (b.openedAt || 0) - (a.openedAt || 0));
    const locked = card.archived || card.cancelled; // sem edição em estados terminais

    root.innerHTML = `
    <div class="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
      <div class="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-4xl max-h-[92vh] flex flex-col border border-border-light dark:border-border-dark">
        <div class="flex items-start justify-between px-6 py-4 border-b border-border-light dark:border-border-dark shrink-0">
          <div class="flex-1 min-w-0 pr-4">
            <div class="flex items-center gap-2 mb-1.5 flex-wrap">
              <span class="text-[11px] font-bold uppercase px-2 py-0.5 rounded-full ${prio.badge}">${prio.label}</span>
              <span class="text-[11px] font-bold uppercase px-2 py-0.5 rounded-full ${area.badge}">${area.label}</span>
              <span class="text-xs text-text-secondary border border-border-light dark:border-border-dark rounded-full px-2 py-0.5">${COLUMN_LABEL[card.column] || card.column}</span>
              ${card.archived ? `<span class="text-xs font-semibold text-amber-600 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-full px-2 py-0.5">Arquivada</span>` : ''}
              ${card.cancelled ? `<span class="text-xs font-semibold text-red-600 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-full px-2 py-0.5">Cancelada</span>` : ''}
            </div>
            <h2 class="text-lg font-bold text-text-main dark:text-white leading-snug">${escapeHtml(card.title)}</h2>
          </div>
          <div class="flex items-center gap-2 shrink-0">
            ${locked ? '' : `<button type="button" id="view-edit" class="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-semibold rounded-lg border border-border-light dark:border-border-dark text-text-secondary dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"><span class="material-symbols-outlined text-[16px]">edit</span> Editar</button>`}
            <button type="button" id="view-close" class="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"><span class="material-symbols-outlined">close</span></button>
          </div>
        </div>

        <div class="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-[1fr_340px] md:divide-x divide-border-light dark:divide-border-dark overflow-hidden">
          <!-- Detalhes -->
          <div class="overflow-y-auto p-6 space-y-5">
            <div>
              <p class="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Descrição</p>
              ${card.description
                ? `<p class="text-sm text-text-main dark:text-slate-200 whitespace-pre-wrap leading-relaxed">${escapeHtml(card.description)}</p>`
                : `<p class="text-sm text-slate-400 italic">Sem descrição.</p>`}
            </div>
            <div>
              <p class="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2 flex items-center gap-1.5"><span class="material-symbols-outlined text-[16px]">attachment</span> Anexos${(card.imageUrls?.length) ? ` (${card.imageUrls.length})` : ''}</p>
              <div id="view-attachments" class="flex flex-wrap gap-2">
                ${(card.imageUrls?.length)
                    ? card.imageUrls.map((u) => attachmentThumbHtml(u, { removable: !locked })).join('')
                    : `<p class="text-sm text-slate-400 italic">Nenhum anexo. ${locked ? '' : 'Use “Editar” para anexar imagens ou PDF.'}</p>`}
              </div>
            </div>
            <div>
              <p class="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Onde no sistema</p>
              <dl class="space-y-2 text-sm">
                <div class="flex gap-2"><dt class="text-text-secondary w-28 shrink-0">Perfil / Área</dt><dd class="text-text-main dark:text-slate-200">${area.label}</dd></div>
                <div class="flex gap-2"><dt class="text-text-secondary w-28 shrink-0">Página</dt><dd class="text-text-main dark:text-slate-200">${escapeHtml(pageLabel)}</dd></div>
                <div class="flex gap-2"><dt class="text-text-secondary w-28 shrink-0">Subitem</dt><dd class="text-text-main dark:text-slate-200">${card.subitem ? escapeHtml(card.subitem) : '—'}</dd></div>
              </dl>
            </div>
            <div>
              <p class="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Informações</p>
              <dl class="space-y-2 text-sm">
                <div class="flex gap-2"><dt class="text-text-secondary w-28 shrink-0">Responsável</dt><dd class="text-text-main dark:text-slate-200">${card.assigneeName ? escapeHtml(card.assigneeName) : '<span class="text-slate-400 italic">não definido</span>'}</dd></div>
                ${card.createdByName ? `<div class="flex gap-2"><dt class="text-text-secondary w-28 shrink-0">Aberto por</dt><dd class="text-text-main dark:text-slate-200">${escapeHtml(card.createdByName)}</dd></div>` : ''}
                <div class="flex gap-2"><dt class="text-text-secondary w-28 shrink-0">Criado em</dt><dd class="text-text-main dark:text-slate-200">${fmtDate(card.createdAt)}</dd></div>
                <div class="flex gap-2"><dt class="text-text-secondary w-28 shrink-0">Atualizado</dt><dd class="text-text-main dark:text-slate-200">${timeAgo(card.updatedAt)}</dd></div>
              </dl>
            </div>
            ${card.cancelled ? `
            <div>
              <p class="text-xs font-semibold text-red-500 uppercase tracking-wide mb-3">Cancelamento</p>
              <dl class="space-y-2 text-sm">
                <div class="flex gap-2"><dt class="text-text-secondary w-28 shrink-0">Responsável</dt><dd class="text-text-main dark:text-slate-200 font-semibold">${escapeHtml(card.cancelledByName || '—')}</dd></div>
                <div class="flex gap-2"><dt class="text-text-secondary w-28 shrink-0">Quando</dt><dd class="text-text-main dark:text-slate-200">${card.cancelledAt ? fmtDate(card.cancelledAt) : '—'}</dd></div>
                ${card.cancelReason ? `<div class="flex gap-2"><dt class="text-text-secondary w-28 shrink-0">Motivo</dt><dd class="text-text-main dark:text-slate-200">${escapeHtml(card.cancelReason)}</dd></div>` : ''}
              </dl>
            </div>` : ''}
            ${opened.length ? `
            <div>
              <p class="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Visualizado por (${opened.length})</p>
              <ul class="space-y-2">
                ${opened.map((o) => `
                  <li class="flex items-center gap-2.5">
                    <div class="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center text-[10px] font-bold text-primary shrink-0">${escapeHtml(initials(o.name))}</div>
                    <div class="min-w-0"><p class="text-xs font-medium text-text-main dark:text-slate-200 truncate">${escapeHtml(o.name || '—')}</p><p class="text-[10px] text-slate-400">${o.openedAt ? timeAgo(o.openedAt) : ''}</p></div>
                  </li>`).join('')}
              </ul>
            </div>` : ''}
          </div>

          <!-- Comentários -->
          <div class="flex flex-col overflow-hidden">
            <div class="px-5 py-3 border-b border-border-light dark:border-border-dark shrink-0">
              <p class="text-xs font-semibold text-slate-400 uppercase tracking-wide flex items-center gap-1.5"><span class="material-symbols-outlined text-[16px]">forum</span> Comentários</p>
            </div>
            <div id="comments-list" class="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-4">
              <div class="flex justify-center py-6"><span class="material-symbols-outlined animate-spin text-slate-300">progress_activity</span></div>
            </div>
            <form id="comment-form" class="px-5 py-3 border-t border-border-light dark:border-border-dark shrink-0 flex flex-col gap-2">
              <div id="comment-attach" class="flex items-center gap-2 flex-wrap"></div>
              <div class="flex gap-2 items-end">
                <div class="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center text-[10px] font-bold text-primary shrink-0">${escapeHtml(initials(currentUser?.name))}</div>
                <textarea id="comment-text" rows="2" maxlength="800" placeholder="Comentário… (Enter envia · Ctrl+V cola um print)"
                  class="flex-1 text-sm rounded-lg border border-border-light dark:border-border-dark bg-white dark:bg-slate-900 text-text-main dark:text-white px-3 py-2 resize-none focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"></textarea>
                <button type="submit" class="h-9 w-9 flex items-center justify-center rounded-lg bg-primary hover:bg-primary-dark text-white transition-colors shrink-0"><span class="material-symbols-outlined text-[20px]">send</span></button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>`;

    root.querySelector('#view-close').addEventListener('click', closeModal);
    const editBtn = root.querySelector('#view-edit');
    if (editBtn) editBtn.addEventListener('click', () => { closeModal(); openCardModal(card); });

    // Galeria de anexos: ampliar imagem / abrir PDF e (se não bloqueado) remover.
    const attWrap = root.querySelector('#view-attachments');
    if (attWrap) {
        wireAttachmentThumbs(attWrap, locked ? {} : {
            onRemove: async (url) => {
                try {
                    await removeCardImage(card.id, url);
                    card.imageUrls = (card.imageUrls || []).filter((u) => u !== url);
                    attWrap.querySelector(`[data-url="${CSS.escape(url)}"]`)?.closest('.group\\/att')?.remove();
                    if (!card.imageUrls.length) attWrap.innerHTML = `<p class="text-sm text-slate-400 italic">Nenhum anexo. Use “Editar” para anexar imagens ou PDF.</p>`;
                    toast('Anexo removido.');
                } catch { toast('Não foi possível remover o anexo.', 'error'); }
            },
        });
    }

    recordOpen(card.id);
    subscribeComments(card.id);

    const form = root.querySelector('#comment-form');
    const textEl = root.querySelector('#comment-text');
    const sendBtn = form.querySelector('button[type="submit"]');
    // Anexos do comentário: colar (Ctrl+V) em qualquer lugar do form ou botão.
    const commentStager = createAttachmentStager(root.querySelector('#comment-attach'), { pasteTarget: form, compact: true });

    let sending = false;
    const submit = async () => {
        if (sending) return;
        const text = textEl.value.trim();
        const files = commentStager.files();
        if (!text && !files.length) return;
        sending = true;
        sendBtn.disabled = true;
        try {
            const urls = [];
            for (const f of files) urls.push(await uploadCommentImage(card.id, f));
            await addComment(card.id, text, urls);
            textEl.value = '';
            commentStager.clear();
        } catch {
            toast('Não foi possível comentar.', 'error');
        } finally {
            sending = false;
            sendBtn.disabled = false;
        }
    };
    form.addEventListener('submit', (e) => { e.preventDefault(); submit(); });
    textEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
    });
}

function subscribeComments(cardId) {
    if (commentsUnsub) commentsUnsub();
    const q = query(collection(db, COL, cardId, 'comments'), orderBy('createdAt', 'asc'));
    commentsUnsub = onSnapshot(q, (snap) => {
        const list = document.getElementById('comments-list');
        if (!list) return;
        if (snap.empty) {
            list.innerHTML = `<p class="text-sm text-slate-400 text-center py-6 italic">Nenhum comentário ainda.</p>`;
            return;
        }
        list.innerHTML = snap.docs.map((d) => {
            const c = d.data();
            const own = c.authorUid === currentUser?.uid;
            const ts = toMs(c.createdAt);
            return `
            <div class="group flex gap-2.5">
              <div class="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center text-[10px] font-bold text-primary shrink-0 mt-0.5">${escapeHtml(initials(c.authorName))}</div>
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 mb-0.5">
                  <span class="text-xs font-semibold text-text-main dark:text-slate-200">${escapeHtml(c.authorName || 'Usuário')}</span>
                  <span class="text-[10px] text-slate-400">${timeAgo(ts)}</span>
                  ${own ? `<button type="button" data-del-comment="${d.id}" class="ml-auto opacity-0 group-hover:opacity-100 transition-opacity text-slate-300 hover:text-red-500" title="Remover"><span class="material-symbols-outlined text-[14px]">delete</span></button>` : ''}
                </div>
                ${c.text ? `<p class="text-sm text-text-main dark:text-slate-200 whitespace-pre-wrap leading-relaxed break-words">${escapeHtml(c.text)}</p>` : ''}
                ${Array.isArray(c.imageUrls) && c.imageUrls.length ? `<div class="mt-1.5 flex flex-wrap gap-2">${c.imageUrls.map((u) => attachmentThumbHtml(u, { size: 'h-16' })).join('')}</div>` : ''}
              </div>
            </div>`;
        }).join('');
        list.scrollTop = list.scrollHeight;
        wireAttachmentThumbs(list);
        list.querySelectorAll('[data-del-comment]').forEach((b) => {
            b.addEventListener('click', async () => {
                try { await deleteComment(cardId, b.dataset.delComment); }
                catch { toast('Não foi possível remover o comentário.', 'error'); }
            });
        });
    });
}

// ── Inicialização ──────────────────────────────────────────────────────────

function initKanban() {
    document.getElementById('tab-board').addEventListener('click', () => { view = 'board'; render(); });
    document.getElementById('tab-archived').addEventListener('click', () => { view = 'arquivados'; render(); });
    document.getElementById('tab-cancelled').addEventListener('click', () => { view = 'cancelados'; render(); });
    document.getElementById('btn-new-card').addEventListener('click', () => openCardModal(null));
    document.getElementById('filter-area').addEventListener('change', (e) => { areaFilter = e.target.value; render(); });
    document.getElementById('filter-owner').addEventListener('change', (e) => { ownerFilter = e.target.value; render(); });

    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

    // O usuário atual chega via auth-guard; capturamos aqui para autoria.
    onAuthStateChanged(auth, (user) => {
        if (user) {
            currentUser = {
                uid: user.uid,
                email: user.email || '',
                name: user.displayName || (user.email ? user.email.split('@')[0] : 'Usuário'),
            };
        }
    });

    loadTeam();
    subscribeBoard();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initKanban);
} else {
    initKanban();
}
