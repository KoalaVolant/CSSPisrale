from pathlib import Path
from bs4 import BeautifulSoup
BASE=Path(__file__).resolve().parents[1]
for folder in (BASE,BASE/'mobile'):
 html=(folder/'index.html').read_text()
 app=(folder/'js/05-application.js').read_text()
 for name in ('randomNoteSearch','randomNoteStatus','toggleRandomNoteArchive','toggleRandomNoteFavorite','randomNoteToTask','sportPreferenceExercises','setSportPreference','saveAllIncompleteDrafts','incompleteRequiredFields','chooseQuickAction'):
  assert name in app and name in html,(folder,name)
 assert 'sportRecentIds' in app and 'chooserRecentIds' in app
 assert "sourceNoteId:n.id" in app
 assert "sourceNoteContent" in html
 assert "x.tqPreference!=='avoid'" in app
 assert "sportWeightedPick(available)" in app
 assert "notes:data.randomNotes.filter(note=>(note.type||'')===type&&isRandomNoteVisible(note))" in app
 assert "isRandomNoteVisible(n)" in app
 assert 'Enregistrer les {{incompleteDirtyCount}}' in html
 doc=BeautifulSoup(html,'html.parser')
 assert doc.select('.v79-note-tools') and doc.select('.v79-sport-preferences')
 print('OK',folder.name,'V79+V80+V81 UI and bindings')
