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
const UI_KEY = window.TODO_QUEST_MOBILE ? 'todo-quest-ui-mobile-v1' : 'todo-quest-ui-v63-test';   // préférences d'affichage (propres à chaque appareil)

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

const SPORT_DEFAULT_EXERCISES = [
  {
    "id": "sport-default-1",
    "name": "Extension de genou assise",
    "category": "genoux",
    "description": "Tendre doucement la jambe depuis une chaise.",
    "level": "doux",
    "reps": "6 par jambe",
    "seconds": 60,
    "active": true
  },
  {
    "id": "sport-default-2",
    "name": "Contraction du quadriceps",
    "category": "genoux",
    "description": "Contracter la cuisse sans bloquer la respiration.",
    "level": "doux",
    "reps": "6 fois 3 secondes",
    "seconds": 60,
    "active": true
  },
  {
    "id": "sport-default-3",
    "name": "Lever de jambe tendue",
    "category": "genoux",
    "description": "Allongé, lever doucement une jambe.",
    "level": "doux",
    "reps": "5 par jambe",
    "seconds": 60,
    "active": true
  },
  {
    "id": "sport-default-4",
    "name": "Glissement du talon",
    "category": "genoux",
    "description": "Allongé, ramener le talon vers soi.",
    "level": "doux",
    "reps": "8 par jambe",
    "seconds": 60,
    "active": true
  },
  {
    "id": "sport-default-5",
    "name": "Montées sur les pointes",
    "category": "genoux",
    "description": "Monter les talons en tenant une chaise.",
    "level": "doux",
    "reps": "10 fois",
    "seconds": 60,
    "active": true
  },
  {
    "id": "sport-default-6",
    "name": "Lever des orteils",
    "category": "genoux",
    "description": "Relever les pointes en gardant les talons au sol.",
    "level": "doux",
    "reps": "10 fois",
    "seconds": 60,
    "active": true
  },
  {
    "id": "sport-default-7",
    "name": "Assis-debout",
    "category": "genoux",
    "description": "Se lever et se rasseoir sur une chaise stable.",
    "level": "moyen",
    "reps": "5 fois",
    "seconds": 60,
    "active": true
  },
  {
    "id": "sport-default-8",
    "name": "Mini-squat avec appui",
    "category": "genoux",
    "description": "Fléchir très légèrement les genoux avec appui.",
    "level": "moyen",
    "reps": "5 fois",
    "seconds": 60,
    "active": true
  },
  {
    "id": "sport-default-9",
    "name": "Flexion du genou debout",
    "category": "genoux",
    "description": "Ramener doucement le talon vers la fesse.",
    "level": "doux",
    "reps": "6 par jambe",
    "seconds": 60,
    "active": true
  },
  {
    "id": "sport-default-10",
    "name": "Pas sur marche basse",
    "category": "genoux",
    "description": "Monter puis descendre une marche stable.",
    "level": "moyen",
    "reps": "5 par jambe",
    "seconds": 60,
    "active": true
  },
  {
    "id": "sport-default-11",
    "name": "Lever de jambe latéral",
    "category": "genoux",
    "description": "Lever une jambe sur le côté avec appui.",
    "level": "doux",
    "reps": "6 par jambe",
    "seconds": 60,
    "active": true
  },
  {
    "id": "sport-default-12",
    "name": "Pont fessier",
    "category": "genoux",
    "description": "Allongé, soulever doucement le bassin.",
    "level": "moyen",
    "reps": "6 fois",
    "seconds": 60,
    "active": true
  },
  {
    "id": "sport-default-13",
    "name": "Marche sur place",
    "category": "mobilite",
    "description": "Marcher à allure tranquille sans avancer.",
    "level": "doux",
    "reps": "45 secondes",
    "seconds": 60,
    "active": true
  },
  {
    "id": "sport-default-14",
    "name": "Cercles de chevilles",
    "category": "mobilite",
    "description": "Faire de petits cercles avec les pieds.",
    "level": "doux",
    "reps": "6 par sens",
    "seconds": 60,
    "active": true
  },
  {
    "id": "sport-default-15",
    "name": "Flexions de cheville",
    "category": "mobilite",
    "description": "Ramener les pointes des pieds vers soi.",
    "level": "doux",
    "reps": "10 fois",
    "seconds": 60,
    "active": true
  },
  {
    "id": "sport-default-16",
    "name": "Transfert du poids",
    "category": "mobilite",
    "description": "Déplacer doucement le poids de gauche à droite.",
    "level": "doux",
    "reps": "30 secondes",
    "seconds": 60,
    "active": true
  },
  {
    "id": "sport-default-17",
    "name": "Étirement des mollets",
    "category": "mobilite",
    "description": "Étirement léger contre un mur, sans douleur.",
    "level": "doux",
    "reps": "15 secondes par côté",
    "seconds": 60,
    "active": true
  },
  {
    "id": "sport-default-18",
    "name": "Étirement arrière de cuisse",
    "category": "mobilite",
    "description": "Tendre une jambe et incliner doucement le buste.",
    "level": "doux",
    "reps": "15 secondes par côté",
    "seconds": 60,
    "active": true
  },
  {
    "id": "sport-default-19",
    "name": "Bascule du bassin",
    "category": "mobilite",
    "description": "Allongé, basculer légèrement le bassin.",
    "level": "doux",
    "reps": "8 fois",
    "seconds": 60,
    "active": true
  },
  {
    "id": "sport-default-20",
    "name": "Ouverture des hanches assise",
    "category": "mobilite",
    "description": "Ouvrir légèrement un genou puis revenir.",
    "level": "doux",
    "reps": "6 par côté",
    "seconds": 60,
    "active": true
  },
  {
    "id": "sport-default-21",
    "name": "Rotations des épaules",
    "category": "mobilite",
    "description": "Faire des cercles avec les épaules.",
    "level": "doux",
    "reps": "10 fois",
    "seconds": 60,
    "active": true
  },
  {
    "id": "sport-default-22",
    "name": "Rotation du buste assise",
    "category": "mobilite",
    "description": "Tourner légèrement le buste sans forcer.",
    "level": "doux",
    "reps": "5 par côté",
    "seconds": 60,
    "active": true
  },
  {
    "id": "sport-default-23",
    "name": "Chat-vache",
    "category": "mobilite",
    "description": "À quatre pattes, arrondir et relâcher le dos.",
    "level": "moyen",
    "reps": "6 fois",
    "seconds": 60,
    "active": true
  },
  {
    "id": "sport-default-24",
    "name": "Étirement des bras",
    "category": "mobilite",
    "description": "Tendre les bras en hauteur tranquillement.",
    "level": "doux",
    "reps": "20 secondes",
    "seconds": 60,
    "active": true
  },
  {
    "id": "sport-default-25",
    "name": "Pompes au mur",
    "category": "renfo",
    "description": "Fléchir les bras contre un mur stable.",
    "level": "doux",
    "reps": "8 fois",
    "seconds": 60,
    "active": true
  },
  {
    "id": "sport-default-26",
    "name": "Gainage debout au mur",
    "category": "renfo",
    "description": "Maintenir le corps aligné contre un mur.",
    "level": "doux",
    "reps": "20 secondes",
    "seconds": 60,
    "active": true
  },
  {
    "id": "sport-default-27",
    "name": "Serrage des omoplates",
    "category": "renfo",
    "description": "Rapprocher doucement les omoplates.",
    "level": "doux",
    "reps": "10 fois",
    "seconds": 60,
    "active": true
  },
  {
    "id": "sport-default-28",
    "name": "Lever de bras alterné",
    "category": "renfo",
    "description": "Lever un bras puis l'autre.",
    "level": "doux",
    "reps": "10 fois",
    "seconds": 60,
    "active": true
  },
  {
    "id": "sport-default-29",
    "name": "Contraction des fessiers",
    "category": "renfo",
    "description": "Contracter les fessiers puis relâcher.",
    "level": "doux",
    "reps": "8 fois 3 secondes",
    "seconds": 60,
    "active": true
  },
  {
    "id": "sport-default-30",
    "name": "Équilibre avec appui",
    "category": "renfo",
    "description": "Tenir sur un pied près d'une chaise.",
    "level": "moyen",
    "reps": "10 secondes par pied",
    "seconds": 60,
    "active": true
  },
  {
    "id": "sport-default-31",
    "name": "Pas latéraux",
    "category": "renfo",
    "description": "Faire de petits pas de côté.",
    "level": "doux",
    "reps": "6 par côté",
    "seconds": 60,
    "active": true
  },
  {
    "id": "sport-default-32",
    "name": "Boxe assise",
    "category": "renfo",
    "description": "Petits coups de poing dans le vide.",
    "level": "doux",
    "reps": "30 secondes",
    "seconds": 60,
    "active": true
  },
  {
    "id": "sport-default-33",
    "name": "Bras en croix",
    "category": "renfo",
    "description": "Lever puis baisser les bras sur les côtés.",
    "level": "doux",
    "reps": "8 fois",
    "seconds": 60,
    "active": true
  },
  {
    "id": "sport-default-34",
    "name": "Pompes inclinées",
    "category": "renfo",
    "description": "Pompes contre un plan de travail stable.",
    "level": "moyen",
    "reps": "6 fois",
    "seconds": 60,
    "active": true
  },
  {
    "id": "sport-default-35",
    "name": "Bird-dog simplifié",
    "category": "renfo",
    "description": "À quatre pattes, allonger bras ou jambe.",
    "level": "moyen",
    "reps": "5 par côté",
    "seconds": 60,
    "active": true
  },
  {
    "id": "sport-default-36",
    "name": "Contraction abdominale assise",
    "category": "renfo",
    "description": "Contracter le ventre en respirant normalement.",
    "level": "doux",
    "reps": "6 fois 4 secondes",
    "seconds": 60,
    "active": true
  },
  {
    "id": "sport-default-37",
    "name": "Danse libre douce",
    "category": "cardio",
    "description": "Danser sur une chanson, sans saut.",
    "level": "doux",
    "reps": "60 secondes",
    "seconds": 60,
    "active": true
  },
  {
    "id": "sport-default-38",
    "name": "Marche rythmée",
    "category": "cardio",
    "description": "Marcher sur place en bougeant les bras.",
    "level": "doux",
    "reps": "60 secondes",
    "seconds": 60,
    "active": true
  },
  {
    "id": "sport-default-39",
    "name": "Boxe debout légère",
    "category": "cardio",
    "description": "Enchaîner des mouvements de bras sans forcer.",
    "level": "doux",
    "reps": "45 secondes",
    "seconds": 60,
    "active": true
  },
  {
    "id": "sport-default-40",
    "name": "Pas latéraux en musique",
    "category": "cardio",
    "description": "Petits pas à droite puis à gauche.",
    "level": "doux",
    "reps": "45 secondes",
    "seconds": 60,
    "active": true
  },
  {
    "id": "sport-default-41",
    "name": "Talons-fesses doux",
    "category": "cardio",
    "description": "Alterner les talons vers l'arrière sans rebond.",
    "level": "moyen",
    "reps": "30 secondes",
    "seconds": 60,
    "active": true
  },
  {
    "id": "sport-default-42",
    "name": "Montées de genoux basses",
    "category": "cardio",
    "description": "Lever alternativement les genoux très bas.",
    "level": "moyen",
    "reps": "30 secondes",
    "seconds": 60,
    "active": true
  },
  {
    "id": "sport-default-43",
    "name": "Marche rapide sur place",
    "category": "cardio",
    "description": "Accélérer brièvement la marche sur place.",
    "level": "moyen",
    "reps": "45 secondes",
    "seconds": 60,
    "active": true
  },
  {
    "id": "sport-default-44",
    "name": "Mouvements de bras rythmés",
    "category": "cardio",
    "description": "Bouger les bras au rythme d'une musique.",
    "level": "doux",
    "reps": "60 secondes",
    "seconds": 60,
    "active": true
  },
  {
    "id": "sport-default-45",
    "name": "Danse d'une minute",
    "category": "ludique",
    "description": "Choisir une musique et bouger librement.",
    "level": "doux",
    "reps": "60 secondes",
    "seconds": 60,
    "active": true
  },
  {
    "id": "sport-default-46",
    "name": "Jeu des statues",
    "category": "ludique",
    "description": "Bouger puis s'immobiliser quelques secondes.",
    "level": "doux",
    "reps": "60 secondes",
    "seconds": 60,
    "active": true
  },
  {
    "id": "sport-default-47",
    "name": "Dessiner des cercles dans l'air",
    "category": "ludique",
    "description": "Dessiner de grands cercles avec les bras.",
    "level": "doux",
    "reps": "45 secondes",
    "seconds": 60,
    "active": true
  },
  {
    "id": "sport-default-48",
    "name": "Pas de danse au choix",
    "category": "ludique",
    "description": "Essayer un pas de danse sans saut.",
    "level": "doux",
    "reps": "60 secondes",
    "seconds": 60,
    "active": true
  },
  {
    "id": "sport-v56-01",
    "name": "Assis-debout avec pause",
    "category": "renfo",
    "description": "Depuis une chaise stable, se lever avec contrôle, marquer une pause puis se rasseoir.",
    "level": "doux",
    "reps": "5 fois, pause 2 s debout",
    "seconds": 60,
    "active": true,
    "sourceUrl": "https://www.nhs.uk/live-well/exercise/strength-exercises/"
  },
  {
    "id": "sport-v56-02",
    "name": "Montée de talon à une jambe avec appui",
    "category": "genoux",
    "description": "Tenir un support solide, lever doucement le talon sur une jambe, redescendre sans rebond.",
    "level": "moyen",
    "reps": "6 par côté",
    "seconds": 75,
    "active": true,
    "sourceUrl": "https://www.nhs.uk/live-well/exercise/strength-exercises/"
  },
  {
    "id": "sport-v56-03",
    "name": "Mini-fente arrière avec appui",
    "category": "genoux",
    "description": "Avec un support, reculer légèrement un pied et fléchir peu les genoux, puis revenir.",
    "level": "moyen",
    "reps": "5 par jambe",
    "seconds": 75,
    "active": true,
    "sourceUrl": "https://www.acefitness.org/resources/everyone/exercise-library/"
  },
  {
    "id": "sport-v56-04",
    "name": "Demi-squat lent sans charge",
    "category": "genoux",
    "description": "Pieds écartés, descendre modérément les hanches, genoux alignés avec les pieds.",
    "level": "moyen",
    "reps": "6 fois",
    "seconds": 90,
    "active": true,
    "sourceUrl": "https://www.orthoinfo.org/recovery/knee-conditioning-program/"
  },
  {
    "id": "sport-v56-05",
    "name": "Abduction de hanche allongée",
    "category": "genoux",
    "description": "Sur le côté, lever doucement la jambe supérieure, garder le bassin stable.",
    "level": "moyen",
    "reps": "6 par côté",
    "seconds": 90,
    "active": true,
    "sourceUrl": "https://www.orthoinfo.org/recovery/knee-conditioning-program/"
  },
  {
    "id": "sport-v56-06",
    "name": "Adduction de hanche allongée",
    "category": "genoux",
    "description": "Sur le côté, soulever doucement la jambe inférieure sans torsion.",
    "level": "moyen",
    "reps": "6 par côté",
    "seconds": 90,
    "active": true,
    "sourceUrl": "https://www.orthoinfo.org/recovery/knee-conditioning-program/"
  },
  {
    "id": "sport-v56-07",
    "name": "Extension de hanche sur le ventre",
    "category": "renfo",
    "description": "Allongé sur le ventre, contracter les fessiers et décoller légèrement une jambe.",
    "level": "moyen",
    "reps": "6 par jambe",
    "seconds": 90,
    "active": true,
    "sourceUrl": "https://www.orthoinfo.org/recovery/knee-conditioning-program/"
  },
  {
    "id": "sport-v56-08",
    "name": "Pont fessier avec pause",
    "category": "renfo",
    "description": "Allongé, genoux fléchis, lever le bassin et maintenir brièvement.",
    "level": "moyen",
    "reps": "8 fois, pause 2 s",
    "seconds": 90,
    "active": true,
    "sourceUrl": "https://www.acefitness.org/resources/everyone/exercise-library/"
  },
  {
    "id": "sport-v56-09",
    "name": "Pont fessier une jambe assisté",
    "category": "renfo",
    "description": "Depuis un pont, délester doucement un pied; garder le bassin horizontal.",
    "level": "difficile",
    "reps": "5 par côté",
    "seconds": 120,
    "active": true,
    "sourceUrl": "https://www.acefitness.org/resources/everyone/exercise-library/"
  },
  {
    "id": "sport-v56-10",
    "name": "Chaise contre le mur courte",
    "category": "renfo",
    "description": "Dos au mur, fléchir légèrement les genoux sans descendre trop bas.",
    "level": "moyen",
    "reps": "3 × 15 s",
    "seconds": 90,
    "active": true,
    "sourceUrl": "https://www.acefitness.org/resources/everyone/exercise-library/"
  },
  {
    "id": "sport-v56-11",
    "name": "Fente arrière contrôlée",
    "category": "renfo",
    "description": "Reculer un pied et fléchir selon l’amplitude confortable, sans impact.",
    "level": "difficile",
    "reps": "6 par jambe",
    "seconds": 120,
    "active": true,
    "sourceUrl": "https://www.acefitness.org/resources/everyone/exercise-library/"
  },
  {
    "id": "sport-v56-12",
    "name": "Squat au poids du corps",
    "category": "renfo",
    "description": "Descendre les hanches dans une amplitude confortable, dos stable et talons au sol.",
    "level": "moyen",
    "reps": "8 répétitions",
    "seconds": 90,
    "active": true,
    "sourceUrl": "https://www.acefitness.org/resources/everyone/exercise-library/"
  },
  {
    "id": "sport-v56-13",
    "name": "Squat tempo lent",
    "category": "renfo",
    "description": "Effectuer un squat sans charge avec descente contrôlée; interrompre si douleur.",
    "level": "difficile",
    "reps": "6 répétitions, descente 3 s",
    "seconds": 120,
    "active": true,
    "sourceUrl": "https://www.acefitness.org/resources/everyone/exercise-library/"
  },
  {
    "id": "sport-v56-14",
    "name": "Soulevé de bassin isométrique",
    "category": "renfo",
    "description": "Maintenir le bassin relevé en pont, sans cambrer le dos.",
    "level": "doux",
    "reps": "3 × 10 s",
    "seconds": 60,
    "active": true,
    "sourceUrl": "https://www.acefitness.org/resources/everyone/exercise-library/"
  },
  {
    "id": "sport-v56-15",
    "name": "Charnière de hanches sans charge",
    "category": "renfo",
    "description": "Incliner le buste depuis les hanches, dos neutre, puis se redresser.",
    "level": "doux",
    "reps": "8 répétitions",
    "seconds": 60,
    "active": true,
    "sourceUrl": "https://www.acefitness.org/resources/everyone/exercise-library/"
  },
  {
    "id": "sport-v56-16",
    "name": "Pompes sur les genoux",
    "category": "renfo",
    "description": "Sur tapis, mains sous épaules, abaisser doucement le buste puis pousser.",
    "level": "moyen",
    "reps": "6 répétitions",
    "seconds": 90,
    "active": true,
    "sourceUrl": "https://www.acefitness.org/resources/everyone/exercise-library/"
  },
  {
    "id": "sport-v56-17",
    "name": "Pompes classiques",
    "category": "renfo",
    "description": "En appui mains-pieds, garder le tronc aligné durant la descente.",
    "level": "difficile",
    "reps": "6 répétitions",
    "seconds": 120,
    "active": true,
    "sourceUrl": "https://www.acefitness.org/resources/everyone/exercise-library/"
  },
  {
    "id": "sport-v56-18",
    "name": "Gainage sur avant-bras",
    "category": "renfo",
    "description": "Avant-bras au sol, corps aligné; variante sur genoux possible.",
    "level": "moyen",
    "reps": "3 × 15 s",
    "seconds": 90,
    "active": true,
    "sourceUrl": "https://www.acefitness.org/resources/everyone/exercise-library/"
  },
  {
    "id": "sport-v56-19",
    "name": "Gainage latéral sur genou",
    "category": "renfo",
    "description": "Sur le côté, appui avant-bras et genou, soulever le bassin.",
    "level": "moyen",
    "reps": "2 × 15 s par côté",
    "seconds": 90,
    "active": true,
    "sourceUrl": "https://www.acefitness.org/resources/everyone/exercise-library/"
  },
  {
    "id": "sport-v56-20",
    "name": "Gainage latéral complet",
    "category": "renfo",
    "description": "En appui sur un avant-bras et les pieds, garder le corps aligné.",
    "level": "difficile",
    "reps": "2 × 20 s par côté",
    "seconds": 120,
    "active": true,
    "sourceUrl": "https://www.acefitness.org/resources/everyone/exercise-library/"
  },
  {
    "id": "sport-v56-21",
    "name": "Dead bug alterné",
    "category": "renfo",
    "description": "Sur le dos, engager le ventre et tendre bras/jambe opposés sans cambrer.",
    "level": "moyen",
    "reps": "6 par côté",
    "seconds": 90,
    "active": true,
    "sourceUrl": "https://www.acefitness.org/resources/everyone/exercise-library/"
  },
  {
    "id": "sport-v56-22",
    "name": "Bird-dog complet",
    "category": "renfo",
    "description": "À quatre pattes, tendre bras et jambe opposés en gardant le bassin stable.",
    "level": "moyen",
    "reps": "6 par côté",
    "seconds": 90,
    "active": true,
    "sourceUrl": "https://www.acefitness.org/resources/everyone/exercise-library/"
  },
  {
    "id": "sport-v56-23",
    "name": "Planche avec toucher d’épaule",
    "category": "renfo",
    "description": "En position de planche, toucher une épaule avec la main opposée sans tourner les hanches.",
    "level": "difficile",
    "reps": "8 alternances",
    "seconds": 120,
    "active": true,
    "sourceUrl": "https://www.acefitness.org/resources/everyone/exercise-library/"
  },
  {
    "id": "sport-v56-24",
    "name": "Élévation frontale avec bouteille",
    "category": "renfo",
    "description": "Lever une petite bouteille devant soi jusqu’aux épaules, lentement.",
    "level": "moyen",
    "reps": "8 répétitions",
    "seconds": 90,
    "active": true,
    "sourceUrl": "https://www.heart.org/en/healthy-living/exercise-and-physical-activity/"
  },
  {
    "id": "sport-v56-25",
    "name": "Curl biceps avec bouteilles",
    "category": "renfo",
    "description": "Coudes près du corps, plier les bras avec de petites bouteilles.",
    "level": "doux",
    "reps": "10 répétitions",
    "seconds": 75,
    "active": true,
    "sourceUrl": "https://www.heart.org/en/healthy-living/exercise-and-physical-activity/"
  },
  {
    "id": "sport-v56-26",
    "name": "Rowing avec bouteilles légères",
    "category": "renfo",
    "description": "Buste incliné dos neutre, tirer les coudes vers l’arrière avec charges légères.",
    "level": "moyen",
    "reps": "8 répétitions",
    "seconds": 90,
    "active": true,
    "sourceUrl": "https://www.heart.org/en/healthy-living/exercise-and-physical-activity/"
  },
  {
    "id": "sport-v56-27",
    "name": "Développé épaules léger",
    "category": "renfo",
    "description": "Pousser de petites charges au-dessus de la tête sans cambrer.",
    "level": "moyen",
    "reps": "8 répétitions",
    "seconds": 90,
    "active": true,
    "sourceUrl": "https://www.heart.org/en/healthy-living/exercise-and-physical-activity/"
  },
  {
    "id": "sport-v56-28",
    "name": "Rotation douce du cou",
    "category": "mobilite",
    "description": "Assis, tourner lentement la tête vers une épaule sans forcer.",
    "level": "doux",
    "reps": "3 par côté",
    "seconds": 45,
    "active": true,
    "sourceUrl": "https://www.nhs.uk/live-well/exercise/flexibility-exercises/"
  },
  {
    "id": "sport-v56-29",
    "name": "Inclinaison latérale du cou",
    "category": "etirement",
    "description": "Incliner légèrement l’oreille vers une épaule, sans tirer la tête.",
    "level": "doux",
    "reps": "3 × 5 s par côté",
    "seconds": 60,
    "active": true,
    "sourceUrl": "https://www.nhs.uk/live-well/exercise/flexibility-exercises/"
  },
  {
    "id": "sport-v56-30",
    "name": "Inclinaison latérale du buste",
    "category": "mobilite",
    "description": "Debout, glisser une main le long de la cuisse en inclinant légèrement le buste.",
    "level": "doux",
    "reps": "5 par côté",
    "seconds": 60,
    "active": true,
    "sourceUrl": "https://www.nhs.uk/live-well/exercise/flexibility-exercises/"
  },
  {
    "id": "sport-v56-31",
    "name": "Ouverture de poitrine debout",
    "category": "etirement",
    "description": "Mains derrière le dos ou contre un mur, ouvrir doucement la poitrine.",
    "level": "doux",
    "reps": "3 × 10 s",
    "seconds": 60,
    "active": true,
    "sourceUrl": "https://www.nhs.uk/live-well/exercise/flexibility-exercises/"
  },
  {
    "id": "sport-v56-32",
    "name": "Étirement latéral du dos",
    "category": "etirement",
    "description": "Un bras au-dessus de la tête, incliner doucement le buste du côté opposé.",
    "level": "doux",
    "reps": "15 s par côté",
    "seconds": 60,
    "active": true,
    "sourceUrl": "https://www.nhs.uk/live-well/exercise/flexibility-exercises/"
  },
  {
    "id": "sport-v56-33",
    "name": "Étirement du quadriceps avec appui",
    "category": "etirement",
    "description": "Debout avec appui, rapprocher doucement le talon de la fesse sans tirer le genou.",
    "level": "moyen",
    "reps": "15 s par jambe",
    "seconds": 90,
    "active": true,
    "sourceUrl": "https://www.orthoinfo.org/recovery/knee-conditioning-program/"
  },
  {
    "id": "sport-v56-34",
    "name": "Étirement des fléchisseurs de hanche",
    "category": "etirement",
    "description": "Position de fente courte avec appui, avancer doucement le bassin.",
    "level": "moyen",
    "reps": "15 s par côté",
    "seconds": 90,
    "active": true,
    "sourceUrl": "https://www.acefitness.org/resources/everyone/exercise-library/"
  },
  {
    "id": "sport-v56-35",
    "name": "Étirement des avant-bras",
    "category": "etirement",
    "description": "Bras tendu, guider doucement la main vers soi, sans douleur.",
    "level": "doux",
    "reps": "15 s par bras",
    "seconds": 60,
    "active": true,
    "sourceUrl": "https://www.acefitness.org/resources/everyone/exercise-library/"
  },
  {
    "id": "sport-v56-36",
    "name": "Marche talon-pointe avec appui",
    "category": "equilibre",
    "description": "Marcher un pied devant l’autre près d’un mur, sans se presser.",
    "level": "moyen",
    "reps": "8 pas",
    "seconds": 90,
    "active": true,
    "sourceUrl": "https://www.nhs.uk/live-well/exercise/balance-exercises/"
  },
  {
    "id": "sport-v56-37",
    "name": "Pas arrière avec appui",
    "category": "equilibre",
    "description": "Avec une chaise stable, faire un petit pas en arrière puis revenir.",
    "level": "doux",
    "reps": "6 par côté",
    "seconds": 60,
    "active": true,
    "sourceUrl": "https://www.nhs.uk/live-well/exercise/balance-exercises/"
  },
  {
    "id": "sport-v56-38",
    "name": "Équilibre tandem",
    "category": "equilibre",
    "description": "Un pied devant l’autre, tenir près d’un mur ou d’un dossier stable.",
    "level": "moyen",
    "reps": "2 × 15 s",
    "seconds": 90,
    "active": true,
    "sourceUrl": "https://www.nhs.uk/live-well/exercise/balance-exercises/"
  },
  {
    "id": "sport-v56-39",
    "name": "Équilibre une jambe sans appui",
    "category": "equilibre",
    "description": "Près d’un support, soulever un pied et chercher la stabilité.",
    "level": "difficile",
    "reps": "2 × 15 s par pied",
    "seconds": 90,
    "active": true,
    "sourceUrl": "https://www.nhs.uk/live-well/exercise/balance-exercises/"
  },
  {
    "id": "sport-v56-40",
    "name": "Pas en huit autour de repères",
    "category": "equilibre",
    "description": "Marcher en dessinant un huit autour de deux repères espacés.",
    "level": "moyen",
    "reps": "60 secondes",
    "seconds": 120,
    "active": true,
    "sourceUrl": "https://www.nhs.uk/live-well/exercise/balance-exercises/"
  },
  {
    "id": "sport-v56-41",
    "name": "Marche dynamique bras alternés",
    "category": "cardio",
    "description": "Marcher sur place en balançant les bras naturellement.",
    "level": "doux",
    "reps": "90 secondes",
    "seconds": 120,
    "active": true,
    "sourceUrl": "https://www.heart.org/en/healthy-living/exercise-and-physical-activity/"
  },
  {
    "id": "sport-v56-42",
    "name": "Step touch rapide sans saut",
    "category": "fitness",
    "description": "Alterner un pas latéral et le regroupement des pieds sur un rythme régulier.",
    "level": "moyen",
    "reps": "60 secondes",
    "seconds": 120,
    "active": true,
    "sourceUrl": "https://www.heart.org/en/healthy-living/exercise-and-physical-activity/"
  },
  {
    "id": "sport-v56-43",
    "name": "Jack sans saut",
    "category": "fitness",
    "description": "Écarter une jambe à la fois en levant les bras, sans sauter.",
    "level": "doux",
    "reps": "45 secondes",
    "seconds": 90,
    "active": true,
    "sourceUrl": "https://www.heart.org/en/healthy-living/exercise-and-physical-activity/"
  },
  {
    "id": "sport-v56-44",
    "name": "Montées de genoux rythmées",
    "category": "fitness",
    "description": "Lever alternativement les genoux à hauteur confortable en avançant les bras.",
    "level": "moyen",
    "reps": "45 secondes",
    "seconds": 90,
    "active": true,
    "sourceUrl": "https://www.heart.org/en/healthy-living/exercise-and-physical-activity/"
  },
  {
    "id": "sport-v56-45",
    "name": "Shadow boxing cadencé",
    "category": "fitness",
    "description": "Enchaîner des coups de poing dans l’air en restant stable sur les appuis.",
    "level": "moyen",
    "reps": "60 secondes",
    "seconds": 120,
    "active": true,
    "sourceUrl": "https://www.heart.org/en/healthy-living/exercise-and-physical-activity/"
  },
  {
    "id": "sport-v56-46",
    "name": "Mountain climber lent sur support",
    "category": "fitness",
    "description": "Mains sur support très stable, alterner la montée des genoux sans impact.",
    "level": "difficile",
    "reps": "30 secondes × 2",
    "seconds": 120,
    "active": true,
    "sourceUrl": "https://www.acefitness.org/resources/everyone/exercise-library/"
  },
  {
    "id": "sport-v56-47",
    "name": "Danse freestyle deux chansons",
    "category": "danse",
    "description": "Danser librement sur deux extraits musicaux, avec pauses et sans saut.",
    "level": "moyen",
    "reps": "2 à 3 minutes",
    "seconds": 180,
    "active": true,
    "sourceUrl": "https://www.heart.org/en/healthy-living/exercise-and-physical-activity/"
  },
  {
    "id": "sport-v56-48",
    "name": "Pas de salsa de base",
    "category": "danse",
    "description": "Alterner des pas en avant et arrière sur un rythme doux, sans pivoter brusquement.",
    "level": "doux",
    "reps": "60 secondes",
    "seconds": 90,
    "active": true,
    "sourceUrl": "https://www.heart.org/en/healthy-living/exercise-and-physical-activity/"
  },
  {
    "id": "sport-v56-49",
    "name": "Pas de merengue sur place",
    "category": "danse",
    "description": "Faire de petits pas alternés avec un mouvement léger des bras.",
    "level": "doux",
    "reps": "60 secondes",
    "seconds": 120,
    "active": true,
    "sourceUrl": "https://www.heart.org/en/healthy-living/exercise-and-physical-activity/"
  },
  {
    "id": "sport-v56-50",
    "name": "Enchaînement danse cardio sans saut",
    "category": "danse",
    "description": "Alterner pas latéraux, marche rythmée et mouvements de bras, sans impact.",
    "level": "moyen",
    "reps": "2 minutes",
    "seconds": 180,
    "active": true,
    "sourceUrl": "https://www.heart.org/en/healthy-living/exercise-and-physical-activity/"
  }
];

