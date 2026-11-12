from pathlib import Path
from bs4 import BeautifulSoup
import re, subprocess
base=Path(__file__).resolve().parents[1]
for root,badge,tag in ((base,'v78.0','78-0-rc'),(base/'mobile','v10.0','10-0-rc')):
 s=(root/'index.html').read_text()
 assert badge in s
 soup=BeautifulSoup(s,'html.parser')
 references=[n.get('src') or n.get('href') for n in soup.select('script[src],link[href]')]
 local=[x for x in references if x.startswith('./') and re.search(r'\.(?:js|css)(?:\?|$)',x)]
 assert local and all('build='+tag in x for x in local),(root,local)
 for value in local: assert (root/value.split('?')[0]).is_file(),value
 assert (root/'diagnostic.html').is_file()
 for name in ('01-core.js','02-catalogue.js','03-storage.js','04-task-components.js','05-application.js'):
  subprocess.run(['node','--check',str(root/'js'/name)],check=True,capture_output=True)
 print('OK:',badge,'assets and diagnostic')
sw=(base/'mobile/sw.js').read_text()
assert 'tqm-shell-v10-0-rc' in sw and 'ignoreSearch:true' in sw
subprocess.run(['node','--check',str(base/'mobile/sw.js')],check=True)
print('OK: cache revision, offline query fallback')
