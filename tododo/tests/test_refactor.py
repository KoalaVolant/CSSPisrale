from pathlib import Path
import re,sys,subprocess
from bs4 import BeautifulSoup
BASE=Path(__file__).resolve().parents[1]
labels=['01-core.js','02-catalogue.js','03-storage.js','04-task-components.js','05-application.js']
for home,source in [(BASE,'app.js'),(BASE/'mobile','app-mobile.js')]:
    html=(home/'index.html').read_text(encoding='utf-8')
    soup=BeautifulSoup(html,'html.parser')
    scripts=[s.get('src','').split('?')[0] for s in soup.select('script[src]')]
    new=['./js/'+label for label in labels]
    assert all(name in scripts for name in new),(home,scripts)
    assert [scripts.index(name) for name in new]==sorted(scripts.index(name) for name in new)
    assert scripts.index('./sync-merge-v72.js')<scripts.index(new[0])
    assert all((home/'js'/label).stat().st_size > 0 for label in labels), 'Empty JS module'
    assert 'firebase-config.js' in html
    assert 'Tâches incomplètes' in html or 'tâches incomplètes' in html
    for label in labels:
        assert (home/'js'/label).is_file()
        subprocess.run(['node','--check',str(home/'js'/label)],check=True,capture_output=True)
    print('OK modular source preservation + script order + syntax:',home)
sw=(BASE/'mobile'/'sw.js').read_text(encoding='utf-8')
for label in labels: assert './js/'+label in sw
assert 'tqm-shell-v11-0-test' in sw
print('OK service-worker cache version and assets')
