const { createApp, reactive, ref, computed, watch, nextTick, provide } = Vue;

/* ============================================================
   Constantes & utilitaires
   ============================================================ */
// V71 : reconciliation par identifiant, independante des anciens drapeaux de migration.
// N'ajoute que les exercices absents et conserve les personnalisations des exercices presents.
function ensureSportV67(exercises) {
  if (!Array.isArray(exercises)) return 0;
  const extras = Array.isArray(window.TODO_SPORT_V67) ? window.TODO_SPORT_V67 : [];
  const ids = new Set(exercises.filter(x => x && x.id).map(x => x.id));
  let added = 0;
  for (const exercise of extras) {
    if (!exercise || !exercise.id || ids.has(exercise.id)) continue;
    exercises.push(clone(exercise));
    ids.add(exercise.id);
    added++;
  }
  return added;
}

const STORAGE_KEY = 'todo-quest-v65-test-isolated';
const UI_KEY = 'todo-quest-ui-v63-test';   // préférences d'affichage (propres à chaque appareil)

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
const DEFAULT_ALTER_REVIEW_QUESTIONS = [
  { id:'enjoyed', label:'A pu profiter de sa journée' },
  { id:'clothes', label:'A choisi les habits' },
  { id:'game', label:'A choisi le jeu' },
  { id:'meal', label:'A mangé le repas' },
  { id:'music', label:'A choisi la musique' },
  { id:'interaction', label:'A interagi avec une personne qui savait que c’était lui' }
];
function normalizeAlterReviewQuestions(list) {
  if (!Array.isArray(list)) return clone(DEFAULT_ALTER_REVIEW_QUESTIONS);
  const seen = new Set();
  return list.filter(q=>q && typeof q.id==='string' && typeof q.label==='string' && q.label.trim() && !seen.has(q.id) && seen.add(q.id))
    .map(q=>({id:q.id,label:q.label.trim()}));
}

const DEFAULT_DIFFICULTIES = [
  { id: 'easy',   name: 'Facile',    color: '#22c55e' },
  { id: 'medium', name: 'Moyenne',   color: '#f59e0b' },
  { id: 'hard',   name: 'Difficile', color: '#ef4444' },
];

const PALETTE = ['#6366f1', '#22c55e', '#f59e0b', '#ef4444', '#06b6d4', '#a855f7', '#ec4899', '#84cc16'];
const nextColor = i => PALETTE[Math.abs(i) % PALETTE.length];

const TABS = [
  { id: 'home',       label: 'Accueil' },
  { id: 'calendar', label: 'Calendrier' },
  { id: 'alters', label: 'Alters' },
  { id: 'mood', label: 'Humeur & Psychologie' },
  { id: 'all',        label: 'Toutes les tâches' },
  { id: 'work',       label: 'Travail' },
  { id: 'usual-lists', label: 'Listes' },
  { id: 'menu', label: 'Menu de la semaine' },
  { id: 'sport', label: 'Sport & bien-être' },
  { id: 'wellness-report', label: 'Bilan global' },
  { id: 'shopping', label: 'Liste de courses' },
  { id: 'achievements', label: 'Succès & objectifs' },
  { id: 'trash', label: 'Corbeille' },
  { id: 'gratitude',  label: 'Gratitude' },
  { id: 'random-notes', label: 'Notes au pif' },
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
  { title: 'Tâches', ids: ['home','calendar','all','work','habits','done'] },
  { title: 'Psychologie', ids: ['alters','mood'] },
  { title: 'TCA et poids', ids: ['menu','shopping','sport','wellness-report'] },
  { title: 'Plaisir', ids: ['rewards','inventory','activities'] },
  { title: 'Autres', ids: ['gratitude','evening','random-notes','challenges','statistics','budget','usual-lists'] },
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
  // V60 : sous-tâches créditées dès leur validation, bonus parent à complétion.
  if (Array.isArray(t.subtasks) && t.subtasks.length) {
    const subtotal=t.subtasks.filter(s=>s.done).reduce((n,s)=>n+Math.max(0,Number(s.points??5)||0),0);
    const complete=t.subtasks.every(s=>s.done) && t.status==='done';
    const extra=complete ? (t.subtaskBonusMode==='multiply' ? subtotal*(Math.max(1,Number(t.subtaskBonusMultiplier)||1.5)-1) : Math.max(0,Number(t.subtaskBonusPoints??t.points)||0)) : 0;
    return (t.malus?-1:1)*Math.round((subtotal+extra)*100)/100;
  }
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
    id: uid(), title: '', category: '', points: 10, malus: false, status: 'todo', projectId: '', due: '', startDate:'', recurrence:'', subtasks:[], estimatedMinutes: null, estimatedEffort: '',
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

