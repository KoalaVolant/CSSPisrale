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
