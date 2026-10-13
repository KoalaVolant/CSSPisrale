const { createApp, reactive, ref, computed, watch, nextTick } = Vue;

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

const TABS = [
  { id: 'home',     label: 'Accueil' },
  { id: 'all',      label: 'Toutes les tâches' },
  { id: 'projects', label: 'Projets' },
  { id: 'rewards',  label: 'Récompenses' },
  { id: 'data',     label: 'Sauvegarde' },
];

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

function defaultData() {
  return {
    tasks: [],        // { id, title, category, points, status, projectId, due }
    projects: [],     // { id, name, description }
    rewards: [        // { id, name, category, cost }
      { id: uid(), name: 'Un bon café',           cost: 20 },
      { id: uid(), name: 'Une soirée jeux vidéo', cost: 100 },
      { id: uid(), name: 'Un resto',              cost: 300 },
    ],
    inventory: [],    // { id, name, category, cost, date, used }
    spent: 0,         // total de points dépensés en récompenses
    adjust: 0,        // ajustement manuel du solde (peut être négatif)
  };
}

function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultData();
    return Object.assign(defaultData(), JSON.parse(raw));
  } catch (e) {
    return defaultData();
  }
}

function loadUi() {
  const defaults = { filtersOpen: false, tab: 'home' };
  try {
    const ui = Object.assign(defaults, JSON.parse(localStorage.getItem(UI_KEY) || '{}'));
    if (!TABS.some(t => t.id === ui.tab)) ui.tab = 'home';   // onglet inconnu -> accueil
    return ui;
  } catch (e) {
    return defaults;
  }
}

/* ============================================================
   Composant : ligne de tâche (template dans index.html)
   ============================================================ */
const TaskRow = {
  template: '#task-row-template',
  props: ['task', 'projectLabel', 'statuses', 'today', 'selected'],
  emits: ['toggle', 'status', 'points', 'due'],
  computed: {
    isOverdue() {
      return !!this.task.due && this.task.due < this.today && this.task.status !== 'done';
    },
    dueLabel() {
      return formatLongDate(this.task.due);
    },
  },
  methods: {
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
  },
};

/* ============================================================
   Composant : liste de tâches avec barre d'actions (cocher / modifier / supprimer)
   Les événements status / points / due sont transmis aux lignes via $attrs.
   ============================================================ */
