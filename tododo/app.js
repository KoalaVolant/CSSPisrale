const { createApp, reactive, ref, computed, watch, nextTick, provide } = Vue;

/* ============================================================
   Constantes & utilitaires
   ============================================================ */
const STORAGE_KEY = 'todo-quest-v1';
const UI_KEY = 'todo-quest-ui';   // préférences d'affichage (propres à chaque appareil)

const STATUSES = [
  { value: 'todo',   label: 'Pas commencé' },
  { value: 'doing',  label: 'En cours' },
  { value: 'paused', label: 'En pause' },
  { value: 'done',   label: 'Terminé' },
];

// Niveaux par défaut (modifiables dans l'onglet "Urgences & difficultés").
// L'ordre = du plus faible au plus fort : il sert pour les tris.
const DEFAULT_URGENCIES = [
  { id: 'low',    name: 'Basse',   color: '#3b82f6' },
  { id: 'medium', name: 'Moyenne', color: '#f59e0b' },
  { id: 'high',   name: 'Haute',   color: '#ef4444' },
];
const DEFAULT_DIFFICULTIES = [
  { id: 'easy',   name: 'Facile',    color: '#22c55e' },
  { id: 'medium', name: 'Moyenne',   color: '#f59e0b' },
  { id: 'hard',   name: 'Difficile', color: '#ef4444' },
];

const PALETTE = ['#6366f1', '#22c55e', '#f59e0b', '#ef4444', '#06b6d4', '#a855f7', '#ec4899', '#84cc16'];
const nextColor = i => PALETTE[Math.abs(i) % PALETTE.length];

const TABS = [
  { id: 'home',       label: 'Accueil' },
  { id: 'all',        label: 'Toutes les tâches' },
  { id: 'work',       label: 'Travail' },
  { id: 'gratitude',  label: 'Gratitude' },
  { id: 'habits',     label: 'Habitudes & routines' },
  { id: 'done',       label: 'Terminés' },
  { id: 'projects',   label: 'Projets' },
  { id: 'categories', label: 'Catégories' },
  { id: 'levels',     label: 'Urgences & difficultés' },
  { id: 'rewards',    label: 'Récompenses' },
  { id: 'inventory',  label: 'Inventaire' },
  { id: 'data',       label: 'Sauvegarde' },
];

const clone = o => JSON.parse(JSON.stringify(o));

// Texte noir ou blanc selon la luminosité du fond (pour que les tags colorés restent lisibles)
function readableText(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return '';
  const n = parseInt(m[1], 16);
  // luminance perçue (formule WCAG, avec correction gamma)
  const lin = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const lum = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return lum > 0.3 ? '#111111' : '#ffffff';
}
// Variables CSS utilisables dans ton style : var(--tag-bg) et var(--tag-fg)
function tagStyle(color) {
  return color ? { '--tag-bg': color, '--tag-fg': readableText(color) } : {};
}

// Valeur d'une tâche en points : positive (bonus) ou négative (malus)
let liveData = null;
function effectiveUrgency(t) {
  return t.scope === 'work' ? '' : (t.urgency || '');
}
function migrateProjectUrgencies(d) {
  if (!Array.isArray(d.tasks) || !Array.isArray(d.projects)) return;
  const projects = new Map(d.projects.map(p => [p.id, p]));
  d.tasks.forEach(t => {
    if (t.scope !== 'work' && !t.urgency && t.projectId) {
      const p = projects.get(t.projectId);
      if (p && p.urgency) t.urgency = p.urgency;
    }
  });
  d.projects.forEach(p => { delete p.urgency; });
}
function taskValue(t) {
  let points = Math.max(0, Number(t.points) || 0);
  if (liveData) {
    for (const [levels, id] of (t.scope === 'work' ? [[liveData.workDifficulties, t.difficulty]] : [[liveData.urgencies, effectiveUrgency(t)], [liveData.difficulties, t.difficulty]])) {
      const level = levels.find(l => l.id === id);
      if (!level) continue;
      const amount = Number(level.pointValue);
      if (!Number.isFinite(amount)) continue;
      points = level.pointMode === 'multiply' ? points * Math.max(0, amount) : points + amount;
    }
  }
  return (t.malus ? -1 : 1) * Math.round(Math.max(0, points));
}
const fmtPts = v => `${v < 0 ? '−' : '+'}${Math.abs(v)} pts`;

// Découpe une liste collée en tâches.
// - Une ligne = une tâche, avec ou sans puce (* - – — • 1. 1) ...)
// - Les lignes placées AVANT la première puce forment un titre (header)
const BULLET_RE = /^\s*(?:(?:[*\-–—]|\d+[.)])\s+|[•▪●◦·]\s*)(.*\S)\s*$/;
function parsePastedList(text) {
  const lines = String(text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const firstBullet = lines.findIndex(l => BULLET_RE.test(l));
  let header = '';
  let body = lines;
  if (firstBullet > 0) {
    header = lines.slice(0, firstBullet).join(' ').trim();
    body = lines.slice(firstBullet);
  }
  const items = body
    .map(l => { const m = l.match(BULLET_RE); return (m ? m[1] : l).trim(); })
    .filter(Boolean);
  return { header, items };
}

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatDate(str) {
  if (!str) return '';
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('fr-FR');
}

function formatLongDate(str) {
  if (!str) return '';
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
}

// Une tâche complète avec toutes ses valeurs par défaut
function newTask(fields = {}) {
  return {
    id: uid(), title: '', category: '', points: 10, malus: false, status: 'todo', projectId: '', due: '',
    urgency: '', difficulty: '', doneAt: '',
    ...fields,
  };
}

// Catégories : anciennes sauvegardes = liste de textes ; maintenant { name, color }
function normalizeCategories(list) {
  const seen = new Set();
  const out = [];
  (Array.isArray(list) ? list : []).forEach(c => {
    const item = typeof c === 'string' ? { name: c, color: '' } : { name: String(c && c.name || ''), color: String(c && c.color || '') };
    if (item.name && !seen.has(item.name)) { seen.add(item.name); out.push(item); }
  });
  return out;
}

// Barème gratitude V4 : 1 point par entrée, +0,25 par jour consécutif après le premier.
// Recalcule l'historique chronologiquement pour mettre à niveau les entrées de V3.
function migrateGratitudePoints(records) {
  if (!Array.isArray(records)) return [];
  const ordered = [...records].filter(g => g && /^\d{4}-\d{2}-\d{2}$/.test(g.date))
    .sort((a, b) => a.date.localeCompare(b.date));
  let previous = '', streak = 0;
  for (const g of ordered) {
    const current = Date.parse(g.date + 'T12:00:00Z');
    const prior = previous ? Date.parse(previous + 'T12:00:00Z') : NaN;
    streak = Number.isFinite(prior) && current - prior === 86400000 ? streak + 1 : 1;
    g.points = 1 + (streak - 1) * 0.25;
    previous = g.date;
  }
  return records;
}

function defaultData() {
  return {
    tasks: [],        // { id, title, category, points, malus, status, projectId, due, urgency, difficulty, doneAt }
    projects: [],     // { id, name, description, color }  (l'ordre du tableau = l'ordre manuel)
    rewardCategories: [], // catégories indépendantes des récompenses et de l'inventaire
    habits: [], // habitudes + historique de réalisations
    gratitude: [], // { date, text, points } : une par jour
    gratitudePointsVersion: 2,
    workCategories: [],
    workDifficulties: clone(DEFAULT_DIFFICULTIES),
    categories: [{ name: 'Travail', color: '#4f86b9' }],   // { name, color }  ("Sans catégorie" existe toujours, c'est la valeur '')
    urgencies: clone(DEFAULT_URGENCIES),       // { id, name, color }, du plus faible au plus fort
    difficulties: clone(DEFAULT_DIFFICULTIES), // idem
    rewards: [        // { id, name, category, cost }
      { id: uid(), name: 'Un bon café',           cost: 20 },
      { id: uid(), name: 'Une soirée jeux vidéo', cost: 100 },
      { id: uid(), name: 'Un resto',              cost: 300 },
    ],
    inventory: [],    // { id, name, category, cost, date, used }
    spent: 0,         // total de points dépensés en récompenses
    adjust: 0,        // ajustement manuel du solde (peut être négatif)
    archived: 0,      // points des tâches terminées puis supprimées (conservés)
  };
}

function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultData();
    const d = Object.assign(defaultData(), JSON.parse(raw));
    d.categories = normalizeCategories(d.categories).filter(c => c.name !== 'Travail');

    if (!Array.isArray(d.rewardCategories)) d.rewardCategories = [];
    d.rewardCategories = normalizeCategories(d.rewardCategories);
    if (!Array.isArray(d.habits)) d.habits = [];
    if (!Array.isArray(d.gratitude)) d.gratitude = [];
    if (d.gratitudePointsVersion !== 2) { migrateGratitudePoints(d.gratitude); d.gratitudePointsVersion = 2; }
    if (!Array.isArray(d.workCategories)) d.workCategories = [];
    d.workCategories = normalizeCategories(d.workCategories);
    if (!Array.isArray(d.workDifficulties)) d.workDifficulties = clone(DEFAULT_DIFFICULTIES);
    // Migration unique : les anciennes tâches classées Travail sont isolées par scope.
    (d.tasks || []).forEach(t => { if (!t.scope) t.scope = t.category === 'Travail' ? 'work' : 'personal'; if (t.scope === 'work') { t.projectId = ''; if (t.category === 'Travail') t.category = ''; } });
    (d.rewards || []).forEach(r => { if (!Number.isFinite(Number(r.saved))) r.saved = 0; });
    const knownRewards = new Set(d.rewardCategories.map(c => c.name));
    [...(d.rewards || []), ...(d.inventory || [])].forEach(x => { if (x.category && !knownRewards.has(x.category)) { d.rewardCategories.push({name:x.category, color:''}); knownRewards.add(x.category); } });
    migrateProjectUrgencies(d);
    if (!Array.isArray(d.urgencies)) d.urgencies = clone(DEFAULT_URGENCIES);
    if (!Array.isArray(d.difficulties)) d.difficulties = clone(DEFAULT_DIFFICULTIES);
    return d;
  } catch (e) {
    return defaultData();
  }
}

