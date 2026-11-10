TODO QUEST V77.3 TEST — REFACTORISATION MODULAIRE SANS MIGRATION

PC : fichiers à la racine de /tododo/ ; Mobile : fichiers dans /tododo/mobile/.
Installer tout le contenu de l’archive, notamment les dossiers js/ et mobile/js/.
Conserver les fichiers de styles et le dossier mobile existants seulement si vous déployez la version PC seule.

Refonte effectuée :
- Découpage du JS monolithique en 5 fichiers Classic Script, dans l’ordre de chargement original.
- 01-core.js : paramètres, utilitaires, constantes.
- 02-catalogue.js : catalogue sportif initial.
- 03-storage.js : initialisation, migrations, persistance locale et préférences.
- 04-task-components.js : TaskRow et TaskList.
- 05-application.js : création Vue, logique des modules, synchronisation, montage.
- Copie des anciens monolithes dans legacy/ pour comparaison et retour arrière (NON CHARGÉS).
- Les formulaires et le HTML métier sont conservés ; CSS conservés.
- Version visible PC v77.3 TEST / Mobile v9.3 TEST.
- Mise à jour du service worker mobile pour lister les nouveaux scripts et versionner le cache.

LIMITE IMPORTANTE :
Ce découpage rend le projet plus maintenable, mais ne sépare PAS encore l’intérieur de la grande fonction setup() en modules indépendants. Refactoriser celle-ci sans tests fonctionnels réels sur Firebase serait risqué. Aucun changement du moteur de fusion V72 : les conflits simultanés restent non validés.

Pour revenir en arrière, réinstaller PC V77.2 et Mobile V9.2 EN ENTIER.
Ne pas remplacer directement les données JSON. Conserver un export avant essai.

Tests fournis : tests/test_refactor.py et tests/test_smoke.cjs.
Pour les exécuter : python3 tests/test_refactor.py ; node tests/test_smoke.cjs
