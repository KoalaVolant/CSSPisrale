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
  { id: 'usual-lists', label: 'Listes de tâches habituelles' },
  { id: 'menu', label: 'Menu de la semaine' },
  { id: 'shopping', label: 'Liste de courses' },
  { id: 'calendar', label: 'Calendrier global' },
  { id: 'planner', label: 'Planificateur' },
  { id: 'achievements', label: 'Succès & objectifs' },
  { id: 'trash', label: 'Corbeille' },
  { id: 'gratitude',  label: 'Gratitude' },
  { id: 'evening', label: 'Textareas' },
  { id: 'habits',     label: 'Habitudes & routines' },
  { id: 'challenges', label: 'Défis' },
  { id: 'statistics', label: 'Statistiques' },
  { id: 'budget', label: 'Budget' },
  { id: 'done',       label: 'Terminés' },
  { id: 'projects',   label: 'Projets' },
  { id: 'categories', label: 'Catégories' },
  { id: 'levels',     label: 'Urgences & difficultés' },
  { id: 'rewards',    label: 'Récompenses' },
  { id: 'inventory',  label: 'Inventaire' },
  { id: 'activities', label: 'Idées d’activités' },
  { id: 'data',       label: 'Sauvegarde' },
];

const NAV_GROUPS = [
  { title: 'Tâches', ids: ['home','planner','calendar','all','work','habits','usual-lists','evening','done'] },
  { title: 'Repas', ids: ['menu','shopping'] },
  { title: 'Plaisir', ids: ['rewards','inventory','activities'] },
  { title: 'Autres', ids: ['gratitude','challenges','achievements','statistics','budget'] },
  { title: 'Configuration', ids: ['projects','categories','levels','trash','data'] },
].map(group => ({ ...group, tabs: group.ids.map(id => TABS.find(t => t.id === id)).filter(Boolean) }));

const clone = o => JSON.parse(JSON.stringify(o));
// Catégories multiples réservées aux tâches Travail. Le champ historique
// category est conservé pour compatibilité avec les anciennes sauvegardes.
function workTags(t) {
  if (t.scope !== 'work') return [];
  return [...new Set((Array.isArray(t.workCategoryNames) ? t.workCategoryNames : (t.category && t.category !== 'Travail' ? [t.category] : [])).filter(x => typeof x === 'string' && x.trim()))];
}
function migrateWorkTags(tasks) {
  (tasks || []).forEach(t => {
    if (t.scope === 'work') {
      t.workCategoryNames = workTags(t);
      t.category = t.workCategoryNames[0] || '';
    }
  });
}


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
  return t.urgency || '';
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
    for (const [levels, id] of (t.scope === 'work' ? [[liveData.workUrgencies, effectiveUrgency(t)], [liveData.workDifficulties, t.difficulty]] : [[liveData.urgencies, effectiveUrgency(t)], [liveData.difficulties, t.difficulty]])) {
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
    urgency: '', difficulty: '', doneAt: '', ticketName: '',
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
    streak = Number.isFinite(prior) && current - prior === 86400000 && previous.slice(0,7)===g.date.slice(0,7) ? streak + 1 : 1;
    g.points = 1 + (streak - 1) * 0.25;
    previous = g.date;
  }
  return records;
}