function defaultData() {
  return {
    achievements: [], // succès attribués, une seule fois
    customAchievements: [],
    appointments: [],
    testNotifications: [],
    budgetEnvelopes: {},
    plannedPurchases: [],
    customRoutines: [],
    mealLeftovers: [],
    moodQuestions: [],
    testSettings: {contextualDashboard:true,automationEnabled:true},
    alters: [],
    alterDays: {},
    alterReviews: [],
    alterReviewQuestions: clone(DEFAULT_ALTER_REVIEW_QUESTIONS),
    moodTypes: [],
    moodEntries: [],
    alterActivities: [],
    moodReminderHour: 19,
    appointmentCategories: [],
    dashboardWidgets: ['sport','foodReview','weight','wellnessReport','randomNotes','habits','routines','meals','priorities','tasks'],
    sportExercises: clone(SPORT_DEFAULT_EXERCISES),
    sportSessions: [],
    sportLocations: [{id:'tremelin',name:'Lac de Trémelin',active:true},{id:'bedee',name:'Parc de Bédée',active:true}],
    sportGoals: {mini:2,game:1,walk:1,walkDays:14},
    sportPoints: {short:3,mini:10,long:20,game:25,walk:30},
    weightSettings: {start:null,target:null,days:[2,5],enabled:true},
    weightEntries: [],
    foodReviews: {},
    foodContainers: ['Assiette','Petite assiette','Grande assiette','Bol','Assiette creuse'],
    foodCategoriesHealth: {},
    foodReminderShown: {},
    groceryBudget: 0, // budget facultatif de courses
    eveningNotes: '', // ancien champ conservé pour migration
    budgetCategories: ['Alimentation','Essence','Loisirs','Logement','Abonnements','Impôts','Santé','Transport','Salaire','Autres'],
    ingredients: [], // {id,name,owned}
    dishes: [], // {id,name,ingredientIds}
    dishCategories: ['Sans catégorie'],
    dishDifficulties: [], // niveaux ordonnés personnalisables
    dishTimes: [], // durées ordonnées personnalisables
    shoppingSessions: [],
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
    randomNotes: [], // petites notes indépendantes
    randomNoteTypes: [],
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
    for(const k of ['alters','alterReviews','moodTypes','moodEntries','alterActivities'])if(!Array.isArray(d[k]))d[k]=[];
    d.alterReviewQuestions=normalizeAlterReviewQuestions(d.alterReviewQuestions);
    if(!d.alterDays||typeof d.alterDays!=='object'||Array.isArray(d.alterDays))d.alterDays={};
    if(!Number.isInteger(d.moodReminderHour))d.moodReminderHour=19;
    d.categories = normalizeCategories(d.categories).filter(c => c.name !== 'Travail');

    if (!Array.isArray(d.rewardCategories)) d.rewardCategories = [];
    d.rewardCategories = normalizeCategories(d.rewardCategories);
    if (!Array.isArray(d.testNotifications)) d.testNotifications=[];
    if (!d.budgetEnvelopes || typeof d.budgetEnvelopes!=='object') d.budgetEnvelopes={};
    if (!Array.isArray(d.plannedPurchases)) d.plannedPurchases=[];
    if(!Array.isArray(d.customRoutines))d.customRoutines=[];
    if(!Array.isArray(d.mealLeftovers))d.mealLeftovers=[];
    if(!Array.isArray(d.moodQuestions))d.moodQuestions=[];
    if (!d.testSettings || typeof d.testSettings!=='object') d.testSettings={contextualDashboard:true,automationEnabled:true};
    if (!Array.isArray(d.habits)) d.habits = [];
    if (!Array.isArray(d.activities)) d.activities = [];
    if (!Array.isArray(d.workTickets)) d.workTickets = [];
    d.workTickets=d.workTickets.filter(t=>t&&typeof t==='object').map(t=>{const items=Array.isArray(t.items)?t.items:[];return {...t,items,waiting:items.some(i=>!i.done)?false:!!t.waiting};});
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
    d.ingredients=d.ingredients.filter(x=>x&&typeof x==='object').map(x=>({...x,name:String(x.name||''),category:typeof x.category==='string'&&x.category.trim()?x.category:'Sans catégorie',owned:!!x.owned,location:typeof x.location==='string'?x.location:'',expiry:typeof x.expiry==='string'?x.expiry:'',stockNote:typeof x.stockNote==='string'?x.stockNote:''}));
    d.ingredientCategories=[...new Set(['Sans catégorie',...d.ingredientCategories.filter(x=>typeof x==='string'&&x.trim()),...d.ingredients.map(x=>x.category).filter(Boolean)])];
    d.shoppingItems.forEach(x=>{if(typeof x.quantity!=='string') x.quantity=String(x.quantity??'');x.store=String(x.store||'');x.category=String(x.category||'Sans catégorie');});
    if (typeof d.menuRules !== 'string') d.menuRules = '';
    if (!Array.isArray(d.achievements)) d.achievements=[];
    if (!Array.isArray(d.dashboardWidgets)) d.dashboardWidgets=['randomNotes','habits','meals','priorities','tasks'];
    if(!d.dashboardWidgets.includes('appointments'))d.dashboardWidgets.unshift('appointments');
    if(!d.dashboardRoutinesV63){if(!d.dashboardWidgets.includes('routines'))d.dashboardWidgets.splice(Math.max(0,d.dashboardWidgets.indexOf('habits')+1),0,'routines');d.dashboardRoutinesV63=true;}
    d.groceryBudget=Number.isFinite(Number(d.groceryBudget))?Number(d.groceryBudget):0;
    if (!Array.isArray(d.budgetEntries)) d.budgetEntries = [];
    if (!Array.isArray(d.budgetRecurring)) d.budgetRecurring = [];
    if (!d.budgetOverrides || typeof d.budgetOverrides !== 'object' || Array.isArray(d.budgetOverrides)) d.budgetOverrides = {};
    if (!Array.isArray(d.budgetSwile)) d.budgetSwile = [];
    if (!Array.isArray(d.cashEntries)) d.cashEntries = [];
    d.budgetSwile = d.budgetSwile.map(x => ({...x, amount: -Math.abs(Number(x.amount) || 0)}));
    if (!Array.isArray(d.textareas)) d.textareas = [];
    if (!Array.isArray(d.randomNotes)) d.randomNotes=[];
    if (!Array.isArray(d.randomNoteTypes)) d.randomNoteTypes=[];
    if (!Array.isArray(d.dishCategories)) d.dishCategories=['Sans catégorie'];
    for(const key of ['dishDifficulties','dishTimes']) if(!Array.isArray(d[key])) d[key]=[];
    if (!Array.isArray(d.shoppingSessions)) d.shoppingSessions=[];
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
    // V52 : données Sport / alimentation, compatibilité anciennes sauvegardes.
    for (const k of ['sportExercises','sportSessions','sportLocations','weightEntries','foodContainers']) {
      if (!Array.isArray(d[k])) d[k]=clone(defaultData()[k]);
    }
    // V56: expansion unique du catalogue, conserve modifications et suppressions utilisateur.
    if (!d.sportCatalogV56) {
      const existingIds = new Set(d.sportExercises.filter(x => x && x.id).map(x => x.id));
      for (const ex of SPORT_DEFAULT_EXERCISES) {
        if (String(ex.id).startsWith('sport-v56-') && !existingIds.has(ex.id)) {
          d.sportExercises.push(clone(ex));
        }
      }
      d.sportCatalogV56 = true;
    }
    // V71 : meme si le drapeau historique est deja true, verifier les exercices reels.
    ensureSportV67(d.sportExercises);
    d.sportCatalogV67 = true;
    if (!d.sportGoals || typeof d.sportGoals !== 'object') d.sportGoals=clone(defaultData().sportGoals);
    if (!d.sportPoints || typeof d.sportPoints !== 'object') d.sportPoints=clone(defaultData().sportPoints);
    if (d.sportPoints.long === undefined) d.sportPoints.long=20;
    if (!d.weightSettings || typeof d.weightSettings !== 'object') d.weightSettings=clone(defaultData().weightSettings);
    for (const k of ['foodReviews','foodCategoriesHealth','foodReminderShown'])
      if (!d[k] || typeof d[k] !== 'object' || Array.isArray(d[k])) d[k]={};
    if (!d.dashboardWidgetsV58) {
      for (const id of ['sport','foodReview','weight','wellnessReport']) if (!d.dashboardWidgets.includes(id)) d.dashboardWidgets.push(id);
      d.dashboardWidgetsV58=true;
    }
    return d;
  } catch (e) {
    return defaultData();
  }
}

