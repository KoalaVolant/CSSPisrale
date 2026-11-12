from pathlib import Path
from hashlib import sha256
from bs4 import BeautifulSoup
import zipfile
ROOT=Path(__file__).resolve().parents[1]
PREVIOUS=Path('/mnt/data/TodoQuest_V77_4_PC_MobileV9_4_TEST.zip')
if PREVIOUS.exists():
  with zipfile.ZipFile(PREVIOUS) as z:
      for prefix in ('','mobile/'):
          for file in ('sync-merge-v72.js','firebase-config.js','style.css','stylekoala.css','styletest.css','sport-catalog-v67.js'):
              name=prefix+file
              assert sha256((ROOT/name).read_bytes()).digest()==sha256(z.read(name)).digest(),f'Fichier metier modifie: {name}'
          for n in range(1,6):
              name=f'{prefix}js/{n:02d}-'+['core','catalogue','storage','task-components','application'][n-1]+'.js'
              assert (ROOT/name).read_bytes()==z.read(name),f'Logique modifiee: {name}'
else:
  print('INFO: archive V77.4 absente, comparaison binaire non effectuee')
mobile=ROOT/'mobile'
html=(mobile/'index.html').read_text(encoding='utf-8')
soup=BeautifulSoup(html,'html.parser')
css=[x.get('href','').split('?')[0] for x in soup.select('link[rel="stylesheet"]')]
assert css[-1]=='nonsticky-v9-5.css',f'La derniere feuille doit annuler les anciens stickies: {css}'
new=(mobile/'nonsticky-v9-5.css').read_text(encoding='utf-8')
for selector in ('.page-header','.task-toolbar','.dashboard-mini-nav','.filters','.tqm-header','.tqm-notes-title','.tqm-agenda-day-head'):
    assert selector in new,selector
assert 'position: static !important' in new
assert '.tqm-bottom-nav' not in new,'Ne pas affecter la navigation en bas'
assert 'v9.5 test' in html
assert 'v77.5' in (ROOT/'index.html').read_text(encoding='utf-8')
sw=(mobile/'sw.js').read_text(encoding='utf-8')
assert "'./nonsticky-v9-5.css'" in sw
assert 'tqm-shell-v9-5' in sw
print('OK: JS metier + Firebase + CSS historiques inchanges ; version et neutralisation sticky ciblees')