function loadUi() {
  const defaults = { filtersOpen: false, tab: 'home', projectSort: 'manual', collapsedProjects: [] };
  try {
    const ui = Object.assign(defaults, JSON.parse(localStorage.getItem(UI_KEY) || '{}'));
    if (!TABS.some(t => t.id === ui.tab)) ui.tab = 'home';   // onglet inconnu -> accueil
    if (!Array.isArray(ui.collapsedProjects)) ui.collapsedProjects = [];
    if (!['manual', 'urgency'].includes(ui.projectSort)) ui.projectSort = 'manual';
    return ui;
  } catch (e) {
    return defaults;
  }
}

/* ============================================================
   Composant : ligne de tâche (template dans index.html)
   Tout est modifiable en cliquant directement sur le tag concerné.
   Les couleurs viennent des projets / catégories / urgences / difficultés.
   ============================================================ */
const TaskRow = {
  template: '#task-row-template',
  props: ['task', 'projects', 'categories', 'statuses', 'today', 'selected', 'compact'],
  inject: { appData: 'app-data' },
  emits: ['toggle', 'status', 'points', 'due', 'update'],
  data() {
    return { editingTitle: false, draft: '' };
  },
  computed: {
    isOverdue() {
      return !!this.task.due && this.task.due < this.today && this.task.status !== 'done';
    },
    dueLabel() {
      return formatLongDate(this.task.due);
    },
    calculatedPoints() { return taskValue(this.task); },
    urgencyOptions() {
      return [{ id: '', label: 'Urgence' }, ...this.appData.urgencies.map(u => ({ id: u.id, label: 'Urgence : ' + u.name }))];
    },
    difficultyOptions() {
      return [{ id: '', label: 'Difficulté' }, ...(this.task.scope === 'work' ? this.appData.workDifficulties : this.appData.difficulties).map(d => ({ id: d.id, label: 'Difficulté : ' + d.name }))];
    },
    // un niveau supprimé ou inconnu est affiché comme "non défini"
    urgencyValue()    { return this.appData.urgencies.some(u => u.id === this.task.urgency) ? this.task.urgency : ''; },
    difficultyValue() { return this.appData.difficulties.some(d => d.id === this.task.difficulty) ? this.task.difficulty : ''; },
    categoryColor() {
      const c = this.appData.categories.find(x => x.name === this.task.category);
      return c ? c.color : '';
    },
    projectColor() {
      const p = this.appData.projects.find(x => x.id === this.task.projectId);
      return p ? p.color || '' : '';
    },
    urgencyColor() {
      const u = this.appData.urgencies.find(x => x.id === this.task.urgency);
      return u ? u.color : '';
    },
    difficultyColor() {
      const d = (this.task.scope === 'work' ? this.appData.workDifficulties : this.appData.difficulties).find(x => x.id === this.task.difficulty);
      return d ? d.color : '';
    },
    // catégorie de la tâche absente de la liste (ne devrait pas arriver) : on l'affiche quand même
    categoryMissing() {
      return !!this.task.category && !this.categories.includes(this.task.category);
    },
  },
  methods: {
    styleFor(color) { return tagStyle(color); },
    // Points modifiables directement dans le tag
    onPoints(event) {
      const raw = String(event.target.value).trim();
      const n = Math.round(Number(raw));
      const value = raw !== '' && Number.isFinite(n) && n >= 0 ? n : this.task.points;   // vide/invalide : on garde l'ancienne valeur
      event.target.value = value;
      this.$emit('points', this.task, value);
    },
    // Clic sur le bloc = (dé)sélection, sauf si on clique sur un champ / tag / bouton, ou si on sélectionne du texte
    onRowClick(event) {
      if (event.target.closest('select, input, button, label, a, option, textarea')) return;
      const selection = window.getSelection ? String(window.getSelection()) : '';
      if (selection) return;
      this.$emit('toggle');
    },
    // Date butoir modifiable directement dans le tag
    onDue(event) {
      this.$emit('due', this.task, event.target.value);
    },
    openPicker(event) {
      try { if (event.target.showPicker) event.target.showPicker(); } catch (e) { /* navigateur sans showPicker */ }
    },
    // Catégorie / projet / urgence / difficulté / bonus-malus : un seul événement "update"
    update(field, event) {
      this.$emit('update', this.task, field, event.target.value);
    },
    // Renommer : double-clic sur le titre
    startTitleEdit() {
      this.draft = this.task.title;
      this.editingTitle = true;
      this.$nextTick(() => { const el = this.$refs.titleInput; if (el) { el.focus(); el.select(); } });
    },
    saveTitle() {
      if (!this.editingTitle) return;
      this.editingTitle = false;
      const title = this.draft.trim();
      if (title && title !== this.task.title) this.$emit('update', this.task, 'title', title);
    },
    cancelTitle() {
      this.editingTitle = false;
    },
  },
};

/* ============================================================
   Composant : liste de tâches avec barre d'actions (sélectionner / modifier / supprimer)
   - group="doneAt" : les tâches sont rangées sous un titre par date de fin (onglet Terminés)
   - compact : n'affiche que la catégorie et le projet sur chaque tâche
   Les événements status / points / due / update sont transmis aux lignes via $attrs.
   ============================================================ */
const TaskList = {
  template: '#task-list-template',
  components: { TaskRow },
  inheritAttrs: false,
  props: {
    tasks:      { type: Array, default: () => [] },
    projects:   { type: Array, default: () => [] },
    categories: { type: Array, default: () => [] },
    statuses:   { type: Array, default: () => [] },
    today:      { type: String, default: '' },
    selected:   { type: Array, default: () => [] },   // ids sélectionnés (global)
    group:      { type: String, default: '' },
    compact:    { type: Boolean, default: false },
  },
  emits: ['toggle', 'select-all', 'clear', 'edit-selected', 'delete-selected'],
  computed: {
    allIds()      { return this.tasks.map(t => t.id); },
    selectedIds() { return this.tasks.filter(t => this.selected.includes(t.id)).map(t => t.id); },
    allSelected() { return this.tasks.length > 0 && this.selectedIds.length === this.tasks.length; },
    // Groupes par date de fin, la plus récente d'abord ; ordre d'origine conservé dans chaque date
    groups() {
      if (this.group !== 'doneAt') return [];
      const map = new Map();
      this.tasks.forEach(t => {
        const key = t.doneAt || '';
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(t);
      });
      return [...map.keys()]
        .sort((a, b) => (b || '').localeCompare(a || ''))     // récent -> ancien
        .sort((a, b) => (a === '') - (b === ''))              // "date inconnue" à la fin
        .map(key => ({ key, label: key ? formatLongDate(key) : 'Date de fin inconnue', tasks: map.get(key) }));
    },
  },
};

/* ============================================================
   Application
   ============================================================ */
