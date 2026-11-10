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
  const defaults = { filtersOpen: false, tab: 'home', projectSort: 'manual', collapsedProjects: [], dashboardMode: 'essential', dashboardModes: {} };
  try {
    const ui = Object.assign(defaults, JSON.parse(localStorage.getItem(UI_KEY) || '{}'));
    if (!TABS.some(t => t.id === ui.tab)) ui.tab = 'home';   // onglet inconnu -> accueil
    if (!Array.isArray(ui.collapsedProjects)) ui.collapsedProjects = [];
    if (!['essential','complete'].includes(ui.dashboardMode)) ui.dashboardMode = 'complete';
    if (!ui.dashboardModes || typeof ui.dashboardModes !== 'object' || Array.isArray(ui.dashboardModes)) ui.dashboardModes = {};
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