function loadUi() {
  const defaults = { filtersOpen: false, tab: window.TODO_QUEST_MOBILE ? 'shopping' : 'home', projectSort: 'manual', collapsedProjects: [] };
  try {
    const ui = Object.assign(defaults, JSON.parse(localStorage.getItem(UI_KEY) || '{}'));
    if (!TABS.some(t => t.id === ui.tab)) ui.tab = 'home';   // onglet inconnu -> accueil
    if (!Array.isArray(ui.collapsedProjects)) ui.collapsedProjects = [];
    if (!['manual', 'urgency','alter'].includes(ui.projectSort)) ui.projectSort = 'manual';
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
    return { editingTitle: false, editingDetails:false, draft: '' };
  },
  computed: {
    taskAlter(){const id=this.task.alterId||this.appData.projects.find(p=>p.id===this.task.projectId)?.alterId;return this.appData.alters.find(a=>a.id===id)||null;},
    milestoneTaskLabel(){const milestone=this.task.milestoneId && this.appData.projectMilestones.find(m=>m.id===this.task.milestoneId&&m.projectId===this.task.projectId);return milestone ? `${milestone.title} - ${this.task.title}` : this.task.title;},
    blockedBy(){const p=this.appData.tasks.find(x=>x.id===this.task.dependsOn);return p&&p.status!=='done'?p:null;},
    effectiveDue(){const m=this.task.milestoneId && this.appData.projectMilestones.find(m=>m.id===this.task.milestoneId&&m.projectId===this.task.projectId);return this.task.due || m?.due || '';},
    isOverdue() {
      return !!this.effectiveDue && this.effectiveDue < this.today && this.task.status !== 'done';
    },
    dueLabel() {
      if (this.effectiveDue === this.today) return "DATE D'ÉCHÉANCE";
      if (this.task.startDate && this.task.startDate <= this.today && (!this.effectiveDue || this.effectiveDue > this.today)) return 'Aujourd’hui · échéance '+formatLongDate(this.effectiveDue);
      return formatLongDate(this.effectiveDue);
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
      data.dishes=data.dishes.filter(x=>x&&typeof x==='object').map(x=>({...x,ingredientIds:Array.isArray(x.ingredientIds)?x.ingredientIds:[]}));
      data.ingredients=data.ingredients.filter(x=>x&&typeof x==='object').map(x=>({...x,name:String(x.name||''),category:typeof x.category==='string'&&x.category.trim()?x.category:'Sans catégorie',owned:!!x.owned,location:typeof x.location==='string'?x.location:''}));
      data.ingredientCategories=[...new Set(['Sans catégorie',...data.ingredientCategories.filter(x=>typeof x==='string'&&x.trim()),...data.ingredients.map(i=>i.category)])];
      data.ingredientLocations=[...new Set([...(data.ingredientLocations||['Congélo','Frigo','Garde-manger','Placard']).filter(x=>typeof x==='string'&&x.trim()),...data.ingredients.map(i=>i.location).filter(Boolean)])];
      data.shoppingItems.forEach(x=>{x.store=String(x.store||'');x.category=String(x.category||'Sans catégorie');x.quantity=String(x.quantity??'');});
      data.weeklyMenus = src.weeklyMenus && typeof src.weeklyMenus === 'object' && !Array.isArray(src.weeklyMenus) ? src.weeklyMenus : {};
      data.menuRules = typeof src.menuRules === 'string' ? src.menuRules : '';
      data.achievements=Array.isArray(src.achievements)?src.achievements:[];
      data.customAchievements=Array.isArray(src.customAchievements)?src.customAchievements:[];
      data.appointments=Array.isArray(src.appointments)?src.appointments:[];
      data.testNotifications=Array.isArray(src.testNotifications)?src.testNotifications:[];
      data.budgetEnvelopes=src.budgetEnvelopes&&typeof src.budgetEnvelopes==='object'?src.budgetEnvelopes:{};
      data.plannedPurchases=Array.isArray(src.plannedPurchases)?clone(src.plannedPurchases):[];
      data.plannedPurchases=data.plannedPurchases.filter(p=>p&&typeof p==='object'&&String(p.name||'').trim()).map(p=>({...p,amount:Math.max(0,Number(p.amount)||0),status:p.status||'planned'}));
      data.customRoutines=Array.isArray(src.customRoutines)?clone(src.customRoutines):[];
      data.mealLeftovers=Array.isArray(src.mealLeftovers)?clone(src.mealLeftovers):[];
      data.moodQuestions=Array.isArray(src.moodQuestions)?clone(src.moodQuestions):[];
      data.testSettings=src.testSettings&&typeof src.testSettings==='object'?src.testSettings:{contextualDashboard:true,automationEnabled:true};
      for(const k of ['alters','alterReviews','moodTypes','moodEntries','alterActivities'])data[k]=Array.isArray(src[k])?src[k]:[];
      data.alterReviewQuestions=normalizeAlterReviewQuestions(src.alterReviewQuestions);
      data.alterDays=src.alterDays&&typeof src.alterDays==='object'&&!Array.isArray(src.alterDays)?src.alterDays:{};
      data.moodReminderHour=Number.isInteger(src.moodReminderHour)?src.moodReminderHour:19;
      data.appointmentCategories=Array.isArray(src.appointmentCategories)?src.appointmentCategories:[];
      data.dashboardWidgets=Array.isArray(src.dashboardWidgets)?[...src.dashboardWidgets]:['randomNotes','habits','meals','priorities','tasks'];
      if(!data.dashboardWidgets.includes('appointments'))data.dashboardWidgets.unshift('appointments');
      if(!src.dashboardRoutinesV63){if(!data.dashboardWidgets.includes('routines'))data.dashboardWidgets.splice(Math.max(0,data.dashboardWidgets.indexOf('habits')+1),0,'routines');}data.dashboardRoutinesV63=true;
      data.groceryBudget=Number.isFinite(Number(src.groceryBudget))?Number(src.groceryBudget):0;
      data.eveningNotes = typeof src.eveningNotes === 'string' ? src.eveningNotes : '';
      data.budgetCategories = Array.isArray(src.budgetCategories) ? [...new Set([...src.budgetCategories, ...[...(src.budgetEntries||[]),...(src.budgetRecurring||[]),...(src.budgetSwile||[])].map(x=>x.category)].filter(x=>typeof x==='string'&&x.trim()))] : [...new Set([...defaultData().budgetCategories, ...[...(src.budgetEntries||[]),...(src.budgetRecurring||[]),...(src.budgetSwile||[])].map(x=>x.category)].filter(x=>typeof x==='string'&&x.trim()))];
      data.budgetEntries = Array.isArray(src.budgetEntries) ? src.budgetEntries : [];
      data.budgetRecurring = Array.isArray(src.budgetRecurring) ? src.budgetRecurring : [];
      data.budgetOverrides = src.budgetOverrides && typeof src.budgetOverrides === 'object' && !Array.isArray(src.budgetOverrides) ? src.budgetOverrides : {};
      data.budgetSwile = Array.isArray(src.budgetSwile) ? src.budgetSwile.map(x => ({...x, amount: -Math.abs(Number(x.amount) || 0)})) : [];
      data.cashEntries = Array.isArray(src.cashEntries) ? src.cashEntries : [];
      data.textareas = Array.isArray(src.textareas) ? src.textareas : [];
      data.randomNotes=Array.isArray(src.randomNotes)?src.randomNotes:[];
      data.randomNoteTypes=Array.isArray(src.randomNoteTypes)?src.randomNoteTypes:[];
      data.dishCategories=Array.isArray(src.dishCategories)?src.dishCategories:['Sans catégorie'];
      data.dishDifficulties=Array.isArray(src.dishDifficulties)?src.dishDifficulties:[];
      data.dishTimes=Array.isArray(src.dishTimes)?src.dishTimes:[];
      data.shoppingSessions=Array.isArray(src.shoppingSessions)?src.shoppingSessions:[];
      if (data.eveningNotes.trim()) { if (!data.textareas.length) data.textareas.push({id:uid(),title:'To do du soir',content:data.eveningNotes}); data.eveningNotes=''; }
      data.usualLists = Array.isArray(src.usualLists) ? src.usualLists : [];
      data.workTicketTypes = Array.isArray(src.workTicketTypes) ? src.workTicketTypes : [];
      data.workTickets = (Array.isArray(src.workTickets) ? src.workTickets : []).filter(t=>t&&typeof t==='object').map(t=>{const items=Array.isArray(t.items)?t.items:[];return {...t,items,waiting:items.some(i=>!i.done)?false:!!t.waiting};});
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
      // V52 : appliquer aussi les données Sport / bien-être reçues via Firebase/import.
      const fresh=defaultData();
      for (const k of ['sportExercises','sportSessions','sportLocations','weightEntries','foodContainers'])
        data[k]=Array.isArray(src[k])?clone(src[k]):clone(fresh[k]);
      // V71 : reconciliation APRES chaque import/chargement distant, independante du drapeau.
      ensureSportV67(data.sportExercises);
      data.sportCatalogV67 = true;
      for (const k of ['sportGoals','sportPoints','weightSettings','foodReviews','foodCategoriesHealth','foodReminderShown'])
        data[k]=src[k] && typeof src[k]==='object' && !Array.isArray(src[k])?clone(src[k]):clone(fresh[k]);
      if(data.sportPoints.long===undefined)data.sportPoints.long=20;
      if (!src.dashboardWidgetsV58) for (const id of ['sport','foodReview','weight','wellnessReport']) if(!data.dashboardWidgets.includes(id))data.dashboardWidgets.push(id);
      data.dashboardWidgetsV58=true;
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
      const amount=Number(String(cashForm.amount).replace(',','.'));
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
      const n=Number(String(budgetEntryForm.amount).replace(',','.'));
      if(!budgetEntryForm.label.trim()||budgetEntryForm.amount===null||budgetEntryForm.amount===''||!Number.isFinite(n))return;
      data.budgetEntries.push({id:uid(),date:budgetEntryForm.date||budgetMonth.value+'-01',label:budgetEntryForm.label.trim(),amount:n,category:budgetEntryForm.category});
      budgetEntryForm.label='';budgetEntryForm.amount=null;
    }
    function addBudgetRecurring(){
      const n=Number(String(budgetRecurringForm.amount).replace(',','.'));
      if(!budgetRecurringForm.label.trim()||budgetRecurringForm.amount===null||budgetRecurringForm.amount===''||!Number.isFinite(n)||!budgetRecurringForm.start||(budgetRecurringForm.end&&budgetRecurringForm.end<budgetRecurringForm.start))return;
      data.budgetRecurring.push({id:uid(),label:budgetRecurringForm.label.trim(),amount:n,category:budgetRecurringForm.category,start:budgetRecurringForm.start,end:budgetRecurringForm.end,active:true});
      budgetRecurringForm.label='';budgetRecurringForm.amount=null;
    }
    function addBudgetSwile(){
      const n=Number(String(budgetSwileForm.amount).replace(',','.'));
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
      const swileGrouped=swile.length ? [{id:'swile-total-'+budgetMonth.value,kind:'swile-total',label:'Swile (50 % du mois précédent)',category:'Swile',date:budgetMonth.value+'-01',amount:swile.reduce((s,x)=>s+x.amount,0)}] : [];
      return [...automatic,...swileGrouped,...manual];
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
    function setTab(id) { view.value = id; nextTick(() => window.scrollTo({top:0,left:0,behavior:'instant'})); }
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
      data.tasks.filter(t => t.status === 'done' || (t.subtasks||[]).some(s=>s.done)).reduce((s, t) => s + taskValue(t), 0)
      + data.workTickets.reduce((sum,ticket)=>sum+(ticket.items||[]).filter(x=>x.done).reduce((s,x)=>s+ticketItemValue(ticket,x),0),0)
      + data.projectMilestones.filter(m=>milestoneDone(m)).reduce((sum,m)=>sum+Math.max(0,Number(m.points)||0),0)
      + (Number(data.archived) || 0));
    const gratitudeTotal = computed(() => Math.round(data.gratitude.reduce((sum,g) => sum+(Number(g.points)||0),0)*100)/100);
    const savedTotal = computed(() => data.rewards.reduce((sum,r)=>sum+Math.max(0,Number(r.saved)||0),0));
    const habitTotal = computed(() => Math.round(data.habits.reduce((sum,h)=>sum+habitAwards(h).reduce((s,a)=>s+a.points,0) - (h.penalties||[]).reduce((s,a)=>s+Math.max(0,Number(a.points)||0),0),0)*100)/100);
    const challengeTotal = computed(() => Math.round(data.challengeAwards.reduce((sum,a) => sum + (Number(a.points)||0), 0)*100)/100);
    const balance = computed(() => Math.round((earned.value + gratitudeTotal.value + habitTotal.value + challengeTotal.value + data.sportSessions.reduce((s,x)=>s+(Number(x.points)||0),0) + Object.values(data.foodReviews).reduce((s,x)=>s+(x&&x.completed?2:0),0) - data.spent - savedTotal.value + (Number(data.adjust) || 0))*100)/100);

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
    // Calculs en centièmes de point pour éviter 6.349999999999994.
    const pointsCents = value => Math.round((Number(value) || 0) * 100);
    const formatPoints = value => (Math.round((Number(value) || 0) * 100) / 100).toLocaleString('fr-FR', { maximumFractionDigits: 2 });
    const rewardRemaining = r => Math.max(0, pointsCents(r.cost) - pointsCents(r.saved)) / 100;
    function toggleRewardFavorite(reward) {
      const wasFavorite=!!reward.favorite;
      data.rewards.forEach(r => {r.favorite=false;});
      reward.favorite=!wasFavorite;
    }
    const randomRewardCategory=ref('');
    const randomRewardExcludeFavorite=ref(false);
    function randomRewardEligible(r){
      return rewardRemaining(r)>0 &&
        (!randomRewardCategory.value || r.category===randomRewardCategory.value) &&
        (!randomRewardExcludeFavorite.value || !r.favorite);
    }
    function depositRandomReward() {
      const eligible=data.rewards.filter(randomRewardEligible);
      if (!eligible.length || balance.value<=0) {notify('Aucune récompense à financer ou aucun point disponible');return;}
      const reward=eligible[Math.floor(Math.random()*eligible.length)];
      depositReward(reward, true);
    }
    function depositReward(reward, random=false) {
      const maxCents = Math.min(pointsCents(balance.value), pointsCents(rewardRemaining(reward)));
      if (maxCents <= 0) { notify('Aucun point disponible à épargner'); return; }
      const max = maxCents / 100;
      const response = prompt(random ? ('Combien de points épargner sur une récompense surprise ? (max '+formatPoints(max)+')') : ('Points à épargner pour « '+reward.name+' » (max '+formatPoints(max)+') :'), formatPoints(Math.min(5,max)));
      if (response === null) return;
      const raw = Number(String(response).trim().replace(',','.'));
      const amountCents = Math.round(raw * 100);
      if (!Number.isFinite(raw) || amountCents <= 0 || amountCents > maxCents || Math.abs(raw * 100 - amountCents) > 0.000001) {
        alert('Montant invalide ou supérieur au solde disponible (2 décimales maximum).'); return;
      }
      reward.saved = (pointsCents(reward.saved) + amountCents) / 100;
      notify(formatPoints(amountCents / 100)+' pts réservés pour '+reward.name);
    }
    function withdrawReward(reward) {
      const savedCents = pointsCents(reward.saved);
      if (savedCents <= 0) return;
      const response = prompt('Points à retirer de cette épargne (max '+formatPoints(savedCents / 100)+') :',formatPoints(savedCents / 100));
      if(response===null)return;
      const raw=Number(String(response).trim().replace(',','.'));
      const amountCents=Math.round(raw * 100);
      if(!Number.isFinite(raw)||amountCents<=0||amountCents>savedCents || Math.abs(raw*100-amountCents)>0.000001) {alert('Montant invalide (2 décimales maximum).');return;}
      reward.saved=(savedCents-amountCents)/100;
    }
    const gratitudeDraft = ref('');
    const gratitudeMoment = ref('');
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
      data.gratitude.push({date:today.value,text:value,moment:gratitudeMoment.value.trim(),points});
      gratitudeDraft.value='';gratitudeMoment.value='';notify('Gratitude enregistrée : +'+points+' pt');
    }
    function deleteGratitude(g) {if(confirm('Supprimer cette gratitude et les points associés ?'))data.gratitude=data.gratitude.filter(x=>x.date!==g.date);}
    // Notes au pif : création rapide sur le dashboard et organisation dans un onglet dédié.
    const randomNoteDraft=ref('');
    const randomNoteTypeDraft=ref('');
    const randomNoteNewType=ref('');
    const randomNoteEditing=ref('');
    const randomNoteTypeDragged=ref('');
    const randomNoteDragged=ref('');
    const randomNoteTypeFilter=ref('');
    const dashboardNewNoteType=ref('');
    function addRandomNote(fromDashboard=false){
      const created=fromDashboard?dashboardNewNoteType.value.trim():'';
      if(created){if(!data.randomNoteTypes.includes(created))data.randomNoteTypes.push(created);randomNoteNewType.value=created;}
      dashboardNewNoteType.value='';
      const content=randomNoteDraft.value.trim();
      if(!content){if(!fromDashboard) data.randomNotes.push({id:uid(),title:'Nouvelle note',content:'',type:randomNoteNewType.value||''});return;}
      data.randomNotes.push({id:uid(),title:content.split('\n')[0].slice(0,60)||'Note au pif',content,type:randomNoteNewType.value||''});
      randomNoteDraft.value='';notify('Note ajoutée');
    }
    function addRandomNoteType(){const n=randomNoteTypeDraft.value.trim();if(n&&!data.randomNoteTypes.includes(n))data.randomNoteTypes.push(n);randomNoteTypeDraft.value='';}
    function renameRandomNoteType(name){const v=prompt('Renommer ce type :',name);if(v===null||!v.trim()||v.trim()===name)return;if(data.randomNoteTypes.includes(v.trim()))return alert('Type déjà existant');data.randomNoteTypes.splice(data.randomNoteTypes.indexOf(name),1,v.trim());data.randomNotes.forEach(n=>{if(n.type===name)n.type=v.trim()});}
    function deleteRandomNoteType(name){if(!confirm('Supprimer le type « '+name+' » ? Les notes seront conservées.'))return;data.randomNoteTypes=data.randomNoteTypes.filter(x=>x!==name);data.randomNotes.forEach(n=>{if(n.type===name)n.type=''});if(randomNoteTypeFilter.value===name)randomNoteTypeFilter.value='';}
    function deleteRandomNote(note){if(confirm('Supprimer cette note ?'))data.randomNotes=data.randomNotes.filter(n=>n.id!==note.id);}
    function dropRandomNote(target){const from=data.randomNotes.findIndex(n=>n.id===randomNoteDragged.value),to=data.randomNotes.findIndex(n=>n.id===target.id);if(from>=0&&to>=0&&from!==to){const [n]=data.randomNotes.splice(from,1);data.randomNotes.splice(to,0,n);}randomNoteDragged.value='';}
    function reorderRandomNoteType(target){
      const from=data.randomNoteTypes.indexOf(randomNoteTypeDragged.value),to=data.randomNoteTypes.indexOf(target);
      if(from>=0&&to>=0&&from!==to){const [type]=data.randomNoteTypes.splice(from,1);data.randomNoteTypes.splice(to,0,type);}
      randomNoteTypeDragged.value='';
    }
    const randomNoteGroups=computed(()=>{
      const types=[...data.randomNoteTypes,''];
      for(const note of data.randomNotes) if(note.type&&!types.includes(note.type))types.splice(types.length-1,0,note.type);
      return types.filter(type=>!randomNoteTypeFilter.value||type===randomNoteTypeFilter.value)
        .map(type=>({type,title:type||'Sans type',notes:data.randomNotes.filter(note=>(note.type||'')===type)}))
        .filter(group=>group.notes.length);
    });
    const visibleRandomNotes=computed(()=>data.randomNotes.filter(n=>!randomNoteTypeFilter.value||n.type===randomNoteTypeFilter.value));
    // Les listes de suggestions ne sont jamais affichées avant une saisie.
    const taskSuggestFocused=ref(false),ingredientSuggestFocused=ref(false);
    const taskSuggestions=computed(()=>{const q=filters.search.trim().toLocaleLowerCase();return q?data.tasks.filter(x=>String(x.title||'').toLocaleLowerCase().includes(q)).slice(0,5):[];});
    const ingredientSuggestions=computed(()=>{const q=ingredientQuery.value.trim().toLocaleLowerCase();return q?data.ingredients.filter(x=>String(x.name||'').toLocaleLowerCase().includes(q)).slice(0,5):[];});
    const shoppingSuggestions=computed(()=>{const q=shoppingIngredientSearch.value.trim().toLocaleLowerCase();return q?shoppingIngredientChoices.value.slice(0,5):[];});
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
    const FILTER_DEFAULTS = { alter: '', search: '', category: '', status: '', project: '', urgency: '', difficulty: '', kind: '', dueMode: 'any', dueExact: '', dueFrom: '', dueTo: '', sort: 'due' };
    const filters = reactive({ ...FILTER_DEFAULTS });

    function resetFilters() {
      Object.assign(filters, FILTER_DEFAULTS);
    }

    // Nombre de filtres actifs (affiché sur le bouton "Filtres / tri" quand le panneau est replié)
    const activeFilterCount = computed(() => {
      let n = 0;
      if (filters.search.trim()) n++;
      if (filters.category) n++;
      if (filters.alter) n++;
      if (filters.status) n++;
      if (filters.project) n++;
      if (filters.urgency) n++;
      if (filters.difficulty) n++;
      if (filters.kind) n++;
      if (filters.dueMode !== 'any') n++;
      if (filters.dueExact) n++;
      if (filters.dueFrom && !filters.dueExact) n++;
      if (filters.dueTo && !filters.dueExact) n++;
      if (filters.sort !== 'due') n++;
      return n;
    });

    // La date de la tâche prévaut ; à défaut, elle hérite dynamiquement de celle du jalon.
    function taskDue(t) {
      if (t.due) return t.due;
      const milestone = t.milestoneId && data.projectMilestones.find(m => m.id === t.milestoneId && m.projectId === t.projectId);
      return milestone?.due || '';
    }

    function applyFilters(list, withSort = true) {
      const q = filters.search.trim().toLowerCase();
      const res = list.filter(t => {
        if (filters.alter && (t.alterId||data.projects.find(p=>p.id===t.projectId)?.alterId||'') !== (filters.alter==='__none'?'':filters.alter)) return false;
        if (filters.status && t.status !== filters.status) return false;
        if (filters.dueMode==='none' && taskDue(t)) return false;
        if (filters.dueMode==='dated' && !taskDue(t)) return false;
        if (filters.dueExact && taskDue(t)!==filters.dueExact) return false;
        if (!filters.dueExact && filters.dueFrom && (!taskDue(t) || taskDue(t)<filters.dueFrom)) return false;
        if (!filters.dueExact && filters.dueTo && (!taskDue(t) || taskDue(t)>filters.dueTo)) return false;
        if (filters.category === '__none' && t.category) return false;
        if (filters.category && filters.category !== '__none' && t.category !== filters.category) return false;
        if (filters.project === '__none' && t.projectId) return false;
        if (filters.project && filters.project !== '__none' && t.projectId !== filters.project) return false;
        if (filters.urgency && effectiveUrgency(t) !== (filters.urgency === '__none' ? '' : filters.urgency)) return false;
        if (filters.difficulty && (t.difficulty || '') !== (filters.difficulty === '__none' ? '' : filters.difficulty)) return false;
        if (filters.kind === 'malus' && !t.malus) return false;
        if (filters.kind === 'bonus' && t.malus) return false;
        if (q && !milestoneTaskLabel(t).toLowerCase().includes(q)) return false;
        return true;
      });
      if (!withSort) return res;
      const byDue = (a, b) => (taskDue(a) || '9999').localeCompare(taskDue(b) || '9999');
      switch (filters.sort) {
        case 'points-desc':     res.sort((a, b) => taskValue(b) - taskValue(a) || byDue(a, b)); break;
        case 'points-asc':      res.sort((a, b) => taskValue(a) - taskValue(b) || byDue(a, b)); break;
        case 'urgency-asc':     res.sort((a, b) => levelRank(data.urgencies, effectiveUrgency(a)) - levelRank(data.urgencies, effectiveUrgency(b)) || byDue(a, b)); break;
        case 'difficulty-asc':  res.sort((a, b) => levelRank(data.difficulties, a.difficulty) - levelRank(data.difficulties, b.difficulty) || byDue(a, b)); break;
        case 'urgency-desc':    res.sort((a, b) => levelRank(data.urgencies, effectiveUrgency(b)) - levelRank(data.urgencies, effectiveUrgency(a)) || byDue(a, b)); break;
        case 'difficulty-desc': res.sort((a, b) => levelRank(data.difficulties, b.difficulty) - levelRank(data.difficulties, a.difficulty) || byDue(a, b)); break;
        case 'alter': res.sort((a,b)=>String(data.alters.find(z=>z.id===(a.alterId||data.projects.find(p=>p.id===a.projectId)?.alterId))?.name||'').localeCompare(String(data.alters.find(z=>z.id===(b.alterId||data.projects.find(p=>p.id===b.projectId)?.alterId))?.name||''),'fr')||byDue(a,b)); break;
        case 'title':           res.sort((a, b) => a.title.localeCompare(b.title)); break;
        default:                res.sort(byDue);
      }
      return res;
    }

    // Les tâches terminées ne sont plus dans ces listes : elles sont dans l'onglet "Terminés"
    const activeTasks   = computed(() => data.tasks.filter(t => t.scope !== 'work' && t.status !== 'done'));
    function taskIsToday(t) {
      const due=taskDue(t), start=t.startDate||'';
      if(start && start>today.value)return false;
      if(due && due<today.value)return true; // Vraie tâche en retard, toujours visible
      if(due===today.value)return true;
      return !!(start && start<=today.value && (!due || due>=today.value));
    }
    const todayTasks = computed(() => applyFilters(activeTasks.value.filter(taskIsToday)));
    const upcomingTasks = computed(() => applyFilters(activeTasks.value.filter(t => !taskIsToday(t) && ((t.startDate && t.startDate>today.value) || (taskDue(t) && taskDue(t)>today.value)))));
    // Sans échéance et sans date de début active, pas de doublon dans Aujourd'hui.
    const undatedTasks = computed(() => applyFilters(activeTasks.value.filter(t => !taskDue(t) && !taskIsToday(t))));
    const allTasks      = computed(() => applyFilters(activeTasks.value));
    const workTasks = computed(() => [...data.tasks.filter(t => t.scope === 'work' && t.status !== 'done')].sort((a,b)=>Number(a.status==='done')-Number(b.status==='done') || (a.due||'9999').localeCompare(b.due||'9999')));
    const copyForm = reactive({open:false});
    const copyText = computed(() => [...allTasks.value.map(t => t.title), ...data.habits.filter(h=>!h.malus&&!habitIsFinished(h)&&(habitDue(h)||habitLateDays(h)>0)&&!habitDoneToday(h)).map(h=>'[Habitude] '+h.title)].join('\n'));
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
      ticket.name = name;touchTicket(ticket);
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
    const hideWaitingTickets = ref(false);
    const ticketNow = ref(Date.now());
    const ticketActivityDate = t => { const raw=t.lastActivityAt || t.createdAtTime || t.createdAt || t.startDate; if(!raw)return NaN; const ms=new Date(/^\d{4}-\d{2}-\d{2}$/.test(raw)?raw+'T00:00:00':raw).getTime();return ms; };
    const ticketStale = t => Number.isFinite(ticketActivityDate(t)) && ticketNow.value-ticketActivityDate(t)>=86400000;
    const ticketNeedsAction = t => (t.items||[]).some(i=>!i.done);
    const ticketWaiting = t => !!t.waiting && !ticketNeedsAction(t);
    const ticketColorState = t => ticketNeedsAction(t)?'pending':ticketWaiting(t)?'waiting':ticketStale(t)?'stale':'clear';
    const ticketStateRank = t => ({pending:0,stale:1,waiting:2,clear:3})[ticketColorState(t)];
    const ticketCreatedLabel = t => {const raw=t.createdAtTime||t.createdAt; if(!raw)return 'Date inconnue'; const dt=new Date(/^\d{4}-\d{2}-\d{2}$/.test(raw)?raw+'T00:00:00':raw);return Number.isNaN(dt.getTime())?String(raw):dt.toLocaleString('fr-FR',{dateStyle:'short',timeStyle: /^\d{4}-\d{2}-\d{2}$/.test(raw)?undefined:'short'});};
    function touchTicket(t){t.lastActivityAt=new Date().toISOString();ticketNow.value=Date.now();}
    // Rafraîchissement lorsqu'une interaction sur la page intervient, sans boucle de synchronisation.

    const ticketDragged = ref(null);
    const openTickets = computed(()=>{
      const list=data.workTickets.filter(t=>!t.done && (!hideWaitingTickets.value || !ticketWaiting(t)));
      const urgency=t=>levelRank(data.workUrgencies,t.urgency);
      const difficulty=t=>levelRank(data.workDifficulties,t.difficulty);
      switch(ticketSort.value){
        case 'action': return [...list].sort((a,b)=>ticketStateRank(a)-ticketStateRank(b));
        case 'inactive': return [...list].sort((a,b)=>(Number.isFinite(ticketActivityDate(a))?ticketActivityDate(a):-Infinity)-(Number.isFinite(ticketActivityDate(b))?ticketActivityDate(b):-Infinity));
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
      data.workTickets.push({id,name,urgency:ticketDraft.urgency,difficulty:ticketDraft.difficulty,typeId:ticketDraft.typeId,url:ticketDraft.url.trim(),due:ticketDraft.due,startDate:ticketDraft.startDate||today.value,category:ticketDraft.category,createdAt:today.value,createdAtTime:new Date().toISOString(),waiting:false,customStatus:'',done:false,doneAt:'',items:[]});
      ticketDraft.name='';ticketDraft.startDate=today.value;ticketDraft.due='';ticketDraft.category='';ticketDraft.url='';
    }
    function addTicketItem(ticket) {
      const draft=ticketInputs[ticket.id]||(ticketInputs[ticket.id]={name:'',points:10});const name=String(draft.name||'').trim();if(!name)return;
      ticket.items.push({id:uid(),name,points:Math.max(0,Number(draft.points)||0),done:false,doneAt:''});ticket.waiting=false;touchTicket(ticket);
      ticketInputs[ticket.id]={name:'',points:10};
    }
    function ticketItemBlocker(ticket,item){const prev=(ticket.items||[]).find(x=>x.id===item.dependsOn);return prev&&!prev.done?prev:null;}
    function validateTicketDependency(ticket,item){let id=item.dependsOn;const seen=new Set([item.id]);while(id){if(seen.has(id)){item.dependsOn='';notify('Dépendance circulaire interdite');return;}seen.add(id);id=ticket.items.find(x=>x.id===id)?.dependsOn||'';}}
    function toggleTicketItem(ticket,item) {
      if(!item.done&&ticketItemBlocker(ticket,item)){notify('Termine la tâche précédente avant celle-ci');return;}
      item.done=!item.done;item.doneAt=item.done?today.value:'';if(!item.done)ticket.waiting=false;touchTicket(ticket);
      if(!item.done&&ticket.done){ticket.done=false;ticket.doneAt='';}
    }
    function finishTicket(ticket) {
      if(!ticket.items.length){notify('Ajoute au moins une tâche avant de terminer le ticket');return;}
      if(ticket.items.some(x=>!x.done)){notify('Termine toutes les tâches avant de clôturer le ticket');return;}
      ticket.done=true;ticket.doneAt=today.value;touchTicket(ticket);
    }
    function reopenTicket(ticket){ticket.done=false;ticket.doneAt='';touchTicket(ticket);}
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
      if(ticketNeedsAction(ticket))ticket.waiting=false;
    }
    function ticketPoints(ticket){return (ticket.items||[]).filter(x=>x.done).reduce((s,x)=>s+ticketItemValue(ticket,x),0);}

    const mealEditing = reactive({});
    const mealEditKey = (date,kind) => date+'-'+kind;
    function isMealEditing(date,kind){return !!mealEditing[mealEditKey(date,kind)];}
    function toggleMealEditing(date,kind){const key=mealEditKey(date,kind);mealEditing[key]=!mealEditing[key];}
    function closeMealEditing(date,kind){mealEditing[mealEditKey(date,kind)]=false;}
    function chooseMealDish(date,kind,id){assignDish(date,kind,id);closeMealEditing(date,kind);}
    function clearMealChoice(date,kind){setMeal(date,kind,'dishId','');setMeal(date,kind,'name','');closeMealEditing(date,kind);}
    const mealModes = reactive({});
    const mealDishSearch = reactive({});
    function mealMode(date, kind) { const key=date+'-'+kind; return mealModes[key] || (mealSlot(date,kind).dishId ? 'saved' : 'manual'); }
    function setMealMode(date,kind,mode) { mealModes[date+'-'+kind]=mode; }
    const eveningPreview = ref(true);
    const noteEditing=ref(''), showArchivedNotes=ref(false), noteDragged=ref('');
    const visibleNotes=computed(()=>data.textareas.filter(n=>showArchivedNotes.value ? !!n.archived : !n.archived));
    function addTextarea(){const note={id:uid(),title:'Nouvelle note',content:'',archived:false};data.textareas.push(note);noteEditing.value=note.id;showArchivedNotes.value=false;nextTick(()=>{const el=document.getElementById('note-'+note.id);el?.scrollIntoView({behavior:'smooth',block:'center'});el?.querySelector('textarea')?.focus({preventScroll:true});});}
    function toggleNoteArchive(note){note.archived=!note.archived;if(noteEditing.value===note.id)noteEditing.value='';}
    function dropNote(target){const from=data.textareas.findIndex(n=>n.id===noteDragged.value), to=data.textareas.findIndex(n=>n.id===target.id);noteDragged.value='';if(from<0||to<0||from===to)return;data.textareas.splice(to,0,...data.textareas.splice(from,1));}
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
      open: false, id: null, title: '', category: '', points: 10, malus: false, status: 'todo', projectId: '', due: '', estimatedMinutes: null, estimatedEffort: '',
      urgency: '', difficulty: '', doneAt: '', scope:'personal', workCategoryNames: [], ticketName: '', dependsOn: '', milestoneId: '',alterId:'',startDate:'',recurrence:'',recurrenceEnd:'',subtaskBonusMode:'add',subtaskBonusPoints:10,subtaskBonusMultiplier:1.5,subtasks:[],subtaskDraft:'',
    });

    const DRAFT_KEY='todo-quest-form-drafts-v62-test';
    let persistedDrafts={};
    try{persistedDrafts=JSON.parse(localStorage.getItem(DRAFT_KEY)||'{}')||{};}catch(e){}
    function saveDrafts(){try{localStorage.setItem(DRAFT_KEY,JSON.stringify({task:persistedDrafts.task,quick:persistedDrafts.quick,ticket:clone(ticketDraft)}));}catch(e){}}
    function clearDraft(key){delete persistedDrafts[key];saveDrafts();}
    Object.assign(ticketDraft,persistedDrafts.ticket||{});
    function openTaskForm(task = null, projectId = '') {
      if (task) {
        Object.assign(taskForm, {
          id: task.id, title: task.title, category: task.category || '', points: task.points, malus: !!task.malus, scope:task.scope||'personal', estimatedMinutes: task.estimatedMinutes ?? null, estimatedEffort: task.estimatedEffort || '',
          status: task.status, projectId: task.projectId || '', due: task.due || '',
          urgency: task.urgency || '', difficulty: task.difficulty || '', doneAt: task.doneAt || '', workCategoryNames: workTags(task), ticketName: task.ticketName || '', dependsOn: task.dependsOn || '', milestoneId:task.milestoneId||'',alterId:task.alterId||'',startDate:task.startDate||'',recurrence:task.recurrence||'',recurrenceEnd:task.recurrenceEnd||'',subtaskBonusMode:task.subtaskBonusMode||'add',subtaskBonusPoints:task.subtaskBonusPoints??task.points??10,subtaskBonusMultiplier:task.subtaskBonusMultiplier||1.5,subtasks:clone(task.subtasks||[]).map(s=>({...s,points:Number.isFinite(Number(s.points))?Number(s.points):5})),subtaskDraft:'',
        });
      } else {
        Object.assign(taskForm, {
          id: null, title: '', category: '', points: 10, malus: false, status: 'todo', projectId, scope: view.value==='work'?'work':'personal', estimatedMinutes: null, estimatedEffort: '',
          due: today.value, urgency: '', difficulty: '', doneAt: '', workCategoryNames: [], ticketName: '', dependsOn: '', milestoneId: '',startDate:'',recurrence:'',recurrenceEnd:'',subtaskBonusMode:'add',subtaskBonusPoints:10,subtaskBonusMultiplier:1.5,subtasks:[],subtaskDraft:'',
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
      if(newStatus==='done' && (task.subtasks||[]).some(s=>!s.done)){notify('Valide les sous-tâches avant de terminer la tâche principale');return;}
      if(newStatus==='done'&&task.dependsOn){const dep=data.tasks.find(x=>x.id===task.dependsOn);if(dep&&dep.status!=='done'){notify('Tâche bloquée par « '+dep.title+' »');return;}}
      const old = task.status;
      task.status = newStatus;
      if (newStatus === 'done') { task.doneAt = doneAt || (old === 'done' && task.doneAt) || today.value; if(old!=='done')recurrenceNext(task); }
      else task.doneAt = '';
    }

    function addFormSubtask(){const title=String(taskForm.subtaskDraft||'').trim();if(!title)return;taskForm.subtasks.push({id:uid(),title,done:false,points:5});taskForm.subtaskDraft='';}
    function removeFormSubtask(id){taskForm.subtasks=taskForm.subtasks.filter(x=>x.id!==id);}
    function toggleTaskSubtask(task,sub){sub.done=!sub.done;if(!sub.done && task.status==='done'){task.status='doing';task.doneAt='';}}
    function setSubtaskPoints(task,sub,value){const amount=Number(value);if(!Number.isFinite(amount)||amount<0){notify('Le nombre de points doit être positif ou nul');return;}sub.points=Math.round(amount*100)/100;}

    // Les sous-tâches servent au suivi : seuls les points de la tâche principale sont attribués.
    function recurrenceNext(task){
      const freq=task.recurrence||'';if(!freq)return;
      const base=task.due && task.due>today.value?task.due:today.value;
      let d=new Date(base+'T12:00:00');
      if(freq==='daily')d.setDate(d.getDate()+1);
      else if(freq==='weekly')d.setDate(d.getDate()+7);
      else if(freq==='monthly'){const day=d.getDate();d.setDate(1);d.setMonth(d.getMonth()+1);const max=new Date(d.getFullYear(),d.getMonth()+1,0).getDate();d.setDate(Math.min(day,max));}
      else return;
      const iso=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
      if(task.recurrenceEnd && iso>task.recurrenceEnd)return;
      if(data.tasks.some(x=>x.recurringPreviousId===task.id))return;
      const next=newTask({...clone(task),id:uid(),due:iso,startDate:task.startDate?iso:'',status:'todo',doneAt:'',recurringPreviousId:task.id,subtasks:(task.subtasks||[]).map(x=>({...x,done:false}))});
      data.tasks.push(next);notify('Prochaine occurrence créée pour le '+formatDate(iso));
    }
    function saveTask() {
      if(taskForm.dependsOn&&taskForm.dependsOn===taskForm.id){notify('Dépendance sur soi impossible');return;}
      if(taskForm.id&&taskForm.dependsOn){let cur=taskForm.dependsOn,seen=new Set([taskForm.id]);while(cur){if(seen.has(cur)){notify('Dépendance circulaire impossible');return;}seen.add(cur);cur=data.tasks.find(t=>t.id===cur)?.dependsOn||'';}}
      const title = taskForm.title.trim();
      if (!title) return;
      if(taskForm.recurrenceEnd && taskForm.recurrenceEnd<(taskForm.due||taskForm.startDate||today.value)){notify('La fin de récurrence précède la première échéance');return;}
      const rawDuration = taskForm.estimatedMinutes;
      const durationIsBlank = rawDuration === null || rawDuration === '' || rawDuration === undefined;
      const duration = durationIsBlank ? null : Number(rawDuration);
      if (!durationIsBlank && (!Number.isFinite(duration) || duration <= 0 || duration > 100000 || Math.abs(duration * 100 - Math.round(duration * 100)) > 1e-7)) {
        notify('La durée approximative doit être supérieure à 0, avec au maximum 2 décimales (ex : 2,5 min).');
        return;
      }
      const fields = {
        title,
        estimatedMinutes: duration,
        estimatedEffort: ['light','medium','high'].includes(taskForm.estimatedEffort) ? taskForm.estimatedEffort : '',
        category: taskForm.scope === 'work' ? (taskForm.workCategoryNames[0] || '') : (taskForm.category || ''),
        workCategoryNames: taskForm.scope === 'work' ? [...taskForm.workCategoryNames] : [],
        ticketName: '',
        scope:taskForm.scope==='work'?'work':'personal',
        points: Math.max(0, Number(taskForm.points) || 0),
        malus: !!taskForm.malus,
        projectId: taskForm.scope==='work'?'':(taskForm.projectId || ''),
        due: taskForm.due || '',
        startDate: taskForm.startDate || '',
        recurrence: taskForm.recurrence || '',
        recurrenceEnd: taskForm.recurrenceEnd || '',
        subtaskBonusMode: taskForm.subtaskBonusMode || 'add',
        subtaskBonusPoints: Math.max(0,Number(taskForm.subtaskBonusPoints)||0),
        subtaskBonusMultiplier: Math.max(1,Number(taskForm.subtaskBonusMultiplier)||1.5),
        subtasks: clone(taskForm.subtasks || []),
        urgency: taskForm.urgency || '',
        difficulty: taskForm.difficulty || '',
        dependsOn: taskForm.dependsOn || '',
        alterId:taskForm.alterId||'',
        milestoneId:taskForm.projectId?(taskForm.milestoneId||''):'',
      };
      let becameDone = false;
      let value = 0;
      if (taskForm.id) {
        const t = data.tasks.find(x => x.id === taskForm.id);
        if (t) {
          const was = t.status;
          Object.assign(t, fields);
          if(taskForm.status==='done'&&blockingTask(t)){notify('Termine la tâche préalable avant celle-ci');return;}
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
      quickForm.mode = 'paste';
      quickForm.scope = view.value === 'work' ? 'work' : 'personal';
      quickForm.paste = { text: '', points: 10, malus: false, category: '', workCategoryNames: [], ticketName: '', urgency: '', difficulty: '', due: today.value, project: '' };
      quickForm.due = today.value;
      quickForm.rows = [0, 1, 2].map(() => ({ title: '', points: 10, due: today.value, urgency: '', difficulty: '', workCategoryNames: [], ticketName: '' }));
      if(persistedDrafts.quick&&persistedDrafts.quick.scope===quickForm.scope)Object.assign(quickForm,persistedDrafts.quick,{open:false});
      quickForm.mode = 'paste';
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
      if(newStatus==='done'&&blockingTask(task)){notify('Tâche bloquée : termine d’abord « '+blockingTask(task).title+' »');return;}
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
      if(field==='subtaskToggle'){const s=(task.subtasks||[]).find(x=>x.id===value);if(s)toggleTaskSubtask(task,s);return;}
      if(field==='subtaskPoints'){const s=(task.subtasks||[]).find(x=>x.id===value?.id);if(s)setSubtaskPoints(task,s,value.points);return;}
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
      } else if (field === 'estimatedMinutes') {
        const raw = String(value ?? '').trim().replace(',', '.');
        const duration = raw === '' ? null : Number(raw);
        if (raw !== '' && (!Number.isFinite(duration) || duration <= 0 || duration > 100000 || Math.abs(duration * 100 - Math.round(duration * 100)) > 1e-7)) { notify('Durée invalide (maximum deux décimales)'); return; }
        task.estimatedMinutes = duration;
      } else if (field === 'estimatedEffort') {
        task.estimatedEffort = ['light','medium','high'].includes(value) ? value : '';
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
    const projectForm = reactive({ open: false, id: null, name: '', description: '', color: '#6366f1', tasks: [],startDate:'',endDate:'' });

    function openProjectForm(project = null) {
      if (project) {
        Object.assign(projectForm, {
          id: project.id, name: project.name, description: project.description || '',
          color: project.color || nextColor(data.projects.length), tasks: [],alterId:project.alterId||'',startDate:project.startDate||'',endDate:project.endDate||'',
        });
      } else {
        Object.assign(projectForm, {
          id: null, name: '', description: '', color: nextColor(data.projects.length),
          tasks: [{ title: '', category: '', points: 10, due: '' }],alterId:'',startDate:'',endDate:'',
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
      if(projectForm.startDate && projectForm.endDate && projectForm.endDate<projectForm.startDate){notify('La fin du projet précède son début');return;}
      if (projectForm.id) {
        const p = data.projects.find(x => x.id === projectForm.id);
        if (p) { p.name = name; p.description = projectForm.description.trim(); p.color = projectForm.color;p.alterId=projectForm.alterId||'';p.startDate=projectForm.startDate||'';p.endDate=projectForm.endDate||''; }
      } else {
        const project = { id: uid(), name, description: projectForm.description.trim(), color: projectForm.color,alterId:projectForm.alterId||'',startDate:projectForm.startDate||'',endDate:projectForm.endDate||'' };
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
        points: list.reduce((s, t) => s + taskValue(t), 0) + data.projectMilestones.filter(m=>m.projectId===project.id).reduce((sum,m)=>sum+Math.max(0,Number(m.points)||0),0),
        milestonesTotal:data.projectMilestones.filter(m=>m.projectId===project.id).length,
        milestonesDone:data.projectMilestones.filter(m=>m.projectId===project.id&&milestoneDone(m)).length,
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
    const projectAlterFilter=ref('');
    const activeProjects = computed(() => sortedProjects.value.filter(p=>!p.completed));
    const finishedProjects = computed(() => sortedProjects.value.filter(p=>p.completed));
    function setProjectCompleted(project,completed){ project.completed=!!completed; project.completedAt=completed?today.value:''; }
    const sortedProjects = computed(() => {
      const filtered=data.projects.filter(p=>!projectAlterFilter.value||(projectAlterFilter.value==='__none'?!p.alterId:p.alterId===projectAlterFilter.value));
      if(ui.projectSort==='alter')return [...filtered].sort((a,b)=>String(data.alters.find(z=>z.id===a.alterId)?.name||'').localeCompare(String(data.alters.find(z=>z.id===b.alterId)?.name||''),'fr'));
      if (ui.projectSort !== 'urgency') return filtered;
      const rank = p => { const u = projectTopUrgency(p); return u ? levelRank(data.urgencies, u.id) : 0; };
      return [...filtered].sort((a, b) => rank(b) - rank(a));   // tri stable : à égalité, l'ordre manuel est gardé
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
    // V64 : paliers manuels. Le plan est conservé dans chaque habitude et ne modifie
    // jamais les points des réalisations passées. Activation explicite uniquement.
    function addHabitProgressionStep(){
      const target=Math.floor(Number(habitForm.progressionNewTarget));
      if(!Number.isFinite(target)||target<1||target>7){notify('Objectif hebdomadaire de 1 à 7 nécessaire');return;}
      habitForm.progressionSteps.push({id:uid(),weeklyTarget:target});
      habitForm.progressionNewTarget=target;
    }
    function removeHabitProgressionStep(index){habitForm.progressionSteps.splice(index,1);}
    function activateHabitProgression(h,index){
      const steps=Array.isArray(h.progressionSteps)?h.progressionSteps:[];
      const step=steps[index];if(!step)return;
      const target=Math.floor(Number(step.weeklyTarget));if(!(target>=1&&target<=7))return;
      const msg=h.frequency==='weekly'
        ? 'Activer le palier '+target+' fois/semaine pour « '+h.title+' » ?'
        : 'Ce palier utilisera une fréquence hebdomadaire de '+target+' fois/semaine pour « '+h.title+' ». Confirmer ?';
      if(!confirm(msg))return;
      // Les validations et les points déjà enregistrés sont préservés.
      h.frequency='weekly';h.weeklyTarget=target;h.activeProgressionStep=index;
      h.progressionHistory=Array.isArray(h.progressionHistory)?h.progressionHistory:[];
      h.progressionHistory.push({date:today.value,index,target});
      notify('Palier activé : '+target+' fois/semaine');
    }
    function habitProgressionCompleted(h){
      const k=monday(today.value);return (h.history||[]).filter(d=>d>=k&&d<=today.value).length;
    }
    const habitForm = reactive({open:false,id:null,title:'',frequency:'daily',weekdays:[],every:2,weeklyTarget:3,startDate:'',endDate:'',completed:false,basePoints:1,comboPoints:0.25,maxPoints:10,malus:false,quantityEnabled:false,quantityMax:3,quantityBonus:0.10,pausedUntil:'',progressionSteps:[],progressionNewTarget:3});
    const habitWeekdays = [{id:1,label:'Lun'},{id:2,label:'Mar'},{id:3,label:'Mer'},{id:4,label:'Jeu'},{id:5,label:'Ven'},{id:6,label:'Sam'},{id:0,label:'Dim'}];
    function openHabitForm(habit = null) {
      Object.assign(habitForm, habit ? {open:true,id:habit.id,title:habit.title,frequency:habit.frequency,weekdays:[...(habit.weekdays||[])],every:habit.every||2,weeklyTarget:habit.weeklyTarget||3,startDate:habit.startDate||habit.createdAt||todayStr(),endDate:habit.endDate||'',completed:!!habit.completed,basePoints:habit.basePoints??0,malus:!!habit.malus,comboPoints:habit.comboPoints??0,maxPoints:habit.maxPoints??'',quantityEnabled:!!habit.quantityEnabled,quantityMax:habit.quantityMax||3,quantityBonus:habit.quantityBonus??0.10,pausedUntil:habit.pausedUntil||'',progressionSteps:clone(habit.progressionSteps||[]),progressionNewTarget:3} : {open:true,id:null,title:'',frequency:'daily',weekdays:[],every:2,weeklyTarget:3,startDate:todayStr(),endDate:'',completed:false,basePoints:1,comboPoints:0.25,maxPoints:10,malus:false,quantityEnabled:false,quantityMax:3,quantityBonus:0.10,pausedUntil:'',progressionSteps:[],progressionNewTarget:3});
    }
    function saveHabit() {
      const title = habitForm.title.trim(); if (!title) return;
      if(habitForm.endDate && habitForm.endDate < habitForm.startDate) { notify("La date de fin doit être après la date de début"); return; }
      if((habitForm.progressionSteps||[]).some(step=>!Number.isInteger(Number(step.weeklyTarget))||Number(step.weeklyTarget)<1||Number(step.weeklyTarget)>7)){notify('Chaque palier doit être compris entre 1 et 7 fois/semaine');return;}
      const fields = {title,frequency:habitForm.frequency,weekdays:[...habitForm.weekdays],every:Math.max(1,Number(habitForm.every)||2),weeklyTarget:Math.max(1,Math.min(7,Number(habitForm.weeklyTarget)||3)),startDate:habitForm.startDate||todayStr(),endDate:habitForm.endDate||'',completed:!!habitForm.completed,malus:!!habitForm.malus,basePoints:Math.max(0,Number(habitForm.basePoints)||0),comboPoints:Math.max(0,Number(habitForm.comboPoints)||0),maxPoints:habitForm.maxPoints === '' || habitForm.maxPoints === null ? null : Math.max(0,Number(habitForm.maxPoints)||0),quantityEnabled:!!habitForm.quantityEnabled,quantityMax:Math.max(1,Number(habitForm.quantityMax)||1),quantityBonus:Math.max(0,Number(habitForm.quantityBonus)||0),pausedUntil:habitForm.pausedUntil||'',progressionSteps:clone(habitForm.progressionSteps||[])};
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
      if(h.malus || habitIsFinished(h) || (h.lateDeferredUntil && h.lateDeferredUntil>today.value))return 0;
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
      if(habitIsFinished(h)||(h.pausedUntil&&h.pausedUntil>=today.value))return false;
      if(h.lateDeferredUntil && h.lateDeferredUntil>today.value)return false;
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
    const dashboardHabits = computed(() => data.habits.filter(h=>(!h.pausedUntil||h.pausedUntil<today.value)&&(habitDue(h)||habitLateDays(h)>0)));
    const pausedDashboardHabits = computed(() => data.habits.filter(h=>!habitIsFinished(h)&&h.pausedUntil&&h.pausedUntil>=today.value));
    function completeHabit(h) {
      if(h.malus || habitIsFinished(h)||(h.pausedUntil&&h.pausedUntil>=today.value))return;
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
    function missedHabitDates(h) {
      if (h.malus || habitIsFinished(h)) return [];
      const start=h.startDate||h.createdAt||today.value;
      const result=[];
      for(let i=1;i<=Math.min(90,Math.max(0,dayDiff(start,today.value)));i++) {
        const d=new Date(today.value+'T12:00:00Z');d.setUTCDate(d.getUTCDate()-i);
        const date=d.toISOString().slice(0,10);
        if(date<start)break;
        if((h.history||[]).includes(date)||(h.postponed||[]).includes(date))continue;
        if(h.pausedUntil && date<=h.pausedUntil && date>=start)continue;
        const dow=d.getUTCDay();
        if(h.frequency==='daily' ||
          h.frequency==='weekdays'&&(h.weekdays||[]).includes(dow) ||
          h.frequency==='interval' && dayDiff(start,date)%Math.max(1,h.every||2)===0)
          result.push(date);
      }
      return result;
    }
    function completeHabitPast(h) {
      const dates=missedHabitDates(h);
      if(!dates.length){notify('Aucune occurrence quotidienne passée à régulariser (90 jours)');return;}
      const date=prompt('Date réellement effectuée (AAAA-MM-JJ) :\n'+dates.slice(0,10).join(', '),dates[0]);
      if(date===null)return;
      if(!dates.includes(date)){notify('Date non prévue, déjà validée ou hors période');return;}
      if(!confirm('Enregistrer « '+h.title+' » comme effectuée le '+date+' ?'))return;
      if(!Array.isArray(h.history))h.history=[];
      if(!h.pointAwards)h.pointAwards=Object.fromEntries(habitAwards(h).map(a=>[a.date,a.points]));
      h.history.push(date);h.history.sort();
      const award=habitAwards(h).find(a=>a.date===date);
      h.pointAwards[date]=award?.points??0;
      notify('Habitude validée rétroactivement le '+date);
    }
    function undoHabitPast(h,date) {
      if (h.malus || !(h.history||[]).includes(date)) return;
      if (!confirm('Annuler la validation du '+date+' pour « '+h.title+' » ? Les points correspondants seront retirés.')) return;
      h.history=h.history.filter(d=>d!==date);
      if (h.pointAwards) delete h.pointAwards[date];
      notify('Validation du '+date+' annulée');
    }
    function habitPeriodStats(h,days=28) {
      const end=today.value;
      const from=dateAddSafe(end,-days+1);
      const start=[from,h.startDate||h.createdAt||from].sort().pop();
      const stop=[end,h.endDate||end].sort()[0];
      if(start>stop) return {expected:0,done:0,postponed:0,rate:null};
      let expected=0,done=0,postponed=0;
      const history=new Set(h.history||[]),reports=new Set(h.postponed||[]);
      if(h.frequency==='weekly') {
        const weeks=new Map();
        for(let d=start;d<=stop;d=dateAddSafe(d,1)){
          if(h.pausedUntil && d<=h.pausedUntil && d>=start)continue;
          const w=monday(d);if(!weeks.has(w))weeks.set(w,[]);weeks.get(w).push(d);
        }
        for(const dates of weeks.values()){
          const target=Math.min(Math.max(1,Number(h.weeklyTarget)||3),dates.length);
          expected+=target;
          done+=Math.min(target,dates.filter(d=>history.has(d)).length);
        }
      } else {
        for(let d=start;d<=stop;d=dateAddSafe(d,1)){
          if(h.pausedUntil&&d<=h.pausedUntil)continue;
          const dow=new Date(d+'T12:00:00Z').getUTCDay();
          const scheduled=h.frequency==='daily'||h.frequency==='weekdays'&&(h.weekdays||[]).includes(dow)||h.frequency==='interval'&&dayDiff(h.startDate||h.createdAt||start,d)%Math.max(1,Number(h.every)||2)===0;
          if(!scheduled&&!history.has(d))continue;
          if(reports.has(d)){postponed++;continue;}
          expected++;if(history.has(d))done++;
        }
      }
      return {expected,done,postponed,rate:expected?Math.round(done/expected*100):null};
    }
    function dateAddSafe(value,days){const d=new Date(value+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);}
    function postponeLateHabit(h) {
      const dates=missedHabitDates(h);
      if(!dates.length){notify('Aucune occurrence passée à reporter (90 jours)');return;}
      const date=prompt('Occurrence à reporter (AAAA-MM-JJ) :',dates[0]);
      if(date===null)return;
      if(!dates.includes(date)){notify('Date non admissible');return;}
      if(!confirm('Reporter l’occurrence du '+date+' à demain ?'))return;
      if(!Array.isArray(h.postponed))h.postponed=[];
      if(!h.postponed.includes(date))h.postponed.push(date);
      const tomorrow=dateAddSafe(today.value,1);
      h.forceDue=tomorrow;
      // Masquer le retard ET la proposition du jour jusqu'à demain.
      // Les autres occurrences en retard ne sont pas effacées silencieusement.
      h.lateDeferredUntil=tomorrow;
      notify('Occurrence du '+date+' reportée au '+tomorrow+'. Reprise demain.');
    }
    function postponeHabit(h) {
      if (!confirm('Reporter « '+h.title+' » à demain ?')) return;
      const d=new Date(today.value+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+1);
      const tomorrow=d.toISOString().slice(0,10);
      if (!Array.isArray(h.postponed)) h.postponed=[];
      if (!h.postponed.includes(today.value)) h.postponed.push(today.value);
      h.forceDue=tomorrow;
      h.lateDeferredUntil=tomorrow;
    }
    function undoHabit(h) { if(!confirm('Annuler la réalisation du jour ?'))return; h.history=(h.history||[]).filter(d=>d!==today.value); if(h.pointAwards)delete h.pointAwards[today.value]; }
    function deleteHabit(h) {if(confirm('Supprimer cette habitude et son historique ?')) {data.trash.unshift({id:uid(),type:'habit',deletedAt:new Date().toISOString(),payload:clone(h)});data.habits=data.habits.filter(x=>x.id!==h.id);}}
    const habitCount = h => (h.history||[]).length;

    /* ---------- Idées d'activités ---------- */
    const randomActivity=ref(null);
    function pickRandomActivity(){if(!data.activities.length){randomActivity.value=null;return;}randomActivity.value=data.activities[Math.floor(Math.random()*data.activities.length)];}
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
      {id:'single-habit',label:'Réaliser X fois une habitude précise'},
      {id:'all-habits',label:'Effectuer toutes les habitudes prévues'},
      {id:'project-count',label:'Terminer X tâches d’un projet'},
      {id:'selected-tasks',label:'Terminer les tâches sélectionnées'},
      {id:'level-deadline',label:'Terminer les tâches d’une urgence / difficulté avant une date'}
    ];
    const challengeForm = reactive({open:false,id:null,name:'',kind:'task-count',scope:'personal',projectId:'',target:5,period:'daily',points:10,enabled:true,selectedTaskIds:[],urgency:'',difficulty:'',deadline:'',habitId:''});
    function openChallengeForm(ch = null) {
      Object.assign(challengeForm, ch ? {
        open:true,id:ch.id,name:ch.name,kind:ch.kind,scope:ch.scope||'personal',
        projectId:ch.projectId||'',target:ch.target||1,period:ch.period||'daily',
        points:ch.points||0,enabled:ch.enabled!==false,selectedTaskIds:[...(ch.selectedTaskIds||[])],urgency:ch.urgency||'',difficulty:ch.difficulty||'',deadline:ch.deadline||'',habitId:ch.habitId||''
      } : {open:true,id:null,name:'',kind:'task-count',scope:'personal',projectId:'',target:5,period:'daily',points:10,enabled:true,selectedTaskIds:[],urgency:'',difficulty:'',deadline:'',habitId:''});
    }
    function saveChallenge() {
      const name=String(challengeForm.name||'').trim();
      const target=Math.floor(Number(challengeForm.target));
      const points=Number(challengeForm.points);
      if (!name || !Number.isFinite(points) || points<0 || !Number.isFinite(target) || target<1 || target>100000) {notify('Nom, objectif et points invalides');return;}
      if (challengeForm.kind==='selected-tasks' && !challengeForm.selectedTaskIds.length) {notify('Sélectionne au moins une tâche');return;}
      if (challengeForm.kind==='level-deadline' && (!challengeForm.deadline || (!challengeForm.urgency && !challengeForm.difficulty))) {notify('Indique une date et au moins un niveau');return;}
      if (challengeForm.kind==='single-habit' && !data.habits.some(h=>h.id===challengeForm.habitId&&!h.malus)) {notify('Choisis une habitude active');return;}
      if (challengeForm.kind==='project-count' && !data.projects.some(p=>p.id===challengeForm.projectId)) {notify('Sélectionne un projet');return;}
      const targetHabit=data.habits.find(h=>h.id===challengeForm.habitId);
      const baselineFrom=today.value;
      const baseline=(challengeForm.kind==='single-habit'&&targetHabit)
        ?(targetHabit.history||[]).filter(d=>d>=baselineFrom&&d<=today.value).length:0;
      const fields={activationBaseline:baseline,baselinePeriodKey:challengeForm.period==='once'?'once':challengeForm.period==='weekly'?weekStart(today.value):today.value,name,kind:challengeForm.kind,habitId:challengeForm.kind==='single-habit'?challengeForm.habitId:'',scope:challengeForm.scope,projectId:challengeForm.kind==='project-count'?challengeForm.projectId:'',target,period:['selected-tasks','level-deadline'].includes(challengeForm.kind)?'once':challengeForm.period,points:Math.round(points*100)/100,enabled:challengeForm.enabled,selectedTaskIds:[...challengeForm.selectedTaskIds],urgency:challengeForm.urgency,difficulty:challengeForm.difficulty,deadline:challengeForm.deadline,deadlineTaskIds:challengeForm.kind==='level-deadline'?data.tasks.filter(t=>(!challengeForm.urgency||t.urgency===challengeForm.urgency)&&(!challengeForm.difficulty||t.difficulty===challengeForm.difficulty)).map(t=>t.id):[]};
      if (challengeForm.id) {
        const item=data.challenges.find(c=>c.id===challengeForm.id);
        if(item) Object.assign(item,fields,{activationDate:today.value,hiddenHome:false});
      } else data.challenges.push({id:uid(),...fields,activationDate:today.value});
      challengeForm.open=false;
      evaluateChallenges();
    }
    function newChallengeFromHabit(h){
      if(!h||h.malus){notify('Choisis une bonne habitude');return;}
      openChallengeForm();
      Object.assign(challengeForm,{name:'Défi : '+h.title,kind:'single-habit',habitId:h.id,
        target:Math.max(1,Math.min(7,Number(h.weeklyTarget)||3)),period:'weekly',points:5});
      view.value='challenges';
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
      if(c.kind==='single-habit'){
        const habit=data.habits.find(h=>h.id===c.habitId);
        const base=c.period==='once'?(c.activationDate||today.value):start;
        const from=base>(c.activationDate||base)?base:(c.activationDate||base);
        const raw=habit?(habit.history||[]).filter(d=>d>=from&&d<=end).length:0;
        const current=Math.max(0,raw-(challengePeriodKey(c,date)===(c.baselinePeriodKey||'')?(Number(c.activationBaseline)||0):0));
        const goal=Math.max(1,Number(c.target)||1);
        return {current,target:goal,complete:!!habit&&current>=goal};
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
          notify(user.value ? 'Import réussi : synchronisation Firebase en cours' : 'Import réussi');
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
    const firebaseReady = Boolean(cfg.apiKey && cfg.projectId && window.firebase && firebase.apps); // synchronisation Firebase réactivée

    const user = ref(null);
    const syncState = ref(firebaseReady ? 'signedout' : 'local');
    const syncLabel = computed(() => ({
      local:     'Firebase indisponible : données locales',
      signedout: 'Non connecté : données sur cet appareil uniquement',
      syncing:   'Synchronisation…',
      synced:    'Synchronisé',
      error:     'Erreur de synchro',
      conflict:  'Conflit : exporte tes données, puis recharge la page',
    }[syncState.value]));

    const clientId = uid();           // identifie cet onglet / appareil
    let auth = null, db = null, docRef = null;
    let unsubscribe = null, saveTimer = null, lastSyncedJson = '', firstSnapshot = true;
    let cloudInitialized = false; // aucune écriture avant lecture du premier état serveur
    let baseSnapshot = null; // dernier document distant connu
    let writingCloud = false;
    let hasConflict = false;

    async function pushToCloud() {
      if (!docRef || !cloudInitialized || hasConflict || writingCloud) return;
      writingCloud = true;
      syncState.value = 'syncing';
      const localCopy = JSON.parse(JSON.stringify(data));
      const localJson = JSON.stringify(localCopy);
      const clean = obj => Object.fromEntries(Object.entries(obj || {}).filter(([key]) => key !== '_by' && key !== '_savedAt'));
      const originalBase = clean(baseSnapshot);
      try {
        const merged = await db.runTransaction(async tx => {
          const doc = await tx.get(docRef);
          const latest = clean(doc.exists ? doc.data() : {});
          const result = window.TodoQuestMerge.threeWay(originalBase, localCopy, latest);
          if (result.conflicts.length) {
            const err = new Error('Conflit sur : ' + result.conflicts.slice(0, 8).join(', '));
            err.isSyncConflict = true;
            throw err;
          }
          const payload = { ...result.result, _by: clientId,
            _savedAt: firebase.firestore.FieldValue.serverTimestamp() };
          tx.set(docRef, payload);
          return result.result;
        });
        baseSnapshot = JSON.parse(JSON.stringify(merged));
        if (JSON.stringify(data) === localJson) {
          applyRemote(merged);
          syncState.value = 'synced';
        } else {
          // Une saisie a continue pendant la transaction: ne pas la perdre.
          lastSyncedJson = JSON.stringify(merged);
          syncState.value = 'syncing';
        }
      } catch (err) {
        console.error('Firestore V72 :', err);
        if (err.isSyncConflict) {
          hasConflict = true;
          syncState.value = 'conflict';
          notify('Conflit entre appareils : aucune donnee distante ecrasee. Exporte un JSON avant de recharger.');
        } else syncState.value = 'error';
      } finally {
        writingCloud = false;
        if (!hasConflict && docRef && cloudInitialized &&
            JSON.stringify(data) !== lastSyncedJson) {
          clearTimeout(saveTimer);
          saveTimer = setTimeout(() => { saveTimer = null; pushToCloud(); }, 1000);
        }
      }
    }

    function flushNow() {
      if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; return pushToCloud(); }
      return Promise.resolve();
    }

    function applyRemote(remote) {
      applyData(remote);
      lastSyncedJson = JSON.stringify(data);
    }

    function startSync(u) {
      docRef = db.collection('users').doc(u.uid);
      firstSnapshot = true;
      cloudInitialized = false;
      hasConflict = false;
      baseSnapshot = null;
      syncState.value = 'syncing';

      unsubscribe = docRef.onSnapshot(snap => {
        if (snap.metadata.hasPendingWrites) return;        // écho de nos propres écritures
        if (firstSnapshot && snap.metadata.fromCache) return; // on attend la vraie réponse du serveur
        const remote = snap.exists ? snap.data() : null;

        if (firstSnapshot) {
          firstSnapshot = false;
          if (!remote) {
            // Jamais de création du document cloud sans accord explicite.
            if (!confirm('Aucune sauvegarde Firebase trouvée pour ce compte. Envoyer les données locales dans le cloud ?\n\nOK = créer la sauvegarde cloud\nAnnuler = rester en lecture seule (aucune écriture Firebase).')) {
              syncState.value = 'error';
              notify('Envoi cloud annulé : déconnecte-toi pour continuer en local');
              return;
            }
            lastSyncedJson = JSON.stringify(data);
            baseSnapshot = {};
            cloudInitialized = true;
            pushToCloud();
            return;
          }
          // Toujours charger le document distant existant : aucun écrasement du cloud par
          // des données de test importées ou conservées localement, sans action explicite.
          applyRemote(remote);
          baseSnapshot = JSON.parse(JSON.stringify(remote));
          cloudInitialized = true;
          // Sauvegarde une seule fois le catalogue ajouté au cloud, sans toucher aux autres valeurs.
          const remoteIds = new Set((Array.isArray(remote.sportExercises) ? remote.sportExercises : []).filter(x=>x && x.id).map(x=>x.id));
          const catalogueMigration = (window.TODO_SPORT_V67 || []).some(ex => ex && ex.id && !remoteIds.has(ex.id));
          if(catalogueMigration) {
            pushToCloud();
            notify('Catalogue sportif enrichi et synchronisé.');
          } else {
            syncState.value = 'synced';
            notify('Données Firebase chargées. Pense à exporter un JSON avant les tests.');
          }
          return;
        }

        // Mises à jour venant d'un autre appareil
        if (cloudInitialized && remote && remote._by !== clientId && !hasConflict) {
          // Si une saisie locale attend, ne pas remplacer cette saisie par le cloud.
          if (saveTimer || writingCloud || JSON.stringify(data) !== lastSyncedJson) {
            if (!writingCloud && !saveTimer) {
              saveTimer = setTimeout(() => { saveTimer = null; pushToCloud(); }, 1000);
            }
          } else {
            applyRemote(remote);
            baseSnapshot = JSON.parse(JSON.stringify(remote));
            syncState.value = 'synced';
          }
        }
      }, err => { console.error('Firestore :', err); syncState.value = 'error'; });
    }

    if (firebaseReady) {
      firebase.initializeApp(cfg);
      auth = firebase.auth();
      db = firebase.firestore();

      auth.onAuthStateChanged(u => {
        if (unsubscribe) { unsubscribe(); unsubscribe = null; }
        cloudInitialized = false;
        hasConflict = false;
        baseSnapshot = null;
        if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
        docRef = null;
        user.value = u ? { name: u.displayName, email: u.email } : null;
        if (u) startSync(u); else syncState.value = 'signedout';
      });

      // Envoi vers le cloud dès que les données changent (avec un petit délai)
      watch(data, () => {
        if (!docRef || !cloudInitialized || hasConflict) return;
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
    function setMealState(date,kind,state){openFoodReview(date,kind,state==='missed'?'changed':'taken');}
    // Catalogue repas, ingrédients et courses
    const menuTab=ref('planning');
    const dishQuery=ref(''), ingredientQuery=ref(''), dishIngredientQuery=ref(''), shoppingQuery=ref('');
    const dishDraft=reactive({name:'',ingredientIds:[],category:'Sans catégorie',categories:['Sans catégorie'],difficulty:'',time:''});
    const dishCategoryFilter=ref(''),dishFoodTypeFilter=ref(''),dishDifficultyFilter=ref(''),dishTimeFilter=ref(''),dishSort=ref('name'),suggestDishCategory=ref(''),suggestFoodType=ref(''),suggestPage=ref(1),suggestPageSize=ref(10);
    const dishEditing=ref(''),dishCategoryNew=ref(''),dishDragged=ref(''),dishCategoryDragged=ref(''),ingredientDragged=ref(''),menuRulesEditing=ref(false);
    // Difficulté et temps sont des listes de niveaux configurables dont l'ordre sert aux tris.
    const dishLevelDraft=reactive({difficulty:'',time:''});
    function dishLevels(kind){return kind==='difficulty'?data.dishDifficulties:data.dishTimes;}
    function addDishLevel(kind){const list=dishLevels(kind),name=String(dishLevelDraft[kind]||'').trim();if(name&&!list.some(x=>x.toLocaleLowerCase()===name.toLocaleLowerCase()))list.push(name);dishLevelDraft[kind]='';}
    function renameDishLevel(kind,name){const list=dishLevels(kind),next=prompt('Renommer :',name)?.trim();if(!next||next===name||list.includes(next))return;const index=list.indexOf(name);if(index<0)return;list.splice(index,1,next);data.dishes.forEach(d=>{if(d[kind]===name)d[kind]=next;});if(dishDraft[kind]===name)dishDraft[kind]=next;if(kind==='difficulty'&&dishDifficultyFilter.value===name)dishDifficultyFilter.value=next;if(kind==='time'&&dishTimeFilter.value===name)dishTimeFilter.value=next;}
    function deleteDishLevel(kind,name){if(!confirm('Supprimer « '+name+' » ? Les plats seront conservés, mais sans cette valeur.'))return;const list=dishLevels(kind),index=list.indexOf(name);if(index>=0)list.splice(index,1);data.dishes.forEach(d=>{if(d[kind]===name)d[kind]='';});if(dishDraft[kind]===name)dishDraft[kind]='';if(kind==='difficulty'&&dishDifficultyFilter.value===name)dishDifficultyFilter.value='';if(kind==='time'&&dishTimeFilter.value===name)dishTimeFilter.value='';}
    const dishLevelDragged=reactive({kind:'',name:''});
    function reorderDishLevel(kind,target){if(dishLevelDragged.kind!==kind)return;const list=dishLevels(kind),a=list.indexOf(dishLevelDragged.name),b=list.indexOf(target);if(a>=0&&b>=0&&a!==b){const [item]=list.splice(a,1);list.splice(b,0,item);}dishLevelDragged.kind='';dishLevelDragged.name='';}
    function dishLevelRank(kind,value){const rank=dishLevels(kind).indexOf(value);return rank<0?Number.MAX_SAFE_INTEGER:rank;}
    const dishCategoryOpen=reactive({});
    function dishCats(d){return [...new Set((Array.isArray(d.categories)?d.categories:(d.category?[d.category]:['Sans catégorie'])).filter(Boolean))];}
    function setDishCats(d,cats){d.categories=[...new Set(cats.filter(Boolean))];d.category=d.categories[0]||'Sans catégorie';}
    const dishFoodTypes=computed(()=>[...new Set(data.ingredients.map(i=>i.category||'Sans catégorie'))]);
    function dishMatchesFood(d,type){return !type||(d.ingredientIds||[]).some(id=>data.ingredients.some(i=>i.id===id&&(i.category||'Sans catégorie')===type));}
    function dishCategoryIsOpen(c){return dishCategoryOpen[c]!==false || !!dishQuery.value.trim();}
    function toggleDishCategory(c){dishCategoryOpen[c]=!dishCategoryIsOpen(c);}
    function reorderDishCategory(to){const from=dishCategoryDragged.value;dishCategoryDragged.value='';if(!from||from===to||from==='Sans catégorie'||to==='Sans catégorie')return;const list=data.dishCategories;const i=list.indexOf(from),k=list.indexOf(to);if(i<0||k<0)return;list.splice(i,1);list.splice(k,0,from);}
    const dishCategoryList=computed(()=>[...new Set(['Sans catégorie',...(data.dishCategories||[]),...data.dishes.flatMap(d=>dishCats(d))])]);
    function addDishCategory(){const n=dishCategoryNew.value.trim();if(n&&!dishCategoryList.value.some(c=>c.toLowerCase()===n.toLowerCase()))data.dishCategories.push(n);dishCategoryNew.value='';}
    function renameDishCategory(c){if(c==='Sans catégorie')return;const n=prompt('Nouveau nom de la catégorie',c)?.trim();if(!n||n===c||dishCategoryList.value.includes(n))return;data.dishCategories.splice(data.dishCategories.indexOf(c),1,n);data.dishes.forEach(d=>{if(dishCats(d).includes(c))setDishCats(d,dishCats(d).map(x=>x===c?n:x));});}
    function deleteDishCategory(c){if(c==='Sans catégorie'||!confirm('Supprimer la catégorie et déplacer ses plats dans Sans catégorie ?'))return;data.dishCategories=data.dishCategories.filter(x=>x!==c);data.dishes.forEach(d=>{if(dishCats(d).includes(c))setDishCats(d,dishCats(d).filter(x=>x!==c));});}
    function dropDishCategory(c){const d=data.dishes.find(x=>x.id===dishDragged.value);if(d)setDishCats(d,[...dishCats(d).filter(x=>x!=='Sans catégorie'),c]);dishDragged.value='';}
    function dropIngredientCategory(c){const i=data.ingredients.find(x=>x.id===ingredientDragged.value);if(i){i.category=c;data.shoppingItems.filter(x=>x.ingredientId===i.id).forEach(x=>x.category=c);}ingredientDragged.value='';}
    const ingredientCategoryOpen=reactive({});
    const ingredientCategoryDragged=ref('');
    function ingredientIsOpen(c){return ingredientCategoryOpen[c]!==false || !!ingredientQuery.value.trim();}
    function toggleIngredientCategory(c){ingredientCategoryOpen[c]=!ingredientIsOpen(c);}
    function reorderIngredientCategory(to){const from=ingredientCategoryDragged.value;ingredientCategoryDragged.value='';if(!from||from===to||from==='Sans catégorie'||to==='Sans catégorie')return;const list=data.ingredientCategories;const i=list.indexOf(from),j=list.indexOf(to);if(i<0||j<0)return;list.splice(i,1);list.splice(j,0,from);}
    function deleteIngredientCategory(c){if(c==='Sans catégorie')return;if(!confirm('Supprimer cette catégorie ? Ses ingrédients seront conservés dans Sans catégorie.'))return;data.ingredients.filter(i=>(i.category||'Sans catégorie')===c).forEach(i=>i.category='Sans catégorie');data.shoppingItems.filter(i=>i.category===c).forEach(i=>i.category='Sans catégorie');data.ingredientCategories=data.ingredientCategories.filter(x=>x!==c);if(ingredientCategoryDraft.value===c)ingredientCategoryDraft.value='Sans catégorie';delete ingredientCategoryOpen[c];}
    function renameIngredientCategory(c){if(c==='Sans catégorie')return;const n=prompt('Renommer la catégorie',c)?.trim();if(!n||n===c||ingredientCategoryList.value.includes(n))return;const idx=data.ingredientCategories.indexOf(c);if(idx>=0)data.ingredientCategories.splice(idx,1,n);data.ingredients.filter(i=>i.category===c).forEach(i=>i.category=n);data.shoppingItems.filter(i=>i.category===c).forEach(i=>i.category=n);if(ingredientCategoryDraft.value===c)ingredientCategoryDraft.value=n;}
    const dishEditSearch=ref('');
    function toggleDishIngredient(d,id){if(!Array.isArray(d.ingredientIds))d.ingredientIds=[];const k=d.ingredientIds.indexOf(id);if(k>=0)d.ingredientIds.splice(k,1);else d.ingredientIds.push(id);}
    function saveDishEdit(d){d.name=String(d.name||'').trim();if(!d.name){notify('Nom de plat obligatoire');return;}if(!d.time||!d.difficulty){notify('Renseigne le temps et la difficulté');return;}d.ingredientIds=[...new Set(d.ingredientIds||[])];dishEditing.value='';}
    const ingredientDraft=ref(''), ingredientCategoryDraft=ref('Sans catégorie'), newIngredientCategory=ref('');
    const ingredientLocationDraft=ref(''), newIngredientLocation=ref('');
    const ingredientEditId=ref(''),ingredientEditName=ref(''),shoppingEditId=ref('');
    function startIngredientEdit(i){ingredientEditId.value=i.id;ingredientEditName.value=i.name;}
    function saveIngredientEdit(i){const name=ingredientEditName.value.trim();if(!name){notify('Nom obligatoire');return;}if(data.ingredients.some(x=>x.id!==i.id&&x.name.toLocaleLowerCase()===name.toLocaleLowerCase())){notify('Nom déjà utilisé');return;}i.name=name;data.shoppingItems.filter(x=>x.ingredientId===i.id).forEach(x=>x.name=name);ingredientEditId.value='';}
    function money(value){return (Number(value)||0).toFixed(2);}
    const ingredientLocationList=computed(()=>[...new Set([...(data.ingredientLocations||[]),...data.ingredients.map(i=>i.location).filter(Boolean)])]);
    function addIngredientLocation(){const name=newIngredientLocation.value.trim();if(!name)return;if(!data.ingredientLocations.some(x=>x.toLocaleLowerCase()===name.toLocaleLowerCase()))data.ingredientLocations.push(name);ingredientLocationDraft.value=name;newIngredientLocation.value='';}
    const shoppingEstimatedDraft=ref(null), shoppingPriceItem=ref(null), shoppingPriceInput=ref(null);
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
    const filteredDishes=computed(()=>data.dishes.filter(x=>String(x.name||'').toLocaleLowerCase().includes(dishQuery.value.toLocaleLowerCase())&&(!dishCategoryFilter.value||dishCats(x).includes(dishCategoryFilter.value))&&dishMatchesFood(x,dishFoodTypeFilter.value)&&(!dishDifficultyFilter.value||x.difficulty===dishDifficultyFilter.value)&&(!dishTimeFilter.value||x.time===dishTimeFilter.value)).sort((a,b)=>{const order=dishSort.value;if(order==='difficulty-asc'||order==='difficulty-desc'||order==='time-asc'||order==='time-desc'){const kind=order.startsWith('difficulty')?'difficulty':'time',sign=order.endsWith('desc')?-1:1;const av=dishLevelRank(kind,a[kind]),bv=dishLevelRank(kind,b[kind]);if(av!==bv)return sign*(av-bv);}return Number(!!b.favorite)-Number(!!a.favorite)||String(a.name||'').localeCompare(String(b.name||''),'fr');}));
    const dishIngredientChoices=computed(()=>(Array.isArray(data.ingredients)?data.ingredients:[]).filter(x=>x&&String(x.name||'').toLocaleLowerCase().includes(dishIngredientQuery.value.toLocaleLowerCase())));
    const ingredientOwnedFilter=ref('all');
    const shiftISODate=(date,days)=>{const d=new Date(date+'T12:00:00');d.setDate(d.getDate()+days);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
    const pantryExpiring=computed(()=>data.ingredients.filter(i=>i.owned&&i.expiry&&i.expiry>=today.value&&i.expiry<=shiftISODate(today.value,7)).sort((a,b)=>a.expiry.localeCompare(b.expiry)));
    const pantryOverdue=computed(()=>data.ingredients.filter(i=>i.owned&&i.expiry&&i.expiry<today.value).sort((a,b)=>a.expiry.localeCompare(b.expiry)));
    const filteredIngredients=computed(()=>(Array.isArray(data.ingredients)?data.ingredients:[]).filter(x=>x&&(ingredientOwnedFilter.value==='all'||!!x.owned===(ingredientOwnedFilter.value==='owned'))&&String(x.name||'').toLocaleLowerCase().includes(ingredientQuery.value.toLocaleLowerCase())).sort((a,b)=>String(a.name||'').localeCompare(String(b.name||''),'fr')));
    function addIngredientCategory(){const name=newIngredientCategory.value.trim();if(!name)return;if(!data.ingredientCategories.some(x=>x.toLocaleLowerCase()===name.toLocaleLowerCase()))data.ingredientCategories.push(name);ingredientCategoryDraft.value=name;newIngredientCategory.value='';}
    function addIngredient(){const name=ingredientDraft.value.trim();if(!name)return; if(data.ingredients.some(i=>i.name.toLocaleLowerCase()===name.toLocaleLowerCase())){notify('Ingrédient déjà présent');return;}data.ingredients.push({id:uid(),name,category:ingredientCategoryDraft.value||'Sans catégorie',owned:false,location:ingredientLocationDraft.value,expiry:'',stockNote:''});ingredientDraft.value='';}
    function setIngredientOwned(i,owned){i.owned=owned;if(owned)data.shoppingItems=data.shoppingItems.filter(x=>x.ingredientId!==i.id);}
    function moveShoppingCategory(target){const from=shoppingCategoryDragged.value;shoppingCategoryDragged.value='';if(!from||from===target)return;const order=data.ingredientCategories;const src=order.indexOf(from),dest=order.indexOf(target);if(src<0||dest<0)return;order.splice(src,1);order.splice(dest,0,from);}
    function favoriteDish(d){d.favorite=!d.favorite;}
    function addReplacedMealToCatalogue(x){
      if(!x?.completed||x.status!=='changed'||!String(x.actual||'').trim())return;
      const title=String(x.actual).trim();
      if(data.dishes.some(d=>String(d.name).toLowerCase()===title.toLowerCase())){notify('Ce plat existe déjà : complète ses ingrédients dans le catalogue');return;}
      data.dishes.push({id:uid(),name:title,category:x.category||'Sans catégorie',categories:[x.category||'Sans catégorie'],ingredientIds:[],difficulty:'',time:'',favorite:false});
      menuTab.value='dishes';dishQuery.value=title;dishEditing.value=data.dishes[data.dishes.length-1].id;setTab('menu');notify('Complète ingrédients, difficulté et temps avant de valider le plat');
    }
    function addDish(){const name=dishDraft.name.trim();if(!name)return;if(!dishDraft.difficulty||!dishDraft.time){notify('Difficulté et temps obligatoires');return;}data.dishes.push({id:uid(),name,category:dishDraft.categories[0]||'Sans catégorie',categories:[...dishDraft.categories],ingredientIds:[...new Set(dishDraft.ingredientIds)],difficulty:dishDraft.difficulty,time:dishDraft.time});dishDraft.difficulty='';dishDraft.time='';dishDraft.name='';dishDraft.ingredientIds=[];dishDraft.categories=['Sans catégorie'];}
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
        else data.shoppingItems.push({id:uid(),name:i.name,ingredientId:i.id,manual:false,checked:false,quantity:'',store:'',category:normalizeIngredientCategory(i),sourceKeys:[key],estimatedPrice:0,finalPrice:null});
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
      else data.shoppingItems.push({id:uid(),name,ingredientId:selected?.id||'',category:selected?normalizeIngredientCategory(selected):shoppingCategoryDraft.value,store,manual:true,checked:false,quantity:shoppingQuantityDraft.value.trim(),sourceKeys:[],estimatedPrice:Math.max(0,Number(shoppingEstimatedDraft.value)||0),finalPrice:null});
      shoppingDraft.value='';shoppingEstimatedDraft.value=null;shoppingQuantityDraft.value='';shoppingIngredientId.value='';
    }
    function addIngredientToShopping(i){const existing=data.shoppingItems.find(s=>s.ingredientId===i.id&&!s.store&&!s.checked);if(!existing)data.shoppingItems.push({id:uid(),name:i.name,ingredientId:i.id,category:normalizeIngredientCategory(i),store:'',manual:true,checked:false,quantity:'',sourceKeys:[],estimatedPrice:0,finalPrice:null});else notify('Déjà présent sans magasin : ajoute-le depuis les courses pour choisir un magasin');}
    function commitShoppingCheck(item){item.checked=true;if(item.ingredientId){const i=data.ingredients.find(x=>x.id===item.ingredientId);if(i)i.owned=true;}}
    function checkShoppingItem(item){if(item.checked){item.checked=false;return;}if(item.finalPrice===null||item.finalPrice===undefined||item.finalPrice===''){shoppingPriceItem.value=item;shoppingPriceInput.value=item.estimatedPrice>0?item.estimatedPrice:null;return;}commitShoppingCheck(item);}
    function confirmShoppingPrice(){const item=shoppingPriceItem.value;if(!item)return;const n=Number(shoppingPriceInput.value);if(shoppingPriceInput.value===null||shoppingPriceInput.value===''||!Number.isFinite(n)||n<0){notify('Indique le prix définitif (0 € est possible)');return;}item.finalPrice=n;commitShoppingCheck(item);shoppingPriceItem.value=null;shoppingPriceInput.value=null;}
    function finishShopping(){const checked=data.shoppingItems.filter(i=>i.checked);if(!checked.length){notify('Aucun article validé');return;}const missing=checked.filter(i=>i.finalPrice===null||i.finalPrice===undefined||i.finalPrice==='');if(missing.length){notify('Renseigne les prix définitifs manquants');return;}if(!confirm('Terminer les courses ? Les articles achetés seront archivés et les articles non cochés resteront dans la liste.'))return;data.shoppingSessions.unshift({id:uid(),date:new Date().toISOString(),items:clone(checked),total:checked.reduce((s,i)=>s+Number(i.finalPrice||0),0)});data.shoppingItems=data.shoppingItems.filter(i=>!i.checked);notify('Courses terminées : achats archivés, articles restants conservés.');}
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
    const suggestedTasks=computed(()=>data.tasks.filter(t=>t.status!=='done'&&t.scope!=='work'&&!blockingTask(t)).map(t=>{
      const urgencyRank=levelRank(data.urgencies,t.urgency);
      const difficultyRank=levelRank(data.difficulties,t.difficulty);
      const due=taskDue(t);const hasDue=typeof due==='string' && /^\d{4}-\d{2}-\d{2}$/.test(due);
      const delta=hasDue?Math.round((new Date(due+'T12:00:00')-new Date(today.value+'T12:00:00'))/86400000):Infinity;
      const category=delta<0?0:delta===0?1:Number.isFinite(delta)?2:3;
      return {task:t,category,delta,urgencyRank,difficultyRank};
    }).sort((a,b)=>a.category-b.category || (Number.isFinite(a.delta)&&Number.isFinite(b.delta)?a.delta-b.delta:0) || b.urgencyRank-a.urgencyRank || b.difficultyRank-a.difficultyRank || String(a.task.title).localeCompare(String(b.task.title),'fr')).slice(0,5));
    function refreshPriorities(){today.value=todayStr();notify('Priorités recalculées');}
    if(typeof document!=='undefined')document.addEventListener('visibilitychange',()=>{if(!document.hidden)today.value=todayStr();});
    const milestoneDraft=reactive({});
    const milestoneTaskDraft=reactive({});
    function milestoneTaskLabel(task){
      const milestone=task.milestoneId && data.projectMilestones.find(m=>m.id===task.milestoneId && m.projectId===task.projectId);
      return milestone ? `${milestone.title} - ${task.title}` : task.title;
    }
    const milestoneDrag=reactive({taskId:'',projectId:'',overId:''});
    function startMilestoneTaskDrag(event,task){
      milestoneDrag.taskId=task.id;milestoneDrag.projectId=task.projectId;milestoneDrag.overId='';
      if(event.dataTransfer){event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain','todo-task:'+task.id);}
      event.stopPropagation();
    }
    function endMilestoneTaskDrag(){milestoneDrag.taskId='';milestoneDrag.projectId='';milestoneDrag.overId='';}
    function dropTaskIntoMilestone(event,project,milestoneId,targetTaskId=''){
      event.preventDefault();event.stopPropagation();
      const task=data.tasks.find(t=>t.id===milestoneDrag.taskId);
      if(!task || task.projectId!==project.id){endMilestoneTaskDrag();return;}
      if(targetTaskId===task.id){endMilestoneTaskDrag();return;}
      task.milestoneId=milestoneId||'';
      if(targetTaskId){
        const from=data.tasks.indexOf(task);
        data.tasks.splice(from,1);
        const target=data.tasks.findIndex(t=>t.id===targetTaskId);
        if(target>=0)data.tasks.splice(target,0,task);else data.tasks.push(task);
      }
      endMilestoneTaskDrag();
    }
    function milestoneTasks(m){return data.tasks.filter(t=>t.projectId===m.projectId&&t.milestoneId===m.id);}
    function linkMilestoneTask(m,id){const t=data.tasks.find(t=>t.id===id && t.projectId===m.projectId);if(t)t.milestoneId=m.id;}
    function addMilestoneTask(m){const title=String(milestoneTaskDraft[m.id]||'').trim();if(!title)return;data.tasks.push(newTask({title,projectId:m.projectId,milestoneId:m.id,scope:'personal'}));milestoneTaskDraft[m.id]='';}
    function renameMilestone(m){const title=prompt('Nouveau nom du jalon',m.title);if(title===null)return;const clean=title.trim();if(clean)m.title=clean;else notify('Nom du jalon obligatoire');}
    function addMilestone(project){const title=(milestoneDraft[project.id]||'').trim();if(!title)return;data.projectMilestones.push({id:uid(),projectId:project.id,title,done:false,points:0});milestoneDraft[project.id]='';}
    function setMilestonePoints(m, raw){
      const value=Number(raw);
      if(!Number.isFinite(value)||value<0){notify('Les points du jalon doivent être positifs ou nuls');return;}
      m.points=Math.round(value);
    }
    function milestoneDone(m){const list=milestoneTasks(m);return list.length?list.every(t=>t.status==='done'):!!m.done;}
    function toggleMilestone(m){const list=milestoneTasks(m);if(list.length&&!milestoneDone(m)){notify('Termine les sous-tâches du jalon avant de le valider');return;}m.done=!milestoneDone(m);m.doneAt=m.done?today.value:'';}
    function removeMilestone(m){data.trash.unshift({id:uid(),type:'milestone',deletedAt:new Date().toISOString(),payload:clone(m)});data.tasks.forEach(t=>{if(t.milestoneId===m.id)t.milestoneId='';});data.projectMilestones=data.projectMilestones.filter(x=>x.id!==m.id);}
    function milestones(project){return data.projectMilestones.filter(m=>m.projectId===project.id);}
    const weekSummary=computed(()=>{const start=monday(today.value);const end=new Date(start+'T12:00:00');end.setDate(end.getDate()+6);const toDate=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;const endS=toDate(end);const tasks=data.tasks.filter(t=>t.doneAt>=start&&t.doneAt<=endS&&t.status==='done');const tickets=data.workTickets.filter(t=>t.doneAt>=start&&t.doneAt<=endS&&t.done);return {tasks:tasks.length,tickets:tickets.length,points:tasks.reduce((s,t)=>s+taskValue(t),0),meals:Array.from({length:7},(_,i)=>{const d=new Date(start+'T12:00:00');d.setDate(d.getDate()+i);const date=toDate(d);return ['lunch','dinner'].map(k=>mealSlot(date,k));}).flat().filter(m=>m.state==='done').length};});

    // V29 : dépendances, planification, calendrier, repas, budget courses, succès et widgets.
    const v29Date = (date, offset=0) => {const d=new Date(date+'T12:00:00');d.setDate(d.getDate()+offset);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
    // V59 TEST : recherche transversale et propositions sans durée imposée.
    const globalQuery=ref('');
    const globalResults=computed(()=>{
      const q=globalQuery.value.trim().toLocaleLowerCase('fr');if(q.length<2)return [];
      return [
        ...data.tasks.map(x=>({id:x.id,type:'Tâche',title:x.title,tab:x.scope==='work'?'work':'all'})),
        ...data.projects.map(x=>({id:x.id,type:'Projet',title:x.name,tab:'projects'})),
        ...data.workTickets.map(x=>({id:x.id,type:'Ticket',title:x.name,tab:'work'})),
        ...data.dishes.map(x=>({id:x.id,type:'Plat',title:x.name,tab:'menu'})),
        ...data.activities.map(x=>({id:x.id,type:'Activité',title:x.name||x.title,tab:'activities'})),
        ...data.appointments.map(x=>({id:x.id,type:'Événement',title:x.title,tab:'calendar'})),
      ].filter(x=>String(x.title||'').toLocaleLowerCase('fr').includes(q)).slice(0,30);
    });
    function openGlobalResult(x){
      globalQuery.value='';
      const task=data.tasks.find(t=>t.id===x.id);
      if(x.type==='Tâche'&&task){openTaskForm(task);return;}
      if(x.type==='Événement'){const a=data.appointments.find(a=>a.id===x.id);if(a){openAppointment(a);return;}}
      if(x.type==='Projet'){const p=data.projects.find(p=>p.id===x.id);if(p){openProjectForm(p);return;}}
      setTab(x.tab);
      if(x.type==='Plat'){menuTab.value='dishes';dishQuery.value=x.title;dishEditing.value=x.id;}
      if(x.type==='Ticket'){waitingPersonFilter.value='';nextTick(()=>document.querySelector('[data-ticket-id="'+x.id+'"]')?.scrollIntoView({block:'center'}));}
      if(x.type==='Activité'){nextTick(()=>document.querySelector('[data-activity-id="'+x.id+'"]')?.scrollIntoView({block:'center'}));}
    }
    const chooserEnergy=ref('low');
    const chooserKind=ref('all');
    const chooserChoice=ref(null);
    const chooserPool=computed(()=>{
      const choices=[];
      const low=chooserEnergy.value==='low';
      for(const t of data.tasks.filter(t=>t.status!=='done' && (!t.startDate||t.startDate<=today.value) && !blockingTask(t))){
        if(chooserKind.value==='pleasure')continue;
        choices.push({id:t.id,title:t.title,source:'Tâche',tab:t.scope==='work'?'work':'all'});
      }
      for(const h of data.habits.filter(h=>!h.malus&&!habitIsFinished(h)&&(habitDue(h)||habitLateDays(h)>0)&&!habitDoneToday(h)))if(chooserKind.value!=='pleasure')choices.push({id:h.id,title:h.title,source:'Habitude',tab:'habits'});
      for(const a of data.activities)if(chooserKind.value!=='useful')choices.push({id:a.id,title:a.name||a.title||'Activité',source:'Activité',tab:'activities'});
      if(chooserKind.value!=='useful')choices.push({id:'sport',title:low?'Mini-flemme sportive':'Séance de sport surprise',source:'Sport',tab:'sport'});
      if(chooserKind.value!=='pleasure')for(const p of data.projects.filter(p=>!p.completed).slice(0,25))choices.push({id:p.id,title:'Avancer sur : '+p.name,source:'Projet',tab:'projects'});
      if(chooserKind.value!=='useful'){
        for(const kind of ['lunch','dinner']){const slot=mealSlot(today.value,kind);const dish=data.dishes.find(d=>d.id===slot.dishId);const name=dish?.name||slot.name;if(name)choices.push({id:'meal-'+kind,title:'Préparer '+(kind==='lunch'?'le déjeuner':'le dîner')+' : '+name,source:'Repas',tab:'menu'});}
      }
      if(chooserKind.value!=='pleasure'&&!data.moodEntries.some(x=>x.date===today.value))choices.push({id:'mood',title:'Compléter le bilan humeur du jour',source:'Bilan',tab:'mood'});
      return choices;
    });
    function openChooserChoice(){const choice=chooserChoice.value;if(!choice)return;if(choice.source==='Tâche'){const t=data.tasks.find(x=>x.id===choice.id);if(t){openTaskForm(t);return;}}if(choice.source==='Habitude'){const h=data.habits.find(x=>x.id===choice.id);if(h){openHabitForm(h);return;}}if(choice.source==='Projet'){setTab('projects');nextTick(()=>document.querySelector('[data-project-id=\"'+choice.id+'\"]')?.scrollIntoView({block:'center'}));return;}if(choice.source==='Repas'){menuTab.value='planning';}setTab(choice.tab);}
    // La difficulté influe sur la sélection des tâches, pas sur leur présence dans le pool.
    const chooserLastSources=ref([]);
    function chooseAction(){
      const pool=chooserPool.value;
      if(!pool.length){chooserChoice.value=null;notify('Aucune proposition disponible');return;}
      const sources=[...new Set(pool.map(x=>x.source))];
      // Équilibrer les sources : 40 tâches ne doivent pas étouffer 3 habitudes.
      const recent=new Set(chooserLastSources.value.slice(-Math.max(1,sources.length-1)));
      const candidates=sources.filter(s=>!recent.has(s));
      const choices=candidates.length?candidates:sources;
      const source=choices[Math.floor(Math.random()*choices.length)];
      const same=pool.filter(x=>x.source===source&&x.id!==chooserChoice.value?.id);
      const eligible=same.length?same:pool.filter(x=>x.source===source);
      chooserChoice.value=eligible[Math.floor(Math.random()*eligible.length)];
      chooserLastSources.value=[...chooserLastSources.value.slice(-5),source];
    }
    const dayTasks=computed(()=>data.tasks.filter(t=>t.status!=='done'&&t.scope!=='work'&&taskIsToday(t)).slice(0,12));
    const dayHabits=computed(()=>data.habits.filter(h=>!h.malus&&!habitIsFinished(h)&&habitDue(h)&&!habitDoneToday(h)).slice(0,12));
    const contextPeriod=computed(()=>{let h=new Date().getHours();return h<12?'Matin':h<18?'Après-midi':'Soir';});
    const focusTask=ref(null);
    function startFocus(task){focusTask.value=task;}
    const waitingPersonFilter=ref('');
    const waitingPeople=computed(()=>[...new Set(data.workTickets.map(x=>String(x.waitingPerson||'').trim()).filter(Boolean))].sort());
    const workLoad=computed(()=>({open:data.workTickets.filter(x=>!x.done).length,waiting:data.workTickets.filter(x=>!x.done&&(x.waiting||x.customStatus?.toLowerCase().includes('attente'))).length,actions:data.workTickets.reduce((n,t)=>n+(t.items||[]).filter(i=>!i.done).length,0),done:data.workTickets.filter(x=>x.done).length}));
    const notificationItems=computed(()=>{
      if(data.testSettings.automationEnabled===false)return [];
      const all=[];
      for(const t of data.tasks.filter(t=>t.status!=='done'&&t.due&&t.due<=today.value))all.push({id:'task-'+t.id,text:'Échéance tâche : '+t.title,tab:t.scope==='work'?'work':'all'});
      for(const t of data.workTickets.filter(t=>!t.done&&t.waitingPerson&&t.followUpDate&&t.followUpDate<=today.value))all.push({id:'wait-'+t.id,text:'Relance '+t.waitingPerson+' : '+t.name,tab:'work'});
      for(const a of data.appointments.filter(a=>a.status!=='done'&&a.start===today.value))all.push({id:'appt-'+a.id,text:'Rendez-vous : '+a.title,tab:'calendar'});
      return all.filter(x=>!data.testNotifications.some(y=>y.id===x.id&&y.day===today.value));
    });
    function dismissNotification(n){data.testNotifications.push({id:n.id,day:today.value});}
    // Les règles sont évaluées dans l'interface, sans service externe ni déclenchement hors navigateur.
    const automationRules=computed(()=>[...notificationItems.value]);
    // V60 : achats envisagés, indépendants des opérations comptables effectives.
    const plannedPurchaseDraft=reactive({name:'',amount:'',category:'',date:''});
    const plannedPurchaseTotal=computed(()=>data.plannedPurchases.filter(p=>p.status!=='bought'&&p.selected!==false).reduce((n,p)=>n+Math.max(0,Number(p.amount)||0),0));
    function addPlannedPurchase(){const name=String(plannedPurchaseDraft.name||'').trim(),amount=Number(plannedPurchaseDraft.amount);if(!name||!Number.isFinite(amount)||amount<=0){notify('Saisis un achat et un montant positif');return;}data.plannedPurchases.push({id:uid(),name,amount,category:plannedPurchaseDraft.category||'',date:plannedPurchaseDraft.date||'',status:'planned',selected:true});plannedPurchaseDraft.name='';plannedPurchaseDraft.amount='';plannedPurchaseDraft.date='';}
    function markPurchaseBought(p){if(p.status==='bought')return;if(!confirm('Enregistrer cet achat comme dépense réelle dans le budget ?'))return;data.budgetEntries.push({id:uid(),date:today.value,label:p.name,amount:-Math.abs(Number(p.amount)||0),category:p.category||data.budgetCategories[0]||'Autre'});p.status='bought';notify('Achat enregistré dans les dépenses');}
    function removePlannedPurchase(p){if(confirm('Supprimer cet achat prévu ?'))data.plannedPurchases=data.plannedPurchases.filter(x=>x.id!==p.id);}
    // V60 : statistiques de charge, descriptives sans temps de travail inféré.
    const workStatPeriod=ref('week');
    const workStatMonth=ref(today.value.slice(0,7));
    const workStatRange=computed(()=>{
      const end=today.value,d=new Date(end+'T12:00:00Z'),p=workStatPeriod.value;
      if(p==='customMonth'&&/^\d{4}-\d{2}$/.test(workStatMonth.value)){const first=workStatMonth.value+'-01';const last=new Date(Date.UTC(Number(workStatMonth.value.slice(0,4)),Number(workStatMonth.value.slice(5)),0)).toISOString().slice(0,10);return {start:first,end:last};}
      if(p==='lastWeek'||p==='week'){const dow=(d.getUTCDay()+6)%7;d.setUTCDate(d.getUTCDate()-dow-(p==='lastWeek'?7:0));return {start:d.toISOString().slice(0,10),end:p==='lastWeek'?dateAdd(d.toISOString().slice(0,10),6):end};}
      if(p==='lastMonth'||p==='month'){d.setUTCDate(1);if(p==='lastMonth'){d.setUTCMonth(d.getUTCMonth()-1);return {start:d.toISOString().slice(0,10),end:dateAdd(end.slice(0,7)+'-01',-1)};}return {start:d.toISOString().slice(0,10),end};}
      if(p==='year'){d.setUTCMonth(0,1);return {start:d.toISOString().slice(0,10),end};}
      return {start:'0000-01-01',end};
    });
    const workDetailed=computed(()=>{
      const {start,end}=workStatRange.value;
      const all=data.workTickets||[];
      const active=all.filter(t=>!t.done&&(t.startDate||t.createdAt||'0000-01-01')<=end);
      const closed=all.filter(t=>t.done && String(t.doneAt||'').slice(0,10)>=start && String(t.doneAt||'').slice(0,10)<=end);
      const late=active.filter(t=>t.due&&t.due<today.value).length;
      const relaunch=active.filter(t=>t.followUpDate&&t.followUpDate<=today.value).length;
      const byType=Object.entries(active.reduce((a,t)=>{const k=data.workTicketTypes.find(x=>x.id===t.typeId)?.name||t.category||'Sans catégorie';a[k]=(a[k]||0)+1;return a;},{})).sort((a,b)=>b[1]-a[1]).slice(0,12);
      const waiting=active.filter(t=>t.waiting||String(t.customStatus||'').toLowerCase().includes('attente'));
      const byPerson=Object.entries(waiting.reduce((a,t)=>{const key=String(t.waitingPerson||'Non renseignée').trim()||'Non renseignée';a[key]=(a[key]||0)+1;return a;},{})).sort((a,b)=>b[1]-a[1]);
      const newTickets=all.filter(t=>{const date=String(t.createdAt||t.startDate||'').slice(0,10);return date>=start&&date<=end;}).length;
      const actions=active.reduce((n,t)=>n+(t.items||[]).filter(x=>!x.done).length,0);
      const age=waiting.map(t=>{const d=String(t.startDate||t.createdAt||'').slice(0,10);return /^\d{4}-\d{2}-\d{2}$/.test(d)?Math.max(0,Math.round((new Date(today.value+'T12:00:00Z')-new Date(d+'T12:00:00Z'))/86400000)):null;}).filter(v=>v!==null);
      return {active:active.length,closed:closed.length,late,relaunch,byType,byPerson,waiting:waiting.length,actions,newTickets,avgWaitingAge:age.length?Math.round(age.reduce((a,b)=>a+b,0)/age.length):null,rangeStart:start,rangeEnd:end};
    });
    // V62 : routines qui référencent les habitudes existantes : aucun double gain de points.
    const routineDraft=reactive({name:'',habitIds:[]});
    function saveRoutine(){const name=String(routineDraft.name||'').trim();if(!name||!routineDraft.habitIds.length){notify('Nom et au moins une habitude nécessaires');return;}data.customRoutines.push({id:uid(),name,habitIds:[...new Set(routineDraft.habitIds)],createdAt:today.value});routineDraft.name='';routineDraft.habitIds=[];notify('Routine ajoutée');}
    function removeRoutine(r){if(confirm('Supprimer cette routine ? Les habitudes restent intactes.'))data.customRoutines=data.customRoutines.filter(x=>x.id!==r.id);}
    function routineProgress(r){const ids=r.habitIds||[];return {total:ids.length,done:ids.filter(id=>{const h=data.habits.find(x=>x.id===id);return h&&habitDoneToday(h);}).length};}
    // V64 : historique des routines : aucune attribution de points additionnels.
    const routineStatsPeriod=ref('week');
    const routineStatsAnchor=ref(todayStr().slice(0,7));
    function monthStart(date){return date.slice(0,7)+'-01';}
    function monthEnd(date){const [y,m]=date.slice(0,7).split('-').map(Number);return new Date(Date.UTC(y,m,0,12)).toISOString().slice(0,10);}
    const routineStatsRange=computed(()=>{
      if(routineStatsPeriod.value==='month'){
        const start=routineStatsAnchor.value+'-01';return {start,end:[monthEnd(start),today.value].sort()[0],label:'Mois '+routineStatsAnchor.value};
      }
      const start=monday(today.value);const d=new Date(start+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+6);
      return {start,end:today.value,label:'Semaine en cours'};
    });
    function routineStats(r){
      const ids=(r.habitIds||[]).filter(id=>data.habits.some(h=>h.id===id));
      const range=routineStatsRange.value;
      const start=[range.start,r.createdAt||today.value].sort().pop();const end=range.end;
      if(!ids.length||start>end)return {days:0,fullDays:0,rate:null,habitResults:[]};
      let days=0,fullDays=0;
      const counts=Object.fromEntries(ids.map(id=>[id,0]));
      for(let dt=start;dt<=end;){
        const done=ids.filter(id=>{const h=data.habits.find(x=>x.id===id);return h&&(h.history||[]).includes(dt);});
        done.forEach(id=>counts[id]++);days++;if(done.length===ids.length)fullDays++;
        const next=new Date(dt+'T12:00:00Z');next.setUTCDate(next.getUTCDate()+1);dt=next.toISOString().slice(0,10);
      }
      return {days,fullDays,rate:days?Math.round(fullDays/days*100):null,
        habitResults:ids.map(id=>({id,title:data.habits.find(h=>h.id===id)?.title||'Habitude',done:counts[id]}))};
    }
    const routineHabits=r=>(r.habitIds||[]).map(id=>data.habits.find(h=>h.id===id)).filter(Boolean);
    // V62 : restes facultatifs, par portions ; aucune date de consommation inventée.
    const leftoverDraft=reactive({name:'',dishId:'',portions:1,storage:'fridge',expiry:''});
    function addLeftover(){const dish=data.dishes.find(x=>x.id===leftoverDraft.dishId);const name=String(leftoverDraft.name||dish?.name||'').trim();const portions=Math.trunc(Number(leftoverDraft.portions));if(!name||!Number.isInteger(portions)||portions<1){notify('Nom et nombre de portions valides requis');return;}data.mealLeftovers.push({id:uid(),name,dishId:dish?.id||'',portions,storage:leftoverDraft.storage,expiry:leftoverDraft.expiry||'',createdAt:today.value});leftoverDraft.name='';leftoverDraft.dishId='';leftoverDraft.portions=1;leftoverDraft.expiry='';notify('Reste ajouté');}
    function consumeLeftover(x){if(x.portions<1)return;x.portions--;if(x.portions===0)notify('Toutes les portions sont consommées');}
    function planLeftover(x,kind='lunch'){if(!x||x.portions<1)return;setMeal(today.value,kind,'name',x.name);setMeal(today.value,kind,'dishId',x.dishId||'');notify('Reste placé au menu du jour ; la portion sera décomptée après confirmation manuelle');}
    function removeLeftover(x){if(confirm('Supprimer ce reste ?'))data.mealLeftovers=data.mealLeftovers.filter(z=>z.id!==x.id);}
    const leftoverPlanDate=ref(today.value),leftoverPlanKind=ref('dinner');
    function planLeftoverSelected(x){if(!x||x.portions<1)return;if(!/^\d{4}-\d{2}-\d{2}$/.test(leftoverPlanDate.value)){notify('Choisis une date valide');return;}setMeal(leftoverPlanDate.value,leftoverPlanKind.value,'name',x.name);setMeal(leftoverPlanDate.value,leftoverPlanKind.value,'dishId',x.dishId||'');notify('Reste planifié sans décompte automatique des portions');}
    // V63 : sélection explicite et indépendante de la semaine de courses.
    // Le sélecteur accepte n'importe quel jour, ramené au lundi correspondant.
    const groceryMonday = date => {
      const d=new Date(String(date||today.value).slice(0,10)+'T12:00:00');
      if(Number.isNaN(d.getTime()))return today.value;
      d.setDate(d.getDate()-(d.getDay()+6)%7);
      return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    };
    const groceryWeekShift=(date,delta)=>{
      const d=new Date(groceryMonday(date)+'T12:00:00');d.setDate(d.getDate()+delta*7);
      return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    };
    const ingredientWeekDate=ref(groceryWeekShift(today.value,1));
    const ingredientWeekStart=computed(()=>groceryMonday(ingredientWeekDate.value));
    const ingredientWeekEnd=computed(()=>{
      const d=new Date(ingredientWeekStart.value+'T12:00:00');d.setDate(d.getDate()+6);
      return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    });
    function selectIngredientWeek(which){ingredientWeekDate.value=which==='current'?groceryMonday(today.value):groceryWeekShift(today.value,1);}
    function shiftIngredientWeek(n){ingredientWeekDate.value=groceryWeekShift(ingredientWeekStart.value,n);}
    const groceryExcludedIds=ref([]);
    watch(ingredientWeekStart,()=>{groceryExcludedIds.value=[];});
    const groceryShoppingExists=id=>data.shoppingItems.some(i=>i.ingredientId===id&&!i.checked);
    const ingredientWeekMeals=computed(()=>{
      const results=[];const start=ingredientWeekStart.value,end=ingredientWeekEnd.value;
      for(const date of Object.keys(data.weeklyMenus||{}).sort()){
        if(date<start||date>end)continue;
        for(const kind of ['lunch','dinner']){
          const slot=data.weeklyMenus[date]?.[kind];
          if(!slot?.name&&!slot?.dishId)continue;
          const dish=data.dishes.find(x=>x.id===slot.dishId);
          results.push({date,kind,name:slot.name||dish?.name||'Repas non identifié',dishId:dish?.id||'',dishFound:!!dish});
        }
      }
      return results;
    });
    const menuIngredientNeeds=computed(()=>{
      const counts=new Map();
      for(const meal of ingredientWeekMeals.value){
        if(!meal.dishFound)continue;
        const dish=data.dishes.find(x=>x.id===meal.dishId);
        for(const ingredientId of new Set(dish?.ingredientIds||[])){
          const ingredient=data.ingredients.find(x=>x.id===ingredientId);
          if(!ingredient)continue;
          const item=counts.get(ingredientId)||{id:ingredientId,name:ingredient.name,count:0,owned:!!ingredient.owned};
          item.count++;counts.set(ingredientId,item);
        }
      }
      return [...counts.values()].sort((x,y)=>x.name.localeCompare(y.name,'fr'));
    });
    function addNeededIngredients(){
      let added=0;
      for(const x of menuIngredientNeeds.value.filter(x=>!x.owned&&!groceryExcludedIds.value.includes(x.id))){
        const ing=data.ingredients.find(i=>i.id===x.id);
        if(!ing||data.shoppingItems.some(i=>i.ingredientId===x.id&&!i.checked))continue;
        addIngredientToShopping(ing);added++;
      }
      notify(added+' ingrédient(s) ajouté(s) pour la semaine du '+ingredientWeekStart.value+', sans quantité inventée');
    }
    // V62 : questions personnalisables et calendrier des bilans d'humeur.
    const moodQuestionDraft=reactive({title:'',kind:'text'});
    function addMoodQuestion(){const title=String(moodQuestionDraft.title||'').trim();if(!title)return;data.moodQuestions.push({id:uid(),title,kind:moodQuestionDraft.kind});moodQuestionDraft.title='';}
    function removeMoodQuestion(q){if(confirm('Supprimer la question ? Les anciennes réponses restent stockées.'))data.moodQuestions=data.moodQuestions.filter(x=>x.id!==q.id);}
    const moodCalendarMonth=ref(today.value.slice(0,7));
    const moodCalendarDays=computed(()=>{const [y,m]=moodCalendarMonth.value.split('-').map(Number);const first=new Date(Date.UTC(y,m-1,1));const pad=(first.getUTCDay()+6)%7;const max=new Date(Date.UTC(y,m,0)).getUTCDate();return [...Array(pad).fill(''),...Array.from({length:max},(_,i)=>moodCalendarMonth.value+'-'+String(i+1).padStart(2,'0'))];});
    const moodEntriesForDate=date=>data.moodEntries.filter(e=>e.date===date);
    const moodQuestionsAnswers=reactive({});
    function openMoodDay(date){if(!date)return;const entry=moodEntriesForDate(date)[0];if(entry){editMoodEntry(entry);}else{Object.assign(moodForm,{id:'',date,moodIds:[],note:'',score:0});for(const key of Object.keys(moodQuestionsAnswers))delete moodQuestionsAnswers[key];}document.querySelector('.mood-view form')?.scrollIntoView({behavior:'smooth',block:'center'});}
    // V60 : détail du jour, sans attribuer d'heure fictive aux tâches.
    const dayView=ref('day');
    const dayOverview=computed(()=>({tasks:(Array.isArray(data.tasks)?data.tasks:[]).filter(t=>t.status!=='done'&&t.scope!=='work'&&taskIsToday(t)),habits:dayHabits.value||[],appointments:(Array.isArray(data.appointments)?data.appointments:[]).filter(a=>a.start<=today.value&&a.end>=today.value),alerts:notificationItems.value||[]}));
    const dayMilestones=computed(()=>{
      const result=[];const now=today.value;
      for(const t of data.tasks){if(t.startDate===now)result.push({id:'task-start-'+t.id,label:'▶ Tâche commence aujourd’hui',title:t.title,kind:'task',item:t});if(t.due===now)result.push({id:'task-due-'+t.id,label:t.status==='done'?'✓ Tâche terminée aujourd’hui':'⚑ Tâche à terminer aujourd’hui',title:t.title,kind:'task',item:t});}
      for(const p of data.projects){if(p.startDate===now)result.push({id:'project-start-'+p.id,label:'▶ Projet commence aujourd’hui',title:p.name,kind:'project',item:p});if(p.endDate===now)result.push({id:'project-end-'+p.id,label:'⚑ Projet se termine aujourd’hui',title:p.name,kind:'project',item:p});}
      for(const m of data.projectMilestones||[]){if(m.due===now){const p=data.projects.find(p=>p.id===m.projectId);result.push({id:'milestone-'+m.id,label:'◆ Jalon prévu aujourd’hui',title:(p?.name? p.name+' : ':'')+m.title,kind:'project',item:p});}}
      return result;
    });
    const nextDeadlineDays=ref(7);
    const upcomingMilestones=computed(()=>{
      const until=new Date(today.value+'T12:00:00Z');until.setUTCDate(until.getUTCDate()+Number(nextDeadlineDays.value)||7);const end=until.toISOString().slice(0,10);
      const a=[];
      for(const t of data.tasks)if(t.status!=='done'&&t.due&&t.due>today.value&&t.due<=end)a.push({id:'t'+t.id,date:t.due,title:t.title,kind:'task',item:t});
      for(const p of data.projects)if(p.endDate&&p.endDate>today.value&&p.endDate<=end)a.push({id:'p'+p.id,date:p.endDate,title:p.name,kind:'project',item:p});
      return a.sort((x,y)=>x.date.localeCompare(y.date)).slice(0,30);
    });
    function openMilestoneItem(x){if(x.kind==='project'){if(x.item)openProjectForm(x.item);}else openTaskForm(x.item);}
    const openDayItem=(task)=>openTaskForm(task);
    function toggleHabitPause(h){if(h.pausedUntil&&h.pausedUntil>=today.value){h.pausedUntil='';notify('Habitude reprise');return;}const end=prompt('Pause jusqu’au (AAAA-MM-JJ) :',today.value);if(end&&/^\d{4}-\d{2}-\d{2}$/.test(end))h.pausedUntil=end;}
    const envelopeMonth=computed(()=>budgetMonth.value);
    function envelopeKey(category){return envelopeMonth.value+'|'+category;}
    const envelopeRows=computed(()=>data.budgetCategories.map(category=>({category,planned:Number(data.budgetEnvelopes[envelopeKey(category)]||0),actual:data.budgetEntries.filter(x=>String(x.date||'').slice(0,7)===envelopeMonth.value&&x.category===category&&Number(x.amount)<0).reduce((v,x)=>v+Math.abs(Number(x.amount)||0),0)})));
    const dashboardLive=computed(()=>({tasks:dayTasks.value.length,habits:dayHabits.value.length,alerts:notificationItems.value.length}));
    const dashboardCatalogue=[{id:'appointments',name:'Rendez-vous de la semaine'},{id:'randomNotes',name:'Ajouter une note au pif'},{id:'habits',name:'Habitudes'},{id:'routines',name:'Routines du jour'},{id:'meals',name:'Repas du jour'},{id:'sport',name:'Sport & objectifs'},{id:'weight',name:'Poids'},{id:'foodReview',name:'Bilans alimentaires'},{id:'wellnessReport',name:'Bilan global TCA et poids'},{id:'priorities',name:'Priorités suggérées'},{id:'tasks',name:'Tâches Aujourd’hui / À venir'}];
    const dashboardEdit=ref(false);
    function widgetVisible(id){return id!=='planner'&&data.dashboardWidgets.includes(id);}
    function setWidgetVisible(id,on){data.dashboardWidgets=on?[...new Set([...data.dashboardWidgets,id])]:data.dashboardWidgets.filter(x=>x!==id);}
    function moveDashboardWidget(id,direction){const a=data.dashboardWidgets;const i=a.indexOf(id),j=i+direction;if(i<0||j<0||j>=a.length)return;[a[i],a[j]]=[a[j],a[i]];}
    const dashboardSorted=computed(()=>[...data.dashboardWidgets.filter(x=>dashboardCatalogue.some(w=>w.id===x)),...dashboardCatalogue.map(w=>w.id).filter(id=>!data.dashboardWidgets.includes(id))].map(id=>dashboardCatalogue.find(w=>w.id===id)));
    const dashboardDragged=ref('');
    function dropDashboardWidget(targetId){
      const from=dashboardDragged.value;
      dashboardDragged.value='';
      if(!from||from===targetId||!data.dashboardWidgets.includes(from)||!data.dashboardWidgets.includes(targetId))return;
      const ordered=data.dashboardWidgets.filter(id=>id!==from);
      const index=ordered.indexOf(targetId);
      if(index<0)return;
      ordered.splice(index,0,from);
      data.dashboardWidgets=ordered;
    }
    const depPicker=reactive({search:'',project:'',category:'',urgency:'',difficulty:''});
    function dependencyMatches(t,currentId=''){
      if(t.id===currentId||t.status==='done')return false;
      if(depPicker.search&&!String(t.title||'').toLocaleLowerCase('fr').includes(depPicker.search.toLocaleLowerCase('fr')))return false;
      if(depPicker.project&&t.projectId!==depPicker.project)return false;
      if(depPicker.category&&t.category!==depPicker.category)return false;
      if(depPicker.urgency&&t.urgency!==depPicker.urgency)return false;
      if(depPicker.difficulty&&t.difficulty!==depPicker.difficulty)return false;
      return true;
    }
    const dependencyChoices=computed(()=>data.tasks.filter(t=>t.status!=='done'));

    function setTaskDependency(t,id){if(!id){t.dependsOn='';return;}if(id===t.id){notify('Une tâche ne peut dépendre d’elle-même');return;}const seen=new Set([t.id]);let cur=id;while(cur){if(seen.has(cur)){notify('Dépendance circulaire refusée');return;}seen.add(cur);cur=data.tasks.find(x=>x.id===cur)?.dependsOn||'';}t.dependsOn=id;}
    function blockingTask(t){const parent=data.tasks.find(x=>x.id===t.dependsOn);return parent&&parent.status!=='done'?parent:null;}
    const plannerDate=ref(today.value);
    const plannerCandidates=computed(()=>data.tasks.filter(t=>t.scope!=='work'&&t.status!=='done'&&!blockingTask(t)).map(t=>{
      const due=taskDue(t);const days=due?Math.round((new Date(due+'T12:00:00')-new Date(plannerDate.value+'T12:00:00'))/86400000):Infinity;
      return {task:t,days,rank:levelRank(data.urgencies,t.urgency),difficulty:levelRank(data.difficulties,t.difficulty)};
    }).sort((a,b)=>(a.days<0?0:a.days===0?1:Number.isFinite(a.days)?2:3)-(b.days<0?0:b.days===0?1:Number.isFinite(b.days)?2:3)||(Number.isFinite(a.days)&&Number.isFinite(b.days)?a.days-b.days:0)||b.rank-a.rank||b.difficulty-a.difficulty));
    const plannedTasks=computed(()=>plannerCandidates.value);
    const plannedMinutes=computed(()=>0); // ancien nom conservé pour compatibilité d'interface
    const suggestionMode=ref('available');
    const suggestionWeek=ref('');
    const dishRecentUse=computed(()=>{const dates=new Map();for(const [date,slots] of Object.entries(data.weeklyMenus||{})){for(const key of ['lunch','dinner']){const id=slots?.[key]?.dishId;if(id && (!dates.has(id)||date>dates.get(id)))dates.set(id,date);}}return dates;});
    const recentDishCutoff=computed(()=>shiftISODate(today.value,-14));
    const pantryAtRisk=computed(()=>new Set([...pantryExpiring.value,...pantryOverdue.value].map(i=>i.id)));
    const suggestionLeftovers=computed(()=>data.mealLeftovers.filter(x=>x.portions>0).sort((a,b)=>(a.expiry||'9999').localeCompare(b.expiry||'9999')));
    const suggestedDishPages=computed(()=>Math.max(1,Math.ceil(availableDishes.value.length/Number(suggestPageSize.value||10))));
    const paginatedDishes=computed(()=>availableDishes.value.slice((Math.min(suggestPage.value,suggestedDishPages.value)-1)*Number(suggestPageSize.value),Math.min(suggestPage.value,suggestedDishPages.value)*Number(suggestPageSize.value)));
    watch([suggestDishCategory,suggestFoodType,suggestPageSize,suggestionMode],()=>{suggestPage.value=1;});
    const availableDishes=computed(()=>data.dishes.filter(d=>(!suggestDishCategory.value||dishCats(d).includes(suggestDishCategory.value))&&dishMatchesFood(d,suggestFoodType.value)).map(d=>{
      const ingredients=(d.ingredientIds||[]).map(id=>data.ingredients.find(i=>i.id===id)).filter(Boolean);
      const missing=ingredients.filter(i=>!i.owned);
      const atRisk=ingredients.filter(i=>i.owned&&pantryAtRisk.value.has(i.id));
      const lastUsed=dishRecentUse.value.get(d.id)||'';
      return {dish:d,missing,total:ingredients.length,atRisk,lastUsed};
    }).filter(x=>{
      if(suggestionMode.value==='favorites')return !!x.dish.favorite;
      if(suggestionMode.value==='available')return x.total>0&&x.missing.length===0;
      if(suggestionMode.value==='variety')return !x.lastUsed||x.lastUsed<recentDishCutoff.value;
      if(suggestionMode.value==='antiwaste')return x.atRisk.length>0;
      return true;
    }).sort((a,b)=>{
      if(suggestionMode.value==='antiwaste')return b.atRisk.length-a.atRisk.length||a.missing.length-b.missing.length;
      if(suggestionMode.value==='variety')return a.lastUsed.localeCompare(b.lastUsed)||a.missing.length-b.missing.length;
      return a.missing.length-b.missing.length||a.dish.name.localeCompare(b.dish.name,'fr');
    }));
    const suggestedMealDraft=reactive({open:false,dishId:'',name:'',date:today.value,kind:'dinner'});
    function openSuggestedMeal(d){suggestedMealDraft.open=true;suggestedMealDraft.dishId=d.id;suggestedMealDraft.name=d.name;suggestedMealDraft.date=today.value;suggestedMealDraft.kind='dinner';}
    function confirmSuggestedMeal(){if(!/^\d{4}-\d{2}-\d{2}$/.test(suggestedMealDraft.date)){notify('Sélectionne une date');return;}assignDish(suggestedMealDraft.date,suggestedMealDraft.kind,suggestedMealDraft.dishId);suggestedMealDraft.open=false;setTab('menu');}
    function suggestMeal(d){openSuggestedMeal(d);}

    const groceryExpected=computed(()=>data.shoppingItems.filter(i=>!i.checked).reduce((s,i)=>s+(Number(i.estimatedPrice)||0),0));
    const groceryPaid=computed(()=>data.shoppingItems.filter(i=>i.checked).reduce((s,i)=>s+(Number(i.finalPrice)||0),0));
    const groceryTotal=computed(()=>groceryExpected.value+groceryPaid.value);
    const groceryRemaining=computed(()=>Number(data.groceryBudget||0)-groceryTotal.value);
    const successDefinitions=[
      {id:'first-task',name:'Premier pas',detail:'Terminer une tâche',target:1,kind:'tasks'},
      {id:'ten-tasks',name:'Rythme établi',detail:'Terminer 10 tâches',target:10,kind:'tasks'},
      {id:'fifty-tasks',name:'Productivité',detail:'Terminer 50 tâches',target:50,kind:'tasks'},
      {id:'first-project',name:'Projet bouclé',detail:'Terminer un projet',target:1,kind:'projects'},
      {id:'five-projects',name:'Chef de projets',detail:'Terminer 5 projets',target:5,kind:'projects'},
      {id:'first-meal',name:'Aux fourneaux',detail:'Respecter 1 repas planifié',target:1,kind:'meals'},
      {id:'ten-meals',name:'Menu tenu',detail:'Respecter 10 repas planifiés',target:10,kind:'meals'},
      {id:'hundred-tasks',name:'Centurion',detail:'Terminer 100 tâches',target:100,kind:'tasks'},
      {id:'twentyfive-tasks',name:'En route',detail:'Terminer 25 tâches',target:25,kind:'tasks'},
      {id:'twenty-meals',name:'Cuisine régulière',detail:'Respecter 20 repas planifiés',target:20,kind:'meals'},
      {id:'ten-projects',name:'Architecte',detail:'Terminer 10 projets',target:10,kind:'projects'},
      {id:'first-habit',name:'Première routine',detail:'Effectuer une habitude au moins une fois',target:1,kind:'habits'},
      {id:'ten-habits',name:'Régularité',detail:'Effectuer 10 validations d’habitudes',target:10,kind:'habits'}
    ];
    const successCounts=computed(()=>({tasks:data.tasks.filter(t=>t.status==='done').length,projects:data.projects.filter(p=>p.completed).length,habits:data.habits.reduce((n,h)=>n+(Array.isArray(h.history)?h.history.length:0),0),meals:Object.values(data.weeklyMenus).reduce((n,d)=>n+['lunch','dinner'].filter(k=>d?.[k]?.state==='done').length,0)}));
    const successProgress=computed(()=>successDefinitions.map(def=>({...def,current:successCounts.value[def.kind],unlocked:successCounts.value[def.kind]>=def.target})));
    watch(successProgress,items=>{for(const def of items){if(def.unlocked&&!data.achievements.some(a=>a.id===def.id)){data.achievements.push({id:def.id,unlockedAt:today.value});}}},{immediate:true,flush:'post'});


    // Rendez-vous indépendants des tâches et des points.
    const calMode=ref(window.TODO_QUEST_MOBILE ? 'week' : 'month');
    const calAnchor=ref(todayStr().slice(0,7)+'-01');
    const apptForm=reactive({open:false,id:'',title:'',start:todayStr(),end:todayStr(),categoryId:'',details:'',linkedType:'',linkedId:'',newTask:'',newProject:'',reminders:[],repeat:'',repeatEnd:''});
    const apptCategoryName=ref(''); const apptCategoryColor=ref('#7c9bb8'); const draggedCategory=ref(''); const draggedAppointment=ref('');
    const dateAdd=(value,days)=>{const d=new Date(value+'T12:00:00');d.setDate(d.getDate()+days);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
    const dateMonday=value=>{const d=new Date(value+'T12:00:00');return dateAdd(value,-((d.getDay()+6)%7));};
    const calendarTitle=computed(()=>calMode.value==='month'?new Date(calAnchor.value+'T12:00:00').toLocaleDateString('fr-FR',{month:'long',year:'numeric'}):'Semaine du '+formatDate(dateMonday(calAnchor.value)));
    const calendarDays=computed(()=>{const start=calMode.value==='month'?dateMonday(calAnchor.value.slice(0,7)+'-01'):dateMonday(calAnchor.value);const n=calMode.value==='month'?42:7;return Array.from({length:n},(_,i)=>dateAdd(start,i));});
    const appointmentsOn=date=>data.appointments.filter(a=>a.start<=date&&a.end>=date).sort((a,b)=>a.start.localeCompare(b.start)||a.title.localeCompare(b.title,'fr'));
    const calendarLayers=reactive({appointments:true,tasks:true,deadlines:true,milestones:true});
    // Preferences d'affichage propres au telephone, non synchronisees et sans suppression de donnees.
    try { const saved=JSON.parse(localStorage.getItem('tqm-calendar-layers-v5')||'{}');
      for(const key of ['appointments','tasks','deadlines','milestones']) if(typeof saved[key]==='boolean')calendarLayers[key]=saved[key];
    } catch(e) { /* stockage indisponible : garder les valeurs par defaut */ }
    watch(calendarLayers,()=>{try{localStorage.setItem('tqm-calendar-layers-v5',JSON.stringify({...calendarLayers}));}catch(e){}},{deep:true});
    function calendarTasksOn(date){return data.tasks.filter(t=>t.status!=='done' && ((calendarLayers.tasks && t.startDate && t.startDate<=date && taskDue(t)>=date && taskDue(t)!==date) || (calendarLayers.deadlines && taskDue(t)===date)));}
    function calendarMilestonesOn(date){return calendarLayers.milestones ? data.projectMilestones.filter(m=>m.due===date) : [];}
    function openCalendarTask(task){openTaskForm(task);}
    function openCalendarMilestone(m){const project=data.projects.find(p=>p.id===m.projectId);setTab('projects');if(project)nextTick(()=>document.querySelector('[data-project-id="'+project.id+'"]')?.scrollIntoView({block:'center'}));}

    const categoryFor=id=>data.appointmentCategories.find(c=>c.id===id);
    const appointmentUpcoming=computed(()=>data.appointments.filter(a=>a.end>=today.value && a.status!=='missed').sort((a,b)=>a.start.localeCompare(b.start)||a.title.localeCompare(b.title,'fr')));
    const appointmentToday=computed(()=>appointmentsOn(today.value));
    const appointmentWeek=computed(()=>{const start=monday(today.value),end=dateAdd(start,6);return [...data.appointments].filter(a=>a.status!=='done'&&a.start<=end&&a.end>=start).sort((a,b)=>a.start.localeCompare(b.start));});
    const appointmentNext3=computed(()=>appointmentUpcoming.value.filter(a=>a.start>today.value).slice(0,3));
    function moveCalendar(delta){if(calMode.value==='day')calAnchor.value=dateAdd(calAnchor.value,delta);else if(calMode.value==='week')calAnchor.value=dateAdd(calAnchor.value,7*delta);else{let d=new Date(calAnchor.value+'T12:00:00');d.setDate(1);d.setMonth(d.getMonth()+delta);calAnchor.value=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-01';}}
    const weekDate=value=>new Date(value+'T12:00:00').toLocaleDateString('fr-FR',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
    const reminderChoices=[{days:30,label:'30 jours avant'},{days:14,label:'14 jours avant'},{days:7,label:'7 jours avant'},{days:3,label:'3 jours avant'},{days:2,label:'2 jours avant'},{days:1,label:'La veille'},{days:0,label:'Le jour de fin'}];
    const linkedLabel=a=>a?.linkedType==='task'?(data.tasks.find(t=>t.id===a.linkedId)?.title||'Tâche supprimée'):a?.linkedType==='project'?(data.projects.find(p=>p.id===a.linkedId)?.name||'Projet supprimé'):'';
    function openAppointment(a=null,date=null){Object.assign(apptForm,{open:true,id:a?.id||'',title:a?.title||'',start:a?.start||date||today.value,end:a?.end||date||today.value,categoryId:a?.categoryId||'',details:a?.details||'',linkedType:a?.linkedType||'',linkedId:a?.linkedId||'',newTask:'',newProject:'',reminders:Array.isArray(a?.reminders)?[...a.reminders]:[],repeat:a?.repeat||'',repeatEnd:a?.repeatEnd||''});}
    function toggleReminder(days,checked){const arr=apptForm.reminders.filter(x=>x!==days);if(checked)arr.push(days);apptForm.reminders=arr.sort((a,b)=>b-a);}
    function createLinkedTask(){const title=apptForm.newTask.trim();if(!title)return;const t=newTask({title,due:apptForm.end,scope:'personal'});data.tasks.push(t);apptForm.linkedType='task';apptForm.linkedId=t.id;apptForm.newTask='';notify('Tâche créée et liée. Enregistre le rendez-vous pour conserver le lien.');}
    function createLinkedProject(){const name=apptForm.newProject.trim();if(!name)return;const p={id:uid(),name,description:'',color:nextColor(data.projects.length)};data.projects.push(p);apptForm.linkedType='project';apptForm.linkedId=p.id;apptForm.newProject='';notify('Projet créé et lié. Enregistre le rendez-vous pour conserver le lien.');}
    const deadlineAlerts=computed(()=>data.appointments.flatMap(a=>{if(!a.linkedType||!a.linkedId||!a.end||!Array.isArray(a.reminders))return [];const exists=a.linkedType==='task'?data.tasks.some(t=>t.id===a.linkedId&&t.status!=='done'):a.linkedType==='project'?data.projects.some(p=>p.id===a.linkedId):false;if(!exists)return [];return a.reminders.filter(n=>Number.isInteger(n)&&n>=0).map(days=>({a,days,date:dateAdd(a.end,-days),key:a.end+':'+days})).filter(x=>x.date<=today.value&&!(a.reminderAcknowledged||[]).includes(x.key));}).sort((x,y)=>x.date.localeCompare(y.date)));
    const pendingDeadlineAlert=computed(()=>deadlineAlerts.value[0]||null);
    function acknowledgeDeadlineAlert(item){if(!item)return;if(!Array.isArray(item.a.reminderAcknowledged))item.a.reminderAcknowledged=[];item.a.reminderAcknowledged.push(item.key);}

    function saveAppointment(){if(!apptForm.title.trim()||!apptForm.start||apptForm.end<apptForm.start)return;if(apptForm.repeat && apptForm.repeatEnd && apptForm.repeatEnd<apptForm.start){notify('Fin de répétition antérieure au début');return;}
      const old=data.appointments.find(a=>a.id===apptForm.id);
      const type=apptForm.linkedType;
      const id=(type==='task'&&data.tasks.some(t=>t.id===apptForm.linkedId))||(type==='project'&&data.projects.some(p=>p.id===apptForm.linkedId))?apptForm.linkedId:'';
      const reminders=id?[...apptForm.reminders]:[];
      const item={id:apptForm.id||uid(),title:apptForm.title.trim(),start:apptForm.start,end:apptForm.end,categoryId:apptForm.categoryId,details:apptForm.details,linkedType:id?type:'',linkedId:id,reminders,repeat:apptForm.repeat||'',repeatEnd:apptForm.repeatEnd||'',reminderAcknowledged:old&&old.end===apptForm.end&&old.linkedId===id?(old.reminderAcknowledged||[]):[],status:old?.status==='done'?'done':'pending'};
      const pos=data.appointments.findIndex(a=>a.id===item.id);if(pos<0)data.appointments.push(item);else Object.assign(data.appointments[pos],item);apptForm.open=false;}

    function deleteAppointment(a){if(confirm('Supprimer ce rendez-vous ?'))data.appointments=data.appointments.filter(x=>x.id!==a.id);}
    function addAppointmentCategory(){const name=apptCategoryName.value.trim();if(!name)return;data.appointmentCategories.push({id:uid(),name,color:apptCategoryColor.value});apptCategoryName.value='';}
    function renameAppointmentCategory(c){const name=prompt('Nom de la catégorie',c.name);if(name?.trim())c.name=name.trim();}
    function deleteAppointmentCategory(c){if(!confirm('Supprimer cette catégorie ? Les rendez-vous restent sans catégorie.'))return;data.appointmentCategories=data.appointmentCategories.filter(x=>x.id!==c.id);data.appointments.forEach(a=>{if(a.categoryId===c.id)a.categoryId='';});}
    function dropAppointmentCategory(target){const from=data.appointmentCategories.findIndex(x=>x.id===draggedCategory.value),to=data.appointmentCategories.findIndex(x=>x.id===target.id);draggedCategory.value='';if(from<0||to<0||from===to)return;data.appointmentCategories.splice(to,0,...data.appointmentCategories.splice(from,1));}
    function dropAppointment(date){const a=data.appointments.find(x=>x.id===draggedAppointment.value);draggedAppointment.value='';if(!a)return;const duration=Math.round((new Date(a.end+'T12:00:00')-new Date(a.start+'T12:00:00'))/86400000);a.start=date;a.end=dateAdd(date,duration);a.status='pending';a.reminderAcknowledged=[];}
    const pendingAppointment=computed(()=>data.appointments.find(a=>a.end<today.value&&(a.status==='pending'||a.status==='postpone')));
    const postponeDate=ref(todayStr());
    function confirmAppointment(a,done){
      if(done){
        if(a.status!=='done'&&a.repeat&&!data.appointments.some(x=>x.previousEventId===a.id)){
          const gap=Math.round((new Date(a.end+'T12:00:00')-new Date(a.start+'T12:00:00'))/86400000);
          let next=new Date(a.start+'T12:00:00');
          if(a.repeat==='weekly')next.setDate(next.getDate()+7);
          else if(a.repeat==='monthly')next.setMonth(next.getMonth()+1);
          else if(a.repeat==='daily')next.setDate(next.getDate()+1);
          const nextDate=next.getFullYear()+'-'+String(next.getMonth()+1).padStart(2,'0')+'-'+String(next.getDate()).padStart(2,'0');
          if(!a.repeatEnd || nextDate<=a.repeatEnd)data.appointments.push({...clone(a),id:uid(),previousEventId:a.id,start:nextDate,end:dateAdd(nextDate,gap),status:'pending',reminderAcknowledged:[]});
        }
        a.status='done';
      }else{a.status='postpone';postponeDate.value=dateAdd(today.value,1);}
    }
    function rescheduleAppointment(a){if(!postponeDate.value)return;const duration=Math.round((new Date(a.end+'T12:00:00')-new Date(a.start+'T12:00:00'))/86400000);a.start=postponeDate.value;a.end=dateAdd(a.start,duration);a.status='pending';a.reminderAcknowledged=[];}
    const achievementForm=reactive({open:false,id:'',name:'',description:'',target:1,current:0});
    function openAchievement(a=null){Object.assign(achievementForm,{open:true,id:a?.id||'',name:a?.name||'',description:a?.description||'',target:a?.target||1,current:a?.current||0});}
    function saveAchievement(){if(!achievementForm.name.trim())return;const a={id:achievementForm.id||uid(),name:achievementForm.name.trim(),description:achievementForm.description,target:Math.max(1,Number(achievementForm.target)||1),current:Math.max(0,Number(achievementForm.current)||0)};const old=data.customAchievements.find(x=>x.id===a.id);if(old)Object.assign(old,a);else data.customAchievements.push(a);achievementForm.open=false;}
    function removeAchievement(a){if(confirm('Supprimer ce succès ou objectif ?'))data.customAchievements=data.customAchievements.filter(x=>x.id!==a.id);}
    const sortedHabits=computed(()=>[...data.habits].sort((a,b)=>Number(!!a.malus)-Number(!!b.malus)||a.title.localeCompare(b.title,'fr')));

    const doneScope = ref('personal');
    const doneCutoff = computed(() => { const d = new Date(today.value + 'T12:00:00'); d.setDate(d.getDate()-30); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; });
    const doneRecent = scope => (scope === 'work' ? doneWorkTasks.value : doneTasks.value).filter(t => (t.doneAt || '') >= doneCutoff.value);
    const doneArchive = scope => (scope === 'work' ? doneWorkTasks.value : doneTasks.value).filter(t => (t.doneAt || '') < doneCutoff.value);
    // Attribution hebdomadaire récurrente : 0 dimanche, 1 lundi ... 6 samedi.
    const alterForm=reactive({id:'',name:'',color:'#688d85'});
    const alterTab=ref('planning');
    const alterAssignment=reactive({day:1,alterId:''});
    const alterDayFor=date=>{const day=new Date(date+'T12:00:00').getDay();return data.alters.find(a=>a.id===data.alterDays[String(day)])||null;};
    const currentAlter=computed(()=>alterDayFor(today.value));
    function saveAlter(){const name=alterForm.name.trim();if(!name)return;const existing=data.alters.find(a=>a.id===alterForm.id);if(existing)Object.assign(existing,{name,color:alterForm.color});else data.alters.push({id:uid(),name,color:alterForm.color});Object.assign(alterForm,{id:'',name:'',color:'#688d85'});}
    function editAlter(a){Object.assign(alterForm,{id:a.id,name:a.name,color:a.color||'#688d85'});}
    function removeAlter(a){if(!confirm('Supprimer cet alter et ses affectations ? Les bilans existants seront conservés.'))return;data.alters=data.alters.filter(x=>x.id!==a.id);Object.keys(data.alterDays).forEach(d=>{if(data.alterDays[d]===a.id)delete data.alterDays[d]});data.tasks.forEach(t=>{if(t.alterId===a.id)t.alterId=''});data.projects.forEach(p=>{if(p.alterId===a.id)p.alterId=''});}
    function assignAlterDay(){const day=String(alterAssignment.day);if(alterAssignment.alterId)data.alterDays[day]=alterAssignment.alterId;else delete data.alterDays[day];}
    const alterWeekDays=computed(()=>Array.from({length:7},(_,i)=>{const date=dateAdd(monday(today.value),i);return{date,day:(i+1)%7,alter:alterDayFor(date)}}));
    const alterActivityDraft=reactive({alterId:'',title:'',description:''});
    function addAlterActivity(){if(!alterActivityDraft.title.trim())return;data.alterActivities.push({id:uid(),alterId:alterActivityDraft.alterId,title:alterActivityDraft.title.trim(),description:alterActivityDraft.description.trim()});alterActivityDraft.title='';alterActivityDraft.description='';}
    function removeAlterActivity(a){if(confirm('Supprimer cette idée ?'))data.alterActivities=data.alterActivities.filter(x=>x.id!==a.id);}
    const alterReviewQuestions=computed(()=>data.alterReviewQuestions.map(q=>[q.id,q.label]));
    const alterReviewConfigOpen=ref(false);
    const newAlterReviewQuestion=ref('');
    function addAlterReviewQuestion(){
      const label=newAlterReviewQuestion.value.trim();
      if(!label)return;
      data.alterReviewQuestions.push({id:'custom_'+uid(),label});
      newAlterReviewQuestion.value='';
    }
    function removeAlterReviewQuestion(q){
      if(confirm('Supprimer cette question du formulaire ? Les réponses historiques restent conservées.'))
        data.alterReviewQuestions=data.alterReviewQuestions.filter(x=>x.id!==q.id);
    }
    function moveAlterReviewQuestion(q,delta){
      const i=data.alterReviewQuestions.findIndex(x=>x.id===q.id),j=i+delta;
      if(i<0||j<0||j>=data.alterReviewQuestions.length)return;
      [data.alterReviewQuestions[i],data.alterReviewQuestions[j]]=[data.alterReviewQuestions[j],data.alterReviewQuestions[i]];
    }

    const alterReviewForm=reactive({open:false,date:'',alterId:'',name:'',enjoyed:null,clothes:null,game:null,meal:null,music:null,interaction:null,notes:''});
    // Une seule fiche par journée, même si d'anciennes synchronisations ont produit des doublons.
    const uniqueAlterReviews=computed(()=>{
      const byDate=new Map();
      for(const r of data.alterReviews){if(r?.date && !byDate.has(r.date))byDate.set(r.date,r);}
      return [...byDate.values()].sort((a,b)=>b.date.localeCompare(a.date));
    });
    const alterReviewDismissKey='todo-quest-alter-review-dismissed';
    const alterReviewDismissed=ref((()=>{try{return localStorage.getItem(alterReviewDismissKey)||'';}catch(_){return '';}})());
    const pendingAlterReview=computed(()=>{
      const yesterday=dateAdd(today.value,-1);
      const a=alterDayFor(yesterday);
      return a && alterReviewDismissed.value!==yesterday && !data.alterReviews.some(r=>r.date===yesterday) ? [yesterday,a.id] : null;
    });
    function dismissAlterReview(){
      alterReviewDismissed.value=alterReviewForm.date;
      try{localStorage.setItem(alterReviewDismissKey,alterReviewForm.date);}catch(_){}
      alterReviewForm.open=false;
    }
    function openPendingAlterReview(){
      if(!pendingAlterReview.value||alterReviewForm.open)return;
      const [date,id]=pendingAlterReview.value;
      Object.assign(alterReviewForm,{open:true,date,alterId:id,name:data.alters.find(a=>a.id===id)?.name||'Alter supprimé',...Object.fromEntries(alterReviewQuestions.value.map(([k])=>[k,null])),notes:''});
    }
    function editAlterReview(review){
      if(!review)return;
      Object.assign(alterReviewForm,{open:true,date:review.date,alterId:review.alterId,name:review.name||data.alters.find(a=>a.id===review.alterId)?.name||'Alter',
        ...Object.fromEntries(alterReviewQuestions.value.map(([k])=>[k,review[k]??null])),notes:review.notes||''});
    }
    function saveAlterReview(){
      if(!alterReviewForm.date || alterReviewForm.date>=today.value){notify('Le bilan se remplit à partir du lendemain de la journée');return;}
      const entry={date:alterReviewForm.date,alterId:alterReviewForm.alterId,name:alterReviewForm.name,
        ...Object.fromEntries(alterReviewQuestions.value.map(([k])=>[k,alterReviewForm[k]])),notes:alterReviewForm.notes};
      const existing=data.alterReviews.find(r=>r.date===entry.date);
      if(existing)Object.assign(existing,entry);
      else data.alterReviews.push({id:uid(),...entry});
      // Élimine uniquement les doublons d'une même date, en conservant l'entrée mise à jour.
      const kept=new Set();
      data.alterReviews=data.alterReviews.filter(r=>{
        if(!r.date || !kept.has(r.date)){if(r.date)kept.add(r.date);return true;}
        return false;
      });
      alterReviewForm.open=false;
    }
    const moodForm=reactive({id:'',date:todayStr(),moodIds:[],note:'',score:0});
    const newMoodType=reactive({name:'',color:'#8a9bb9'});
    const moodChartDays=ref(30);
    const moodTypeFor=id=>data.moodTypes.find(m=>m.id===id)||null;
    const moodEntryTypes=e=>(Array.isArray(e.moodIds)?e.moodIds:e.moodId?[e.moodId]:[]).map(moodTypeFor).filter(Boolean);
    const moodTypePolarity=t=>{if(['positive','neutral','negative'].includes(t.polarity))return t.polarity;const i=data.moodTypes.findIndex(x=>x.id===t.id),total=data.moodTypes.length;return i<(total-1)/2?'positive':i>(total-1)/2?'negative':'neutral';};
    const moodTypeValue=t=>{const polarity=moodTypePolarity(t);if(polarity==='neutral')return 0;const group=data.moodTypes.filter(x=>moodTypePolarity(x)===polarity);const position=group.findIndex(x=>x.id===t.id);if(position<0)return 0;if(polarity==='positive')return Math.round(1+4*(group.length-1-position)/Math.max(1,group.length-1));return -Math.round(1+4*position/Math.max(1,group.length-1));};
    const moodTone=e=>{const values=moodEntryTypes(e).map(moodTypeValue);return values.length?values.reduce((a,b)=>a+b,0)/values.length:0;};
    function normalizeMoodOrder(){const rank={positive:0,neutral:1,negative:2};data.moodTypes.sort((a,b)=>rank[moodTypePolarity(a)]-rank[moodTypePolarity(b)]);}
    const moodChart=computed(()=>[...data.moodEntries].filter(x=>x.date>=dateAdd(today.value,-moodChartDays.value+1)&&x.date<=today.value).sort((a,b)=>a.date.localeCompare(b.date)));
    function saveMoodType(){const name=newMoodType.name.trim();if(!name)return;data.moodTypes.push({id:uid(),name,color:newMoodType.color,polarity:'neutral'});normalizeMoodOrder();newMoodType.name='';}
    function removeMoodType(type){if(!confirm('Supprimer cette humeur ? Les entrées historiques seront conservées.'))return;data.moodTypes=data.moodTypes.filter(x=>x.id!==type.id);}
    const draggedMood=ref('');
    function dropMoodType(target){const i=data.moodTypes.findIndex(t=>t.id===draggedMood.value),j=data.moodTypes.findIndex(t=>t.id===target.id);if(i<0||j<0||i===j)return;data.moodTypes.splice(j,0,...data.moodTypes.splice(i,1));const moved=data.moodTypes.find(t=>t.id===draggedMood.value);if(moved)moved.polarity=moodTypePolarity(target);normalizeMoodOrder();draggedMood.value='';}
    function saveMood(){if(!moodForm.date)return;const value=Math.max(-5,Math.min(5,Number(moodForm.score)||0));const ids=[...moodForm.moodIds];const entry={id:moodForm.id||uid(),date:moodForm.date,moodIds:ids,moodId:ids[0]||'',moodName:ids.map(id=>moodTypeFor(id)?.name).filter(Boolean).join(', '),moodColor:moodTypeFor(ids[0])?.color||'#999',note:moodForm.note,score:value,answers:{...moodQuestionsAnswers}};const old=data.moodEntries.find(x=>x.id===entry.id);if(old)Object.assign(old,entry);else data.moodEntries.push(entry);Object.assign(moodForm,{id:'',date:todayStr(),moodIds:[],note:'',score:0});for(const k of Object.keys(moodQuestionsAnswers))delete moodQuestionsAnswers[k];moodPromptDismissed.value=entry.date;notify('Entrée du journal enregistrée');}
    function editMoodEntry(e){Object.assign(moodForm,{id:e.id,date:e.date,moodIds:[...(e.moodIds|| (e.moodId?[e.moodId]:[]))],note:e.note||'',score:e.score});for(const k of Object.keys(moodQuestionsAnswers))delete moodQuestionsAnswers[k];Object.assign(moodQuestionsAnswers,e.answers||{});}
    function removeMoodEntry(e){if(confirm('Supprimer cette note ?'))data.moodEntries=data.moodEntries.filter(x=>x.id!==e.id);}
    const moodPromptDismissed=ref('');
    const moodPromptDate=computed(()=>{
      // Si le bilan de la veille a été oublié, le proposer dès le lendemain.
      const yesterday=dateAdd(today.value,-1);
      if(!data.moodEntries.some(x=>x.date===yesterday) && moodPromptDismissed.value!==yesterday)return yesterday;
      if(new Date().getHours()*60+new Date().getMinutes()>=Number(data.moodReminderHour||0)*60 &&
          !data.moodEntries.some(x=>x.date===today.value) && moodPromptDismissed.value!==today.value)return today.value;
      return '';
    });
    const moodPromptOpen=computed(()=>nowMinute.value>=0 && !!moodPromptDate.value);
    function openMoodPrompt(){if(!moodPromptDate.value)return;Object.assign(moodForm,{id:'',date:moodPromptDate.value,moodIds:[],note:'',score:0});dismissMoodPrompt();setTab('mood');}
    function dismissMoodPrompt(){moodPromptDismissed.value=moodPromptDate.value||today.value;}
    const nowMinute=ref(0);
    setInterval(()=>{nowMinute.value++;today.value=todayStr();if(pendingAlterReview.value&&!alterReviewForm.open&&!pendingAppointment.value&&!apptForm.open)openPendingAlterReview();},60000);
    nextTick(()=>{if(pendingAlterReview.value)openPendingAlterReview();});
    // =============== V52 : Sport, poids et bilans de repas ===============
    const sportMode = ref('surprise');
    const sportLevel = ref('doux');
    const sportDraft = ref([]);
    const sportDraftKind = ref('mini');
    const sportMinutes = ref(12); // durée visée de la séance longue
    const sportActualMinutes = ref(12); // durée réellement déclarée
    const sportLongExerciseCount = ref(8); // 4 à 10 exercices pour la séance 10-15 min
    const sportPick = ref(null);
    const sportFocusOpen = ref(false);
    const sportFocusIndex = ref(0);
    function startSportFocus(){
      if(!sportDraft.value.length && !sportPick.value)return;
      sportFocusIndex.value=0;
      sportFocusOpen.value=true;
    }
    function closeSportFocus(){sportFocusOpen.value=false;}

    const sportWalkSteps=ref('');
    const sportFeedback=reactive({effort:'ok',discomfort:false,liked:true});
    const sportExerciseForm = reactive({name:'',category:'cardio',description:'',level:'doux',reps:'30 secondes',seconds:60});
    const sportLocationName = ref('');
    const sportStart = computed(()=>monday(today.value));
    const sportDateAdd=(date,n)=>{const d=new Date(date+'T12:00:00');d.setDate(d.getDate()+n);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
    // Cycle de 14 jours ancré à un lundi fixe (05/01/2026), configurable en durée.
    const walkCycleStart=computed(()=>{const base=new Date('2026-01-05T12:00:00');const now=new Date(sportStart.value+'T12:00:00');const days=Math.round((now-base)/86400000);const size=Math.max(7,Number(data.sportGoals.walkDays)||14);return sportDateAdd('2026-01-05',Math.floor(days/size)*size);});
    const sportProgress=computed(()=>({
      mini:data.sportSessions.filter(x=>['mini','long'].includes(x.kind)&&x.date>=sportStart.value&&x.date<=today.value).length,
      game:data.sportSessions.filter(x=>x.kind==='game'&&x.date>=sportStart.value&&x.date<=today.value).length,
      walk:data.sportSessions.filter(x=>x.kind==='walk'&&x.date>=walkCycleStart.value&&x.date<=today.value).length,
    }));
    const sportHistory=computed(()=>[...data.sportSessions].sort((a,b)=>String(b.createdAt||b.date).localeCompare(String(a.createdAt||a.date))));
    const sportReminder=computed(()=>{const dow=new Date(today.value+'T12:00:00').getDay();return dow>=4||dow===0;});
    const sportPool=computed(()=>data.sportExercises.filter(x=>x && x.active!==false && (sportLevel.value==='difficile' || (sportLevel.value==='moyen' && x.level!=='difficile') || (sportLevel.value==='doux' && x.level==='doux'))));
    const sportRandom=(items)=>items[Math.floor(Math.random()*items.length)];
    // La durée totale est la somme des temps attribués aux exercices.
    // Pour une séance longue, on répartit 10-15 min sur les exercices sélectionnés.
    // Le nombre de passages indique explicitement les répétitions du mouvement.
    function distributeSportDuration(exercises, targetMinutes){
      if(!exercises.length)return [];
      const targetUnits=Math.round(Math.max(10,Math.min(15,Number(targetMinutes)||12))*4); // quarts de minute
      const weights=exercises.map(x=>Math.max(15,Number(x.seconds)||60));
      const sum=weights.reduce((s,x)=>s+x,0);
      // minimum 30 secondes par mouvement
      const units=exercises.map(()=>2);
      let rest=Math.max(0,targetUnits-units.length*2);
      const ideal=weights.map(w=>rest*w/sum);
      for(let i=0;i<units.length;i++){const whole=Math.floor(ideal[i]);units[i]+=whole;rest-=whole;}
      const order=ideal.map((x,i)=>({i,part:x-Math.floor(x)})).sort((a,b)=>b.part-a.part);
      for(let i=0;i<rest;i++)units[order[i%order.length].i]++;
      return exercises.map((x,i)=>({...x,plannedSeconds:units[i]*15}));
    }
    const sportDraftTotalSeconds=computed(()=>sportDraft.value.reduce((sum,x)=>sum+(Number(x.plannedSeconds)||Number(x.seconds)||60),0));
    const sportDraftDoneSeconds=computed(()=>sportDraft.value.filter(x=>x.completed).reduce((sum,x)=>sum+(Number(x.plannedSeconds)||Number(x.seconds)||60),0));
    function sportTimeLabel(seconds){const s=Math.round(Math.max(0,Number(seconds)||0));return `${Math.floor(s/60)} min${s%60?' '+String(s%60).padStart(2,'0')+' s':''}`;}
    function sportPassages(ex){return Math.max(1,Math.ceil((Number(ex.plannedSeconds)||Number(ex.seconds)||60)/Math.max(15,Number(ex.seconds)||60)));}
    function setSportTargetMinutes(value){
      sportMinutes.value=Math.max(10,Math.min(15,Math.round(Number(value)||12)));
      if(sportDraftKind.value==='long'&&sportDraft.value.length){
        sportDraft.value=distributeSportDuration(sportDraft.value,sportMinutes.value);
        sportActualMinutes.value=sportDraftTotalSeconds.value/60;
      }
    }
    function generateSport(kind='mini'){
      sportDraftKind.value=kind;
      if(kind==='long'){sportMinutes.value=12;sportActualMinutes.value=12;}
      if(kind==='game'){
        const options=['Ring Fit Adventure','Just Dance'];
        const previous=sportPick.value?.name;
        const list=options.filter(x=>x!==previous);
        sportPick.value={name:sportRandom(list.length?list:options),minutes:15};sportDraft.value=[];return;
      }
      if(kind==='walk'){
        const items=data.sportLocations.filter(x=>x.active!==false);
        const options=items.filter(x=>x.id!==sportPick.value?.id);
        sportPick.value=sportRandom(options.length?options:items)||null;sportWalkSteps.value='';sportDraft.value=[];return;
      }
      const themeCategories=sportMode.value==='corps'?['genoux','renfo','cardio','mobilite','equilibre','fitness']:sportMode.value==='detente'?['etirement','mobilite','equilibre']:null;
      const all=sportPool.value.filter(x=>sportMode.value==='surprise'||sportMode.value==='mini'||(themeCategories?themeCategories.includes(x.category):x.category===sportMode.value));
      const availableByDuration = kind==='short' || kind==='mini'
        ? all.filter(x => (Number(x.seconds)||60) <= 90)
        : all;
      const fallback=availableByDuration.length ? availableByDuration : (all.length?all:sportPool.value);
      const n=kind==='short'?1:kind==='long'?Math.min(Math.max(4,Math.min(10,Math.trunc(Number(sportLongExerciseCount.value)||8))),fallback.length):Math.min(3,fallback.length);
      const picked=[];
      const available=[...fallback];
      // Dans le mode Surprise, garder le renforcement des genoux présent,
      // sans empêcher les autres mouvements courts.
      if((kind==='mini'||kind==='long') && sportMode.value==='surprise'){
        const knee=available.filter(x=>x.category==='genoux');
        while(picked.length<2 && knee.length){
          const chosen=knee.splice(Math.floor(Math.random()*knee.length),1)[0];
          picked.push(chosen);available.splice(available.findIndex(x=>x.id===chosen.id),1);
        }
      }
      while(picked.length<n && available.length){const ix=Math.floor(Math.random()*available.length);picked.push(available.splice(ix,1)[0]);}
      sportDraft.value=kind==='long' ? distributeSportDuration(picked.map(x=>({...x,completed:false})),sportMinutes.value) : picked.map(x=>({...x,completed:false,plannedSeconds:Number(x.seconds)||60}));
      if(kind==='long')sportActualMinutes.value=sportDraftTotalSeconds.value/60;
      sportPick.value=null;
    }
    function replaceSportExercise(index){
      const used=new Set(sportDraft.value.map(x=>x.id));
      const choices=sportPool.value.filter(x=>!used.has(x.id) &&
        (sportMode.value==='surprise'||x.category===sportMode.value) &&
        (!['mini','short'].includes(sportDraftKind.value)||(Number(x.seconds)||60)<=90));
      if(!choices.length){notify('Aucun autre exercice disponible avec ces filtres');return;}
      const newExercise={...sportRandom(choices),completed:false};
      sportDraft.value.splice(index,1,{...newExercise,plannedSeconds:Number(newExercise.seconds)||60});
      if(sportDraftKind.value==='long'){sportDraft.value=distributeSportDuration(sportDraft.value,sportMinutes.value);sportActualMinutes.value=sportDraftTotalSeconds.value/60;}
    }
    function completeSport(){
      const plannedKind=sportDraftKind.value;
      const exercises=sportDraft.value.filter(x=>x.completed);
      const kind=(['mini','long'].includes(plannedKind) && exercises.length<sportDraft.value.length)?'short':plannedKind;
      if((kind==='mini'||kind==='long'||kind==='short')&&!exercises.length){notify('Coche au moins un exercice réalisé');return;}
      if((kind==='game'||kind==='walk')&&!sportPick.value){notify('Choisis une activité');return;}
      if(kind==='walk' && sportWalkSteps.value!=='' && (!Number.isInteger(Number(sportWalkSteps.value)) || Number(sportWalkSteps.value)<0)){notify('Indique un nombre de pas entier positif, ou laisse le champ vide');return;}
      const points=Number(data.sportPoints[kind])||0;
      data.sportSessions.push({id:uid(),date:today.value,createdAt:new Date().toISOString(),kind,
        name:['mini','long','short'].includes(kind)?exercises.map(x=>x.name).join(', '):sportPick.value.name,
        exerciseIds:exercises.map(x=>x.id),steps:kind==='walk' && sportWalkSteps.value!==''?Number(sportWalkSteps.value):null,feedback:clone(sportFeedback),minutes:kind==='game'?Math.max(1,Number(sportPick.value.minutes)||15):kind==='walk'?Math.max(1,Number(sportPick.value.minutes)||20):['mini','long','short'].includes(plannedKind)?(kind==='long'?Math.max(1,Number(sportActualMinutes.value)||sportDraftDoneSeconds.value/60):Math.max(0.25,Math.round(sportDraftDoneSeconds.value/15)/4)):Math.max(1,Number(sportPick.value?.minutes)||1),points});
      sportDraft.value=[];sportPick.value=null;sportFocusOpen.value=false;sportFocusIndex.value=0;Object.assign(sportFeedback,{effort:'ok',discomfort:false,liked:true});notify('Activité enregistrée : +'+points+' points');
    }
    function deleteSportSession(x){if(confirm('Supprimer cette activité et ses points ?'))data.sportSessions=data.sportSessions.filter(y=>y.id!==x.id);}
    function addSportExercise(){const name=sportExerciseForm.name.trim();if(!name)return;data.sportExercises.push({...clone(sportExerciseForm),id:uid(),name,active:true});sportExerciseForm.name='';}
    function removeSportExercise(x){if(confirm('Supprimer cet exercice du catalogue ?'))data.sportExercises=data.sportExercises.filter(y=>y.id!==x.id);}
    function addSportLocation(){const name=sportLocationName.value.trim();if(!name)return;data.sportLocations.push({id:uid(),name,active:true});sportLocationName.value='';}
    function removeSportLocation(x){data.sportLocations=data.sportLocations.filter(y=>y.id!==x.id);}
    const weightForm=reactive({date:today.value,weight:null});
    const weightRecent=computed(()=>[...data.weightEntries].sort((a,b)=>b.date.localeCompare(a.date)));
    const weightLatest=computed(()=>weightRecent.value[0]?.weight??null);
    const weightWeekly=computed(()=>{const map=new Map();for(const x of data.weightEntries){const key=monday(x.date);if(!map.has(key))map.set(key,[]);map.get(key).push(Number(x.weight));}return [...map].sort((a,b)=>a[0].localeCompare(b[0])).map(([week,values])=>({week,average:Math.round(values.reduce((a,b)=>a+b,0)/values.length*10)/10,count:values.length}));});
    function saveWeight(){const v=Number(weightForm.weight);if(!weightForm.date||!Number.isFinite(v)||v<=0||v>500){notify('Poids invalide');return;}const existing=data.weightEntries.find(x=>x.date===weightForm.date);if(existing)existing.weight=v;else data.weightEntries.push({id:uid(),date:weightForm.date,weight:v});weightForm.weight=null;}
    function deleteWeight(x){if(confirm('Supprimer cette mesure ?'))data.weightEntries=data.weightEntries.filter(y=>y.id!==x.id);}
    const foodForm=reactive({open:false,date:'',kind:'lunch',status:'taken',actual:'',category:'',quantity:'ok',container:'',containerRating:'good',health:'unknown'});
    const foodContainerNew=ref('');
    function foodReviewKey(date,kind){return date+'|'+kind;}
    function foodReview(date,kind){return data.foodReviews[foodReviewKey(date,kind)]||null;}
    function openFoodReview(date,kind,status='taken'){
      const prior=foodReview(date,kind);
      Object.assign(foodForm,{open:true,date,kind,status:prior?.status||status,actual:prior?.actual||'',category:prior?.category||'',quantity:prior?.quantity||'ok',container:prior?.container||data.foodContainers[0]||'',containerRating:prior?.containerRating||'good',health:prior?.health||'unknown'});
      if(status==='changed'&&!prior)foodForm.status='changed';
    }
    function addFoodContainer(){const n=foodContainerNew.value.trim();if(n&&!data.foodContainers.includes(n))data.foodContainers.push(n);if(n)foodForm.container=n;foodContainerNew.value='';}
    function saveFoodReview(){
      if(foodForm.status==='changed'&&!foodForm.actual.trim()){notify('Indique le repas de remplacement');return;}
      if(!foodForm.container){notify('Choisis un récipient');return;}
      const key=foodReviewKey(foodForm.date,foodForm.kind);
      data.foodReviews[key]={completed:true,date:foodForm.date,kind:foodForm.kind,status:foodForm.status,actual:foodForm.status==='changed'?foodForm.actual.trim():'',category:foodForm.category,quantity:foodForm.quantity,container:foodForm.container,containerRating:foodForm.containerRating,health:foodForm.health};
      setMeal(foodForm.date,foodForm.kind,'state',foodForm.status==='changed'?'missed':'done');foodForm.open=false;finishReminderMeal(foodForm.date,foodForm.kind);notify('Bilan du repas enregistré');
    }
    const foodWeekReviews=computed(()=>Object.values(data.foodReviews).filter(x=>x?.completed&&x.date>=monday(today.value)&&x.date<=today.value));
    const foodSummary=computed(()=>{const arr=foodWeekReviews.value;return {total:arr.length,respected:arr.filter(x=>x.status==='taken').length,changed:arr.filter(x=>x.status==='changed').length,quantityOk:arr.filter(x=>x.quantity==='ok').length,balanced:arr.filter(x=>x.health==='balanced').length};});
    const foodReminder=reactive({open:false,date:'',items:[],activeKind:''});
    function checkFoodReminder(){
      const yesterday=sportDateAdd(today.value,-1);
      if(data.foodReminderShown[yesterday])return;
      const items=['lunch','dinner'].filter(kind=>{const slot=mealSlot(yesterday,kind);return (slot.name||slot.dishId)&&!foodReview(yesterday,kind);});
      if(!items.length)return;
      data.foodReminderShown[yesterday]=today.value;
      Object.assign(foodReminder,{open:true,date:yesterday,items,activeKind:''});
    }
    function closeFoodReminder(){foodReminder.open=false;foodReminder.activeKind='';}
    function reviewReminderMeal(kind){
      if(!foodReminder.items.includes(kind))return;
      const date=foodReminder.date;
      foodReminder.activeKind=kind;
      foodReminder.open=false;
      openFoodReview(date,kind);
    }
    function finishReminderMeal(date,kind){
      if(date!==foodReminder.date || kind!==foodReminder.activeKind)return;
      foodReminder.items=foodReminder.items.filter(x=>x!==kind && !foodReview(date,x));
      foodReminder.activeKind='';
      if(foodReminder.items.length)nextTick(()=>{foodReminder.open=true;});
    }
    function cancelFoodReview(){
      foodForm.open=false;
      if(foodReminder.activeKind){foodReminder.activeKind='';foodReminder.open=true;}
    }
    nextTick(()=>checkFoodReminder());
    watch(today,()=>checkFoodReminder());
    // =============== V53 : statistiques descriptives Sport / menu / poids ===============
    const wellnessRange=ref(8);
    const wellnessWeeks=computed(()=>{
      const end=monday(today.value);
      const rows=[];
      for(let i=Math.max(1,Math.min(52,Number(wellnessRange.value)||8))-1;i>=0;i--){
        const week=sportDateAdd(end,-7*i), until=sportDateAdd(week,6);
        const meals=Object.values(data.foodReviews).filter(x=>x?.completed&&x.date>=week&&x.date<=until);
        const acts=data.sportSessions.filter(x=>x.date>=week&&x.date<=until);
        const weights=data.weightEntries.filter(x=>x.date>=week&&x.date<=until&&Number(x.weight)>0);
        const count=meals.length;
        const mean=weights.length ? weights.reduce((n,x)=>n+Number(x.weight),0)/weights.length : null;
        rows.push({week, until, meals:count, respected:meals.filter(x=>x.status==='taken').length,
          changed:meals.filter(x=>x.status==='changed').length,
          quantityOk:meals.filter(x=>x.quantity==='ok').length,
          quantityLess:meals.filter(x=>x.quantity==='less').length,
          quantityMore:meals.filter(x=>x.quantity==='more').length,
          balanced:meals.filter(x=>x.health==='balanced').length,
          average:meals.filter(x=>x.health==='average').length,
          unbalanced:meals.filter(x=>x.health==='unbalanced').length,
          containersGood:meals.filter(x=>x.containerRating==='good').length,
          containersNeutral:meals.filter(x=>x.containerRating==='neutral').length,
          containersBad:meals.filter(x=>x.containerRating==='bad').length,
          activityCount:acts.length,
          minutes:acts.reduce((n,x)=>n+(Number(x.minutes)||0),0),
          steps:acts.filter(x=>x.kind==='walk').reduce((n,x)=>n+(Number(x.steps)||0),0),
          weight:mean===null?null:Math.round(mean*100)/100, weightCount:weights.length});
      }
      return rows;
    });
    const wellnessTotals=computed(()=>wellnessWeeks.value.reduce((a,r)=>{
      for(const key of ['meals','respected','changed','quantityOk','quantityLess','quantityMore','balanced','average','unbalanced','containersGood','containersNeutral','containersBad','activityCount','minutes','steps'])a[key]+=r[key];
      return a;
    },{meals:0,respected:0,changed:0,quantityOk:0,quantityLess:0,quantityMore:0,balanced:0,average:0,unbalanced:0,containersGood:0,containersNeutral:0,containersBad:0,activityCount:0,minutes:0,steps:0}));
    const wellnessFeelGroups=computed(()=>{
      const t=wellnessTotals.value;
      const make=(title,items)=>{
        const known=items.reduce((sum,x)=>sum+x.count,0);
        const unknown=Math.max(0,t.meals-known);
        return {title,total:t.meals,segments:[...items.map(x=>({...x,percent:t.meals?100*x.count/t.meals:0})),
          {label:'Non renseigné',count:unknown,color:'#d4d9d6',percent:t.meals?100*unknown/t.meals:0}]};
      };
      return [
        make('Respect du menu',[{label:'Respecté',count:t.respected,color:'#598c77'},{label:'Remplacé',count:t.changed,color:'#d6a064'}]),
        make('Quantité ressentie',[{label:'Adaptée',count:t.quantityOk,color:'#598c77'},{label:'Pas assez',count:t.quantityLess,color:'#e0b46f'},{label:'Trop',count:t.quantityMore,color:'#b87b86'}]),
        make('Équilibre estimé du plat',[{label:'Plutôt équilibré',count:t.balanced,color:'#598c77'},{label:'À améliorer',count:t.average,color:'#e0b46f'},{label:'Peu équilibré',count:t.unbalanced,color:'#b87b86'}]),
        make('Appréciation du récipient',[{label:'Adapté',count:t.containersGood,color:'#598c77'},{label:'Moyen',count:t.containersNeutral,color:'#e0b46f'},{label:'Pas adapté',count:t.containersBad,color:'#b87b86'}]),
      ];
    });
    // V58 : périodes hebdomadaires ou mensuelles, quatre distributions par période.
    const wellnessGrouping=ref('month');
    const wellnessPeriodRows=computed(()=>{
      const fields=['meals','respected','changed','quantityOk','quantityLess','quantityMore','balanced','average','unbalanced','containersGood','containersNeutral','containersBad'];
      const map=new Map();
      for(const row of wellnessWeeks.value){
        if(wellnessGrouping.value==='week'){
          const entry={key:row.week,label:'Semaine du '+formatDate(row.week)};
          for(const f of fields)entry[f]=row[f];
          map.set(entry.key,entry);
        }
      }
      if(wellnessGrouping.value==='month'){
        const first=wellnessWeeks.value[0]?.week;
        const last=wellnessWeeks.value[wellnessWeeks.value.length-1]?.until;
        if(!first||!last)return [];
        const ensure=(key)=>{
          if(!map.has(key)){const [y,m]=key.split('-').map(Number);const label=new Date(y,m-1,1).toLocaleDateString('fr-FR',{month:'long',year:'numeric'});const r={key,label};for(const f of fields)r[f]=0;map.set(key,r);}
          return map.get(key);
        };
        for(const x of Object.values(data.foodReviews)){
          if(!x?.completed||x.date<first||x.date>last)continue;
          const r=ensure(x.date.slice(0,7));r.meals++;
          if(x.status==='taken')r.respected++;
          if(x.status==='changed')r.changed++;
          if(x.quantity==='ok')r.quantityOk++;
          if(x.quantity==='less')r.quantityLess++;
          if(x.quantity==='more')r.quantityMore++;
          if(x.health==='balanced')r.balanced++;
          if(x.health==='average')r.average++;
          if(x.health==='unbalanced')r.unbalanced++;
          if(x.containerRating==='good')r.containersGood++;
          if(x.containerRating==='neutral')r.containersNeutral++;
          if(x.containerRating==='bad')r.containersBad++;
        }
      }
      return [...map.values()].sort((a,b)=>a.key.localeCompare(b.key));
    });
    const wellnessPeriodCharts=computed(()=>wellnessPeriodRows.value.map(r=>{
      const build=(title,values)=>{
        const known=values.reduce((n,x)=>n+x.count,0);
        const extra=Math.max(0,r.meals-known);
        const all=[...values,{label:'Non renseigné',count:extra,color:'#d4d9d6'}];
        return {title,segments:all.map(x=>({...x,percent:r.meals?100*x.count/r.meals:0}))};
      };
      return {key:r.key,label:r.label,total:r.meals,charts:[
        build('Menu prévu',[{label:'Respecté',count:r.respected,color:'#598c77'},{label:'Changé',count:r.changed,color:'#d6a064'}]),
        build('Quantité ressentie',[{label:'Adaptée',count:r.quantityOk,color:'#598c77'},{label:'Pas assez',count:r.quantityLess,color:'#e0b46f'},{label:'Trop',count:r.quantityMore,color:'#b87b86'}]),
        build('Équilibre du plat',[{label:'Plutôt équilibré',count:r.balanced,color:'#598c77'},{label:'À améliorer',count:r.average,color:'#e0b46f'},{label:'Peu équilibré',count:r.unbalanced,color:'#b87b86'}]),
        build('Récipient',[{label:'Adapté',count:r.containersGood,color:'#598c77'},{label:'Moyen',count:r.containersNeutral,color:'#e0b46f'},{label:'Pas adapté',count:r.containersBad,color:'#b87b86'}]),
      ]};
    }));
    function wellnessPct(num,den){return den?Math.round(100*num/den):0;}
    const wellnessMaxMinutes=computed(()=>Math.max(1,...wellnessWeeks.value.map(x=>x.minutes)));
    const wellnessMaxMeals=computed(()=>Math.max(1,...wellnessWeeks.value.map(x=>x.meals)));
    const wellnessWeightChart=computed(()=>{
      const valid=wellnessWeeks.value.filter(x=>x.weight!==null);
      if(!valid.length)return {points:[],segments:[],labels:[],min:0,max:0};
      const min=Math.floor((Math.min(...valid.map(x=>x.weight))-.5)*10)/10;
      const max=Math.ceil((Math.max(...valid.map(x=>x.weight))+.5)*10)/10;
      const spread=Math.max(0.5,max-min);
      return {min,max,labels:wellnessWeeks.value.map(x=>x.week),
        points:wellnessWeeks.value.map((r,i)=>r.weight===null?null:{x:10+(i/Math.max(1,wellnessWeeks.value.length-1))*380,y:120-((r.weight-min)/spread)*105,week:r.week,weight:r.weight}),
        segments:(()=>{const result=[];let line=[];for(const r of wellnessWeeks.value.map((row,i)=>row.weight===null?null:{x:10+(i/Math.max(1,wellnessWeeks.value.length-1))*380,y:120-((row.weight-min)/spread)*105})){if(r){line.push(`${r.x},${r.y}`);}else if(line.length){result.push(line.join(' '));line=[];}}if(line.length)result.push(line.join(' '));return result;})()};
    });
    const wellnessPaired=computed(()=>wellnessWeeks.value.filter(x=>x.weight!==null && x.meals>0));
    const wellnessStart=computed(()=>wellnessWeeks.value[0]?.week||monday(today.value));
    const wellnessEnd=computed(()=>wellnessWeeks.value[wellnessWeeks.value.length-1]?.until||today.value);
    const wellnessFoodCategories=computed(()=>{
      const counter=new Map();
      for(const x of Object.values(data.foodReviews)){
        if(!x?.completed || x.date<wellnessStart.value || x.date>wellnessEnd.value)continue;
        const key=String(x.category||'Non précisé');counter.set(key,(counter.get(key)||0)+1);
      }
      return [...counter].map(([name,count])=>({name,count})).sort((a,b)=>b.count-a.count);
    });
    const wellnessContainers=computed(()=>{
      const counter=new Map();
      for(const x of Object.values(data.foodReviews)){
        if(!x?.completed || x.date<wellnessStart.value || x.date>wellnessEnd.value)continue;
        const key=String(x.container||'Non précisé');
        if(!counter.has(key))counter.set(key,{name:key,count:0,good:0,neutral:0,bad:0});
        const r=counter.get(key);r.count++;if(['good','neutral','bad'].includes(x.containerRating))r[x.containerRating]++;
      }
      return [...counter.values()].sort((a,b)=>b.count-a.count);
    });
    const wellnessSportTypes=computed(()=>{
      const labels={short:'Mini-flemme',mini:'Mini-séance',long:'Séance longue',game:'Jeu actif',walk:'Balade'};
      const counts=new Map();
      for(const x of data.sportSessions){
        if(x.date<wellnessStart.value||x.date>wellnessEnd.value)continue;
        const name=labels[x.kind]||x.kind||'Autre';counts.set(name,(counts.get(name)||0)+1);
      }
      return [...counts].map(([name,count])=>({name,count})).sort((a,b)=>b.count-a.count);
    });
    const wellnessTrend=computed(()=>{
      const rows=wellnessWeeks.value.filter(x=>x.weight!==null);
      if(rows.length<2)return null;
      return Math.round((rows[rows.length-1].weight-rows[0].weight)*100)/100;
    });
    // Les rapprochements sont descriptifs. Aucune causalité, compensation ou score nutritionnel n'est déduit.
    // =============== fin V52 ===============

    // V59 : courbes de tendances (pourcentages uniquement, séries comparables).
    const wellnessTimeline=computed(()=>{
      const list=wellnessPeriodRows.value||[];
      const width=600,height=200,pad=30;
      const defs=[{key:'respected',name:'Menus respectés',color:'#467b65'},{key:'quantityOk',name:'Quantités adaptées',color:'#d29d4d'},{key:'balanced',name:'Plats évalués positivement',color:'#7772ae'},{key:'containersGood',name:'Récipients adaptés',color:'#bb7787'}];
      const series=defs.map(item=>({...item,points:list.map((r,i)=>{
        if(!r.meals)return null;
        return {x:pad+(list.length<=1?0.5:i/(list.length-1))*(width-pad*2),y:height-pad-(r[item.key]/r.meals)*(height-pad*2),pct:Math.round(r[item.key]/r.meals*100),label:r.label,n:r.meals};
      }),segments:[]}));
      for(const line of series){let group=[];for(const point of line.points){if(point)group.push(point.x+','+point.y);else if(group.length){line.segments.push(group.join(' '));group=[];}}if(group.length)line.segments.push(group.join(' '));}
      return {width,height,labels:list.map(x=>x.label),series};
    });
    const dashboardNav=computed(()=>data.dashboardWidgets.map(id=>dashboardCatalogue.find(x=>x.id===id)).filter(Boolean).map(x=>({id:x.id,name:x.name})));
    function jumpDashboard(id){nextTick(()=>document.getElementById('dashboard-'+id)?.scrollIntoView({behavior:'smooth',block:'start'}));}
    const goodHabitsHomeOpen = ref(true);
    const badHabitsHomeOpen = ref(true);
    // V4 : vue mobile légère. Les objets source et règles de calcul restent inchangés.
    const mobileTaskScope=ref('today');
    const mobileTaskQuery=ref('');
    const mobileTaskProject=ref('');
    const mobileTaskCategory=ref('');
    const mobileTaskSort=ref('due');
    const mobileLastDone=ref('');
    const mobileTasks=computed(()=>{
      const q=mobileTaskQuery.value.trim().toLocaleLowerCase('fr');
      return data.tasks.filter(t=>{
        if(t.scope==='work'||t.status==='done')return false;
        const due=taskDue(t);
        const start=t.startDate||'';
        const active=start&&start<=today.value&&(!due||due>=today.value);
        const todayFlag=due===today.value||!!active;
        if(mobileTaskScope.value==='today'&&!todayFlag)return false;
        if(mobileTaskScope.value==='late'&&!(due&&due<today.value))return false;
        if(mobileTaskScope.value==='upcoming'&&!(due&&due>today.value))return false;
        if(mobileTaskProject.value&&t.projectId!==mobileTaskProject.value)return false;
        if(mobileTaskCategory.value&&t.category!==mobileTaskCategory.value)return false;
        if(q){const p=data.projects.find(x=>x.id===t.projectId);
          if(![t.title,t.category,p?.name].some(x=>String(x||'').toLocaleLowerCase('fr').includes(q)))return false;}
        return true;
      }).sort((a,b)=>{
        if(mobileTaskSort.value==='title')return (a.title||'').localeCompare(b.title||'','fr');
        if(mobileTaskSort.value==='project')return (data.projects.find(p=>p.id===a.projectId)?.name||'').localeCompare(data.projects.find(p=>p.id===b.projectId)?.name||'','fr');
        if(mobileTaskSort.value==='points')return (Number(b.points)||0)-(Number(a.points)||0);
        return (taskDue(a)||'9999-12-31').localeCompare(taskDue(b)||'9999-12-31');
      });
    });
    function mobilePostponeTask(t){
      if(!t||t.status==='done')return;
      // Décaler uniquement la date d'échéance ; les dates initiales restent dans le reste du système.
      changeDue(t,dateAdd(today.value,1));
      notify('Tâche reportée à demain');
    }
    const mobileCalendarDays=computed(()=>calMode.value==='day'?[calAnchor.value]:calendarDays.value);
    return {
      mobileTaskScope,mobileTaskQuery,mobileTaskProject,mobileTaskCategory,mobileTaskSort,mobileLastDone,mobileTasks,mobilePostponeTask,mobileCalendarDays,
      routineDraft,saveRoutine,removeRoutine,routineProgress,routineHabits,routineStatsPeriod,routineStatsAnchor,routineStatsRange,routineStats,ingredientWeekDate,ingredientWeekStart,ingredientWeekEnd,ingredientWeekMeals,selectIngredientWeek,shiftIngredientWeek,groceryExcludedIds,groceryShoppingExists,leftoverDraft,addLeftover,consumeLeftover,planLeftover,removeLeftover,leftoverPlanDate,leftoverPlanKind,planLeftoverSelected,menuIngredientNeeds,addNeededIngredients,moodQuestionDraft,addMoodQuestion,removeMoodQuestion,moodCalendarMonth,moodCalendarDays,moodEntriesForDate,moodQuestionsAnswers,openMoodDay,workStatMonth,plannedPurchaseDraft,plannedPurchaseTotal,addPlannedPurchase,markPurchaseBought,removePlannedPurchase,workDetailed,workStatPeriod,dayView,dayOverview,dayMilestones,nextDeadlineDays,upcomingMilestones,openMilestoneItem,openDayItem,toggleHabitPause,setSubtaskPoints,openChooserChoice,
      wellnessTimeline,globalQuery,globalResults,openGlobalResult,chooserEnergy,chooserKind,chooserChoice,chooserPool,chooseAction,dayTasks,dayHabits,contextPeriod,focusTask,startFocus,waitingPersonFilter,waitingPeople,workLoad,notificationItems,dismissNotification,automationRules,envelopeMonth,envelopeRows,envelopeKey,dashboardLive,addFormSubtask,removeFormSubtask,toggleTaskSubtask,
      sportFocusOpen,sportFocusIndex,startSportFocus,closeSportFocus,sportFeedback,sportMode,sportLevel,sportDraft,sportDraftKind,sportMinutes,sportActualMinutes,sportDraftTotalSeconds,sportDraftDoneSeconds,sportTimeLabel,sportPassages,setSportTargetMinutes,sportLongExerciseCount,sportPick,sportWalkSteps,sportProgress,sportHistory,sportReminder,walkCycleStart,sportExerciseForm,sportLocationName,generateSport,replaceSportExercise,completeSport,deleteSportSession,addSportExercise,removeSportExercise,addSportLocation,removeSportLocation,weightForm,weightRecent,weightLatest,weightWeekly,saveWeight,deleteWeight,foodForm,foodReview,foodReviewKey,openFoodReview,addFoodContainer,foodContainerNew,saveFoodReview,foodSummary,foodWeekReviews,foodReminder,closeFoodReminder,reviewReminderMeal,cancelFoodReview,wellnessRange,wellnessGrouping,wellnessPeriodCharts,wellnessWeeks,wellnessTotals,wellnessFeelGroups,wellnessPct,wellnessMaxMinutes,wellnessMaxMeals,wellnessWeightChart,wellnessPaired,wellnessTrend,wellnessFoodCategories,wellnessContainers,wellnessSportTypes,
      projectAlterFilter,alterForm,alterTab,alterAssignment,alterActivityDraft,addAlterActivity,removeAlterActivity,alterDayFor,currentAlter,saveAlter,editAlter,removeAlter,assignAlterDay,alterWeekDays,alterReviewQuestions,alterReviewConfigOpen,newAlterReviewQuestion,addAlterReviewQuestion,removeAlterReviewQuestion,moveAlterReviewQuestion,alterReviewForm,uniqueAlterReviews,editAlterReview,dismissAlterReview,saveAlterReview,pendingAlterReview,openPendingAlterReview,moodForm,newMoodType,moodChartDays,moodChart,moodTypeFor,moodEntryTypes,moodTone,moodTypeValue,normalizeMoodOrder,draggedMood,dropMoodType,saveMoodType,removeMoodType,saveMood,editMoodEntry,removeMoodEntry,moodPromptOpen,moodPromptDate,openMoodPrompt,dismissMoodPrompt,nowMinute,dashboardNav,jumpDashboard,dashboardNewNoteType,appointmentWeek,
      ingredientOwnedFilter,pantryExpiring,pantryOverdue,calMode,calAnchor,calendarTitle,calendarDays,appointmentsOn,calendarLayers,calendarTasksOn,calendarMilestonesOn,openCalendarTask,openCalendarMilestone,categoryFor,appointmentUpcoming,appointmentToday,appointmentNext3,weekDate,linkedLabel,reminderChoices,toggleReminder,createLinkedTask,createLinkedProject,pendingDeadlineAlert,acknowledgeDeadlineAlert,moveCalendar,openAppointment,apptForm,saveAppointment,deleteAppointment,apptCategoryName,apptCategoryColor,draggedCategory,draggedAppointment,addAppointmentCategory,renameAppointmentCategory,deleteAppointmentCategory,dropAppointmentCategory,dropAppointment,pendingAppointment,postponeDate,confirmAppointment,rescheduleAppointment,achievementForm,openAchievement,saveAchievement,removeAchievement,sortedHabits,
      ingredientEditId,ingredientEditName,startIngredientEdit,saveIngredientEdit,shoppingEditId,money,suggestedMealDraft,openSuggestedMeal,confirmSuggestedMeal,ticketItemBlocker,validateTicketDependency,groceryExpected,groceryPaid,dashboardCatalogue,dashboardEdit,widgetVisible,setWidgetVisible,moveDashboardWidget,dashboardSorted,dashboardDragged,dropDashboardWidget,depPicker,dependencyMatches,dependencyChoices,setTaskDependency,blockingTask,plannerDate,plannerCandidates,plannedTasks,plannedMinutes,availableDishes,suggestionMode,suggestionLeftovers,suggestMeal,groceryTotal,groceryRemaining,successProgress,v29Date,
      dishLevelDraft,addDishLevel,renameDishLevel,deleteDishLevel,dishLevelDragged,reorderDishLevel,dishDifficultyFilter,dishTimeFilter,dishSort,
      randomNoteDraft,randomNoteTypeDraft,randomNoteNewType,randomNoteEditing,randomNoteDragged,randomNoteTypeDragged,randomNoteTypeFilter,addRandomNote,addRandomNoteType,renameRandomNoteType,deleteRandomNoteType,reorderRandomNoteType,deleteRandomNote,dropRandomNote,randomNoteGroups,visibleRandomNotes,taskSuggestFocused,ingredientSuggestFocused,taskSuggestions,ingredientSuggestions,shoppingSuggestions,
      dishEditSearch,toggleDishIngredient,dishCategoryOpen,dishCategoryDragged,dishCategoryIsOpen,toggleDishCategory,reorderDishCategory,ticketWaiting,ticketCreatedLabel,ingredientCategoryOpen,ingredientCategoryDragged,ingredientIsOpen,toggleIngredientCategory,reorderIngredientCategory,deleteIngredientCategory,renameMilestone,ticketColorState,ticketStale,ticketNeedsAction,touchTicket,noteEditing,showArchivedNotes,noteDragged,visibleNotes,toggleNoteArchive,dropNote,menuRulesEditing,dishEditing,dishCategoryNew,dishDragged,ingredientDragged,dishCategoryList,addDishCategory,renameDishCategory,deleteDishCategory,dropDishCategory,dropIngredientCategory,renameIngredientCategory,saveDishEdit,shoppingEstimatedDraft,shoppingPriceItem,shoppingPriceInput,confirmShoppingPrice,finishShopping,
      favoriteDish,addReplacedMealToCatalogue,dishCats,setDishCats,dishFoodTypes,dishCategoryFilter,dishFoodTypeFilter,suggestDishCategory,suggestFoodType,suggestPage,suggestPageSize,suggestedDishPages,paginatedDishes,menuTab,dishQuery,ingredientQuery,dishIngredientQuery,dishIngredientChoices,shoppingQuery,dishDraft,ingredientDraft,ingredientCategoryDraft,newIngredientCategory,ingredientLocationDraft,newIngredientLocation,ingredientLocationList,addIngredientLocation,ingredientCategoryList,groupedDishIngredients,groupedIngredients,groupedShopping,shoppingDraft,shoppingQuantityDraft,shoppingIngredientId,shoppingAddMode,shoppingIngredientSearch,shoppingIngredientChoices,shoppingCategoryDraft,shoppingStoreDraft,shoppingStoreFilter,shoppingStores,pendingMeal,shoppingVisible,filteredDishes,filteredIngredients,addIngredient,addIngredientCategory,setIngredientOwned,moveShoppingCategory,shoppingCategoryDragged,addIngredientToShopping,addDish,dishName,dishIngredients,assignDish,confirmDishMissing,addShoppingItem,checkShoppingItem,removeShoppingItem,removeDish,removeIngredient,restoreTrash,emptyTrash,todayMeals,mealStats,habitStats,suggestedTasks,refreshPriorities,milestoneDraft,milestoneTaskDraft,milestoneDrag,startMilestoneTaskDrag,endMilestoneTaskDrag,dropTaskIntoMilestone,milestoneTaskLabel,milestoneTasks,milestoneDone,linkMilestoneTask,addMilestone,addMilestoneTask,toggleMilestone,setMilestonePoints,removeMilestone,milestones,weekSummary,
      menuWeekOffset,menuWeekStart,menuWeekDays,mealSlot,setMeal,dragMeal,dropMeal,setMealState,menuDragged,goodHabitsHomeOpen,badHabitsHomeOpen,pausedDashboardHabits,
      // état
      budgetMonth,budgetSection,budgetCategories,budgetCategoryName,reorderDrag,startReorder,dropReorder,cashForm,cashBalance,cashIncome,cashExpenses,addCashEntry,removeCashEntry,moveBudgetCategory,addBudgetCategory,renameBudgetCategory,deleteBudgetCategory,budgetEntryForm,budgetRecurringForm,budgetSwileForm,budgetItems,budgetDisplayItems,budgetSummary,budgetSwileSource,budgetSwileNext,recurringForMonth,money,changeBudgetMonth,monthAfter,addBudgetEntry,addBudgetRecurring,addBudgetSwile,overrideRecurring,resetRecurringOverride,removeBudgetEntry,removeBudgetRecurring,removeBudgetSwile,
      usualDragged,usualNewItem,addUsualList,removeUsualList,addUsualHeading,addUsualItem,toggleUsualItem,resetUsualList,deleteUsualItem,startUsualDrag,dropUsualItem,
      addTicketType,deleteTicketType,safeTicketUrl,
      ticketSort,hideWaitingTickets,ticketDragged,ticketDragStart,ticketDrop,ticketDraft,ticketInputs,collapsedTickets,isTicketCollapsed,toggleTicketCollapse,renameTicket,updateTicketItemPoints,openTickets,closedTickets,createTicket,addTicketItem,toggleTicketItem,finishTicket,reopenTicket,removeTicket,removeTicketItem,ticketPoints,ticketItemValue,doneStats,statistics,
      data, ui, view, setTab, pageTitle, today, toast, doneScope, doneRecent, doneArchive, doneCutoff, tabs: TABS, navGroups: NAV_GROUPS, statuses: STATUSES, tagStyle,
      // cloud
      firebaseReady, user, syncState, syncLabel, signIn, signOut,
      // catégories
      categories, rewardCategories, newRewardCategory, addRewardCategory, deleteRewardCategory, categoryForm, openCategoryForm, saveCategory, deleteCategory, categoryUsage, setCategoryColor,
      // urgences & difficultés
      newLevel, levelUsage, addLevel, renameLevel, setLevelColor, moveLevel, deleteLevel,
      // points
      earned, balance, challengeTotal, nextReward, favoriteReward, rewardRemaining, formatPoints, toggleRewardFavorite, depositReward, depositRandomReward, randomRewardCategory, randomRewardExcludeFavorite, randomRewardEligible, withdrawReward, gratitudeTotal, savedTotal, gratitudeDraft, gratitudeMoment, todayGratitude, sortedGratitude, saveGratitude, deleteGratitude, workCategories, newWorkCategory, addWorkCategory, deleteWorkCategory, addWorkDifficulty, deleteWorkDifficulty, addWorkUrgency, deleteWorkUrgency, moveWorkLevel, moveTicketType, balanceForm, openBalanceForm, applyBalance, resetBalance,
      rewardFilters, visibleRewards, groupedRewards, visibleInventory, unusedInventory, usedInventory, rewardClaimCount, setInventoryUsed,
      // filtres
      filters, resetFilters, activeFilterCount, taskDue, todayTasks, upcomingTasks, undatedTasks, allTasks, workTasks, doneTasks, doneWorkTasks, copyForm, copyText, copyTaskTitles,
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
      CHALLENGE_KINDS, challengeForm, openChallengeForm,newChallengeFromHabit, saveChallenge, deleteChallenge, toggleChallenge, hideChallengeHome, currentChallenges, challengeHistory, challengeProgress,
      habitForm, habitWeekdays,addHabitProgressionStep,removeHabitProgressionStep,activateHabitProgression,habitProgressionCompleted,openHabitForm, saveHabit, dashboardHabits, habitIsFinished, markHabitFinished, habitDue, habitDoneToday, completeHabit, postponeHabit, completeHabitPast, postponeLateHabit, undoHabitPast, habitPeriodStats, undoHabit, deleteHabit, habitCount, habitAwards, habitLateDays, habitQuantity, setHabitQuantity, habitTotal, habitPenaltiesToday, penalizeHabit, undoHabitPenalty,
      activityForm, randomActivity, pickRandomActivity, openActivityForm, saveActivity, deleteActivity, createFromActivity,
      // utilitaires
      formatDate, mealMode, setMealMode, mealDishSearch, isMealEditing, toggleMealEditing, closeMealEditing, chooseMealDish, clearMealChoice, eveningPreview, renderEveningMarkdown, addTextarea, removeTextarea, openWorkQuickPaste,
    };
  },
});

app.config.errorHandler = (error, instance, info) => {
  console.error('[Todo Quest] Erreur Vue :', info, error);
  let panel = document.getElementById('todo-error-banner');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'todo-error-banner';
    panel.setAttribute('role', 'alert');
    panel.style.cssText = 'position:fixed;bottom:12px;left:12px;right:12px;max-height:35vh;overflow:auto;z-index:99999;padding:12px 16px;background:#fff0f0;border:2px solid #b91c1c;color:#7f1d1d;font:14px Arial,sans-serif;box-shadow:0 4px 14px #0003';
    document.body.appendChild(panel);
  }
  panel.textContent = 'Todo Quest : erreur sur la page. ' + (error?.message || String(error)) + ' (section : ' + info + '). Copie ce message pour le diagnostic. Tes données ne sont pas supprimées.';
};
app.component('task-list', TaskList);
app.mount('#app');