const app = createApp({
  setup() {
    /* ---------- Données + sauvegarde auto ---------- */
    const data = reactive(loadData());
    liveData = data;
    provide('app-data', data);   // les lignes de tâches y lisent les couleurs et les niveaux

    // Toute catégorie utilisée par une tâche / récompense / objet doit exister dans la liste
    function syncCategories() {
      data.categories = normalizeCategories(data.categories);

      const known = new Set(data.categories.map(c => c.name));
      data.tasks.filter(x => x.scope !== 'work').forEach(x => {
        if (x.category && !known.has(x.category)) {
          known.add(x.category);
          data.categories.push({ name: x.category, color: '' });
        }
      });
    }
    syncCategories();
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch (e) { /* stockage indisponible */ }   // enregistre la migration tout de suite

    watch(data, () => {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch (e) { /* stockage indisponible */ }
    }, { deep: true });

    // Remplace toutes les données (import de fichier, synchro cloud)
    function applyData(src) {
      data.tasks        = Array.isArray(src.tasks) ? src.tasks : [];
      data.tasks.forEach(t => { if (!t.scope) t.scope = t.category === 'Travail' ? 'work' : 'personal'; if (t.scope === 'work') { t.projectId=''; if(t.category==='Travail') t.category=''; } });
      data.projects     = Array.isArray(src.projects) ? src.projects : [];
      migrateProjectUrgencies(data);
      data.rewards      = Array.isArray(src.rewards) ? src.rewards : [];
      data.rewards.forEach(r => { r.saved = Math.max(0, Math.min(Number(r.cost)||0, Number(r.saved)||0)); });
      data.inventory    = Array.isArray(src.inventory) ? src.inventory : [];
      data.categories   = normalizeCategories(src.categories).filter(c=>c.name!=='Travail');
      data.categories = data.categories.filter(c=>c.name!=='Travail');
      data.rewardCategories = normalizeCategories(src.rewardCategories || [...(src.rewards || []), ...(src.inventory || [])].map(x => x.category).filter(Boolean));
      data.habits = Array.isArray(src.habits) ? src.habits : [];
      data.gratitude = Array.isArray(src.gratitude) ? src.gratitude : [];
      if (src.gratitudePointsVersion !== 2) migrateGratitudePoints(data.gratitude);
      data.gratitudePointsVersion = 2;
      data.workCategories = normalizeCategories(src.workCategories);
      data.workDifficulties = Array.isArray(src.workDifficulties) ? src.workDifficulties : clone(DEFAULT_DIFFICULTIES);
      data.urgencies    = Array.isArray(src.urgencies) ? src.urgencies : clone(DEFAULT_URGENCIES);
      data.difficulties = Array.isArray(src.difficulties) ? src.difficulties : clone(DEFAULT_DIFFICULTIES);
      data.spent        = Number(src.spent) || 0;
      data.adjust       = Number(src.adjust) || 0;
      data.archived     = Number(src.archived) || 0;
      syncCategories();
    }

    /* ---------- Préférences d'affichage (mémorisées) ---------- */
    const ui = reactive(loadUi());
    watch(ui, () => {
      try { localStorage.setItem(UI_KEY, JSON.stringify(ui)); } catch (e) { /* stockage indisponible */ }
    }, { deep: true });

    // Onglet ouvert : mémorisé avec les autres préférences
    const view = computed({ get: () => ui.tab, set: v => { ui.tab = v; } });
    function setTab(id) { view.value = id; }
    const pageTitle = computed(() => view.value === 'home' ? 'Tableau de bord' : (TABS.find(t => t.id === view.value) || {}).label);
    const today = ref(todayStr());
    setInterval(() => { today.value = todayStr(); }, 60 * 1000);

    /* ---------- Notifications ---------- */
    const toast = ref('');
    let toastTimer = null;
    function notify(msg) {
      toast.value = msg;
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => { toast.value = ''; }, 3000);
    }

    /* ---------- Catégories (avec couleur) ---------- */
    const categories = computed(() => data.categories.map(c => c.name));   // noms, pour les menus déroulants

    const categoryForm = reactive({ open: false, oldName: '', name: '', color: '#6366f1' });

    function openCategoryForm(name = null) {
      const found = name ? data.categories.find(c => c.name === name) : null;
      Object.assign(categoryForm, {
        open: true, oldName: name || '', name: name || '',
        color: (found && found.color) || nextColor(data.categories.length),
      });
    }

    function saveCategory() {
      const name = categoryForm.name.trim();
      if (!name) return;
      if (name.toLowerCase() === 'sans catégorie') { alert("« Sans catégorie » existe déjà : c'est la catégorie par défaut."); return; }
      const clash = data.categories.some(c => c.name.toLowerCase() === name.toLowerCase() && c.name !== categoryForm.oldName);
      if (clash) { alert('Cette catégorie existe déjà.'); return; }

      if (categoryForm.oldName) {                       // renommer : on met à jour tout ce qui l'utilise
        const old = categoryForm.oldName;
        const cat = data.categories.find(c => c.name === old);
        if (cat) { cat.name = name; cat.color = categoryForm.color; }
        data.tasks.forEach(x => { if (x.category === old) x.category = name; });
        if (filters.category === old) filters.category = name;

      } else {
        data.categories.push({ name, color: categoryForm.color });
      }
      categoryForm.open = false;
    }

    function setCategoryColor(cat, color) { cat.color = color; }

    function categoryUsage(name) {
      return {
        tasks: data.tasks.filter(t => (t.category || '') === name).length,
        rewards: 0,
      };
    }

    function deleteCategory(name) {
      const u = categoryUsage(name);
      const used = u.tasks + u.rewards;
      const msg = used
        ? `Supprimer la catégorie « ${name} » ? ${u.tasks} tâche(s) et ${u.rewards} récompense(s) passeront en « Sans catégorie ».`
        : `Supprimer la catégorie « ${name} » ?`;
      if (!confirm(msg)) return;
      data.tasks.forEach(x => { if (x.category === name) x.category = ''; });
      data.categories = data.categories.filter(c => c.name !== name);
      if (filters.category === name) filters.category = '';

    }

    /* ---------- Urgences & difficultés (niveaux modifiables, avec couleur) ---------- */
    const newLevel = reactive({ urgencies: '', difficulties: '' });
    const levelField = kind => (kind === 'urgencies' ? 'urgency' : 'difficulty');

    function levelUsage(kind, id) {
      return data.tasks.filter(t => t[levelField(kind)] === id).length;
    }

    function addLevel(kind) {
      const name = newLevel[kind].trim();
      if (!name) return;
      if (data[kind].some(l => l.name.toLowerCase() === name.toLowerCase())) { alert('Ce niveau existe déjà.'); return; }
      data[kind].push({ id: uid(), name, color: nextColor(data[kind].length) });
      newLevel[kind] = '';
    }

    function renameLevel(level, event) {
      const name = event.target.value.trim();
      if (!name) { event.target.value = level.name; return; }
      level.name = name;
    }

    function setLevelColor(level, color) { level.color = color; }

    function moveLevel(kind, index, delta) {
      const j = index + delta;
      if (j < 0 || j >= data[kind].length) return;
      const [moved] = data[kind].splice(index, 1);
      data[kind].splice(j, 0, moved);
    }

    function deleteLevel(kind, level) {
      const n = levelUsage(kind, level.id);
      const msg = n ? `Supprimer « ${level.name} » ? ${n} tâche(s) n'auront plus de niveau.` : `Supprimer « ${level.name} » ?`;
      if (!confirm(msg)) return;
      data.tasks.forEach(t => { if (t[levelField(kind)] === level.id) t[levelField(kind)] = ''; });
      data[kind] = data[kind].filter(l => l.id !== level.id);
      const fkey = kind === 'urgencies' ? 'urgency' : 'difficulty';
      if (filters[fkey] === level.id) filters[fkey] = '';
    }

    // Rang d'un niveau = sa position dans la liste (0 = non défini)
    const levelRank = (list, id) => list.findIndex(l => l.id === id) + 1;

    /* ---------- Points ---------- */
    // Points des tâches terminées (bonus en +, malus en −) + points des tâches terminées puis supprimées
    const earned = computed(() =>
      data.tasks.filter(t => t.status === 'done').reduce((s, t) => s + taskValue(t), 0)
      + (Number(data.archived) || 0));
    const gratitudeTotal = computed(() => Math.round(data.gratitude.reduce((sum,g) => sum+(Number(g.points)||0),0)*100)/100);
    const savedTotal = computed(() => data.rewards.reduce((sum,r)=>sum+Math.max(0,Number(r.saved)||0),0));
    const balance = computed(() => Math.round((earned.value + gratitudeTotal.value - data.spent - savedTotal.value + (Number(data.adjust) || 0))*100)/100);

    // Modification manuelle du solde : on règle "adjust" pour tomber pile sur la valeur voulue
    const balanceForm = reactive({ open: false, value: 0 });
    function openBalanceForm() {
      balanceForm.value = balance.value;
      balanceForm.open = !balanceForm.open;
    }
    function applyBalance() {
      const target = Number(balanceForm.value);
      if (!Number.isFinite(target)) return;
      data.adjust = Math.round((target - (earned.value + gratitudeTotal.value - data.spent - savedTotal.value))*100)/100;
      balanceForm.open = false;
      notify(`Solde réglé à ${Math.round(target)} pts`);
    }
    function resetBalance() {
      if (!confirm('Remettre le solde de points à 0 ?')) return;
      data.adjust = -(earned.value + gratitudeTotal.value - data.spent - savedTotal.value);
      balanceForm.open = false;
      notify('Solde remis à 0');
    }

    const rewardsByCost = computed(() => [...data.rewards].sort((a, b) => a.cost - b.cost));
    const nextReward = computed(() => rewardsByCost.value.find(r => r.cost > balance.value) || null);
    const favoriteReward = computed(() => data.rewards.find(r => r.favorite) || null);
    const rewardRemaining = r => Math.max(0, (Number(r.cost)||0) - (Number(r.saved)||0));
    function toggleRewardFavorite(reward) {
      const wasFavorite=!!reward.favorite;
      data.rewards.forEach(r => {r.favorite=false;});
      reward.favorite=!wasFavorite;
    }
    function depositReward(reward) {
      const max = Math.min(balance.value, rewardRemaining(reward));
      if (max <= 0) { notify('Aucun point disponible à épargner'); return; }
      const response = prompt('Points à épargner pour « '+reward.name+' » (max '+max+') :', String(Math.min(5,max)));
      if (response === null) return;
      const amount = Number(response.replace(',','.'));
      if (!Number.isFinite(amount) || amount <= 0 || amount > max || Math.round(amount*100)!==amount*100) { alert('Montant invalide ou supérieur au solde disponible.'); return; }
      reward.saved = Math.round(((Number(reward.saved)||0)+amount)*100)/100;
      notify(amount+' pts réservés pour '+reward.name);
    }
    function withdrawReward(reward) {
      const saved=Number(reward.saved)||0;
      if (saved<=0) return;
      const response=prompt('Points à retirer de cette épargne (max '+saved+') :',String(saved));
      if(response===null)return;
      const amount=Number(response.replace(',','.'));
      if(!Number.isFinite(amount)||amount<=0||amount>saved || Math.round(amount*100)!==amount*100) {alert('Montant invalide.');return;}
      reward.saved=Math.round((saved-amount)*100)/100;
    }
    const gratitudeDraft = ref('');
    const todayGratitude = computed(() => data.gratitude.find(g=>g.date===today.value));
    const sortedGratitude = computed(() => [...data.gratitude].sort((a,b)=>b.date.localeCompare(a.date)));
    function saveGratitude() {
      const value=gratitudeDraft.value.trim(); if(!value) return;
      if(todayGratitude.value) {notify('Tu as déjà enregistré ta gratitude aujourd’hui');return;}
      const yesterday=new Date(today.value+'T12:00:00Z');yesterday.setUTCDate(yesterday.getUTCDate()-1);
      let run=0, cursor=yesterday.toISOString().slice(0,10);
      const dates=new Set(data.gratitude.map(g=>g.date));
      while(dates.has(cursor)) {run++; const d=new Date(cursor+'T12:00:00Z');d.setUTCDate(d.getUTCDate()-1);cursor=d.toISOString().slice(0,10);}
      const points=1 + run * 0.25;
      data.gratitude.push({date:today.value,text:value,points});
      gratitudeDraft.value='';notify('Gratitude enregistrée : +'+points+' pt');
    }
    function deleteGratitude(g) {if(confirm('Supprimer cette gratitude et les points associés ?'))data.gratitude=data.gratitude.filter(x=>x.date!==g.date);}
    const workCategories = computed(()=>data.workCategories.map(c=>c.name));
    const newWorkCategory=ref('');
    function addWorkCategory(){const name=newWorkCategory.value.trim();if(name&&!workCategories.value.some(c=>c.toLowerCase()===name.toLowerCase()))data.workCategories.push({name,color:''});newWorkCategory.value='';}
    function deleteWorkCategory(name){if(!confirm('Supprimer la catégorie de travail « '+name+' » ?'))return;data.tasks.filter(t=>t.scope==='work'&&t.category===name).forEach(t=>t.category='');data.workCategories=data.workCategories.filter(c=>c.name!==name);}
    function addWorkDifficulty(){data.workDifficulties.push({id:uid(),name:'Nouveau niveau',color:'#6b7280',pointMode:'add',pointValue:0});}
    function deleteWorkDifficulty(level){if(!confirm('Supprimer ce niveau de difficulté ?'))return;data.tasks.filter(t=>t.scope==='work'&&t.difficulty===level.id).forEach(t=>t.difficulty='');data.workDifficulties=data.workDifficulties.filter(x=>x.id!==level.id);}

    // Filtre / tri des récompenses (le filtre de catégorie s'applique aussi à l'inventaire)
    const rewardCategories = computed(() => data.rewardCategories.map(c => c.name));
    const newRewardCategory = ref('');
    function addRewardCategory() {
      const name = newRewardCategory.value.trim();
      if (name && !data.rewardCategories.some(c => c.name.toLowerCase() === name.toLowerCase())) data.rewardCategories.push({name, color:''});
      newRewardCategory.value = '';
    }
    function deleteRewardCategory(name) {
      if (!confirm('Supprimer cette catégorie de récompenses ? Les récompenses seront conservées sans catégorie.')) return;
      [...data.rewards, ...data.inventory].forEach(x => { if (x.category === name) x.category = ''; });
      data.rewardCategories = data.rewardCategories.filter(c => c.name !== name);
      if (rewardFilters.category === name) rewardFilters.category = '';
    }
    const rewardFilters = reactive({ category: '', sort: 'cost-asc' });

    function matchesRewardCategory(item) {
      const c = rewardFilters.category;
      if (!c) return true;
      if (c === '__none') return !item.category;
      return item.category === c;
    }

    const visibleRewards = computed(() => {
      const list = data.rewards.filter(matchesRewardCategory);
      switch (rewardFilters.sort) {
        case 'cost-desc': list.sort((a, b) => b.cost - a.cost); break;
        case 'name':      list.sort((a, b) => a.name.localeCompare(b.name)); break;
        case 'category':  list.sort((a, b) => (a.category || '\uffff').localeCompare(b.category || '\uffff') || a.cost - b.cost); break;
        default:          list.sort((a, b) => a.cost - b.cost);
      }
      return list;
    });

    const groupedRewards = computed(() => {
      const groups = new Map();
      visibleRewards.value.forEach(r => { const key = r.category || 'Sans catégorie'; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(r); });
      return [...groups].map(([name, rewards]) => ({name, rewards}));
    });
    const visibleInventory = computed(() => data.inventory.filter(matchesRewardCategory));

    /* ---------- Filtres & tris des tâches ---------- */
    const FILTER_DEFAULTS = { search: '', category: '', status: '', project: '', urgency: '', difficulty: '', kind: '', sort: 'due' };
    const filters = reactive({ ...FILTER_DEFAULTS });

    function resetFilters() {
      Object.assign(filters, FILTER_DEFAULTS);
    }

    // Nombre de filtres actifs (affiché sur le bouton "Filtres / tri" quand le panneau est replié)
    const activeFilterCount = computed(() => {
      let n = 0;
      if (filters.search.trim()) n++;
      if (filters.category) n++;
      if (filters.status) n++;
      if (filters.project) n++;
      if (filters.urgency) n++;
      if (filters.difficulty) n++;
      if (filters.kind) n++;
      if (filters.sort !== 'due') n++;
      return n;
    });

    function applyFilters(list, withSort = true) {
      const q = filters.search.trim().toLowerCase();
      const res = list.filter(t => {
        if (filters.status && t.status !== filters.status) return false;
        if (filters.category === '__none' && t.category) return false;
        if (filters.category && filters.category !== '__none' && t.category !== filters.category) return false;
        if (filters.project === '__none' && t.projectId) return false;
        if (filters.project && filters.project !== '__none' && t.projectId !== filters.project) return false;
        if (filters.urgency && effectiveUrgency(t) !== (filters.urgency === '__none' ? '' : filters.urgency)) return false;
        if (filters.difficulty && (t.difficulty || '') !== (filters.difficulty === '__none' ? '' : filters.difficulty)) return false;
        if (filters.kind === 'malus' && !t.malus) return false;
        if (filters.kind === 'bonus' && t.malus) return false;
        if (q && !t.title.toLowerCase().includes(q)) return false;
        return true;
      });
      if (!withSort) return res;
      const byDue = (a, b) => (a.due || '9999').localeCompare(b.due || '9999');
      switch (filters.sort) {
        case 'points-desc':     res.sort((a, b) => taskValue(b) - taskValue(a) || byDue(a, b)); break;
        case 'points-asc':      res.sort((a, b) => taskValue(a) - taskValue(b) || byDue(a, b)); break;
        case 'urgency-desc':    res.sort((a, b) => levelRank(data.urgencies, effectiveUrgency(b)) - levelRank(data.urgencies, effectiveUrgency(a)) || byDue(a, b)); break;
        case 'difficulty-desc': res.sort((a, b) => levelRank(data.difficulties, b.difficulty) - levelRank(data.difficulties, a.difficulty) || byDue(a, b)); break;
        case 'title':           res.sort((a, b) => a.title.localeCompare(b.title)); break;
        default:                res.sort(byDue);
      }
      return res;
    }

    // Les tâches terminées ne sont plus dans ces listes : elles sont dans l'onglet "Terminés"
    const activeTasks   = computed(() => data.tasks.filter(t => t.scope !== 'work' && t.status !== 'done'));
    const todayTasks    = computed(() => applyFilters(activeTasks.value.filter(t => t.due && t.due <= today.value)));
    const upcomingTasks = computed(() => applyFilters(activeTasks.value.filter(t => t.due && t.due > today.value)));
    const allTasks      = computed(() => applyFilters(activeTasks.value));
    const workTasks = computed(() => [...data.tasks.filter(t => t.scope === 'work')].sort((a,b)=>Number(a.status==='done')-Number(b.status==='done') || (a.due||'9999').localeCompare(b.due||'9999')));
    const copyForm = reactive({open:false});
    const copyText = computed(() => allTasks.value.map(t => t.title).join('\n'));
    function copyTaskTitles() { if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(copyText.value).then(() => notify('Liste copiée')).catch(() => notify('Sélectionne le texte pour le copier')); }
    // Terminées : triées par date de fin (la plus récente d'abord) ; les filtres s'appliquent aussi
    const doneTasks     = computed(() => applyFilters(data.tasks.filter(t => t.scope !== 'work' && t.status === 'done'), false)
      .sort((a, b) => (b.doneAt || '').localeCompare(a.doneAt || '')));

    /* ---------- Tâches ---------- */
    const taskForm = reactive({
      open: false, id: null, title: '', category: '', points: 10, malus: false, status: 'todo', projectId: '', due: '',
      urgency: '', difficulty: '', doneAt: '', scope:'personal',
    });

    function openTaskForm(task = null, projectId = '') {
      if (task) {
        Object.assign(taskForm, {
          id: task.id, title: task.title, category: task.category || '', points: task.points, malus: !!task.malus, scope:task.scope||'personal',
          status: task.status, projectId: task.projectId || '', due: task.due || '',
          urgency: task.urgency || '', difficulty: task.difficulty || '', doneAt: task.doneAt || '',
        });
      } else {
        Object.assign(taskForm, {
          id: null, title: '', category: '', points: 10, malus: false, status: 'todo', projectId, scope: view.value==='work'?'work':'personal',
          due: today.value, urgency: '', difficulty: '', doneAt: '',
        });
      }
      quickForm.open = false;
      taskForm.open = true;
    }

    // Un 2e clic sur le bouton referme le formulaire (sauf si on est en train de modifier une tâche)
    function toggleTaskForm() {
      if (taskForm.open && !taskForm.id) taskForm.open = false;
      else openTaskForm();
    }

    function toggleQuickForm() {
      if (quickForm.open) quickForm.open = false;
      else openQuickForm();
    }

    // Change le statut d'une tâche en gérant la date de fin (doneAt)
    function setStatus(task, newStatus, doneAt = '') {
      const old = task.status;
      task.status = newStatus;
      if (newStatus === 'done') task.doneAt = doneAt || (old === 'done' && task.doneAt) || today.value;
      else task.doneAt = '';
    }

    function saveTask() {
      const title = taskForm.title.trim();
      if (!title) return;
      const fields = {
        title,
        category: taskForm.category || '',
        scope:taskForm.scope==='work'?'work':'personal',
        points: Math.max(0, Number(taskForm.points) || 0),
        malus: !!taskForm.malus,
        projectId: taskForm.scope==='work'?'':(taskForm.projectId || ''),
        due: taskForm.due || '',
        urgency: taskForm.scope==='work' ? '' : (taskForm.urgency || ''),
        difficulty: taskForm.difficulty || '',
      };
      let becameDone = false;
      let value = 0;
      if (taskForm.id) {
        const t = data.tasks.find(x => x.id === taskForm.id);
        if (t) {
          const was = t.status;
          Object.assign(t, fields);
          setStatus(t, taskForm.status, taskForm.doneAt);
          becameDone = was !== 'done' && t.status === 'done';
          value = taskValue(t);
        }
      } else {
        const t = newTask({ ...fields });
        setStatus(t, taskForm.status, taskForm.doneAt);
        data.tasks.push(t);
        becameDone = t.status === 'done';
        value = taskValue(t);
      }
      if (becameDone) notify(`${fmtPts(value)} · tâche déplacée dans Terminés`);
      taskForm.open = false;
    }

    /* ---------- To do rapide (plusieurs tâches d'un coup) ---------- */
    const quickForm = reactive({
      open: false, mode: 'rows', due: '', rows: [],
      paste: { text: '', points: 10, malus: false, category: '', urgency: '', difficulty: '', due: '', project: '' },
    });
    const pastePreview = computed(() => parsePastedList(quickForm.paste.text));

    function openQuickForm() {
      taskForm.open = false;
      quickForm.mode = 'rows';
      quickForm.paste = { text: '', points: 10, malus: false, category: '', urgency: '', difficulty: '', due: today.value, project: '' };
      quickForm.due = today.value;
      quickForm.rows = [0, 1, 2].map(() => ({ title: '', points: 10, due: today.value }));
      quickForm.open = true;
      focusLastQuickRow(0);
    }

    function focusLastQuickRow(index) {
      nextTick(() => {
        const inputs = document.querySelectorAll('.quick-name');
        const el = inputs[index === undefined ? inputs.length - 1 : index];
        if (el) el.focus();
      });
    }

    function addQuickRow() {
      const last = quickForm.rows[quickForm.rows.length - 1];
      quickForm.rows.push({ title: '', points: last ? last.points : 10, due: last ? last.due : '' });
      focusLastQuickRow();
    }

    function removeQuickRow(i) {
      quickForm.rows.splice(i, 1);
      if (!quickForm.rows.length) quickForm.rows.push({ title: '', points: 10, due: quickForm.due });
    }

    // Applique la date "pour toutes" à chaque ligne
    function applyQuickDue() {
      quickForm.rows.forEach(r => { r.due = quickForm.due; });
    }

    function saveQuick() {
      const rows = quickForm.rows.filter(r => r.title.trim());
      rows.forEach(r => data.tasks.push(newTask({
        title: r.title.trim(),
        points: Math.max(0, Number(r.points) || 0),
        due: r.due || '',
      })));
      notify(rows.length ? `${rows.length} tâche(s) ajoutée(s)` : 'Aucune tâche à ajouter');
      quickForm.open = false;
    }

    function savePaste() {
      const { header, items } = pastePreview.value;
      if (!items.length) { notify('Aucune tâche détectée'); return; }

      let projectId = quickForm.paste.project;
      if (projectId === '__header') {
        if (header) {
          const project = { id: uid(), name: header, description: '', color: nextColor(data.projects.length) };
          data.projects.push(project);
          projectId = project.id;
        } else {
          projectId = '';
        }
      }

      const points = Math.max(0, Number(quickForm.paste.points) || 0);
      items.forEach(title => data.tasks.push(newTask({
        title, points, projectId,
        malus: !!quickForm.paste.malus,
        category: quickForm.paste.category || '',
        urgency: quickForm.paste.urgency || '',
        difficulty: quickForm.paste.difficulty || '',
        due: quickForm.paste.due || '',
      })));
      notify(`${items.length} tâche(s) ajoutée(s)`);
      quickForm.open = false;
    }

    /* ---------- Sélection (clic sur le bloc d'une tâche) ---------- */
    const selection = ref([]);   // ids des tâches sélectionnées

    function toggleSelect(id) {
      const i = selection.value.indexOf(id);
      if (i >= 0) selection.value.splice(i, 1); else selection.value.push(id);
    }
    function selectMany(ids) {
      ids.forEach(id => { if (!selection.value.includes(id)) selection.value.push(id); });
    }
    function deselectMany(ids) {
      selection.value = selection.value.filter(id => !ids.includes(id));
    }

    // "Modifier" sur la sélection : 1 tâche = popup complète, plusieurs = popup de modification groupée
    // '__keep' = ne rien changer
    const bulkForm = reactive({
      open: false, ids: [], category: '__keep', points: '', kind: '__keep', status: '', projectId: '__keep',
      urgency: '__keep', difficulty: '__keep', due: '', clearDue: false,
    });

    function editSelected(ids) {
      if (ids.length === 1) {
        const t = data.tasks.find(x => x.id === ids[0]);
        if (t) openTaskForm(t);
        return;
      }
      Object.assign(bulkForm, {
        open: true, ids: [...ids], category: '__keep', points: '', kind: '__keep', status: '', projectId: '__keep',
        urgency: '__keep', difficulty: '__keep', due: '', clearDue: false,
      });
    }

    function saveBulk() {
      let gained = 0;
      bulkForm.ids.forEach(id => {
        const t = data.tasks.find(x => x.id === id);
        if (!t) return;
        const was = t.status;
        if (bulkForm.category !== '__keep') t.category = bulkForm.category;
        if (bulkForm.points !== '' && bulkForm.points !== null && Number.isFinite(Number(bulkForm.points))) {
          t.points = Math.max(0, Math.round(Number(bulkForm.points)));
        }
        if (bulkForm.kind !== '__keep') t.malus = bulkForm.kind === 'malus';
        if (bulkForm.status) setStatus(t, bulkForm.status);
        if (was !== 'done' && t.status === 'done') gained += taskValue(t);
        if (t.scope !== 'work' && bulkForm.projectId !== '__keep') t.projectId = bulkForm.projectId;
        if (t.scope !== 'work' && bulkForm.urgency !== '__keep') t.urgency = bulkForm.urgency;
        if (bulkForm.difficulty !== '__keep') t.difficulty = bulkForm.difficulty;
        if (bulkForm.clearDue) t.due = '';
        else if (bulkForm.due) t.due = bulkForm.due;
      });
      notify(gained ? `${bulkForm.ids.length} tâches modifiées · ${fmtPts(gained)}` : `${bulkForm.ids.length} tâches modifiées`);
      bulkForm.open = false;
    }

    // Supprime des tâches. Les points des tâches TERMINÉES supprimées sont conservés (data.archived).
    function removeTasks(ids) {
      const set = new Set(ids);
      data.tasks.filter(t => set.has(t.id) && t.status === 'done').forEach(t => {
        data.archived = (Number(data.archived) || 0) + taskValue(t);
      });
      data.tasks = data.tasks.filter(t => !set.has(t.id));
    }

    function deleteSelected(ids) {
      if (!ids.length) return;
      const done = data.tasks.filter(t => ids.includes(t.id) && t.status === 'done');
      const keep = done.reduce((s, t) => s + taskValue(t), 0);
      let msg = ids.length === 1 ? 'Supprimer la tâche sélectionnée ?' : `Supprimer les ${ids.length} tâches sélectionnées ?`;
      if (done.length) msg += `\n\nLes points des tâches terminées (${fmtPts(keep)}) sont conservés.`;
      if (!confirm(msg)) return;
      removeTasks(ids);
    }

    function deleteTask(task) {
      const keep = task.status === 'done' ? `\n\nSes points (${fmtPts(taskValue(task))}) sont conservés.` : '';
      if (!confirm(`Supprimer la tâche « ${task.title} » ?${keep}`)) return;
      removeTasks([task.id]);
    }

    // On oublie les tâches sélectionnées qui n'existent plus
    watch(() => data.tasks.length, () => {
      selection.value = selection.value.filter(id => data.tasks.some(t => t.id === id));
    });

    // Échap ferme les popups
    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      const popup = [bulkForm, taskForm, quickForm, projectForm, categoryForm, rewardForm, balanceForm].find(f => f.open);
      if (popup) popup.open = false;
    });

    // Points à gagner dans les listes Aujourd'hui / À venir (les malus comptent en négatif)
    const sumToEarn = list => list.filter(t => t.status !== 'done').reduce((s, t) => s + taskValue(t), 0);
    const todayPoints    = computed(() => sumToEarn(todayTasks.value));
    const upcomingPoints = computed(() => sumToEarn(upcomingTasks.value));

    function changeStatus(task, newStatus) {
      const old = task.status;
      if (old === newStatus) return;
      setStatus(task, newStatus);
      const v = taskValue(task);
      if (old !== 'done' && newStatus === 'done') notify(`${fmtPts(v)} · tâche déplacée dans Terminés`);
      if (old === 'done' && newStatus !== 'done') notify(`${fmtPts(-v)} (tâche rouverte)`);
    }

    function changePoints(task, value) {
      task.points = Math.max(0, Number(value) || 0);
    }

    function changeDue(task, value) {
      task.due = value || '';
    }

    // Modification directe depuis les tags : catégorie, projet, urgence, difficulté, bonus/malus, titre
    function updateTask(task, field, value) {
      if (field === 'title') {
        const v = String(value).trim();
        if (v) task.title = v;
      } else if (field === 'malus') {
        task.malus = value === true || value === 'true';
      } else if (['category', 'projectId', 'urgency', 'difficulty'].includes(field)) {
        if(task.scope==='work' && ['projectId','urgency'].includes(field))return;
        task[field] = value || '';
      }
    }

    function projectName(id) {
      const p = data.projects.find(x => x.id === id);
      return p ? p.name : '';
    }

    /* ---------- Projets ---------- */
    const projectForm = reactive({ open: false, id: null, name: '', description: '', color: '#6366f1', tasks: [] });

    function openProjectForm(project = null) {
      if (project) {
        Object.assign(projectForm, {
          id: project.id, name: project.name, description: project.description || '',
          color: project.color || nextColor(data.projects.length), tasks: [],
        });
      } else {
        Object.assign(projectForm, {
          id: null, name: '', description: '', color: nextColor(data.projects.length),
          tasks: [{ title: '', category: '', points: 10, due: '' }],
        });
      }
      projectForm.open = true;
    }

    function addDraftTask() {
      projectForm.tasks.push({ title: '', category: '', points: 10, due: '' });
    }

    function saveProject() {
      const name = projectForm.name.trim();
      if (!name) return;
      if (projectForm.id) {
        const p = data.projects.find(x => x.id === projectForm.id);
        if (p) { p.name = name; p.description = projectForm.description.trim(); p.color = projectForm.color; }
      } else {
        const project = { id: uid(), name, description: projectForm.description.trim(), color: projectForm.color };
        data.projects.push(project);
        projectForm.tasks
          .filter(d => d.title.trim())
          .forEach(d => data.tasks.push(newTask({
            title: d.title.trim(),
            category: d.category || '',
            points: Math.max(0, Number(d.points) || 0),
            projectId: project.id,
            due: d.due || '',
          })));
      }
      projectForm.open = false;
    }

    function setProjectColor(project, color) { project.color = color; }

    function removeProject(project) {
      removeTasks(data.tasks.filter(t => t.projectId === project.id).map(t => t.id));
      data.projects = data.projects.filter(p => p.id !== project.id);
    }

    function projectTasks(project) {
      return data.tasks
        .filter(t => t.projectId === project.id)
        .sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999'));
    }

    function projectStats(project) {
      const list = data.tasks.filter(t => t.projectId === project.id);
      return {
        total: list.length,
        done: list.filter(t => t.status === 'done').length,
        points: list.reduce((s, t) => s + taskValue(t), 0),
      };
    }

    // Urgence maximale des tâches d'un projet, uniquement pour le tri des projets.
    function projectTopUrgency(project) {
      const tasks = data.tasks.filter(t => t.projectId === project.id && t.scope !== 'work');
      const rank = id => levelRank(data.urgencies, id);
      const top = tasks.reduce((best, t) => rank(t.urgency) > rank(best) ? t.urgency : best, '');
      return data.urgencies.find(u => u.id === top) || null;
    }

    // Tri des projets : ordre manuel (glisser-déposer) ou par urgence
    const sortedProjects = computed(() => {
      if (ui.projectSort !== 'urgency') return data.projects;
      const rank = p => { const u = projectTopUrgency(p); return u ? levelRank(data.urgencies, u.id) : 0; };
      return [...data.projects].sort((a, b) => rank(b) - rank(a));   // tri stable : à égalité, l'ordre manuel est gardé
    });

    // Replier / déplier les tâches d'un projet (mémorisé sur cet appareil)
    const isProjectOpen = id => !ui.collapsedProjects.includes(id);
    function toggleProjectOpen(id) {
      const i = ui.collapsedProjects.indexOf(id);
      if (i >= 0) ui.collapsedProjects.splice(i, 1); else ui.collapsedProjects.push(id);
    }
    function setAllProjectsOpen(open) {
      ui.collapsedProjects = open ? [] : data.projects.map(p => p.id);
    }

    // Sélection des projets : Modifier / Supprimer n'apparaissent qu'une fois un projet sélectionné
    const projectSelection = ref([]);

    function toggleProjectSelect(id) {
      const i = projectSelection.value.indexOf(id);
      if (i >= 0) projectSelection.value.splice(i, 1); else projectSelection.value.push(id);
    }
    function onProjectClick(event, project) {
      if (event.target.closest('select, input, button, label, a, option, textarea, .drag-handle, .project-task')) return;
      if (window.getSelection && String(window.getSelection())) return;
      toggleProjectSelect(project.id);
    }
    function selectAllProjects() { projectSelection.value = data.projects.map(p => p.id); }
    function clearProjectSelection() { projectSelection.value = []; }

    function editSelectedProject() {
      if (projectSelection.value.length !== 1) return;
      const p = data.projects.find(x => x.id === projectSelection.value[0]);
      if (p) openProjectForm(p);
    }

    function deleteSelectedProjects() {
      const projects = data.projects.filter(p => projectSelection.value.includes(p.id));
      if (!projects.length) return;
      const nTasks = data.tasks.filter(t => projects.some(p => p.id === t.projectId)).length;
      const names = projects.length === 1 ? `le projet « ${projects[0].name} »` : `les ${projects.length} projets sélectionnés`;
      const msg = nTasks
        ? `Supprimer ${names} et ses ${nTasks} tâche(s) ? (Les points des tâches terminées sont conservés.)`
        : `Supprimer ${names} ?`;
      if (!confirm(msg)) return;
      projects.forEach(removeProject);
      projectSelection.value = [];
    }

    watch(() => data.projects.length, () => {
      projectSelection.value = projectSelection.value.filter(id => data.projects.some(p => p.id === id));
    });

    // Réorganiser les projets : glisser-déposer (poignée) ou boutons monter / descendre
    const dragProject = reactive({ from: -1, over: -1 });

    function onProjectDragStart(event, index) {
      dragProject.from = index;
      try {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', String(index));   // requis par Firefox
        const card = event.target.closest('.project');
        if (card && event.dataTransfer.setDragImage) event.dataTransfer.setDragImage(card, 20, 20);
      } catch (e) { /* navigateur sans dataTransfer complet */ }
    }
    function onProjectDragOver(index) {
      if (dragProject.from >= 0) dragProject.over = index;
    }
    function onProjectDrop(index) {
      const from = dragProject.from;
      if (from >= 0 && from !== index && ui.projectSort === 'manual') {
        const [moved] = data.projects.splice(from, 1);
        data.projects.splice(index, 0, moved);
      }
      onProjectDragEnd();
    }
    function onProjectDragEnd() {
      dragProject.from = -1;
      dragProject.over = -1;
    }
    function moveProject(index, delta) {
      const j = index + delta;
      if (j < 0 || j >= data.projects.length) return;
      const [moved] = data.projects.splice(index, 1);
      data.projects.splice(j, 0, moved);
    }

    /* ---------- Récompenses ---------- */
    const rewardForm = reactive({ open: false, id: null, name: '', cost: 50, category: '' });

    function openRewardForm(reward = null) {
      if (reward) Object.assign(rewardForm, { id: reward.id, name: reward.name, cost: reward.cost, category: reward.category || '' });
      else Object.assign(rewardForm, { id: null, name: '', cost: 50, category: '' });
      rewardForm.open = true;
    }

    function saveReward() {
      const name = rewardForm.name.trim();
      if (!name) return;
      const payload = { name, cost: Math.max(1, Number(rewardForm.cost) || 1), category: rewardForm.category || '' };
      if (rewardForm.id) {
        const r = data.rewards.find(x => x.id === rewardForm.id);
        if (r) { if(Number(r.saved)>payload.cost) {r.saved=payload.cost;} Object.assign(r, payload); }
      } else {
        data.rewards.push({ id: uid(), ...payload });
      }
      rewardForm.open = false;
    }

    function deleteReward(reward) {
      if (!confirm(`Supprimer la récompense « ${reward.name} » ? (Celles déjà gagnées restent dans l'inventaire.)`)) return;
      data.rewards = data.rewards.filter(r => r.id !== reward.id);
    }

    function claimReward(reward) {
      const reserved = Number(reward.saved)||0;
      if (balance.value + reserved < reward.cost) return;
      data.spent += reward.cost;
      reward.saved=0;
      data.inventory.unshift({
        id: uid(), name: reward.name, category: reward.category || '', cost: reward.cost, date: todayStr(), used: false,
      });
      notify(`Récompense gagnée : ${reward.name} ! Elle est dans l'Inventaire`);
    }

    /* ---------- Inventaire ---------- */
    const invForm = reactive({ id: null, name: '', category: '' });

    function startEditInv(item) {
      Object.assign(invForm, { id: item.id, name: item.name, category: item.category || '' });
    }

    function saveInv() {
      const item = data.inventory.find(i => i.id === invForm.id);
      if (item && invForm.name.trim()) {
        item.name = invForm.name.trim();
        item.category = invForm.category || '';
      }
      invForm.id = null;
    }

    function deleteInv(item) {
      if (!confirm(`Retirer « ${item.name} » de l'inventaire ? (Les points ne sont pas rendus.)`)) return;
      data.inventory = data.inventory.filter(i => i.id !== item.id);
    }

    function refundInv(item) {
      if (!confirm(`Retirer « ${item.name} » et rendre ${item.cost} pts ?`)) return;
      data.spent = Math.max(0, data.spent - item.cost);
      data.inventory = data.inventory.filter(i => i.id !== item.id);
      notify(`+${item.cost} pts remboursés`);
    }

    /* ---------- Habitudes et routines ---------- */
    const habitForm = reactive({open:false,id:null,title:'',frequency:'daily',weekdays:[],every:2,weeklyTarget:3});
    const habitWeekdays = [{id:1,label:'Lun'},{id:2,label:'Mar'},{id:3,label:'Mer'},{id:4,label:'Jeu'},{id:5,label:'Ven'},{id:6,label:'Sam'},{id:0,label:'Dim'}];
    function openHabitForm(habit = null) {
      Object.assign(habitForm, habit ? {open:true,id:habit.id,title:habit.title,frequency:habit.frequency,weekdays:[...(habit.weekdays||[])],every:habit.every||2,weeklyTarget:habit.weeklyTarget||3} : {open:true,id:null,title:'',frequency:'daily',weekdays:[],every:2,weeklyTarget:3});
    }
    function saveHabit() {
      const title = habitForm.title.trim(); if (!title) return;
      const fields = {title,frequency:habitForm.frequency,weekdays:[...habitForm.weekdays],every:Math.max(1,Number(habitForm.every)||2),weeklyTarget:Math.max(1,Math.min(7,Number(habitForm.weeklyTarget)||3))};
      if (habitForm.id) {const h=data.habits.find(x=>x.id===habitForm.id);if(h) Object.assign(h,fields);}
      else data.habits.push({id:uid(),...fields,createdAt:todayStr(),history:[],postponed:[]});
      habitForm.open=false;
    }
    const dayDiff = (a,b) => Math.round((Date.parse(b+'T12:00:00Z')-Date.parse(a+'T12:00:00Z'))/86400000);
    const monday = date => {const d=new Date(date+'T12:00:00Z'); d.setUTCDate(d.getUTCDate()-(d.getUTCDay()+6)%7);return d.toISOString().slice(0,10);};
    function habitDoneToday(h) {return (h.history||[]).includes(today.value);}
    function habitDue(h) {
      if (habitDoneToday(h)) return true;
      if (h.forceDue === today.value) return true;
      if ((h.postponed||[]).includes(today.value)) return false;
      const dow = new Date(today.value+'T12:00:00Z').getUTCDay();
      if (h.frequency==='weekdays') return (h.weekdays||[]).includes(dow);
      if (h.frequency==='interval') return dayDiff(h.createdAt||today.value,today.value)%Math.max(1,h.every||2)===0;
      if (h.frequency==='weekly') return (h.history||[]).filter(d=>monday(d)===monday(today.value)).length < (h.weeklyTarget||3);
      return true;
    }
    const dashboardHabits = computed(() => data.habits.filter(h=>habitDue(h)));
    function completeHabit(h) {
      if (habitDoneToday(h)) return;
      if (!confirm('Confirmer la réalisation de « '+h.title+' » aujourd’hui ?')) return;
      if (!Array.isArray(h.history)) h.history=[];
      h.history.push(today.value);
      h.postponed=(h.postponed||[]).filter(d=>d!==today.value);
      notify('Habitude enregistrée');
    }
    function postponeHabit(h) {
      if (!confirm('Reporter « '+h.title+' » à demain ?')) return;
      const d=new Date(today.value+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+1);
      const tomorrow=d.toISOString().slice(0,10);
      if (!Array.isArray(h.postponed)) h.postponed=[];
      if (!h.postponed.includes(today.value)) h.postponed.push(today.value);
      h.forceDue=tomorrow;
    }
    function undoHabit(h) { if(!confirm('Annuler la réalisation du jour ?'))return; h.history=(h.history||[]).filter(d=>d!==today.value); }
    function deleteHabit(h) {if(confirm('Supprimer cette habitude et son historique ?')) data.habits=data.habits.filter(x=>x.id!==h.id);}
    const habitCount = h => (h.history||[]).length;

    /* ---------- Export / import / reset ---------- */
    function exportData() {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `todo-quest-${todayStr()}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    }

    function importData(event) {
      const input = event.target;
      const file = input.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const json = JSON.parse(reader.result);
          const ok = ['tasks', 'projects', 'rewards', 'inventory'].every(k => Array.isArray(json[k]));
          if (!ok) throw new Error('format');
          if (!confirm('Remplacer toutes les données actuelles par celles du fichier ?')) return;
          applyData(json);
          notify('Import réussi');
        } catch (e) {
          alert("Fichier invalide : ce n'est pas une sauvegarde Todo Quest.");
        } finally {
          input.value = '';
        }
      };
      reader.readAsText(file);
    }

    function resetAll() {
      const cloudNote = user.value ? ' Cela effacera aussi tes données dans le cloud.' : '';
      if (!confirm('Tout effacer (tâches, projets, catégories, récompenses, inventaire) ?' + cloudNote + ' Pense à exporter avant !')) return;
      Object.assign(data, defaultData());
      notify('Données réinitialisées');
    }

    /* ---------- Synchro cloud (Firebase) ---------- */
    // Actif seulement si firebase-config.js est rempli et que le SDK est chargé.
    const cfg = window.FIREBASE_CONFIG || {};
    const firebaseReady = typeof firebase !== 'undefined' && !!cfg.apiKey && !String(cfg.apiKey).startsWith('COLLE');

    const user = ref(null);
    const syncState = ref(firebaseReady ? 'signedout' : 'local');
    const syncLabel = computed(() => ({
      local:     'Mode local (cloud non configuré)',
      signedout: 'Non connecté : données sur cet appareil uniquement',
      syncing:   'Synchronisation…',
      synced:    'Synchronisé',
      error:     'Erreur de synchro',
    }[syncState.value]));

    const clientId = uid();           // identifie cet onglet / appareil
    let auth = null, db = null, docRef = null;
    let unsubscribe = null, saveTimer = null, lastSyncedJson = '', firstSnapshot = true;

    function pushToCloud() {
      if (!docRef) return Promise.resolve();
      syncState.value = 'syncing';
      const payload = JSON.parse(JSON.stringify(data));
      payload._by = clientId;
      payload._savedAt = firebase.firestore.FieldValue.serverTimestamp();
      return docRef.set(payload)
        .then(() => { syncState.value = 'synced'; })
        .catch(err => { console.error('Firestore :', err); syncState.value = 'error'; });
    }

    function flushNow() {
      if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; return pushToCloud(); }
      return Promise.resolve();
    }

    function applyRemote(remote) {
      applyData(remote);
      lastSyncedJson = JSON.stringify(data);   // évite de renvoyer ce qu'on vient de recevoir
    }

    function startSync(u) {
      docRef = db.collection('users').doc(u.uid);
      firstSnapshot = true;
      syncState.value = 'syncing';

      unsubscribe = docRef.onSnapshot(snap => {
        if (snap.metadata.hasPendingWrites) return;        // écho de nos propres écritures
        if (firstSnapshot && snap.metadata.fromCache) return; // on attend la vraie réponse du serveur
        const remote = snap.exists ? snap.data() : null;

        if (firstSnapshot) {
          firstSnapshot = false;
          if (!remote) {                                    // 1re connexion : on envoie les données locales
            lastSyncedJson = JSON.stringify(data);
            pushToCloud();
            notify('Données envoyées dans le cloud');
            return;
          }
          const localHasData = data.tasks.length || data.projects.length || data.inventory.length;
          if (localHasData && !confirm('Des données existent déjà dans ton cloud. Remplacer celles de cet appareil par celles du cloud ?\n\nOK = utiliser le cloud\nAnnuler = envoyer les données de cet appareil vers le cloud')) {
            lastSyncedJson = JSON.stringify(data);
            pushToCloud();
            return;
          }
          applyRemote(remote);
          syncState.value = 'synced';
          notify('Données synchronisées');
          return;
        }

        // Mises à jour venant d'un autre appareil
        if (remote && remote._by !== clientId && !saveTimer) {
          applyRemote(remote);
          syncState.value = 'synced';
        }
      }, err => { console.error('Firestore :', err); syncState.value = 'error'; });
    }

    if (firebaseReady) {
      firebase.initializeApp(cfg);
      auth = firebase.auth();
      db = firebase.firestore();

      auth.onAuthStateChanged(u => {
        if (unsubscribe) { unsubscribe(); unsubscribe = null; }
        docRef = null;
        user.value = u ? { name: u.displayName, email: u.email } : null;
        if (u) startSync(u); else syncState.value = 'signedout';
      });

      // Envoi vers le cloud dès que les données changent (avec un petit délai)
      watch(data, () => {
        if (!docRef) return;
        const json = JSON.stringify(data);
        if (json === lastSyncedJson) return;
        lastSyncedJson = json;
        syncState.value = 'syncing';
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => { saveTimer = null; pushToCloud(); }, 800);
      }, { deep: true });

      // Si l'onglet passe en arrière-plan / se ferme, on envoie tout de suite
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') flushNow();
      });
    }

    async function signIn() {
      if (!firebaseReady) return;
      const provider = new firebase.auth.GoogleAuthProvider();
      try {
        await auth.signInWithPopup(provider);
      } catch (e) {
        if (e.code === 'auth/popup-blocked') return auth.signInWithRedirect(provider);
        if (e.code === 'auth/popup-closed-by-user' || e.code === 'auth/cancelled-popup-request') return;
        if (e.code === 'auth/unauthorized-domain') {
          alert("Ce domaine n'est pas autorisé : ajoute-le dans Firebase → Authentication → Settings → Authorized domains.");
          return;
        }
        alert('Connexion impossible : ' + (e.message || e.code));
      }
    }

    async function signOut() {
      if (!auth) return;
      await flushNow();
      await auth.signOut();
      notify('Déconnecté (tes données restent sur cet appareil)');
    }

    return {
      // état
      data, ui, view, setTab, pageTitle, today, toast, tabs: TABS, statuses: STATUSES, tagStyle,
      // cloud
      firebaseReady, user, syncState, syncLabel, signIn, signOut,
      // catégories
      categories, rewardCategories, newRewardCategory, addRewardCategory, deleteRewardCategory, categoryForm, openCategoryForm, saveCategory, deleteCategory, categoryUsage, setCategoryColor,
      // urgences & difficultés
      newLevel, levelUsage, addLevel, renameLevel, setLevelColor, moveLevel, deleteLevel,
      // points
      earned, balance, nextReward, favoriteReward, rewardRemaining, toggleRewardFavorite, depositReward, withdrawReward, gratitudeTotal, savedTotal, gratitudeDraft, todayGratitude, sortedGratitude, saveGratitude, deleteGratitude, workCategories, newWorkCategory, addWorkCategory, deleteWorkCategory, addWorkDifficulty, deleteWorkDifficulty, balanceForm, openBalanceForm, applyBalance, resetBalance,
      rewardFilters, visibleRewards, groupedRewards, visibleInventory,
      // filtres
      filters, resetFilters, activeFilterCount, todayTasks, upcomingTasks, allTasks, workTasks, doneTasks, copyForm, copyText, copyTaskTitles,
      // tâches
      quickForm, openQuickForm, toggleQuickForm, addQuickRow, removeQuickRow, applyQuickDue, saveQuick, pastePreview, savePaste,
      taskForm, openTaskForm, toggleTaskForm, saveTask, deleteTask, changeStatus, changePoints, changeDue, updateTask, projectName,
      selection, toggleSelect, selectMany, deselectMany, editSelected, deleteSelected, bulkForm, saveBulk,
      todayPoints, upcomingPoints,
      // projets
      projectForm, openProjectForm, addDraftTask, saveProject, setProjectColor, projectTasks, projectStats, projectTopUrgency,
      sortedProjects, isProjectOpen, toggleProjectOpen, setAllProjectsOpen,
      projectSelection, onProjectClick, toggleProjectSelect, selectAllProjects, clearProjectSelection, editSelectedProject, deleteSelectedProjects,
      dragProject, onProjectDragStart, onProjectDragOver, onProjectDrop, onProjectDragEnd, moveProject,
      // récompenses
      rewardForm, openRewardForm, saveReward, deleteReward, claimReward,
      // inventaire
      invForm, startEditInv, saveInv, deleteInv, refundInv,
      // données
      exportData, importData, resetAll,
      habitForm, habitWeekdays, openHabitForm, saveHabit, dashboardHabits, habitDue, habitDoneToday, completeHabit, postponeHabit, undoHabit, deleteHabit, habitCount,
      // utilitaires
      formatDate,
    };
  },
});

app.component('task-list', TaskList);
app.mount('#app');