const TaskList = {
  template: '#task-list-template',
  components: { TaskRow },
  inheritAttrs: false,
  props: {
    tasks:    { type: Array, default: () => [] },
    projects: { type: Array, default: () => [] },
    statuses: { type: Array, default: () => [] },
    today:    { type: String, default: '' },
    selected: { type: Array, default: () => [] },   // ids cochés (global)
  },
  emits: ['toggle', 'select-all', 'clear', 'edit-selected', 'delete-selected'],
  computed: {
    allIds()      { return this.tasks.map(t => t.id); },
    selectedIds() { return this.tasks.filter(t => this.selected.includes(t.id)).map(t => t.id); },
    allSelected() { return this.tasks.length > 0 && this.selectedIds.length === this.tasks.length; },
  },
  methods: {
    projectLabel(task) {
      if (!task.projectId) return '';
      const p = this.projects.find(x => x.id === task.projectId);
      return p ? p.name : '';
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
    watch(data, () => {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch (e) { /* stockage indisponible */ }
    }, { deep: true });

    /* ---------- Préférences d'affichage (mémorisées) ---------- */
    const ui = reactive(loadUi());
    watch(ui, () => {
      try { localStorage.setItem(UI_KEY, JSON.stringify(ui)); } catch (e) { /* stockage indisponible */ }
    }, { deep: true });

    // Onglet ouvert sous le tableau de bord ('' = aucun) : mémorisé avec les autres préférences
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

    /* ---------- Points ---------- */
    const earned = computed(() =>
      data.tasks.filter(t => t.status === 'done').reduce((s, t) => s + (Number(t.points) || 0), 0));
    const balance = computed(() => earned.value - data.spent + (Number(data.adjust) || 0));

    // Modification manuelle du solde : on règle "adjust" pour tomber pile sur la valeur voulue
    const balanceForm = reactive({ open: false, value: 0 });
    function openBalanceForm() {
      balanceForm.value = balance.value;
      balanceForm.open = !balanceForm.open;
    }
    function applyBalance() {
      const target = Number(balanceForm.value);
      if (!Number.isFinite(target)) return;
      data.adjust = Math.round(target) - (earned.value - data.spent);
      balanceForm.open = false;
      notify(`Solde réglé à ${Math.round(target)} pts`);
    }
    function resetBalance() {
      if (!confirm('Remettre le solde de points à 0 ?')) return;
      data.adjust = -(earned.value - data.spent);
      balanceForm.open = false;
      notify('Solde remis à 0');
    }

    const rewardsByCost = computed(() => [...data.rewards].sort((a, b) => a.cost - b.cost));
    const nextReward = computed(() => rewardsByCost.value.find(r => r.cost > balance.value) || null);

    // Filtre / tri des récompenses (le filtre de catégorie s'applique aussi à l'inventaire)
    const rewardFilters = reactive({ category: '', sort: 'cost-asc' });

    const rewardCategories = computed(() =>
      [...new Set([...data.rewards, ...data.inventory].map(r => r.category).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b)));

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

    const visibleInventory = computed(() => data.inventory.filter(matchesRewardCategory));

    /* ---------- Filtres & tris ---------- */
    const filters = reactive({ search: '', category: '', status: '', project: '', sort: 'due', showDone: false });

    function resetFilters() {
      Object.assign(filters, { search: '', category: '', status: '', project: '', sort: 'due', showDone: false });
    }

    // Nombre de filtres actifs (affiché sur le bouton "Filtres / tri" quand le panneau est replié)
    const activeFilterCount = computed(() => {
      let n = 0;
      if (filters.search.trim()) n++;
      if (filters.category) n++;
      if (filters.status) n++;
      if (filters.project) n++;
      if (filters.sort !== 'due') n++;
      if (filters.showDone) n++;
      return n;
    });

    const categories = computed(() =>
      [...new Set(data.tasks.map(t => t.category).filter(Boolean))].sort((a, b) => a.localeCompare(b)));

    function applyFilters(list) {
      const q = filters.search.trim().toLowerCase();
      const res = list.filter(t => {
        if (!filters.showDone && !filters.status && t.status === 'done') return false;
        if (filters.status && t.status !== filters.status) return false;
        if (filters.category && t.category !== filters.category) return false;
        if (filters.project === '__none' && t.projectId) return false;
        if (filters.project && filters.project !== '__none' && t.projectId !== filters.project) return false;
        if (q && !t.title.toLowerCase().includes(q)) return false;
        return true;
      });
      const byDue = (a, b) => (a.due || '9999').localeCompare(b.due || '9999');
      switch (filters.sort) {
        case 'points-desc': res.sort((a, b) => b.points - a.points || byDue(a, b)); break;
        case 'points-asc':  res.sort((a, b) => a.points - b.points || byDue(a, b)); break;
        case 'title':       res.sort((a, b) => a.title.localeCompare(b.title)); break;
        default:            res.sort(byDue);
      }
      return res;
    }

    const todayTasks    = computed(() => applyFilters(data.tasks.filter(t => t.due && t.due <= today.value)));
    const upcomingTasks = computed(() => applyFilters(data.tasks.filter(t => t.due && t.due > today.value)));
    const allTasks      = computed(() => applyFilters(data.tasks));

    /* ---------- Tâches ---------- */
    const taskForm = reactive({
      open: false, id: null, title: '', category: '', points: 10, status: 'todo', projectId: '', due: '',
    });

    function openTaskForm(task = null, projectId = '') {
      if (task) {
        Object.assign(taskForm, {
          id: task.id, title: task.title, category: task.category || '', points: task.points,
          status: task.status, projectId: task.projectId || '', due: task.due || '',
        });
      } else {
        Object.assign(taskForm, {
          id: null, title: '', category: '', points: 10, status: 'todo', projectId,
          due: today.value,
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

    function saveTask() {
      const title = taskForm.title.trim();
      if (!title) return;
      const payload = {
        title,
        category: taskForm.category.trim(),
        points: Math.max(0, Number(taskForm.points) || 0),
        status: taskForm.status,
        projectId: taskForm.projectId || '',
        due: taskForm.due || '',
      };
      if (taskForm.id) {
        const t = data.tasks.find(x => x.id === taskForm.id);
        if (t) {
          const wasDone = t.status === 'done';
          Object.assign(t, payload);
          if (!wasDone && t.status === 'done') notify(`+${t.points} pts !`);
        }
      } else {
        const t = { id: uid(), ...payload };
        data.tasks.push(t);
        if (t.status === 'done') notify(`+${t.points} pts !`);
      }
      taskForm.open = false;
    }

    /* ---------- To do rapide (plusieurs tâches d'un coup) ---------- */
    const quickForm = reactive({
      open: false, mode: 'rows', due: '', rows: [],
      paste: { text: '', points: 10, category: '', due: '', project: '' },
    });
    const pastePreview = computed(() => parsePastedList(quickForm.paste.text));

    function openQuickForm() {
      taskForm.open = false;
      quickForm.mode = 'rows';
      quickForm.paste = { text: '', points: 10, category: '', due: today.value, project: '' };
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
      rows.forEach(r => data.tasks.push({
        id: uid(),
        title: r.title.trim(),
        category: '',
        points: Math.max(0, Number(r.points) || 0),
        status: 'todo',
        projectId: '',
        due: r.due || '',
      }));
      notify(rows.length ? `${rows.length} tâche(s) ajoutée(s)` : 'Aucune tâche à ajouter');
      quickForm.open = false;
    }

    function savePaste() {
      const { header, items } = pastePreview.value;
      if (!items.length) { notify('Aucune tâche détectée'); return; }

      let projectId = quickForm.paste.project;
      if (projectId === '__header') {
        if (header) {
          const project = { id: uid(), name: header, description: '' };
          data.projects.push(project);
          projectId = project.id;
        } else {
          projectId = '';
        }
      }

      const points = Math.max(0, Number(quickForm.paste.points) || 0);
      const category = quickForm.paste.category.trim();
      items.forEach(title => data.tasks.push({
        id: uid(), title, category, points, status: 'todo', projectId, due: quickForm.paste.due || '',
      }));
      notify(`${items.length} tâche(s) ajoutée(s)`);
      quickForm.open = false;
    }

    /* ---------- Sélection (cases à cocher) ---------- */
    const selection = ref([]);   // ids des tâches cochées

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
    const bulkForm = reactive({ open: false, ids: [], category: '', points: '', status: '', projectId: '__keep', due: '', clearDue: false });

    function editSelected(ids) {
      if (ids.length === 1) {
        const t = data.tasks.find(x => x.id === ids[0]);
        if (t) openTaskForm(t);
        return;
      }
      Object.assign(bulkForm, { open: true, ids: [...ids], category: '', points: '', status: '', projectId: '__keep', due: '', clearDue: false });
    }

    function saveBulk() {
      let gained = 0;
      bulkForm.ids.forEach(id => {
        const t = data.tasks.find(x => x.id === id);
        if (!t) return;
        if (bulkForm.category.trim()) t.category = bulkForm.category.trim();
        if (bulkForm.points !== '' && bulkForm.points !== null && Number.isFinite(Number(bulkForm.points))) {
          t.points = Math.max(0, Math.round(Number(bulkForm.points)));
        }
        if (bulkForm.status) {
          if (t.status !== 'done' && bulkForm.status === 'done') gained += Number(t.points) || 0;
          t.status = bulkForm.status;
        }
        if (bulkForm.projectId !== '__keep') t.projectId = bulkForm.projectId;
        if (bulkForm.clearDue) t.due = '';
        else if (bulkForm.due) t.due = bulkForm.due;
      });
      notify(gained ? `${bulkForm.ids.length} tâches modifiées · +${gained} pts !` : `${bulkForm.ids.length} tâches modifiées`);
      bulkForm.open = false;
    }

    function deleteSelected(ids) {
      if (!ids.length) return;
      const msg = ids.length === 1 ? 'Supprimer la tâche sélectionnée ?' : `Supprimer les ${ids.length} tâches sélectionnées ?`;
      if (!confirm(msg)) return;
      data.tasks = data.tasks.filter(t => !ids.includes(t.id));
    }

    // On oublie les cases cochées dont la tâche n'existe plus
    watch(() => data.tasks.length, () => {
      selection.value = selection.value.filter(id => data.tasks.some(t => t.id === id));
    });

    // Échap ferme les popups
    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      const popup = [bulkForm, taskForm, quickForm, projectForm, rewardForm, balanceForm].find(f => f.open);
      if (popup) popup.open = false;
    });

    // Points à gagner dans les listes Aujourd'hui / À venir (tâches pas encore terminées)
    const sumToEarn = list => list.filter(t => t.status !== 'done').reduce((s, t) => s + (Number(t.points) || 0), 0);
    const stats = computed(() => ({
      doing: data.tasks.filter(t => t.status === 'doing').length,
      done: data.tasks.filter(t => t.status === 'done').length,
      overdue: data.tasks.filter(t => t.due && t.due < today.value && t.status !== 'done').length,
    }));
    const todayPoints    = computed(() => sumToEarn(todayTasks.value));
    const upcomingPoints = computed(() => sumToEarn(upcomingTasks.value));

    function deleteTask(task) {
      if (!confirm(`Supprimer la tâche « ${task.title} » ?`)) return;
      data.tasks = data.tasks.filter(t => t.id !== task.id);
    }

    function changeStatus(task, newStatus) {
      const old = task.status;
      task.status = newStatus;
      if (old !== 'done' && newStatus === 'done') notify(`+${task.points} pts !`);
      if (old === 'done' && newStatus !== 'done') notify(`−${task.points} pts (tâche rouverte)`);
    }

    function changePoints(task, value) {
      task.points = Math.max(0, Number(value) || 0);
    }

    function changeDue(task, value) {
      task.due = value || '';
    }

    function projectName(id) {
      const p = data.projects.find(x => x.id === id);
      return p ? p.name : '';
    }

    /* ---------- Projets ---------- */
    const projectForm = reactive({ open: false, id: null, name: '', description: '', tasks: [] });

    function openProjectForm(project = null) {
      if (project) {
        Object.assign(projectForm, { id: project.id, name: project.name, description: project.description || '', tasks: [] });
      } else {
        Object.assign(projectForm, { id: null, name: '', description: '', tasks: [{ title: '', category: '', points: 10, due: '' }] });
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
        if (p) { p.name = name; p.description = projectForm.description.trim(); }
      } else {
        const project = { id: uid(), name, description: projectForm.description.trim() };
        data.projects.push(project);
        projectForm.tasks
          .filter(d => d.title.trim())
          .forEach(d => data.tasks.push({
            id: uid(),
            title: d.title.trim(),
            category: (d.category || '').trim(),
            points: Math.max(0, Number(d.points) || 0),
            status: 'todo',
            projectId: project.id,
            due: d.due || '',
          }));
      }
      projectForm.open = false;
    }

    function deleteProject(project) {
      const n = data.tasks.filter(t => t.projectId === project.id).length;
      const msg = n
        ? `Supprimer le projet « ${project.name} » et ses ${n} tâche(s) ?`
        : `Supprimer le projet « ${project.name} » ?`;
      if (!confirm(msg)) return;
      data.tasks = data.tasks.filter(t => t.projectId !== project.id);
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
        points: list.reduce((s, t) => s + (Number(t.points) || 0), 0),
      };
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
      const payload = { name, cost: Math.max(1, Number(rewardForm.cost) || 1), category: rewardForm.category.trim() };
      if (rewardForm.id) {
        const r = data.rewards.find(x => x.id === rewardForm.id);
        if (r) Object.assign(r, payload);
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
      if (balance.value < reward.cost) return;
      data.spent += reward.cost;
      data.inventory.unshift({
        id: uid(), name: reward.name, category: reward.category || '', cost: reward.cost, date: todayStr(), used: false,
      });
      notify(`Récompense gagnée : ${reward.name} !`);
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
        item.category = invForm.category.trim();
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
          data.tasks = json.tasks;
          data.projects = json.projects;
          data.rewards = json.rewards;
          data.inventory = json.inventory;
          data.spent = Number(json.spent) || 0;
          data.adjust = Number(json.adjust) || 0;
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
      if (!confirm('Tout effacer (tâches, projets, récompenses, inventaire) ?' + cloudNote + ' Pense à exporter avant !')) return;
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
      data.tasks     = Array.isArray(remote.tasks) ? remote.tasks : [];
      data.projects  = Array.isArray(remote.projects) ? remote.projects : [];
      data.rewards   = Array.isArray(remote.rewards) ? remote.rewards : [];
      data.inventory = Array.isArray(remote.inventory) ? remote.inventory : [];
      data.spent     = Number(remote.spent) || 0;
      data.adjust    = Number(remote.adjust) || 0;
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
      data, ui, view, setTab, pageTitle, today, toast, tabs: TABS, statuses: STATUSES,
      // cloud
      firebaseReady, user, syncState, syncLabel, signIn, signOut,
      // points
      earned, balance, nextReward, balanceForm, openBalanceForm, applyBalance, resetBalance,
      rewardFilters, rewardCategories, visibleRewards, visibleInventory,
      // filtres
      filters, resetFilters, activeFilterCount, categories, todayTasks, upcomingTasks, allTasks,
      // tâches
      quickForm, openQuickForm, toggleQuickForm, addQuickRow, removeQuickRow, applyQuickDue, saveQuick, pastePreview, savePaste,
      taskForm, openTaskForm, toggleTaskForm, saveTask, deleteTask, changeStatus, changePoints, changeDue, projectName,
      selection, toggleSelect, selectMany, deselectMany, editSelected, deleteSelected, bulkForm, saveBulk,
      todayPoints, upcomingPoints, stats,
      // projets
      projectForm, openProjectForm, addDraftTask, saveProject, deleteProject, projectTasks, projectStats,
      // récompenses
      rewardForm, openRewardForm, saveReward, deleteReward, claimReward,
      // inventaire
      invForm, startEditInv, saveInv, deleteInv, refundInv,
      // données
      exportData, importData, resetAll,
      // utilitaires
      formatDate,
    };
  },
});

app.component('task-list', TaskList);
app.mount('#app');