function defaultData() {
  return {
    dailyTimeBudget: 180, // minutes disponibles pour le planificateur
    achievements: [], // succès attribués, une seule fois
    dashboardWidgets: ['habits','meals','priorities','planner','tasks'],
    groceryBudget: 0, // budget facultatif de courses
    eveningNotes: '', // ancien champ conservé pour migration
    budgetCategories: ['Alimentation','Essence','Loisirs','Logement','Abonnements','Impôts','Santé','Transport','Salaire','Autres'],
    ingredients: [], // {id,name,owned}
    dishes: [], // {id,name,ingredientIds}
    shoppingItems: [], // {id,name,ingredientId,manual,checked,sourceKeys,quantity}
    ingredientCategories: ['Sans catégorie'],
    ingredientLocations: ['Congélo','Frigo','Garde-manger','Placard'],
    trash: [], // objets supprimés, restaurables
    projectMilestones: [], // {id,projectId,title,done}
    weeklyMenus: {}, // menus indexés par lundi YYYY-MM-DD
    menuRules: '', // conditions personnelles de préparation des menus
    budgetEntries: [], // opérations saisies (montants signés)
    budgetRecurring: [], // charges mensuelles automatiques
    budgetOverrides: {}, // montants adaptés sur un mois précis
    budgetSwile: [], // dépenses Swile décalées au mois suivant à 50 %
    cashEntries: [], // espèces indépendantes du budget mensuel
    textareas: [], // blocs Markdown nommés
    usualLists: [], // listes de suivi sans points
    workTicketTypes: [], // types avec bonus de points
    workTickets: [],  // tickets avec sous-tâches et historique
    tasks: [],        // { id, title, category, points, malus, status, projectId, due, urgency, difficulty, doneAt }
    projects: [],     // { id, name, description, color }  (l'ordre du tableau = l'ordre manuel)
    rewardCategories: [], // catégories indépendantes des récompenses et de l'inventaire
    habits: [], // habitudes + historique de réalisations
    activities: [], // idées d'activités personnelles
    challenges: [], // défis paramétrables
    challengeAwards: [], // journal immuable des points attribués
    gratitude: [], // { date, text, points } : une par jour
    gratitudePointsVersion: 3,
    workCategories: [],
    workDifficulties: clone(DEFAULT_DIFFICULTIES),
    workUrgencies: clone(DEFAULT_URGENCIES),
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
    if (!Array.isArray(d.activities)) d.activities = [];
    if (!Array.isArray(d.workTickets)) d.workTickets = [];
    if (!Array.isArray(d.workTicketTypes)) d.workTicketTypes = [];
    if (!Array.isArray(d.usualLists)) d.usualLists = [];
    d.eveningNotes = typeof d.eveningNotes === 'string' ? d.eveningNotes : '';
    if (!Array.isArray(d.budgetCategories)) d.budgetCategories = defaultData().budgetCategories;
    d.budgetCategories = [...new Set([...d.budgetCategories, ...[...(d.budgetEntries||[]),...(d.budgetRecurring||[]),...(d.budgetSwile||[])].map(x=>x.category)].filter(x=>typeof x==='string'&&x.trim()))];
    if (!d.weeklyMenus || typeof d.weeklyMenus !== 'object' || Array.isArray(d.weeklyMenus)) d.weeklyMenus = {};
    for (const k of ['ingredients','dishes','shoppingItems','trash','projectMilestones']) if (!Array.isArray(d[k])) d[k]=[];
    if(!Array.isArray(d.ingredientCategories)) d.ingredientCategories=['Sans catégorie'];
    if(!Array.isArray(d.ingredientLocations)) d.ingredientLocations=['Congélo','Frigo','Garde-manger','Placard'];
    d.ingredientLocations=[...new Set([...d.ingredientLocations.filter(x=>typeof x==='string'&&x.trim()),...d.ingredients.map(x=>x?.location).filter(Boolean)])];
    d.ingredients=d.ingredients.filter(x=>x&&typeof x==='object').map(x=>({...x,name:String(x.name||''),category:typeof x.category==='string'&&x.category.trim()?x.category:'Sans catégorie',owned:!!x.owned,location:typeof x.location==='string'?x.location:''}));
    d.ingredientCategories=[...new Set(['Sans catégorie',...d.ingredientCategories.filter(x=>typeof x==='string'&&x.trim()),...d.ingredients.map(x=>x.category).filter(Boolean)])];
    d.shoppingItems.forEach(x=>{if(typeof x.quantity!=='string') x.quantity=String(x.quantity??'');x.store=String(x.store||'');x.category=String(x.category||'Sans catégorie');});
    if (typeof d.menuRules !== 'string') d.menuRules = '';
    if (!Array.isArray(d.achievements)) d.achievements=[];
    if (!Array.isArray(d.dashboardWidgets)) d.dashboardWidgets=['habits','meals','priorities','planner','tasks'];
    d.dailyTimeBudget = Number.isFinite(Number(d.dailyTimeBudget)) ? Math.max(0,Number(d.dailyTimeBudget)) : 180;
    d.groceryBudget=Number.isFinite(Number(d.groceryBudget))?Number(d.groceryBudget):0;
    if (!Array.isArray(d.budgetEntries)) d.budgetEntries = [];
    if (!Array.isArray(d.budgetRecurring)) d.budgetRecurring = [];
    if (!d.budgetOverrides || typeof d.budgetOverrides !== 'object' || Array.isArray(d.budgetOverrides)) d.budgetOverrides = {};
    if (!Array.isArray(d.budgetSwile)) d.budgetSwile = [];
    if (!Array.isArray(d.cashEntries)) d.cashEntries = [];
    d.budgetSwile = d.budgetSwile.map(x => ({...x, amount: -Math.abs(Number(x.amount) || 0)}));
    if (!Array.isArray(d.textareas)) d.textareas = [];
    if (d.eveningNotes.trim()) { if (!d.textareas.length) d.textareas.push({id:uid(),title:'To do du soir',content:d.eveningNotes}); d.eveningNotes=''; }
     d.inventory.forEach(i=>{if(i.used && !i.usedAt)i.usedAt=i.date||todayStr();});
    if (!Array.isArray(d.challenges)) d.challenges = [];
    if (!Array.isArray(d.challengeAwards)) d.challengeAwards = [];
    if (!Array.isArray(d.gratitude)) d.gratitude = [];
    if (d.gratitudePointsVersion !== 3) { migrateGratitudePoints(d.gratitude); d.gratitudePointsVersion = 3; }
    if (!Array.isArray(d.workCategories)) d.workCategories = [];
    d.workCategories = normalizeCategories(d.workCategories);
    if (!Array.isArray(d.workDifficulties)) d.workDifficulties = clone(DEFAULT_DIFFICULTIES);
    if (!Array.isArray(d.workUrgencies)) d.workUrgencies = clone(Array.isArray(d.urgencies) ? d.urgencies : DEFAULT_URGENCIES);
    // Migration unique : les anciennes tâches classées Travail sont isolées par scope.
    (d.tasks || []).forEach(t => { if (!t.scope) t.scope = t.category === 'Travail' ? 'work' : 'personal'; if (t.scope === 'work') { t.projectId = ''; if (t.category === 'Travail') t.category = ''; } });
    (d.rewards || []).forEach(r => { if (!Number.isFinite(Number(r.saved))) r.saved = 0; });
    const knownRewards = new Set(d.rewardCategories.map(c => c.name));
    [...(d.rewards || []), ...(d.inventory || [])].forEach(x => { if (x.category && !knownRewards.has(x.category)) { d.rewardCategories.push({name:x.category, color:''}); knownRewards.add(x.category); } });
    migrateWorkTags(d.tasks);
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
      return [{ id: '', label: 'Urgence' }, ...(this.task.scope === 'work' ? this.appData.workUrgencies : this.appData.urgencies).map(u => ({ id: u.id, label: 'Urgence : ' + u.name }))];
    },
    difficultyOptions() {
      return [{ id: '', label: 'Difficulté' }, ...(this.task.scope === 'work' ? this.appData.workDifficulties : this.appData.difficulties).map(d => ({ id: d.id, label: 'Difficulté : ' + d.name }))];
    },
    // un niveau supprimé ou inconnu est affiché comme "non défini"
    urgencyValue()    { return (this.task.scope === 'work' ? this.appData.workUrgencies : this.appData.urgencies).some(u => u.id === this.task.urgency) ? this.task.urgency : ''; },
    difficultyValue() { return (this.task.scope === 'work' ? this.appData.workDifficulties : this.appData.difficulties).some(d => d.id === this.task.difficulty) ? this.task.difficulty : ''; },
    categoryColor() {
      const c = (this.task.scope === 'work' ? this.appData.workCategories : this.appData.categories).find(x => x.name === this.task.category);
      return c ? c.color : '';
    },
    projectColor() {
      const p = this.appData.projects.find(x => x.id === this.task.projectId);
      return p ? p.color || '' : '';
    },
    urgencyColor() {
      const u = (this.task.scope === 'work' ? this.appData.workUrgencies : this.appData.urgencies).find(x => x.id === this.task.urgency);
      return u ? u.color : '';
    },
    difficultyColor() {
      const d = (this.task.scope === 'work' ? this.appData.workDifficulties : this.appData.difficulties).find(x => x.id === this.task.difficulty);
      return d ? d.color : '';
    },
    // catégorie de la tâche absente de la liste (ne devrait pas arriver) : on l'affiche quand même
    workTags() { return workTags(this.task); },
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
      if (event.target.closest('select, input, button, label, a, option, textarea, details, summary')) return;
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
      for (const k of ['ingredients','dishes','shoppingItems','trash','projectMilestones','ingredientCategories','ingredientLocations']) data[k]=Array.isArray(src[k])?src[k]:[];
      data.ingredients=data.ingredients.filter(x=>x&&typeof x==='object').map(x=>({...x,name:String(x.name||''),category:typeof x.category==='string'&&x.category.trim()?x.category:'Sans catégorie',owned:!!x.owned,location:typeof x.location==='string'?x.location:''}));
      data.ingredientCategories=[...new Set(['Sans catégorie',...data.ingredientCategories.filter(x=>typeof x==='string'&&x.trim()),...data.ingredients.map(i=>i.category)])];
      data.ingredientLocations=[...new Set([...(data.ingredientLocations||['Congélo','Frigo','Garde-manger','Placard']).filter(x=>typeof x==='string'&&x.trim()),...data.ingredients.map(i=>i.location).filter(Boolean)])];
      data.shoppingItems.forEach(x=>{x.store=String(x.store||'');x.category=String(x.category||'Sans catégorie');x.quantity=String(x.quantity??'');});
      data.weeklyMenus = src.weeklyMenus && typeof src.weeklyMenus === 'object' && !Array.isArray(src.weeklyMenus) ? src.weeklyMenus : {};
      data.menuRules = typeof src.menuRules === 'string' ? src.menuRules : '';
      data.achievements=Array.isArray(src.achievements)?src.achievements:[];
      data.dashboardWidgets=Array.isArray(src.dashboardWidgets)?src.dashboardWidgets:['habits','meals','priorities','planner','tasks'];
      data.dailyTimeBudget=Number.isFinite(Number(src.dailyTimeBudget))?Number(src.dailyTimeBudget):180;
      data.groceryBudget=Number.isFinite(Number(src.groceryBudget))?Number(src.groceryBudget):0;
      data.eveningNotes = typeof src.eveningNotes === 'string' ? src.eveningNotes : '';
      data.budgetCategories = Array.isArray(src.budgetCategories) ? [...new Set([...src.budgetCategories, ...[...(src.budgetEntries||[]),...(src.budgetRecurring||[]),...(src.budgetSwile||[])].map(x=>x.category)].filter(x=>typeof x==='string'&&x.trim()))] : [...new Set([...defaultData().budgetCategories, ...[...(src.budgetEntries||[]),...(src.budgetRecurring||[]),...(src.budgetSwile||[])].map(x=>x.category)].filter(x=>typeof x==='string'&&x.trim()))];
      data.budgetEntries = Array.isArray(src.budgetEntries) ? src.budgetEntries : [];
      data.budgetRecurring = Array.isArray(src.budgetRecurring) ? src.budgetRecurring : [];
      data.budgetOverrides = src.budgetOverrides && typeof src.budgetOverrides === 'object' && !Array.isArray(src.budgetOverrides) ? src.budgetOverrides : {};
      data.budgetSwile = Array.isArray(src.budgetSwile) ? src.budgetSwile.map(x => ({...x, amount: -Math.abs(Number(x.amount) || 0)})) : [];
      data.cashEntries = Array.isArray(src.cashEntries) ? src.cashEntries : [];
      data.textareas = Array.isArray(src.textareas) ? src.textareas : [];
      if (data.eveningNotes.trim()) { if (!data.textareas.length) data.textareas.push({id:uid(),title:'To do du soir',content:data.eveningNotes}); data.eveningNotes=''; }
      data.usualLists = Array.isArray(src.usualLists) ? src.usualLists : [];
      data.workTicketTypes = Array.isArray(src.workTicketTypes) ? src.workTicketTypes : [];
      data.workTickets = Array.isArray(src.workTickets) ? src.workTickets : [];
      // Les tickets synchronisés doivent également disposer de champs de saisie locaux.
      if (typeof ticketInputs !== 'undefined') {
        data.workTickets.forEach(t => { if (!ticketInputs[t.id]) ticketInputs[t.id] = {name:'',points:10}; });
      }
      data.tasks        = Array.isArray(src.tasks) ? src.tasks : [];
      data.tasks.forEach(t => { if (!t.scope) t.scope = t.category === 'Travail' ? 'work' : 'personal'; if (t.scope === 'work') { t.projectId=''; if(t.category==='Travail') t.category=''; } });
      migrateWorkTags(data.tasks);
      data.projects     = Array.isArray(src.projects) ? src.projects : [];
      migrateProjectUrgencies(data);
      data.rewards      = Array.isArray(src.rewards) ? src.rewards : [];
      data.rewards.forEach(r => { r.saved = Math.max(0, Math.min(Number(r.cost)||0, Number(r.saved)||0)); });
      data.inventory    = Array.isArray(src.inventory) ? src.inventory : [];
      data.categories   = normalizeCategories(src.categories).filter(c=>c.name!=='Travail');
      data.categories = data.categories.filter(c=>c.name!=='Travail');
      data.rewardCategories = normalizeCategories(src.rewardCategories || [...(src.rewards || []), ...(src.inventory || [])].map(x => x.category).filter(Boolean));
      data.habits = Array.isArray(src.habits) ? src.habits : [];
      data.activities = Array.isArray(src.activities) ? src.activities : [];
      data.inventory.forEach(i=>{if(i.used&&!i.usedAt)i.usedAt=i.date||todayStr();});
      data.challenges = Array.isArray(src.challenges) ? src.challenges : [];
      data.challengeAwards = Array.isArray(src.challengeAwards) ? src.challengeAwards : [];
      data.gratitude = Array.isArray(src.gratitude) ? src.gratitude : [];
      if (src.gratitudePointsVersion !== 3) migrateGratitudePoints(data.gratitude);
      data.gratitudePointsVersion = 3;
      data.workCategories = normalizeCategories(src.workCategories);
      data.workDifficulties = Array.isArray(src.workDifficulties) ? src.workDifficulties : clone(DEFAULT_DIFFICULTIES);
      data.workUrgencies = Array.isArray(src.workUrgencies) ? src.workUrgencies : clone(Array.isArray(src.urgencies) ? src.urgencies : DEFAULT_URGENCIES);
      data.urgencies    = Array.isArray(src.urgencies) ? src.urgencies : clone(DEFAULT_URGENCIES);
      data.difficulties = Array.isArray(src.difficulties) ? src.difficulties : clone(DEFAULT_DIFFICULTIES);
      data.spent        = Number(src.spent) || 0;
      data.adjust       = Number(src.adjust) || 0;
      data.archived     = Number(src.archived) || 0;
      syncCategories();
    }

    /* ---------- Budget mensuel : chaque mois est indépendant ---------- */
    const budgetMonth = ref(todayStr().slice(0, 7));
    const budgetSection = ref('month');
    const budgetCategories = computed(()=>data.budgetCategories);
    const budgetCategoryName = ref('');
    function addBudgetCategory(){
      const name=budgetCategoryName.value.trim();
      if(!name||name==='Charge récurrente'||data.budgetCategories.some(c=>c.toLocaleLowerCase('fr')===name.toLocaleLowerCase('fr')))return;
      data.budgetCategories.push(name);budgetCategoryName.value='';
    }
    function renameBudgetCategory(oldName){
      const name=prompt('Nouveau nom de la catégorie',oldName)?.trim();
      if(!name||name===oldName||name==='Charge récurrente'||data.budgetCategories.some(c=>c!==oldName&&c.toLocaleLowerCase('fr')===name.toLocaleLowerCase('fr')))return;
      const i=data.budgetCategories.indexOf(oldName);if(i<0)return;
      data.budgetCategories[i]=name;
      for(const collection of [data.budgetEntries,data.budgetRecurring,data.budgetSwile,data.cashEntries]) collection.forEach(x=>{if(x.category===oldName)x.category=name;});
      for(const form of [budgetEntryForm,budgetRecurringForm,budgetSwileForm,cashForm])if(form.category===oldName)form.category=name;
    }
    function deleteBudgetCategory(name){
      if(data.budgetCategories.length<=1)return;
      const used=[...data.budgetEntries,...data.budgetRecurring,...data.budgetSwile,...data.cashEntries].some(x=>x.category===name);
      if(used){alert('Catégorie utilisée : renomme-la pour conserver son historique.');return;}
      if(!confirm('Supprimer la catégorie « '+name+' » ?'))return;
      data.budgetCategories=data.budgetCategories.filter(x=>x!==name);
      for(const form of [budgetEntryForm,budgetRecurringForm,budgetSwileForm,cashForm])if(form.category===name)form.category=data.budgetCategories[0];
    }
    function moveBudgetCategory(name, delta){
      const index=data.budgetCategories.indexOf(name);
      const next=index+delta;
      if(index<0||next<0||next>=data.budgetCategories.length)return;
      const categories=[...data.budgetCategories];
      [categories[index],categories[next]]=[categories[next],categories[index]];
      data.budgetCategories=categories;
    }
    const reorderDrag = ref(null);
    function startReorder(event, kind, id){
      reorderDrag.value={kind,id};
      if(event.dataTransfer){event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain',String(id));}
    }
    function dropReorder(event, kind, targetId){
      event.preventDefault();
      const drag=reorderDrag.value;
      if(!drag||drag.kind!==kind||drag.id===targetId){reorderDrag.value=null;return;}
      const keys={budget:'budgetCategories',ticket:'workTicketTypes',workUrgency:'workUrgencies',workDifficulty:'workDifficulties',urgencies:'urgencies',difficulties:'difficulties',recurring:'budgetRecurring',swile:'budgetSwile',cash:'cashEntries',manual:'budgetEntries'};
      const key=keys[kind];if(!key){reorderDrag.value=null;return;}
      const arr=data[key];if(!Array.isArray(arr))return;
      const idOf=item=>typeof item==='string'?item:item.id;
      const from=arr.findIndex(x=>String(idOf(x))===String(drag.id)),to=arr.findIndex(x=>String(idOf(x))===String(targetId));
      if(from>=0&&to>=0){const [v]=arr.splice(from,1);arr.splice(to,0,v);}
      reorderDrag.value=null;
    }
    const budgetEntryForm = reactive({date:todayStr(),label:'',amount:null,category:'Autres'});
    const budgetRecurringForm = reactive({label:'',amount:null,category:'Abonnements',start:todayStr().slice(0,7),end:''});
    const budgetSwileForm = reactive({date:todayStr(),label:'',amount:null,category:'Alimentation'});
    const cashForm = reactive({date:todayStr(),label:'',amount:null,category:'Autres'});
    const cashBalance = computed(() => data.cashEntries.reduce((sum,x)=>sum+(Number(x.amount)||0),0));
    const cashIncome = computed(() => data.cashEntries.reduce((sum,x)=>sum+Math.max(0,Number(x.amount)||0),0));
    const cashExpenses = computed(() => data.cashEntries.reduce((sum,x)=>sum+Math.min(0,Number(x.amount)||0),0));
    function addCashEntry(){
      const amount=Number(cashForm.amount);
      if(!cashForm.label.trim()||cashForm.amount===null||cashForm.amount===''||!Number.isFinite(amount)||!cashForm.date)return;
      data.cashEntries.push({id:uid(),date:cashForm.date,label:cashForm.label.trim(),amount,category:cashForm.category});
      cashForm.label='';cashForm.amount=null;
    }
    function removeCashEntry(id){if(confirm('Supprimer cette opération en espèces ?'))data.cashEntries=data.cashEntries.filter(x=>x.id!==id);}
    function money(v) { return (Number(v)||0).toLocaleString('fr-FR',{style:'currency',currency:'EUR'}); }
    function shiftMonth(month,offset){const match=/^(\d{4})-(\d{2})$/.exec(month||'');if(!match)return todayStr().slice(0,7);const n=Number(match[1])*12+Number(match[2])-1+offset;const year=Math.floor(n/12);return String(year).padStart(4,'0')+'-'+String(n-year*12+1).padStart(2,'0');}
    function monthBefore(month){return shiftMonth(month,-1);}
    function monthAfter(month){return shiftMonth(month,1);}
    function changeBudgetMonth(delta){budgetMonth.value=shiftMonth(budgetMonth.value,delta);budgetEntryForm.date=budgetMonth.value+'-01';budgetSwileForm.date=budgetMonth.value+'-01';}
    const recurringForMonth=computed(()=>data.budgetRecurring.filter(r=>r.active!==false&&r.start<=budgetMonth.value&&(!r.end||r.end>=budgetMonth.value)).map(r=>{
      const k=budgetMonth.value+'|'+r.id;
      return {...r,monthlyKey:k,amount:Object.prototype.hasOwnProperty.call(data.budgetOverrides,k)?Number(data.budgetOverrides[k]):Number(r.amount)};
    }));
    function overrideRecurring(rec,evt){const n=Number(evt.target.value);if(!evt.target.value.trim()||!Number.isFinite(n))return;data.budgetOverrides[rec.monthlyKey]=n;}
    function resetRecurringOverride(rec){delete data.budgetOverrides[rec.monthlyKey];}
    function addBudgetEntry(){
      const n=Number(budgetEntryForm.amount);
      if(!budgetEntryForm.label.trim()||budgetEntryForm.amount===null||budgetEntryForm.amount===''||!Number.isFinite(n))return;
      data.budgetEntries.push({id:uid(),date:budgetEntryForm.date||budgetMonth.value+'-01',label:budgetEntryForm.label.trim(),amount:n,category:budgetEntryForm.category});
      budgetEntryForm.label='';budgetEntryForm.amount=null;
    }
    function addBudgetRecurring(){
      const n=Number(budgetRecurringForm.amount);
      if(!budgetRecurringForm.label.trim()||budgetRecurringForm.amount===null||budgetRecurringForm.amount===''||!Number.isFinite(n)||!budgetRecurringForm.start||(budgetRecurringForm.end&&budgetRecurringForm.end<budgetRecurringForm.start))return;
      data.budgetRecurring.push({id:uid(),label:budgetRecurringForm.label.trim(),amount:n,category:budgetRecurringForm.category,start:budgetRecurringForm.start,end:budgetRecurringForm.end,active:true});
      budgetRecurringForm.label='';budgetRecurringForm.amount=null;
    }
    function addBudgetSwile(){
      const n=Number(budgetSwileForm.amount);
      if(!budgetSwileForm.label.trim()||budgetSwileForm.amount===null||budgetSwileForm.amount===''||!Number.isFinite(n)||n>=0)return;
      data.budgetSwile.push({id:uid(),date:budgetSwileForm.date||todayStr(),label:budgetSwileForm.label.trim(),amount:n,category:budgetSwileForm.category});
      budgetSwileForm.label='';budgetSwileForm.amount=null;
    }
    function removeBudgetEntry(id){if(confirm('Supprimer cette opération ?')){const x=data.budgetEntries.find(x=>x.id===id);if(x)data.trash.unshift({id:uid(),type:'budgetEntry',deletedAt:new Date().toISOString(),payload:clone(x)});data.budgetEntries=data.budgetEntries.filter(x=>x.id!==id);}}
    function removeBudgetRecurring(id){if(confirm('Supprimer cette charge récurrente ?')){data.budgetRecurring=data.budgetRecurring.filter(x=>x.id!==id);Object.keys(data.budgetOverrides).filter(k=>k.endsWith('|'+id)).forEach(k=>delete data.budgetOverrides[k]);}}
    function removeBudgetSwile(id){if(confirm('Supprimer cet achat Swile ?')){const x=data.budgetSwile.find(x=>x.id===id);if(x)data.trash.unshift({id:uid(),type:'budgetSwile',deletedAt:new Date().toISOString(),payload:clone(x)});data.budgetSwile=data.budgetSwile.filter(x=>x.id!==id);}}
    const budgetSwileSource=computed(()=>data.budgetSwile.filter(x=>x.date?.slice(0,7)===budgetMonth.value));
    const budgetSwileNext=computed(()=>data.budgetSwile.filter(x=>x.date?.slice(0,7)===monthBefore(budgetMonth.value)));
    const budgetItems=computed(()=>[
      ...data.budgetEntries.filter(x=>x.date?.slice(0,7)===budgetMonth.value).map(x=>({...x,kind:'manual'})),
      ...recurringForMonth.value.map(x=>({...x,id:'rec-'+x.monthlyKey,date:budgetMonth.value+'-01',category:'Charge récurrente',kind:'recurring'})),
      ...budgetSwileNext.value.map(x=>({...x,id:'swile-'+x.id,amount:-Math.abs(Number(x.amount)||0)/2,label:'Swile (50 %) : '+x.label,kind:'swile'}))
    ]);
    // Affichage en liste simple, sans regroupement par catégorie.
    // Les charges automatiques sont agrégées en une seule ligne datée au début du mois.
    // Les opérations manuelles conservent strictement leur ordre de création.
    const budgetDisplayItems=computed(()=>{
      const recurring=recurringForMonth.value;
      const recurringTotal=recurring.reduce((sum,r)=>sum+(Number(r.amount)||0),0);
      const automatic=recurring.length ? [{id:'recurring-total-'+budgetMonth.value,kind:'recurring-total',label:'Charges récurrentes',category:'Charge récurrente',date:budgetMonth.value+'-01',amount:recurringTotal}] : [];
      const manual=data.budgetEntries.filter(x=>x.date?.slice(0,7)===budgetMonth.value).map(x=>({...x,kind:'manual'}));
      const swile=budgetSwileNext.value.map(x=>({...x,id:'swile-'+x.id,amount:-Math.abs(Number(x.amount)||0)/2,label:'Swile (50 %) : '+x.label,kind:'swile'}));
      return [...automatic,...manual,...swile];
    });
    const budgetSummary=computed(()=>{
      const items=budgetItems.value;
      const income=items.reduce((v,x)=>v+Math.max(0,Number(x.amount)||0),0);
      const expenses=items.reduce((v,x)=>v+Math.max(0,-(Number(x.amount)||0)),0);
      const names=[...new Set([...budgetCategories.value,'Charge récurrente',...items.map(x=>x.category)])];
      const groups=names.map(category=>({category,amount:items.filter(x=>x.category===category).reduce((v,x)=>v+Math.max(0,-(Number(x.amount)||0)),0),items:items.filter(x=>x.category===category)}));
      const categoryTotal=name=>items.filter(x=>x.category?.toLocaleLowerCase('fr')===name.toLocaleLowerCase('fr')).reduce((v,x)=>v+Math.max(0,-(Number(x.amount)||0)),0);
      return {income,expenses,balance:income-expenses,groups,food:categoryTotal('Alimentation'),fuel:categoryTotal('Essence'),leisure:categoryTotal('Loisirs'),swileTotal:budgetSwileSource.value.reduce((v,x)=>v-Math.abs(Number(x.amount)||0),0)};
    });

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

    // Les niveaux sont ordonnés du PLUS FORT (en haut) au PLUS FAIBLE (en bas).
    // Aucun niveau affecté = rang 0. Les noms et les bonus de points ne déterminent pas le tri.
    const levelRank = (list, id) => {
      const index = list.findIndex(l => l.id === id);
      return index < 0 ? 0 : list.length - index;
    };

    /* ---------- Points ---------- */
    // Points des tâches terminées (bonus en +, malus en −) + points des tâches terminées puis supprimées
    const earned = computed(() =>
      data.tasks.filter(t => t.status === 'done').reduce((s, t) => s + taskValue(t), 0)
      + data.workTickets.reduce((sum,ticket)=>sum+(ticket.items||[]).filter(x=>x.done).reduce((s,x)=>s+ticketItemValue(ticket,x),0),0)
      + (Number(data.archived) || 0));
    const gratitudeTotal = computed(() => Math.round(data.gratitude.reduce((sum,g) => sum+(Number(g.points)||0),0)*100)/100);
    const savedTotal = computed(() => data.rewards.reduce((sum,r)=>sum+Math.max(0,Number(r.saved)||0),0));
    const habitTotal = computed(() => Math.round(data.habits.reduce((sum,h)=>sum+habitAwards(h).reduce((s,a)=>s+a.points,0) - (h.penalties||[]).reduce((s,a)=>s+Math.max(0,Number(a.points)||0),0),0)*100)/100);
    const challengeTotal = computed(() => Math.round(data.challengeAwards.reduce((sum,a) => sum + (Number(a.points)||0), 0)*100)/100);
    const balance = computed(() => Math.round((earned.value + gratitudeTotal.value + habitTotal.value + challengeTotal.value - data.spent - savedTotal.value + (Number(data.adjust) || 0))*100)/100);

    // Modification manuelle du solde : on règle "adjust" pour tomber pile sur la valeur voulue
    const balanceForm = reactive({ open: false, value: 0 });
    function openBalanceForm() {
      balanceForm.value = balance.value;
      balanceForm.open = !balanceForm.open;
    }
    function applyBalance() {
      const target = Number(balanceForm.value);
      if (!Number.isFinite(target)) return;
      data.adjust = Math.round((target - (earned.value + gratitudeTotal.value + habitTotal.value + challengeTotal.value - data.spent - savedTotal.value))*100)/100;
      balanceForm.open = false;
      notify(`Solde réglé à ${Math.round(target)} pts`);
    }
    function resetBalance() {
      if (!confirm('Remettre le solde de points à 0 ?')) return;
      data.adjust = -(earned.value + gratitudeTotal.value + habitTotal.value + challengeTotal.value - data.spent - savedTotal.value);
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
    function depositRandomReward() {
      const eligible=data.rewards.filter(r=>rewardRemaining(r)>0);
      if (!eligible.length || balance.value<=0) {notify('Aucune récompense à financer ou aucun point disponible');return;}
      const reward=eligible[Math.floor(Math.random()*eligible.length)];
      depositReward(reward, true);
    }
    function depositReward(reward, random=false) {
      const max = Math.min(balance.value, rewardRemaining(reward));
      if (max <= 0) { notify('Aucun point disponible à épargner'); return; }
      const response = prompt(random ? ('Combien de points épargner sur une récompense surprise ? (max '+max+')') : ('Points à épargner pour « '+reward.name+' » (max '+max+') :'), String(Math.min(5,max)));
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
      while(cursor.slice(0,7)===today.value.slice(0,7) && dates.has(cursor)) {run++; const d=new Date(cursor+'T12:00:00Z');d.setUTCDate(d.getUTCDate()-1);cursor=d.toISOString().slice(0,10);}
      const points=1 + run * 0.25;
      data.gratitude.push({date:today.value,text:value,points});
      gratitudeDraft.value='';notify('Gratitude enregistrée : +'+points+' pt');
    }
    function deleteGratitude(g) {if(confirm('Supprimer cette gratitude et les points associés ?'))data.gratitude=data.gratitude.filter(x=>x.date!==g.date);}
    const workCategories = computed(()=>data.workCategories.map(c=>c.name));
    const newWorkCategory=ref('');
    function addWorkCategory(){const name=newWorkCategory.value.trim();if(name&&!workCategories.value.some(c=>c.toLowerCase()===name.toLowerCase()))data.workCategories.push({name,color:''});newWorkCategory.value='';}
    function deleteWorkCategory(name){
      if(!confirm('Supprimer la catégorie de travail « '+name+' » ?'))return;
      data.tasks.filter(t=>t.scope==='work').forEach(t=>{
        t.workCategoryNames=workTags(t).filter(c=>c!==name);
        t.category=t.workCategoryNames[0]||'';
      });
      data.workCategories=data.workCategories.filter(c=>c.name!==name);
    }
    function moveWorkLevel(kind,index,delta){const levels=kind==='urgency'?data.workUrgencies:data.workDifficulties;const dest=index+delta;if(dest<0||dest>=levels.length)return;const [v]=levels.splice(index,1);levels.splice(dest,0,v);}
    function addWorkUrgency(){data.workUrgencies.push({id:uid(),name:'Nouvelle urgence',color:'#6b7280',pointMode:'add',pointValue:0});}
    function deleteWorkUrgency(level){if(!confirm('Supprimer cette urgence de travail ?'))return;data.tasks.filter(t=>t.scope==='work'&&t.urgency===level.id).forEach(t=>t.urgency='');data.workUrgencies=data.workUrgencies.filter(x=>x.id!==level.id);}
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
    const unusedInventory = computed(()=>visibleInventory.value.filter(i=>!i.used));
    const usedInventory = computed(()=>visibleInventory.value.filter(i=>i.used).sort((a,b)=>(b.usedAt||'').localeCompare(a.usedAt||'')));
    const rewardClaimCount = r => data.inventory.filter(i=>i.rewardId===r.id || (!i.rewardId && i.name===r.name)).length;

    /* ---------- Filtres & tris des tâches ---------- */
    const FILTER_DEFAULTS = { search: '', category: '', status: '', project: '', urgency: '', difficulty: '', kind: '', dueMode: 'any', dueFrom: '', dueTo: '', sort: 'due' };
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
      if (filters.dueMode !== 'any') n++;
      if (filters.dueFrom) n++;
      if (filters.dueTo) n++;
      if (filters.sort !== 'due') n++;
      return n;
    });

    function applyFilters(list, withSort = true) {
      const q = filters.search.trim().toLowerCase();
      const res = list.filter(t => {
        if (filters.status && t.status !== filters.status) return false;
        if (filters.dueMode==='none' && t.due) return false;
        if (filters.dueMode==='dated' && !t.due) return false;
        if (filters.dueFrom && (!t.due || t.due<filters.dueFrom)) return false;
        if (filters.dueTo && (!t.due || t.due>filters.dueTo)) return false;
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
        case 'urgency-asc':     res.sort((a, b) => levelRank(data.urgencies, effectiveUrgency(a)) - levelRank(data.urgencies, effectiveUrgency(b)) || byDue(a, b)); break;
        case 'difficulty-asc':  res.sort((a, b) => levelRank(data.difficulties, a.difficulty) - levelRank(data.difficulties, b.difficulty) || byDue(a, b)); break;
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
    const workTasks = computed(() => [...data.tasks.filter(t => t.scope === 'work' && t.status !== 'done')].sort((a,b)=>Number(a.status==='done')-Number(b.status==='done') || (a.due||'9999').localeCompare(b.due||'9999')));
    const copyForm = reactive({open:false});
    const copyText = computed(() => allTasks.value.map(t => t.title).join('\n'));
    function copyTaskTitles() { if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(copyText.value).then(() => notify('Liste copiée')).catch(() => notify('Sélectionne le texte pour le copier')); }
    // Terminées : triées par date de fin (la plus récente d'abord) ; les filtres s'appliquent aussi
    const doneTasks = computed(() => applyFilters(data.tasks.filter(t => t.scope !== 'work' && t.status === 'done'), false)
      .sort((a, b) => (b.doneAt || '').localeCompare(a.doneAt || '')));
    const doneWorkTasks = computed(() => data.tasks.filter(t => t.scope === 'work' && t.status === 'done')
      .sort((a,b) => (b.doneAt || '').localeCompare(a.doneAt || '')));

    /* ---------- Tickets professionnels (compatibles avec les tâches historiques) ---------- */
    function ticketItemValue(ticket, item) {
      let points = taskValue({scope:'work',points:Math.max(0,Number(item.points)||0),urgency:ticket.urgency||'',difficulty:ticket.difficulty||'',malus:false});
      const type = data.workTicketTypes.find(x => x.id === ticket.typeId);
      if (type && Number.isFinite(Number(type.pointValue))) {
        const value = Math.max(0, Number(type.pointValue));
        points = type.pointMode === 'multiply' ? points * value : points + value;
      }
      return Math.round(Math.max(0, points) * 100) / 100;
    }
    function moveTicketType(index, direction) {
      const next=index+direction;
      if(next<0 || next>=data.workTicketTypes.length)return;
      const [item]=data.workTicketTypes.splice(index,1);
      data.workTicketTypes.splice(next,0,item);
    }
    function addTicketType() { data.workTicketTypes.push({id:uid(),name:'Nouveau type',color:'#64748b',pointMode:'add',pointValue:0}); }
    function deleteTicketType(type) {
      if (!confirm('Supprimer ce type de ticket ?')) return;
      data.workTickets.forEach(t => { if(t.typeId===type.id) t.typeId=''; });
      data.workTicketTypes=data.workTicketTypes.filter(t=>t.id!==type.id);
    }
    function safeTicketUrl(url) {
      const value=String(url||'').trim();
      if(!value)return '';
      try { const u=new URL(value);return ['https:','http:'].includes(u.protocol) ? u.href : ''; }
      catch(e){return '';}
    }
    const ticketDraft = reactive({name:'',urgency:'',difficulty:'',startDate:todayStr(),due:'',category:'',typeId:'',url:''});
    const collapsedTickets = reactive({});
    function isTicketCollapsed(id) { return collapsedTickets[id] !== false; }
    function toggleTicketCollapse(id) { collapsedTickets[id] = !isTicketCollapsed(id); }
    function renameTicket(ticket) {
      const value = prompt("Nouveau nom du ticket", ticket.name);
      if (value === null) return;
      const name = value.trim();
      if (!name) { notify("Le ticket doit avoir un nom"); return; }
      ticket.name = name;
    }
    function updateTicketItemPoints(ticket, item, event) {
      const raw = String(event.target.value).trim();
      const parsed = Number(raw);
      if (!raw || !Number.isFinite(parsed) || parsed < 0) {
        event.target.value = item.points;
        notify('Indique un nombre de points positif ou nul');
        return;
      }
      item.points = Math.round(parsed);
      event.target.value = item.points;
    }
    const ticketInputs = reactive({});
    data.workTickets.forEach(t=>{ticketInputs[t.id]={name:'',points:10};});
    const ticketSort = ref('manual');
    const ticketDragged = ref(null);
    const openTickets = computed(()=>{
      const list=data.workTickets.filter(t=>!t.done);
      const urgency=t=>levelRank(data.workUrgencies,t.urgency);
      const difficulty=t=>levelRank(data.workDifficulties,t.difficulty);
      switch(ticketSort.value){
        case 'urgency-desc': return [...list].sort((a,b)=>urgency(b)-urgency(a));
        case 'urgency-asc': return [...list].sort((a,b)=>urgency(a)-urgency(b));
        case 'difficulty-desc': return [...list].sort((a,b)=>difficulty(b)-difficulty(a));
        case 'difficulty-asc': return [...list].sort((a,b)=>difficulty(a)-difficulty(b));
        case 'start-asc': return [...list].sort((a,b)=>(a.startDate||a.createdAt||'9999').localeCompare(b.startDate||b.createdAt||'9999'));
        case 'start-desc': return [...list].sort((a,b)=>(b.startDate||b.createdAt||'0000').localeCompare(a.startDate||a.createdAt||'0000'));
        case 'due-asc': return [...list].sort((a,b)=>(a.due||'9999').localeCompare(b.due||'9999'));
        case 'due-desc': return [...list].sort((a,b)=>(b.due||'0000').localeCompare(a.due||'0000'));
        case 'name': return [...list].sort((a,b)=>a.name.localeCompare(b.name));
        default: return list;
      }
    });
    function ticketDragStart(event,ticket){
      if(ticketSort.value!=='manual'){event.preventDefault();return;}
      ticketDragged.value=ticket.id;
      event.dataTransfer.effectAllowed='move';
      event.dataTransfer.setData('text/plain',ticket.id);
    }
    function ticketDrop(event,target){
      event.preventDefault();
      const from=data.workTickets.findIndex(t=>t.id===ticketDragged.value);
      const to=data.workTickets.findIndex(t=>t.id===target.id);
      if(from<0||to<0||from===to)return;
      const [moved]=data.workTickets.splice(from,1);
      data.workTickets.splice(to,0,moved);
      ticketDragged.value=null;
    }
    const closedTickets = computed(()=>[...data.workTickets.filter(t=>t.done)].sort((a,b)=>(b.doneAt||'').localeCompare(a.doneAt||'')));
    function createTicket() {
      const name=ticketDraft.name.trim(); if(!name)return;
      const id=uid();ticketInputs[id]={name:'',points:10};
      data.workTickets.push({id,name,urgency:ticketDraft.urgency,difficulty:ticketDraft.difficulty,typeId:ticketDraft.typeId,url:ticketDraft.url.trim(),due:ticketDraft.due,startDate:ticketDraft.startDate||today.value,category:ticketDraft.category,createdAt:today.value,customStatus:'',done:false,doneAt:'',items:[]});
      ticketDraft.name='';ticketDraft.startDate=today.value;ticketDraft.due='';ticketDraft.category='';ticketDraft.url='';
    }
    function addTicketItem(ticket) {
      const draft=ticketInputs[ticket.id]||(ticketInputs[ticket.id]={name:'',points:10});const name=String(draft.name||'').trim();if(!name)return;
      ticket.items.push({id:uid(),name,points:Math.max(0,Number(draft.points)||0),done:false,doneAt:''});
      ticketInputs[ticket.id]={name:'',points:10};
    }
    function toggleTicketItem(ticket,item) {
      item.done=!item.done;item.doneAt=item.done?today.value:'';
      if(!item.done&&ticket.done){ticket.done=false;ticket.doneAt='';}
    }
    function finishTicket(ticket) {
      if(!ticket.items.length){notify('Ajoute au moins une tâche avant de terminer le ticket');return;}
      if(ticket.items.some(x=>!x.done)){notify('Termine toutes les tâches avant de clôturer le ticket');return;}
      ticket.done=true;ticket.doneAt=today.value;
    }
    function reopenTicket(ticket){ticket.done=false;ticket.doneAt='';}
    function removeTicket(ticket){
      if(!confirm(`Supprimer le ticket « ${ticket.name} » et toutes ses tâches ? Les points validés seront conservés.`))return;
      data.trash.unshift({id:uid(),type:'ticket',deletedAt:new Date().toISOString(),payload:clone(ticket)});
      data.archived+=(ticket.items||[]).filter(x=>x.done).reduce((s,x)=>s+ticketItemValue(ticket,x),0);
      data.workTickets=data.workTickets.filter(x=>x.id!==ticket.id);
    }
    function removeTicketItem(ticket,item){
      if(!confirm(`Supprimer « ${item.name} » ?`))return;
      if(item.done)data.archived+=ticketItemValue(ticket,item);
      ticket.items=ticket.items.filter(x=>x.id!==item.id);
      if(ticket.done){ticket.done=false;ticket.doneAt='';}
    }
    function ticketPoints(ticket){return (ticket.items||[]).filter(x=>x.done).reduce((s,x)=>s+ticketItemValue(ticket,x),0);}

    const eveningPreview = ref(false);
    function addTextarea(){data.textareas.push({id:uid(),title:'Nouvelle note',content:''});}
    function removeTextarea(note){if(confirm('Supprimer « '+(note.title||'Sans titre')+' » ?')){data.trash.unshift({id:uid(),type:'textarea',deletedAt:new Date().toISOString(),payload:clone(note)});data.textareas=data.textareas.filter(x=>x.id!==note.id);}}
    function renderEveningMarkdown(source) {
      const escape = text => String(text).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
      const inline = text => escape(text).replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>').replace(/\*(.+?)\*/g,'<em>$1</em>').replace(/`([^`]+)`/g,'<code>$1</code>');
      let result='', inList=false;
      const closeList=()=>{if(inList){result+='</ul>';inList=false;}};
      for(const line of String(source||'').split(/\r?\n/)) {
        const heading=line.match(/^(#{1,3})\s+(.+)$/);
        const checkbox=line.match(/^\s*[-*]\s+\[([ xX])\]\s*(.*)$/);
        const bullet=line.match(/^\s*[-*]\s+(.+)$/);
        if(checkbox||bullet){
          if(!inList){result+='<ul>';inList=true;}
          result+='<li>'+(checkbox?(checkbox[1].toLowerCase()==='x'?'☑ ':'☐ ')+inline(checkbox[2]):inline(bullet[1]))+'</li>';
        }else {closeList();if(heading){const n=heading[1].length;result+='<h'+n+'>'+inline(heading[2])+'</h'+n+'>';}
          else if(line.trim())result+='<p>'+inline(line)+'</p>';else result+='<p></p>';}
      }
      closeList();return result;
    }
    /* Listes habituelles : aucun impact sur les points, sans remise à zéro automatique. */
    const usualDragged = ref(null);
    const usualNewItem = reactive({});
    function addUsualList() {
      data.usualLists.push({id:uid(),title:'Nouvelle liste',info:'',collapsed:false,items:[]});
    }
    function removeUsualList(list) {
      if(confirm(`Supprimer la liste « ${list.title} » ?`)) data.usualLists=data.usualLists.filter(x=>x.id!==list.id);
    }
    function addUsualHeading(list) {
      const title=prompt('Titre de la section :');
      if(title && title.trim())list.items.push({id:uid(),name:title.trim(),heading:true,done:false,doneAt:''});
    }
    function addUsualItem(list) {
      const name=String(usualNewItem[list.id]||'').trim();if(!name)return;
      list.items.push({id:uid(),name,done:false,doneAt:''});usualNewItem[list.id]='';
    }
    function toggleUsualItem(item) { if(item.heading)return; item.done=!item.done;item.doneAt=item.done?new Date().toISOString():''; }
    function resetUsualList(list) { list.items.forEach(item=>{item.done=false;item.doneAt='';}); }
    function deleteUsualItem(list,item) { list.items=list.items.filter(x=>x.id!==item.id); }
    function startUsualDrag(event,list,item) {
      usualDragged.value={listId:list.id,itemId:item.id};
      event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain',item.id);
    }
    function dropUsualItem(event,list,target) {
      event.preventDefault();const source=usualDragged.value;usualDragged.value=null;
      if(!source||source.listId!==list.id)return;
      const from=list.items.findIndex(x=>x.id===source.itemId),to=list.items.findIndex(x=>x.id===target.id);
      if(from<0||to<0||from===to)return;
      const [item]=list.items.splice(from,1);list.items.splice(to,0,item);
    }

    /* ---------- Statistiques (données connues uniquement) ---------- */
    const completedEntries=computed(()=>[
      ...data.tasks.filter(t=>t.status==='done'&&t.doneAt).map(t=>({date:t.doneAt,scope:t.scope==='work'?'work':'personal',points:taskValue(t),ticket:false})),
      ...data.workTickets.flatMap(ticket=>(ticket.items||[]).filter(x=>x.done&&x.doneAt).map(x=>({date:x.doneAt,scope:'work',points:ticketItemValue(ticket,x),ticket:true})))
    ]);
    const doneStats=computed(()=>{
      const result={};for(const scope of ['personal','work']){
        const entries=completedEntries.value.filter(x=>x.scope===scope);
        const byDate={};for(const item of entries)byDate[item.date]=(byDate[item.date]||0)+item.points;
        const dates=Object.keys(byDate).sort().reverse();
        result[scope]={count:entries.length,total:entries.reduce((s,x)=>s+x.points,0),average:entries.length?Math.round(entries.reduce((s,x)=>s+x.points,0)/entries.length*100)/100:0,days:dates.map(date=>({date,points:Math.round(byDate[date]*100)/100}))};
      }return result;
    });
    const statistics=computed(()=>{
      const tasks=data.tasks;const tickets=data.workTickets;
      const done=completedEntries.value;const todayDone=done.filter(x=>x.date===today.value);
      const active=tasks.filter(t=>t.status!=='done');
      const perDay={};done.forEach(x=>{perDay[x.date]=(perDay[x.date]||0)+x.points;});
      const series=Object.keys(perDay).sort().reverse().map(date=>({date,points:Math.round(perDay[date]*100)/100,count:done.filter(x=>x.date===date).length}));
      const sum=done.reduce((s,x)=>s+x.points,0);
      const total=tickets.reduce((s,t)=>s+(t.items||[]).length,0);
      const ticketDone=tickets.reduce((s,t)=>s+(t.items||[]).filter(x=>x.done).length,0);
      const categories=Object.entries(tasks.reduce((acc,t)=>{const k=t.scope==='work'?'Travail':t.category||'Sans catégorie';acc[k]=(acc[k]||0)+1;return acc;},{})).sort((a,b)=>b[1]-a[1]);
      const trendDates=Array.from({length:14},(_,i)=>{const d=new Date(today.value+'T12:00:00');d.setDate(d.getDate()-(13-i));return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;});
      const trend=trendDates.map(date=>({date,points:Math.round((perDay[date]||0)*100)/100,count:done.filter(x=>x.date===date).length}));
      const trendMax=Math.max(1,...trend.map(x=>Math.abs(x.points)));
      const statusTotal=Math.max(1,tasks.length);
      const categoryMax=Math.max(1,...categories.map(x=>x[1]));
      return {trend,trendMax,statusTotal,categoryMax,tasks:tasks.length,active:active.length,completed:done.length,overdue:active.filter(t=>t.due&&t.due<today.value).length,completionRate:tasks.length?Math.round(tasks.filter(t=>t.status==='done').length/tasks.length*100):0,points:Math.round(sum*100)/100,average:done.length?Math.round(sum/done.length*100)/100:0,todayPoints:todayDone.reduce((s,x)=>s+x.points,0),todayCount:todayDone.length,days:series,mostProductive:series.reduce((best,d)=>!best||d.points>best.points?d:best,null),tickets:tickets.length,ticketsOpen:tickets.filter(t=>!t.done).length,ticketsClosed:tickets.filter(t=>t.done).length,ticketItems:total,ticketItemsDone:ticketDone,projects:data.projects.length,habits:data.habits.length,challenges:data.challenges.length,rewards:data.rewards.length,inventory:data.inventory.length,gratitude:data.gratitude.length,spent:data.spent,saved:savedTotal.value,categories,byStatus:STATUSES.map(s=>({name:s.label,count:tasks.filter(t=>t.status===s.value).length}))};
    });

    /* ---------- Tâches ---------- */
    const taskForm = reactive({
      open: false, id: null, title: '', category: '', points: 10, malus: false, status: 'todo', projectId: '', due: '',
      urgency: '', difficulty: '', doneAt: '', scope:'personal', workCategoryNames: [], ticketName: '',
    });

    const DRAFT_KEY='todo-quest-form-drafts-v2';
    let persistedDrafts={};
    try{persistedDrafts=JSON.parse(localStorage.getItem(DRAFT_KEY)||'{}')||{};}catch(e){}
    function saveDrafts(){try{localStorage.setItem(DRAFT_KEY,JSON.stringify({task:persistedDrafts.task,quick:persistedDrafts.quick,ticket:clone(ticketDraft)}));}catch(e){}}
    function clearDraft(key){delete persistedDrafts[key];saveDrafts();}
    Object.assign(ticketDraft,persistedDrafts.ticket||{});
    function openTaskForm(task = null, projectId = '') {
      if (task) {
        Object.assign(taskForm, {
          id: task.id, title: task.title, category: task.category || '', points: task.points, malus: !!task.malus, scope:task.scope||'personal',
          status: task.status, projectId: task.projectId || '', due: task.due || '',
          urgency: task.urgency || '', difficulty: task.difficulty || '', doneAt: task.doneAt || '', workCategoryNames: workTags(task), ticketName: task.ticketName || '',
        });
      } else {
        Object.assign(taskForm, {
          id: null, title: '', category: '', points: 10, malus: false, status: 'todo', projectId, scope: view.value==='work'?'work':'personal',
          due: today.value, urgency: '', difficulty: '', doneAt: '', workCategoryNames: [], ticketName: '',
        });
      }
      if(!task && persistedDrafts.task && persistedDrafts.task.scope===taskForm.scope)Object.assign(taskForm,persistedDrafts.task,{open:false,id:null});
      quickForm.open = false;
      taskForm.open = true;
    }

    // Un 2e clic sur le bouton referme le formulaire (sauf si on est en train de modifier une tâche)
    function toggleTaskForm() {
      if (taskForm.open && !taskForm.id) taskForm.open = false;
      else openTaskForm();
    }

    function openWorkQuickPaste(){openQuickForm();quickForm.mode='paste';}
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
        category: taskForm.scope === 'work' ? (taskForm.workCategoryNames[0] || '') : (taskForm.category || ''),
        workCategoryNames: taskForm.scope === 'work' ? [...taskForm.workCategoryNames] : [],
        ticketName: '',
        scope:taskForm.scope==='work'?'work':'personal',
        points: Math.max(0, Number(taskForm.points) || 0),
        malus: !!taskForm.malus,
        projectId: taskForm.scope==='work'?'':(taskForm.projectId || ''),
        due: taskForm.due || '',
        urgency: taskForm.urgency || '',
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
      taskForm.open = false;clearDraft('task');
    }

    /* ---------- To do rapide (plusieurs tâches d'un coup) ---------- */
    const quickForm = reactive({
      open: false, mode: 'rows', scope: 'personal', due: '', rows: [],
      paste: { text: '', points: 10, malus: false, category: '', workCategoryNames: [], ticketName: '', urgency: '', difficulty: '', due: '', project: '' },
    });
    const pastePreview = computed(() => parsePastedList(quickForm.paste.text));

    function openQuickForm() {
      taskForm.open = false;
      quickForm.mode = 'rows';
      quickForm.scope = view.value === 'work' ? 'work' : 'personal';
      quickForm.paste = { text: '', points: 10, malus: false, category: '', workCategoryNames: [], ticketName: '', urgency: '', difficulty: '', due: today.value, project: '' };
      quickForm.due = today.value;
      quickForm.rows = [0, 1, 2].map(() => ({ title: '', points: 10, due: today.value, urgency: '', difficulty: '', workCategoryNames: [], ticketName: '' }));
      if(persistedDrafts.quick&&persistedDrafts.quick.scope===quickForm.scope)Object.assign(quickForm,persistedDrafts.quick,{open:false});
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
      quickForm.rows.push({ title: '', points: last ? last.points : 10, due: last ? last.due : '', urgency: last ? last.urgency || '' : '', difficulty: last ? last.difficulty || '' : '', workCategoryNames: last ? [...(last.workCategoryNames || [])] : [], ticketName: last ? last.ticketName || '' : '' });
      focusLastQuickRow();
    }

    function removeQuickRow(i) {
      quickForm.rows.splice(i, 1);
      if (!quickForm.rows.length) quickForm.rows.push({ title: '', points: 10, due: quickForm.due, urgency: '', difficulty: '', workCategoryNames: [], ticketName: '' });
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
        scope: quickForm.scope,
        urgency: r.urgency || '',
        difficulty: quickForm.scope === 'work' ? (r.difficulty || '') : '',
        workCategoryNames: quickForm.scope === 'work' ? [...(r.workCategoryNames || [])] : [],
        ticketName: '',
        category: quickForm.scope === 'work' ? ((r.workCategoryNames || [])[0] || '') : '',
        due: r.due || '',
      })));
      notify(rows.length ? `${rows.length} tâche(s) ajoutée(s)` : 'Aucune tâche à ajouter');
      quickForm.open = false;clearDraft('quick');
    }

    function savePaste() {
      const { header, items } = pastePreview.value;
      if (!items.length) { notify('Aucune tâche détectée'); return; }

      let projectId = quickForm.scope === 'work' ? '' : quickForm.paste.project;
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
        title, points, projectId, scope: quickForm.scope,
        malus: !!quickForm.paste.malus,
        category: quickForm.scope === 'work' ? (quickForm.paste.workCategoryNames[0] || '') : (quickForm.paste.category || ''),
        workCategoryNames: quickForm.scope === 'work' ? [...quickForm.paste.workCategoryNames] : [],
        ticketName: '',
        urgency: quickForm.paste.urgency || '',
        difficulty: quickForm.paste.difficulty || '',
        due: quickForm.paste.due || '',
      })));
      notify(`${items.length} tâche(s) ajoutée(s)`);
      quickForm.open = false;clearDraft('quick');
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
      urgency: '__keep', difficulty: '__keep', due: '', clearDue: false, workCategoryNames: [], editWorkCategories: false,
    });

    function editSelected(ids) {
      if (ids.length === 1) {
        const t = data.tasks.find(x => x.id === ids[0]);
        if (t) openTaskForm(t);
        return;
      }
      Object.assign(bulkForm, {
        open: true, ids: [...ids], category: '__keep', points: '', kind: '__keep', status: '', projectId: '__keep',
        urgency: '__keep', difficulty: '__keep', due: '', clearDue: false, workCategoryNames: [], editWorkCategories: false, workCategoryNames: [], editWorkCategories: false,
      });
    }

    function saveBulk() {
      let gained = 0;
      bulkForm.ids.forEach(id => {
        const t = data.tasks.find(x => x.id === id);
        if (!t) return;
        const was = t.status;
        if (t.scope === 'work') {
          if (bulkForm.editWorkCategories) {
            t.workCategoryNames = [...bulkForm.workCategoryNames];
            t.category = t.workCategoryNames[0] || '';
          }
        } else if (bulkForm.category !== '__keep') t.category = bulkForm.category;
        if (bulkForm.points !== '' && bulkForm.points !== null && Number.isFinite(Number(bulkForm.points))) {
          t.points = Math.max(0, Math.round(Number(bulkForm.points)));
        }
        if (bulkForm.kind !== '__keep') t.malus = bulkForm.kind === 'malus';
        if (bulkForm.status) setStatus(t, bulkForm.status);
        if (was !== 'done' && t.status === 'done') gained += taskValue(t);
        if (t.scope !== 'work' && bulkForm.projectId !== '__keep') t.projectId = bulkForm.projectId;
        if (bulkForm.urgency !== '__keep') t.urgency = bulkForm.urgency;
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
      data.tasks.filter(t=>set.has(t.id)).forEach(t=>data.trash.unshift({id:uid(),type:'task',deletedAt:new Date().toISOString(),payload:clone(t)}));
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

    // Brouillons enregistrés localement, indépendamment des synchronisations Firebase.
    watch(taskForm,()=>{if(taskForm.open&&!taskForm.id){persistedDrafts.task=clone(taskForm);saveDrafts();}},{deep:true});
    watch(quickForm,()=>{if(quickForm.open){persistedDrafts.quick=clone(quickForm);saveDrafts();}},{deep:true});
    watch(ticketDraft,()=>saveDrafts(),{deep:true});
    // Échap ferme les popups
    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      // Ne jamais fermer accidentellement un formulaire avec des données en cours.
      if (e.target && e.target.closest && e.target.closest('.modal')) return;
      // Fermeture par Échap désactivée pour préserver toute saisie en cours.
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

    function duplicateTask(task,mode='tomorrow') {
      const copy=newTask({...task,id:uid(),title:task.title,status:'todo',doneAt:'',scope:task.scope||'personal'});
      if(mode==='tomorrow'){
        const d=new Date(today.value+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+1);copy.due=d.toISOString().slice(0,10);
      } else {
        const title=prompt('Nom de la tâche suivante :',task.title+' (suite)');
        if(!title||!title.trim())return;
        copy.title=title.trim();copy.previousTaskId=task.id;copy.due=task.due||today.value;
      }
      data.tasks.push(copy);
      notify('Nouvelle tâche créée : '+copy.title);
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
      } else if (field === 'ticketName' && task.scope === 'work') {
        task.ticketName = String(value || '').trim();
      } else if (field === 'malus') {
        task.malus = value === true || value === 'true';
      } else if (field === 'workCategoryToggle' && task.scope === 'work') {
        const tags = workTags(task);
        task.workCategoryNames = tags.includes(value) ? tags.filter(c=>c!==value) : [...tags,value];
        task.category = task.workCategoryNames[0] || '';
      } else if (['category', 'projectId', 'urgency', 'difficulty'].includes(field)) {
        if(task.scope==='work' && field==='projectId')return;
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
      data.trash.unshift({id:uid(),type:'project',deletedAt:new Date().toISOString(),payload:clone(project),milestones:clone(data.projectMilestones.filter(m=>m.projectId===project.id))});
      data.projectMilestones=data.projectMilestones.filter(m=>m.projectId!==project.id);
      removeTasks(data.tasks.filter(t => t.projectId === project.id).map(t => t.id));
      data.projects = data.projects.filter(p => p.id !== project.id);
    }

    function projectTasks(project) {
      return data.tasks
        .filter(t => t.projectId === project.id && t.status !== 'done')
        .sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999'));
    }

    function projectStats(project) {
      const list = data.tasks.filter(t => t.projectId === project.id);
      return {
        total: list.length,
        done: list.filter(t => t.status === 'done').length,
        points: list.reduce((s, t) => s + taskValue(t), 0),
        milestonesTotal:data.projectMilestones.filter(m=>m.projectId===project.id).length,
        milestonesDone:data.projectMilestones.filter(m=>m.projectId===project.id&&m.done).length,
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
    const activeProjects = computed(() => sortedProjects.value.filter(p=>!p.completed));
    const finishedProjects = computed(() => sortedProjects.value.filter(p=>p.completed));
    function setProjectCompleted(project,completed){ project.completed=!!completed; project.completedAt=completed?today.value:''; }
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
    const rewardForm = reactive({ open: false, id: null, name: '', cost: 50, category: '', conditions: [] });
    function addRewardCondition() { rewardForm.conditions.push({id:uid(),text:'',done:false}); }
    function rewardConditionsMet(r) { return (r.conditions||[]).every(c=>c.done); }
    function canClaimReward(r) { return balance.value + (Number(r.saved)||0) >= r.cost && rewardConditionsMet(r); }

    function openRewardForm(reward = null) {
      if (reward) Object.assign(rewardForm, { id: reward.id, name: reward.name, cost: reward.cost, category: reward.category || '', conditions:clone(reward.conditions||[]) });
      else Object.assign(rewardForm, { id: null, name: '', cost: 50, category: '', conditions:[] });
      rewardForm.open = true;
    }

    function saveReward() {
      const name = rewardForm.name.trim();
      if (!name) return;
      const payload = { name, cost: Math.max(1, Number(rewardForm.cost) || 1), category: rewardForm.category || '', conditions:rewardForm.conditions.filter(c=>String(c.text||'').trim()).map(c=>({id:c.id||uid(),text:String(c.text).trim(),done:!!c.done})) };
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
      data.trash.unshift({id:uid(),type:'reward',deletedAt:new Date().toISOString(),payload:clone(reward)});
      data.rewards = data.rewards.filter(r => r.id !== reward.id);
    }

    function claimReward(reward) {
      const reserved = Number(reward.saved)||0;
      if (!canClaimReward(reward)) { notify("Points insuffisants ou conditions non validées"); return; }
      data.spent += reward.cost;
      reward.saved=0;
      const achievedConditions = clone(reward.conditions||[]);
      (reward.conditions||[]).forEach(c=>{c.done=false;});
      data.inventory.unshift({
        id: uid(), rewardId:reward.id, name: reward.name, category: reward.category || '', cost: reward.cost, conditions:achievedConditions, date: todayStr(), used: false, usedAt:'',
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

    function setInventoryUsed(item,used){item.used=!!used;item.usedAt=used?todayStr():'';}

    function deleteInv(item) {
      if (!confirm(`Retirer « ${item.name} » de l'inventaire ? (Les points ne sont pas rendus.)`)) return;
      data.trash.unshift({id:uid(),type:'inventory',deletedAt:new Date().toISOString(),payload:clone(item),refunded:false});
      data.inventory = data.inventory.filter(i => i.id !== item.id);
    }

    function refundInv(item) {
      if (!confirm(`Retirer « ${item.name} » et rendre ${item.cost} pts ?`)) return;
      data.spent = Math.max(0, data.spent - item.cost);
      data.trash.unshift({id:uid(),type:'inventory',deletedAt:new Date().toISOString(),payload:clone(item),refunded:true});
      data.inventory = data.inventory.filter(i => i.id !== item.id);
      notify(`+${item.cost} pts remboursés`);
    }

    /* ---------- Habitudes et routines ---------- */
    const habitForm = reactive({open:false,id:null,title:'',frequency:'daily',weekdays:[],every:2,weeklyTarget:3,startDate:'',endDate:'',completed:false,basePoints:1,comboPoints:0.25,maxPoints:10,malus:false,quantityEnabled:false,quantityMax:3,quantityBonus:0.10});
    const habitWeekdays = [{id:1,label:'Lun'},{id:2,label:'Mar'},{id:3,label:'Mer'},{id:4,label:'Jeu'},{id:5,label:'Ven'},{id:6,label:'Sam'},{id:0,label:'Dim'}];
    function openHabitForm(habit = null) {
      Object.assign(habitForm, habit ? {open:true,id:habit.id,title:habit.title,frequency:habit.frequency,weekdays:[...(habit.weekdays||[])],every:habit.every||2,weeklyTarget:habit.weeklyTarget||3,startDate:habit.startDate||habit.createdAt||todayStr(),endDate:habit.endDate||'',completed:!!habit.completed,basePoints:habit.basePoints??0,malus:!!habit.malus,comboPoints:habit.comboPoints??0,maxPoints:habit.maxPoints??'',quantityEnabled:!!habit.quantityEnabled,quantityMax:habit.quantityMax||3,quantityBonus:habit.quantityBonus??0.10} : {open:true,id:null,title:'',frequency:'daily',weekdays:[],every:2,weeklyTarget:3,startDate:todayStr(),endDate:'',completed:false,basePoints:1,comboPoints:0.25,maxPoints:10,malus:false,quantityEnabled:false,quantityMax:3,quantityBonus:0.10});
    }
    function saveHabit() {
      const title = habitForm.title.trim(); if (!title) return;
      if(habitForm.endDate && habitForm.endDate < habitForm.startDate) { notify("La date de fin doit être après la date de début"); return; }
      const fields = {title,frequency:habitForm.frequency,weekdays:[...habitForm.weekdays],every:Math.max(1,Number(habitForm.every)||2),weeklyTarget:Math.max(1,Math.min(7,Number(habitForm.weeklyTarget)||3)),startDate:habitForm.startDate||todayStr(),endDate:habitForm.endDate||'',completed:!!habitForm.completed,malus:!!habitForm.malus,basePoints:Math.max(0,Number(habitForm.basePoints)||0),comboPoints:Math.max(0,Number(habitForm.comboPoints)||0),maxPoints:habitForm.maxPoints === '' || habitForm.maxPoints === null ? null : Math.max(0,Number(habitForm.maxPoints)||0),quantityEnabled:!!habitForm.quantityEnabled,quantityMax:Math.max(1,Number(habitForm.quantityMax)||1),quantityBonus:Math.max(0,Number(habitForm.quantityBonus)||0)};
      if (habitForm.id) {const h=data.habits.find(x=>x.id===habitForm.id);if(h) { if (!h.pointAwards) h.pointAwards = Object.fromEntries(habitAwards(h).map(a=>[a.date,a.points])); Object.assign(h,fields); }}
      else data.habits.push({id:uid(),...fields,createdAt:todayStr(),history:[],postponed:[]});
      habitForm.open=false;
    }
    const dayDiff = (a,b) => Math.round((Date.parse(b+'T12:00:00Z')-Date.parse(a+'T12:00:00Z'))/86400000);
    const monday = date => {const d=new Date(date+'T12:00:00Z'); d.setUTCDate(d.getUTCDate()-(d.getUTCDay()+6)%7);return d.toISOString().slice(0,10);};
    function habitPenaltiesToday(h) {return (h.penalties||[]).filter(x=>x.date===today.value).length;}
    function penalizeHabit(h) {
      if(!h.malus || habitIsFinished(h) || (h.startDate||h.createdAt||today.value)>today.value)return;
      const points=Math.max(0,Number(h.basePoints)||0);
      if(!points)return notify('Définis un malus supérieur à zéro');
      if(!Array.isArray(h.penalties))h.penalties=[];
      h.penalties.push({id:uid(),date:today.value,points});
      notify('−'+points+' pts · '+h.title);
    }
    function undoHabitPenalty(h) {
      const i=(h.penalties||[]).map((p,i)=>({p,i})).filter(x=>x.p.date===today.value).pop();
      if(i && confirm('Annuler le dernier malus du jour ?'))h.penalties.splice(i.i,1);
    }
    function habitAwards(h) {
      const dates=[...new Set(h.history||[])].filter(d=>d && d>=(h.startDate||h.createdAt||'0000')).sort();
      let streak=0,previous='';
      return dates.map(date=>{
        // Une série quotidienne est rompue si un jour manque. Les autres fréquences
        // comptent les réalisations consécutives du planning, sans jour obligatoire entre deux.
        if(h.frequency==='daily' && previous && dayDiff(previous,date)!==1)streak=0;
        streak++;previous=date;
        const calculated=Math.max(0,Number(h.basePoints)||0)+Math.max(0,Number(h.comboPoints)||0)*(streak-1);
        const limit = h.maxPoints === undefined || h.maxPoints === null || h.maxPoints === '' ? Infinity : Math.max(0,Number(h.maxPoints)||0);
        const awarded = h.pointAwards && Object.prototype.hasOwnProperty.call(h.pointAwards,date) ? h.pointAwards[date] : Math.round(Math.min(calculated,limit)*100)/100;
        return {date,points:awarded,streak};
      });
    }
    function habitIsFinished(h) { return !!h.completed || !!(h.endDate && h.endDate < today.value); }
    function markHabitFinished(h) { if(!confirm('Marquer cette routine comme terminée ?'))return; h.completed=true; h.endDate=h.endDate||today.value; }
    function habitLateDays(h){
      if(h.malus || habitIsFinished(h))return 0;
      const start=h.startDate||h.createdAt||today.value;
      if(start>today.value || habitDoneToday(h))return 0;
      const last=[...(h.history||[])].filter(d=>d<today.value).sort().pop();
      const from=last||start;
      let n=0;
      for(let i=last?1:0;i<=Math.min(3650,dayDiff(from,today.value));i++){
        const d=new Date(from+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+i);
        const day=d.toISOString().slice(0,10);
        if(day>=today.value||day<start||(h.postponed||[]).includes(day))continue;
        const dow=d.getUTCDay();
        if(h.frequency==='daily'||h.frequency==='weekdays'&&(h.weekdays||[]).includes(dow)||h.frequency==='interval'&&dayDiff(start,day)%Math.max(1,h.every||2)===0)n++;
      }
      return h.frequency==='weekly'?Math.max(0,Math.floor(dayDiff(start,today.value)/7)*(h.weeklyTarget||3)-(h.history||[]).length):n;
    }
    function habitQuantity(h){
      if(!h.quantityEnabled)return null;
      const day=(h.dailyQuantities||{})[today.value]||{};
      return {done:day.done??0,max:day.max??h.quantityMax??1};
    }
    function setHabitQuantity(h,field,value){
      if(!h.dailyQuantities)h.dailyQuantities={};
      const day=h.dailyQuantities[today.value]||{done:0,max:h.quantityMax||1};
      day[field]=Math.max(field==='max'?1:0,Number(value)||0);
      if(day.done>day.max)day.done=day.max;
      h.dailyQuantities[today.value]=day;
    }
    function habitDoneToday(h) {return (h.history||[]).includes(today.value);}
    function habitDue(h) {
      if(habitIsFinished(h))return false;
      if(h.malus)return (h.startDate||h.createdAt||today.value)<=today.value;
      if ((h.startDate||h.createdAt||today.value)>today.value) return false;
      if (habitDoneToday(h)) return true;
      if (h.forceDue === today.value) return true;
      if ((h.postponed||[]).includes(today.value)) return false;
      const dow = new Date(today.value+'T12:00:00Z').getUTCDay();
      if (h.frequency==='weekdays') return (h.weekdays||[]).includes(dow);
      if (h.frequency==='interval') return dayDiff(h.startDate||h.createdAt||today.value,today.value)%Math.max(1,h.every||2)===0;
      if (h.frequency==='weekly') return (h.history||[]).filter(d=>monday(d)===monday(today.value)).length < (h.weeklyTarget||3);
      return true;
    }
    const dashboardHabits = computed(() => data.habits.filter(h=>habitDue(h)||habitLateDays(h)>0));
    function completeHabit(h) {
      if(h.malus || habitIsFinished(h))return;
      if ((h.startDate||h.createdAt||today.value)>today.value || habitDoneToday(h)) return;
      if (!confirm('Confirmer la réalisation de « '+h.title+' » aujourd’hui ?')) return;
      if (!Array.isArray(h.history)) h.history=[];
      h.history.push(today.value);
      if (!h.pointAwards) h.pointAwards={};
      const baseAward=habitAwards(h).find(a=>a.date===today.value)?.points ?? 0;
      const q=habitQuantity(h);
      // Bonus proportionnel aux unités effectuées, même si l'objectif n'est pas atteint.
      h.pointAwards[today.value]=Math.round((baseAward+(q ? q.done*Math.max(0,Number(h.quantityBonus)||0) : 0))*100)/100;
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
    function undoHabit(h) { if(!confirm('Annuler la réalisation du jour ?'))return; h.history=(h.history||[]).filter(d=>d!==today.value); if(h.pointAwards)delete h.pointAwards[today.value]; }
    function deleteHabit(h) {if(confirm('Supprimer cette habitude et son historique ?')) {data.trash.unshift({id:uid(),type:'habit',deletedAt:new Date().toISOString(),payload:clone(h)});data.habits=data.habits.filter(x=>x.id!==h.id);}}
    const habitCount = h => (h.history||[]).length;

    /* ---------- Idées d'activités ---------- */
    const activityForm=reactive({open:false,id:null,title:'',points:10});
    function openActivityForm(a=null){Object.assign(activityForm,a?{open:true,id:a.id,title:a.title,points:a.points??10}:{open:true,id:null,title:'',points:10});}
    function saveActivity(){const title=activityForm.title.trim();if(!title)return;const payload={title,points:Math.max(0,Number(activityForm.points)||0)};
      const existing=data.activities.find(a=>a.id===activityForm.id);if(existing)Object.assign(existing,payload);else data.activities.push({id:uid(),...payload});activityForm.open=false;}
    function deleteActivity(a){if(confirm('Supprimer cette idée ?')){data.trash.unshift({id:uid(),type:'activity',deletedAt:new Date().toISOString(),payload:clone(a)});data.activities=data.activities.filter(x=>x.id!==a.id);}}
    function createFromActivity(a){data.tasks.push(newTask({title:a.title,points:a.points||0,scope:'personal',due:today.value}));notify('Tâche créée : '+a.title);view.value='all';}

    /* ---------- Défis personnalisables ---------- */
    // Les défis attribuent des points à la première réussite d'une période.
    // Les récompenses déjà attribuées ne changent pas lors de la modification d'un défi.
    const CHALLENGE_KINDS = [
      {id:'task-count',label:'Terminer X tâches'},
      {id:'all-tasks',label:'Terminer toutes les tâches prévues'},
      {id:'habit-count',label:'Effectuer X habitudes'},
      {id:'all-habits',label:'Effectuer toutes les habitudes prévues'},
      {id:'project-count',label:'Terminer X tâches d’un projet'},
      {id:'selected-tasks',label:'Terminer les tâches sélectionnées'},
      {id:'level-deadline',label:'Terminer les tâches d’une urgence / difficulté avant une date'}
    ];
    const challengeForm = reactive({open:false,id:null,name:'',kind:'task-count',scope:'personal',projectId:'',target:5,period:'daily',points:10,enabled:true,selectedTaskIds:[],urgency:'',difficulty:'',deadline:''});
    function openChallengeForm(ch = null) {
      Object.assign(challengeForm, ch ? {
        open:true,id:ch.id,name:ch.name,kind:ch.kind,scope:ch.scope||'personal',
        projectId:ch.projectId||'',target:ch.target||1,period:ch.period||'daily',
        points:ch.points||0,enabled:ch.enabled!==false,selectedTaskIds:[...(ch.selectedTaskIds||[])],urgency:ch.urgency||'',difficulty:ch.difficulty||'',deadline:ch.deadline||''
      } : {open:true,id:null,name:'',kind:'task-count',scope:'personal',projectId:'',target:5,period:'daily',points:10,enabled:true,selectedTaskIds:[],urgency:'',difficulty:'',deadline:''});
    }
    function saveChallenge() {
      const name=String(challengeForm.name||'').trim();
      const target=Math.floor(Number(challengeForm.target));
      const points=Number(challengeForm.points);
      if (!name || !Number.isFinite(points) || points<0 || !Number.isFinite(target) || target<1 || target>100000) {notify('Nom, objectif et points invalides');return;}
      if (challengeForm.kind==='selected-tasks' && !challengeForm.selectedTaskIds.length) {notify('Sélectionne au moins une tâche');return;}
      if (challengeForm.kind==='level-deadline' && (!challengeForm.deadline || (!challengeForm.urgency && !challengeForm.difficulty))) {notify('Indique une date et au moins un niveau');return;}
      if (challengeForm.kind==='project-count' && !data.projects.some(p=>p.id===challengeForm.projectId)) {notify('Sélectionne un projet');return;}
      const fields={name,kind:challengeForm.kind,scope:challengeForm.scope,projectId:challengeForm.kind==='project-count'?challengeForm.projectId:'',target,period:['selected-tasks','level-deadline'].includes(challengeForm.kind)?'once':challengeForm.period,points:Math.round(points*100)/100,enabled:challengeForm.enabled,selectedTaskIds:[...challengeForm.selectedTaskIds],urgency:challengeForm.urgency,difficulty:challengeForm.difficulty,deadline:challengeForm.deadline,deadlineTaskIds:challengeForm.kind==='level-deadline'?data.tasks.filter(t=>(!challengeForm.urgency||t.urgency===challengeForm.urgency)&&(!challengeForm.difficulty||t.difficulty===challengeForm.difficulty)).map(t=>t.id):[]};
      if (challengeForm.id) {
        const item=data.challenges.find(c=>c.id===challengeForm.id);
        if(item) Object.assign(item,fields,{activationDate:today.value,hiddenHome:false});
      } else data.challenges.push({id:uid(),...fields,activationDate:today.value});
      challengeForm.open=false;
      evaluateChallenges();
    }
    function deleteChallenge(c) {
      if(!confirm('Supprimer ce défi ? Les points déjà gagnés seront conservés.'))return;
      data.challenges=data.challenges.filter(x=>x.id!==c.id);
    }
    function hideChallengeHome(c) { const original=data.challenges.find(x=>x.id===c.id); if(original) original.hiddenHome=true; }
    function toggleChallenge(c) {c.enabled=!c.enabled;if(c.enabled){c.activationDate=today.value;evaluateChallenges();}}
    const weekStart = date => {
      const d=new Date(date+'T12:00:00Z'); d.setUTCDate(d.getUTCDate()-(d.getUTCDay()+6)%7);
      return d.toISOString().slice(0,10);
    };
    const challengePeriodKey = (c,date) => c.period==='once'?'once':c.period==='weekly'?weekStart(date):date;
    function challengeProgress(c, date=today.value) {
      const start=c.period==='weekly'?weekStart(date):date;
      const end=c.period==='weekly' ? (()=>{const d=new Date(start+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+6);return d.toISOString().slice(0,10);})() : date;
      const scopeOk=t=>c.scope==='both'||(c.scope==='work'?t.scope==='work':t.scope!=='work');
      const completed=t=>t.status==='done'&&t.doneAt>=start&&t.doneAt<=end;
      if(c.kind==='selected-tasks') {
        const ids=c.selectedTaskIds||[];
        const tasks=ids.map(id=>data.tasks.find(t=>t.id===id));
        const done=tasks.filter(t=>t&&t.status==='done').length;
        return {current:done,target:ids.length,complete:ids.length>0&&done===ids.length};
      }
      if(c.kind==='level-deadline') {
        const tasks=data.tasks.filter(t=>!Array.isArray(c.deadlineTaskIds)||c.deadlineTaskIds.includes(t.id)).filter(t=>
          (!c.urgency||t.urgency===c.urgency)&&(!c.difficulty||t.difficulty===c.difficulty));
        const done=tasks.filter(t=>t.status==='done'&&t.doneAt && t.doneAt<=c.deadline).length;
        return {current:done,target:tasks.length,complete:tasks.length>0&&done===tasks.length && today.value<=c.deadline};
      }
      if(c.kind==='all-habits'||c.kind==='habit-count') {
        // Une habitude prévue aujourd'hui compte dans le dénominateur.
        // Pour la semaine, les réalisations de la semaine sont comptées par habitude.
        const valid=data.habits.filter(h=> c.period==='weekly' ? true : habitDue(h));
        const done=valid.filter(h=>(h.history||[]).some(d=>d>=start&&d<=end)).length;
        const goal=c.kind==='all-habits'?valid.length:c.target;
        return {current:done,target:goal,complete:goal>0&&done>=goal};
      }
      if(c.kind==='project-count') {
        const n=data.tasks.filter(t=>t.projectId===c.projectId&&completed(t)).length;
        return {current:n,target:c.target,complete:n>=c.target};
      }
      const relevant=data.tasks.filter(scopeOk);
      if(c.kind==='all-tasks') {
        // Toutes les tâches dont l'échéance est dans la période, plus les retards
        // à terminer pendant cette période. Aucune tâche = défi non validé.
        const due=relevant.filter(t=>t.due&&t.due<=end && (t.status!=='done'||t.doneAt>=start));
        const done=due.filter(t=>t.status==='done'&&t.doneAt<=end).length;
        return {current:done,target:due.length,complete:due.length>0&&done===due.length};
      }
      const n=relevant.filter(completed).length;
      return {current:n,target:c.target,complete:n>=c.target};
    }
    const currentChallenges = computed(()=>data.challenges.map(c=>{
      const progress=challengeProgress(c);
      const award=data.challengeAwards.find(a=>a.challengeId===c.id&&a.periodKey===challengePeriodKey(c,today.value));
      return {...c,...progress,awarded:!!award};
    }));
    const challengeHistory = computed(()=>[...data.challengeAwards].sort((a,b)=>(b.date||'').localeCompare(a.date||'')));
    let evaluatingChallenges=false;
    function evaluateChallenges() {
      if(evaluatingChallenges) return;
      evaluatingChallenges=true;
      try {
        for(const c of data.challenges) {
          if(c.enabled===false)continue;
          const key=challengePeriodKey(c,today.value);
          // Un nouveau défi ne peut pas accorder des points pour les périodes passées.
          if(key < challengePeriodKey(c,c.activationDate||today.value))continue;
          if(data.challengeAwards.some(a=>a.challengeId===c.id&&a.periodKey===key))continue;
          if(!challengeProgress(c).complete)continue;
          data.challengeAwards.push({id:uid(),challengeId:c.id,challengeName:c.name,periodKey:key,date:today.value,points:Number(c.points)||0});
          notify('Défi réussi : '+c.name+' (+'+c.points+' pts)');
        }
      } finally {evaluatingChallenges=false;}
    }
    watch(data,()=>evaluateChallenges(),{deep:true,flush:'post'});
    watch(today,()=>evaluateChallenges());
    // Un défi peut devenir validé lors du chargement des données distantes.
    // On attend la première synchronisation pour évaluer lors de l'ouverture.

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

    // Planning repas : 7 jours, lundi à dimanche. Les déplacements échangent les deux cases.
    const menuWeekOffset = ref(0);
    const menuDragged = ref(null);
    const menuDays = ['Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi','Dimanche'];
    const menuWeekStart = computed(() => {
      const d=new Date(today.value+'T12:00:00');
      d.setDate(d.getDate()-((d.getDay()+6)%7)+7*menuWeekOffset.value);
      return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    });
    const menuWeekDays = computed(() => menuDays.map((label,i)=>{
      const d=new Date(menuWeekStart.value+'T12:00:00');d.setDate(d.getDate()+i);
      const date=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      return {date,label};
    }));
    function mealSlot(date,kind) {
      return data.weeklyMenus[date]?.[kind] || {name:'',state:''};
    }
    function setMeal(date,kind,field,value){
      if(!data.weeklyMenus[date])data.weeklyMenus[date]={};
      if(!data.weeklyMenus[date][kind])data.weeklyMenus[date][kind]={name:'',state:''};
      data.weeklyMenus[date][kind][field]=value;
      if(field==='name') data.weeklyMenus[date][kind].state='';
    }
    function dragMeal(event,date,kind){menuDragged.value={date,kind};event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain',date+':'+kind);}
    function dropMeal(event,date,kind){
      event.preventDefault();const from=menuDragged.value;menuDragged.value=null;
      if(!from||(from.date===date&&from.kind===kind))return;
      const a=clone(mealSlot(from.date,from.kind)),b=clone(mealSlot(date,kind));
      if(!data.weeklyMenus[from.date])data.weeklyMenus[from.date]={};
      if(!data.weeklyMenus[date])data.weeklyMenus[date]={};
      data.weeklyMenus[from.date][from.kind]=b;
      data.weeklyMenus[date][kind]=a;
    }
    function setMealState(date,kind,state){setMeal(date,kind,'state',mealSlot(date,kind).state===state?'':state);}
    // Catalogue repas, ingrédients et courses
    const menuTab=ref('planning');
    const dishQuery=ref(''), ingredientQuery=ref(''), dishIngredientQuery=ref(''), shoppingQuery=ref('');
    const dishDraft=reactive({name:'',ingredientIds:[]});
    const ingredientDraft=ref(''), ingredientCategoryDraft=ref('Sans catégorie'), newIngredientCategory=ref('');
    const ingredientLocationDraft=ref(''), newIngredientLocation=ref('');
    const ingredientLocationList=computed(()=>[...new Set([...(data.ingredientLocations||[]),...data.ingredients.map(i=>i.location).filter(Boolean)])]);
    function addIngredientLocation(){const name=newIngredientLocation.value.trim();if(!name)return;if(!data.ingredientLocations.some(x=>x.toLocaleLowerCase()===name.toLocaleLowerCase()))data.ingredientLocations.push(name);ingredientLocationDraft.value=name;newIngredientLocation.value='';}
    const shoppingDraft=ref(''), shoppingQuantityDraft=ref(''), shoppingIngredientId=ref(''), shoppingAddMode=ref('free'), shoppingIngredientSearch=ref('');
    const shoppingCategoryDraft=ref('Sans catégorie'),shoppingStoreDraft=ref(''),shoppingStoreFilter=ref('');
    const shoppingStores=computed(()=>[...new Set(data.shoppingItems.map(i=>String(i.store||'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'fr')));
    const shoppingIngredientChoices=computed(()=>data.ingredients.filter(i=>String(i.name||'').toLocaleLowerCase().includes(shoppingIngredientSearch.value.trim().toLocaleLowerCase())).sort((a,b)=>a.name.localeCompare(b.name,'fr')));
    watch(shoppingAddMode,()=>{shoppingIngredientId.value='';shoppingDraft.value='';});
    const pendingMeal=ref(null), shoppingCategoryDragged=ref('');
    const normalizeIngredientCategory = i => i?.category || 'Sans catégorie';
    const ingredientCategoryList=computed(()=>[...new Set(['Sans catégorie',...(Array.isArray(data.ingredientCategories)?data.ingredientCategories:[]).filter(c=>typeof c==='string'&&c.trim()),...(Array.isArray(data.ingredients)?data.ingredients:[]).filter(Boolean).map(normalizeIngredientCategory)])]);
    const groupedDishIngredients=computed(()=>ingredientCategoryList.value.map(name=>({name,items:dishIngredientChoices.value.filter(i=>normalizeIngredientCategory(i)===name)})).filter(g=>g.items.length));
    const groupedIngredients=computed(()=>ingredientCategoryList.value.map(name=>({name,items:filteredIngredients.value.filter(i=>normalizeIngredientCategory(i)===name)})).filter(g=>g.items.length));
    const groupedShopping=computed(()=>ingredientCategoryList.value.map(name=>({name,items:shoppingVisible.value.filter(x=>{const i=data.ingredients.find(i=>i.id===x.ingredientId);return (i?normalizeIngredientCategory(i):(x.category||'Sans catégorie'))===name})})).filter(g=>g.items.length));
    const shoppingVisible=computed(()=>data.shoppingItems.filter(x=>String(x.name||'').toLocaleLowerCase().includes(shoppingQuery.value.toLocaleLowerCase()) && (!shoppingStoreFilter.value || (shoppingStoreFilter.value==='__none'?!x.store:x.store===shoppingStoreFilter.value))));
    const filteredDishes=computed(()=>data.dishes.filter(x=>x.name.toLocaleLowerCase().includes(dishQuery.value.toLocaleLowerCase())).sort((a,b)=>a.name.localeCompare(b.name,'fr')));
    const dishIngredientChoices=computed(()=>(Array.isArray(data.ingredients)?data.ingredients:[]).filter(x=>x&&String(x.name||'').toLocaleLowerCase().includes(dishIngredientQuery.value.toLocaleLowerCase())));
    const filteredIngredients=computed(()=>(Array.isArray(data.ingredients)?data.ingredients:[]).filter(x=>x&&String(x.name||'').toLocaleLowerCase().includes(ingredientQuery.value.toLocaleLowerCase())).sort((a,b)=>String(a.name||'').localeCompare(String(b.name||''),'fr')));
    function addIngredientCategory(){const name=newIngredientCategory.value.trim();if(!name)return;if(!data.ingredientCategories.some(x=>x.toLocaleLowerCase()===name.toLocaleLowerCase()))data.ingredientCategories.push(name);ingredientCategoryDraft.value=name;newIngredientCategory.value='';}
    function addIngredient(){const name=ingredientDraft.value.trim();if(!name)return; if(data.ingredients.some(i=>i.name.toLocaleLowerCase()===name.toLocaleLowerCase())){notify('Ingrédient déjà présent');return;}data.ingredients.push({id:uid(),name,category:ingredientCategoryDraft.value||'Sans catégorie',owned:false,location:ingredientLocationDraft.value});ingredientDraft.value='';}
    function setIngredientOwned(i,owned){i.owned=owned;if(owned)data.shoppingItems=data.shoppingItems.filter(x=>x.ingredientId!==i.id);}
    function moveShoppingCategory(target){const from=shoppingCategoryDragged.value;shoppingCategoryDragged.value='';if(!from||from===target)return;const order=data.ingredientCategories;const src=order.indexOf(from),dest=order.indexOf(target);if(src<0||dest<0)return;order.splice(src,1);order.splice(dest,0,from);}
    function addDish(){const name=dishDraft.name.trim();if(!name)return;data.dishes.push({id:uid(),name,ingredientIds:[...new Set(dishDraft.ingredientIds)]});dishDraft.name='';dishDraft.ingredientIds=[];}
    function dishName(id){return data.dishes.find(d=>d.id===id)?.name||'';}
    function dishIngredients(dish){return (dish?.ingredientIds||[]).map(id=>data.ingredients.find(i=>i.id===id)).filter(Boolean);}
    function assignDish(date,kind,dishId){
      if(!dishId){setMeal(date,kind,'dishId','');setMeal(date,kind,'name','');return;}
      const dish=data.dishes.find(d=>d.id===dishId);if(!dish)return;
      const missing=dishIngredients(dish).filter(i=>!i.owned);
      if(missing.length){pendingMeal.value={date,kind,dishId,missingIds:missing.map(i=>i.id)};return;}
      commitDish(date,kind,dish);
    }
    function commitDish(date,kind,dish){setMeal(date,kind,'name',dish.name);setMeal(date,kind,'dishId',dish.id);}
    function confirmDishMissing(){
      const p=pendingMeal.value;if(!p)return;
      const dish=data.dishes.find(d=>d.id===p.dishId);if(!dish){pendingMeal.value=null;return;}
      const key=p.date+':'+p.kind;
      dishIngredients(dish).filter(i=>!i.owned).forEach(i=>{
        let item=data.shoppingItems.find(s=>s.ingredientId===i.id&&!s.checked&&!s.store);
        if(item){item.sourceKeys=[...new Set([...(item.sourceKeys||[]),key])];}
        else data.shoppingItems.push({id:uid(),name:i.name,ingredientId:i.id,manual:false,checked:false,quantity:'',store:'',category:normalizeIngredientCategory(i),sourceKeys:[key]});
      });
      commitDish(p.date,p.kind,dish);pendingMeal.value=null;
    }
    function addShoppingItem(){
      const selected=shoppingAddMode.value==='ingredient'?data.ingredients.find(i=>i.id===shoppingIngredientId.value):null;
      const name=shoppingAddMode.value==='ingredient'?selected?.name:shoppingDraft.value.trim();
      if(!name){notify(shoppingAddMode.value==='ingredient'?'Sélectionne un ingrédient':'Saisis le nom de l’article');return;}
      const store=shoppingStoreDraft.value.trim();
      // Plusieurs lignes du même ingrédient sont permises pour des magasins différents.
      const existing=selected?data.shoppingItems.find(x=>x.ingredientId===selected.id && String(x.store||'').toLocaleLowerCase()===store.toLocaleLowerCase() && !x.checked):null;
      if(existing){if(shoppingQuantityDraft.value.trim())existing.quantity=shoppingQuantityDraft.value.trim();notify('Ingrédient déjà présent pour ce magasin : quantité mise à jour');}
      else data.shoppingItems.push({id:uid(),name,ingredientId:selected?.id||'',category:selected?normalizeIngredientCategory(selected):shoppingCategoryDraft.value,store,manual:true,checked:false,quantity:shoppingQuantityDraft.value.trim(),sourceKeys:[]});
      shoppingDraft.value='';shoppingQuantityDraft.value='';shoppingIngredientId.value='';
    }
    function addIngredientToShopping(i){const existing=data.shoppingItems.find(s=>s.ingredientId===i.id&&!s.store&&!s.checked);if(!existing)data.shoppingItems.push({id:uid(),name:i.name,ingredientId:i.id,category:normalizeIngredientCategory(i),store:'',manual:true,checked:false,quantity:'',sourceKeys:[]});else notify('Déjà présent sans magasin : ajoute-le depuis les courses pour choisir un magasin');}
    function checkShoppingItem(item){item.checked=!item.checked;if(item.checked&&item.ingredientId){const i=data.ingredients.find(x=>x.id===item.ingredientId);if(i)setIngredientOwned(i,true);}}
    function removeShoppingItem(item){data.trash.unshift({id:uid(),type:'shopping',deletedAt:new Date().toISOString(),payload:clone(item)});data.shoppingItems=data.shoppingItems.filter(x=>x.id!==item.id);}
    function removeDish(dish){if(!confirm('Supprimer le plat « '+dish.name+' » ? Les menus déjà planifiés conservent leur libellé.'))return;data.trash.unshift({id:uid(),type:'dish',deletedAt:new Date().toISOString(),payload:clone(dish)});data.dishes=data.dishes.filter(x=>x.id!==dish.id);}
    function removeIngredient(item){if(!confirm('Supprimer cet ingrédient du catalogue ?'))return;data.trash.unshift({id:uid(),type:'ingredient',deletedAt:new Date().toISOString(),payload:clone(item),dishIds:data.dishes.filter(d=>(d.ingredientIds||[]).includes(item.id)).map(d=>d.id)});data.ingredients=data.ingredients.filter(x=>x.id!==item.id);data.dishes.forEach(d=>d.ingredientIds=d.ingredientIds.filter(id=>id!==item.id));}
    function restoreTrash(item){
      const p=clone(item.payload);
      const maps={task:'tasks',project:'projects',ticket:'workTickets',dish:'dishes',ingredient:'ingredients',shopping:'shoppingItems',milestone:'projectMilestones',habit:'habits',activity:'activities',reward:'rewards',inventory:'inventory',textarea:'textareas',budgetEntry:'budgetEntries',budgetSwile:'budgetSwile'};
      const k=maps[item.type];if(!k)return;
      if(item.type==='milestone'&&!data.projects.some(x=>x.id===p.projectId)){notify('Restaure d’abord le projet parent');return;}
      if(item.type==='task'&&p.projectId&&!data.projects.some(x=>x.id===p.projectId)){notify('Restaure d’abord le projet parent');return;}
      if(item.type==='shopping'&&p.ingredientId&&!data.ingredients.some(x=>x.id===p.ingredientId)){notify('Restaure d’abord l’ingrédient');return;}
      const already=data[k].some(x=>x.id===p.id);
      if(!already)data[k].push(p);
      if(item.type==='project'&&item.milestones)(item.milestones||[]).forEach(m=>{if(!data.projectMilestones.some(x=>x.id===m.id))data.projectMilestones.push(m);});
      if(item.type==='ingredient'&&item.dishIds)(item.dishIds||[]).forEach(id=>{const dish=data.dishes.find(d=>d.id===id);if(dish){dish.ingredientIds=dish.ingredientIds||[];if(!dish.ingredientIds.includes(p.id))dish.ingredientIds.push(p.id);}});
      if(!already&&item.type==='task'&&p.status==='done')data.archived=(Number(data.archived)||0)-taskValue(p);
      if(!already&&item.type==='ticket')data.archived=(Number(data.archived)||0)-(p.items||[]).filter(x=>x.done).reduce((s,x)=>s+ticketItemValue(p,x),0);
      if(!already&&item.type==='inventory'&&item.refunded)data.spent=(Number(data.spent)||0)+(Number(p.cost)||0);
      data.trash=data.trash.filter(x=>x.id!==item.id);
    }
    function emptyTrash(){if(confirm('Vider définitivement la corbeille ?'))data.trash=[];}
    const todayMeals=computed(()=>({lunch:mealSlot(today.value,'lunch'),dinner:mealSlot(today.value,'dinner')}));
    const mealStats=computed(()=>{const v=Object.values(data.weeklyMenus).flatMap(day=>Object.values(day));const done=v.filter(x=>x.state==='done').length,missed=v.filter(x=>x.state==='missed').length;return {done,missed,rate:done+missed?Math.round(done/(done+missed)*100):0};});
    const habitStats=computed(()=>{
      const end=today.value, since=new Date(end+'T12:00:00Z');since.setUTCDate(since.getUTCDate()-27);
      const start=since.toISOString().slice(0,10), good=[],bad=[];
      for(const h of data.habits){const begin=[start,h.startDate||h.createdAt||start].sort().pop();const finish=[end,h.endDate||end].sort()[0];if(begin>finish)continue;
        const dates=[];for(let d=begin;d<=finish;){dates.push(d);const x=new Date(d+'T12:00:00Z');x.setUTCDate(x.getUTCDate()+1);d=x.toISOString().slice(0,10);}
        if(h.malus){const incidents=(h.penalties||[]).filter(p=>p.date>=begin&&p.date<=finish).length;bad.push({title:h.title,expected:dates.length,achieved:Math.max(0,dates.length-new Set((h.penalties||[]).filter(p=>p.date>=begin&&p.date<=finish).map(p=>p.date)).size),incidents});continue;}
        const completed=new Set((h.history||[]).filter(d=>d>=begin&&d<=finish));const postponed=new Set(h.postponed||[]);let expected=0,achieved=0;
        if(h.frequency==='weekly'){const weeks=new Map();for(const d of dates){const k=monday(d);weeks.set(k,(weeks.get(k)||0)+1);}for(const [week,count] of weeks){const target=Math.min(Number(h.weeklyTarget)||3,count);expected+=target;achieved+=Math.min(target,[...completed].filter(d=>monday(d)===week).length);}}
        else for(const d of dates){const date=new Date(d+'T12:00:00Z'),dow=date.getUTCDay();const scheduled=h.frequency==='weekdays'?(h.weekdays||[]).includes(dow):h.frequency==='interval'?dayDiff(h.startDate||h.createdAt||begin,d)%Math.max(1,Number(h.every)||2)===0:true;if((scheduled&&!postponed.has(d))||completed.has(d)){expected++;if(completed.has(d))achieved++;}}
        good.push({title:h.title,expected,achieved,incidents:0});
      }
      const summarize=items=>{const expected=items.reduce((s,x)=>s+x.expected,0),achieved=items.reduce((s,x)=>s+x.achieved,0);return {items,expected,achieved,rate:expected?Math.round(100*achieved/expected):null};};
      return {good:summarize(good),bad:summarize(bad),period:'28 derniers jours (jusqu’à aujourd’hui)'};
    });
    // Priorisation par échéance avant toute pondération : retard > aujourd'hui > futur > sans date.
    // Les tâches à échéance égale sont classées par urgence puis difficulté.
    const suggestedTasks=computed(()=>data.tasks.filter(t=>t.status!=='done'&&t.scope!=='work').map(t=>{
      const urgencyRank=levelRank(data.urgencies,t.urgency);
      const difficultyRank=levelRank(data.difficulties,t.difficulty);
      const hasDue=typeof t.due==='string' && /^\d{4}-\d{2}-\d{2}$/.test(t.due);
      const delta=hasDue?Math.round((new Date(t.due+'T12:00:00')-new Date(today.value+'T12:00:00'))/86400000):Infinity;
      const category=delta<0?0:delta===0?1:Number.isFinite(delta)?2:3;
      return {task:t,category,delta,urgencyRank,difficultyRank};
    }).sort((a,b)=>a.category-b.category || (Number.isFinite(a.delta)&&Number.isFinite(b.delta)?a.delta-b.delta:0) || b.urgencyRank-a.urgencyRank || b.difficultyRank-a.difficultyRank || String(a.task.title).localeCompare(String(b.task.title),'fr')).slice(0,5));
    function refreshPriorities(){today.value=todayStr();notify('Priorités recalculées');}
    if(typeof document!=='undefined')document.addEventListener('visibilitychange',()=>{if(!document.hidden)today.value=todayStr();});
    const milestoneDraft=reactive({});
    function addMilestone(project){const title=(milestoneDraft[project.id]||'').trim();if(!title)return;data.projectMilestones.push({id:uid(),projectId:project.id,title,done:false});milestoneDraft[project.id]='';}
    function toggleMilestone(m){m.done=!m.done;m.doneAt=m.done?today.value:'';}
    function removeMilestone(m){data.trash.unshift({id:uid(),type:'milestone',deletedAt:new Date().toISOString(),payload:clone(m)});data.projectMilestones=data.projectMilestones.filter(x=>x.id!==m.id);}
    function milestones(project){return data.projectMilestones.filter(m=>m.projectId===project.id);}
    const weekSummary=computed(()=>{const start=monday(today.value);const end=new Date(start+'T12:00:00');end.setDate(end.getDate()+6);const toDate=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;const endS=toDate(end);const tasks=data.tasks.filter(t=>t.doneAt>=start&&t.doneAt<=endS&&t.status==='done');const tickets=data.workTickets.filter(t=>t.doneAt>=start&&t.doneAt<=endS&&t.done);return {tasks:tasks.length,tickets:tickets.length,points:tasks.reduce((s,t)=>s+taskValue(t),0),meals:Array.from({length:7},(_,i)=>{const d=new Date(start+'T12:00:00');d.setDate(d.getDate()+i);const date=toDate(d);return ['lunch','dinner'].map(k=>mealSlot(date,k));}).flat().filter(m=>m.state==='done').length};});

    // V29 : dépendances, planification, calendrier, repas, budget courses, succès et widgets.
    const v29Date = (date, offset=0) => {const d=new Date(date+'T12:00:00');d.setDate(d.getDate()+offset);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
    const dashboardCatalogue=[{id:'habits',name:'Habitudes'},{id:'meals',name:'Repas du jour'},{id:'priorities',name:'Priorités suggérées'},{id:'planner',name:'Plan de journée'},{id:'tasks',name:'Tâches Aujourd’hui / À venir'}];
    const dashboardEdit=ref(false);
    function widgetVisible(id){return data.dashboardWidgets.includes(id);}
    function setWidgetVisible(id,on){data.dashboardWidgets=on?[...new Set([...data.dashboardWidgets,id])]:data.dashboardWidgets.filter(x=>x!==id);}
    function moveDashboardWidget(id,direction){const a=data.dashboardWidgets;const i=a.indexOf(id),j=i+direction;if(i<0||j<0||j>=a.length)return;[a[i],a[j]]=[a[j],a[i]];}
    const dashboardSorted=computed(()=>data.dashboardWidgets.filter(x=>dashboardCatalogue.some(w=>w.id===x)));
    const dependencyChoices=computed(()=>data.tasks.filter(t=>t.status!=='done'));
    function setTaskDependency(t,id){if(!id){t.dependsOn='';return;}if(id===t.id){notify('Une tâche ne peut dépendre d’elle-même');return;}const seen=new Set([t.id]);let cur=id;while(cur){if(seen.has(cur)){notify('Dépendance circulaire refusée');return;}seen.add(cur);cur=data.tasks.find(x=>x.id===cur)?.dependsOn||'';}t.dependsOn=id;}
    function blockingTask(t){const parent=data.tasks.find(x=>x.id===t.dependsOn);return parent&&parent.status!=='done'?parent:null;}
    const plannerDate=ref(today.value);
    const plannerCandidates=computed(()=>data.tasks.filter(t=>t.scope!=='work'&&t.status!=='done'&&!blockingTask(t)).map(t=>{
      const due=t.due||'';const days=due?Math.round((new Date(due+'T12:00:00')-new Date(plannerDate.value+'T12:00:00'))/86400000):Infinity;
      return {task:t,days,rank:levelRank(data.urgencies,t.urgency),difficulty:levelRank(data.difficulties,t.difficulty),minutes:Math.max(1,Number(t.estimatedMinutes)||30)};
    }).sort((a,b)=>(a.days<0?0:a.days===0?1:Number.isFinite(a.days)?2:3)-(b.days<0?0:b.days===0?1:Number.isFinite(b.days)?2:3)|| (Number.isFinite(a.days)&&Number.isFinite(b.days)?a.days-b.days:0)||b.rank-a.rank||b.difficulty-a.difficulty));
    const plannedTasks=computed(()=>{let remaining=Math.max(0,Number(data.dailyTimeBudget)||0);return plannerCandidates.value.filter(x=>{if(x.minutes>remaining)return false;remaining-=x.minutes;return true;});});
    const plannedMinutes=computed(()=>plannedTasks.value.reduce((sum,x)=>sum+x.minutes,0));
    const calendarMonth=ref(today.value.slice(0,7));
    const calendarDays=computed(()=>{const [y,m]=calendarMonth.value.split('-').map(Number);const count=new Date(y,m,0).getDate();return Array.from({length:count},(_,i)=>`${y}-${String(m).padStart(2,'0')}-${String(i+1).padStart(2,'0')}`);});
    function shiftCalendarMonth(n){const [y,m]=calendarMonth.value.split('-').map(Number),d=new Date(y,m-1+n,1);calendarMonth.value=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;}
    function calendarTasks(date){return data.tasks.filter(t=>t.due===date);}
    function calendarTickets(date){return data.workTickets.filter(t=>t.due===date||t.startDate===date);}
    function calendarMilestones(date){return data.projectMilestones.filter(m=>m.due===date);}
    function calendarMeals(date){return ['lunch','dinner'].map(k=>({kind:k,name:mealSlot(date,k).name})).filter(x=>x.name);}
    const calendarDrag=ref('');
    function onCalendarDrop(date){const t=data.tasks.find(t=>t.id===calendarDrag.value);if(t)t.due=date;calendarDrag.value='';}
    const availableDishes=computed(()=>data.dishes.map(d=>{const ingredients=(d.ingredientIds||[]).map(id=>data.ingredients.find(i=>i.id===id)).filter(Boolean);const missing=ingredients.filter(i=>!i.owned);return {dish:d,missing,total:ingredients.length};}).sort((a,b)=>a.missing.length-b.missing.length||a.dish.name.localeCompare(b.dish.name,'fr')));
    function suggestMeal(d){assignDish(today.value,'dinner',d.id);setTab('menu');}
    const groceryTotal=computed(()=>data.shoppingItems.reduce((s,i)=>s+(Number(i.estimatedPrice)||0),0));
    const groceryRemaining=computed(()=>Number(data.groceryBudget||0)-groceryTotal.value);
    const successDefinitions=[
      {id:'first-task',name:'Premier pas',detail:'Terminer une tâche',target:1,kind:'tasks'},
      {id:'ten-tasks',name:'Rythme établi',detail:'Terminer 10 tâches',target:10,kind:'tasks'},
      {id:'fifty-tasks',name:'Productivité',detail:'Terminer 50 tâches',target:50,kind:'tasks'},
      {id:'first-project',name:'Projet bouclé',detail:'Terminer un projet',target:1,kind:'projects'},
      {id:'five-projects',name:'Chef de projets',detail:'Terminer 5 projets',target:5,kind:'projects'},
      {id:'first-meal',name:'Aux fourneaux',detail:'Respecter 1 repas planifié',target:1,kind:'meals'},
      {id:'ten-meals',name:'Menu tenu',detail:'Respecter 10 repas planifiés',target:10,kind:'meals'}
    ];
    const successCounts=computed(()=>({tasks:data.tasks.filter(t=>t.status==='done').length,projects:data.projects.filter(p=>p.completed).length,meals:Object.values(data.weeklyMenus).reduce((n,d)=>n+['lunch','dinner'].filter(k=>d?.[k]?.state==='done').length,0)}));
    const successProgress=computed(()=>successDefinitions.map(def=>({...def,current:successCounts.value[def.kind],unlocked:successCounts.value[def.kind]>=def.target})));
    watch(successProgress,items=>{for(const def of items){if(def.unlocked&&!data.achievements.some(a=>a.id===def.id)){data.achievements.push({id:def.id,unlockedAt:today.value});}}},{immediate:true,flush:'post'});

    const goodHabitsHomeOpen = ref(true);
    const badHabitsHomeOpen = ref(true);
    return {
      dashboardCatalogue,dashboardEdit,widgetVisible,setWidgetVisible,moveDashboardWidget,dashboardSorted,dependencyChoices,setTaskDependency,blockingTask,plannerDate,plannerCandidates,plannedTasks,plannedMinutes,calendarMonth,calendarDays,shiftCalendarMonth,calendarTasks,calendarTickets,calendarMilestones,calendarMeals,calendarDrag,onCalendarDrop,availableDishes,suggestMeal,groceryTotal,groceryRemaining,successProgress,v29Date,
      menuTab,dishQuery,ingredientQuery,dishIngredientQuery,dishIngredientChoices,shoppingQuery,dishDraft,ingredientDraft,ingredientCategoryDraft,newIngredientCategory,ingredientLocationDraft,newIngredientLocation,ingredientLocationList,addIngredientLocation,ingredientCategoryList,groupedDishIngredients,groupedIngredients,groupedShopping,shoppingDraft,shoppingQuantityDraft,shoppingIngredientId,shoppingAddMode,shoppingIngredientSearch,shoppingIngredientChoices,shoppingCategoryDraft,shoppingStoreDraft,shoppingStoreFilter,shoppingStores,pendingMeal,shoppingVisible,filteredDishes,filteredIngredients,addIngredient,addIngredientCategory,setIngredientOwned,moveShoppingCategory,shoppingCategoryDragged,addIngredientToShopping,addDish,dishName,dishIngredients,assignDish,confirmDishMissing,addShoppingItem,checkShoppingItem,removeShoppingItem,removeDish,removeIngredient,restoreTrash,emptyTrash,todayMeals,mealStats,habitStats,suggestedTasks,refreshPriorities,milestoneDraft,addMilestone,toggleMilestone,removeMilestone,milestones,weekSummary,
      menuWeekOffset,menuWeekStart,menuWeekDays,mealSlot,setMeal,dragMeal,dropMeal,setMealState,menuDragged,goodHabitsHomeOpen,badHabitsHomeOpen,
      // état
      budgetMonth,budgetSection,budgetCategories,budgetCategoryName,reorderDrag,startReorder,dropReorder,cashForm,cashBalance,cashIncome,cashExpenses,addCashEntry,removeCashEntry,moveBudgetCategory,addBudgetCategory,renameBudgetCategory,deleteBudgetCategory,budgetEntryForm,budgetRecurringForm,budgetSwileForm,budgetItems,budgetDisplayItems,budgetSummary,budgetSwileSource,budgetSwileNext,recurringForMonth,money,changeBudgetMonth,monthAfter,addBudgetEntry,addBudgetRecurring,addBudgetSwile,overrideRecurring,resetRecurringOverride,removeBudgetEntry,removeBudgetRecurring,removeBudgetSwile,
      usualDragged,usualNewItem,addUsualList,removeUsualList,addUsualHeading,addUsualItem,toggleUsualItem,resetUsualList,deleteUsualItem,startUsualDrag,dropUsualItem,
      addTicketType,deleteTicketType,safeTicketUrl,
      ticketSort,ticketDragged,ticketDragStart,ticketDrop,ticketDraft,ticketInputs,collapsedTickets,isTicketCollapsed,toggleTicketCollapse,renameTicket,updateTicketItemPoints,openTickets,closedTickets,createTicket,addTicketItem,toggleTicketItem,finishTicket,reopenTicket,removeTicket,removeTicketItem,ticketPoints,ticketItemValue,doneStats,statistics,
      data, ui, view, setTab, pageTitle, today, toast, tabs: TABS, navGroups: NAV_GROUPS, statuses: STATUSES, tagStyle,
      // cloud
      firebaseReady, user, syncState, syncLabel, signIn, signOut,
      // catégories
      categories, rewardCategories, newRewardCategory, addRewardCategory, deleteRewardCategory, categoryForm, openCategoryForm, saveCategory, deleteCategory, categoryUsage, setCategoryColor,
      // urgences & difficultés
      newLevel, levelUsage, addLevel, renameLevel, setLevelColor, moveLevel, deleteLevel,
      // points
      earned, balance, challengeTotal, nextReward, favoriteReward, rewardRemaining, toggleRewardFavorite, depositReward, depositRandomReward, withdrawReward, gratitudeTotal, savedTotal, gratitudeDraft, todayGratitude, sortedGratitude, saveGratitude, deleteGratitude, workCategories, newWorkCategory, addWorkCategory, deleteWorkCategory, addWorkDifficulty, deleteWorkDifficulty, addWorkUrgency, deleteWorkUrgency, moveWorkLevel, moveTicketType, balanceForm, openBalanceForm, applyBalance, resetBalance,
      rewardFilters, visibleRewards, groupedRewards, visibleInventory, unusedInventory, usedInventory, rewardClaimCount, setInventoryUsed,
      // filtres
      filters, resetFilters, activeFilterCount, todayTasks, upcomingTasks, allTasks, workTasks, doneTasks, doneWorkTasks, copyForm, copyText, copyTaskTitles,
      // tâches
      quickForm, openQuickForm, toggleQuickForm, addQuickRow, removeQuickRow, applyQuickDue, saveQuick, pastePreview, savePaste,
      taskForm, openTaskForm, toggleTaskForm, saveTask, duplicateTask, deleteTask, changeStatus, changePoints, changeDue, updateTask, projectName,
      selection, toggleSelect, selectMany, deselectMany, editSelected, deleteSelected, bulkForm, saveBulk,
      todayPoints, upcomingPoints,
      // projets
      projectForm, openProjectForm, addDraftTask, saveProject, setProjectColor, projectTasks, projectStats, projectTopUrgency,
      sortedProjects, activeProjects, finishedProjects, setProjectCompleted, isProjectOpen, toggleProjectOpen, setAllProjectsOpen,
      projectSelection, onProjectClick, toggleProjectSelect, selectAllProjects, clearProjectSelection, editSelectedProject, deleteSelectedProjects,
      dragProject, onProjectDragStart, onProjectDragOver, onProjectDrop, onProjectDragEnd, moveProject,
      // récompenses
      rewardForm, openRewardForm, saveReward, addRewardCondition, rewardConditionsMet, canClaimReward, deleteReward, claimReward,
      // inventaire
      invForm, startEditInv, saveInv, deleteInv, refundInv,
      // données
      exportData, importData, resetAll,
      CHALLENGE_KINDS, challengeForm, openChallengeForm, saveChallenge, deleteChallenge, toggleChallenge, hideChallengeHome, currentChallenges, challengeHistory, challengeProgress,
      habitForm, habitWeekdays, openHabitForm, saveHabit, dashboardHabits, habitIsFinished, markHabitFinished, habitDue, habitDoneToday, completeHabit, postponeHabit, undoHabit, deleteHabit, habitCount, habitAwards, habitLateDays, habitQuantity, setHabitQuantity, habitTotal, habitPenaltiesToday, penalizeHabit, undoHabitPenalty,
      activityForm, openActivityForm, saveActivity, deleteActivity, createFromActivity,
      // utilitaires
      formatDate, eveningPreview, renderEveningMarkdown, addTextarea, removeTextarea, openWorkQuickPaste,
    };
  },
});

app.component('task-list', TaskList);
app.mount('#app');
