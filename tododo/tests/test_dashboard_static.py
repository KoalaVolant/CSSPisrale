from pathlib import Path
import re
from bs4 import BeautifulSoup
ROOT=Path(__file__).resolve().parents[1]
html=(ROOT/'index.html').read_text(encoding='utf-8')
css=(ROOT/'dashboard-v77.css').read_text(encoding='utf-8')
soup=BeautifulSoup(html,'html.parser')
root=soup.select_one('#dashboard-tasks')
assert root, 'dashboard tasks absent'
assert root.select_one('.v77-simple-columns'), 'simple absent'
assert len(root.select('.v77-detailed-columns > .v761-detail-group'))==2, 'detail columns'
assert not root.select('.v77-detailed-columns details, .v77-detailed-columns summary'), 'detail collapsible'
assert len(root.select('.v77-detailed-columns .v771-detail-content'))==2
assert len(root.select('.v761-task-actions button'))==3
assert root.select_one('#v761-incomplete-panel') or soup.select_one('#v761-incomplete-panel'), 'incomplete panel missing'
assert 'v77.5' in html
for selector in ('.v77-simple-columns .v761-task-title strong','.v77-simple-columns .v761-task-title span','.v77-simple-columns .v761-task-actions button','.v77-simple-columns .v761-task-field select'):
    assert selector in css, f'missing scoped font rule: {selector}'
assert '#dashboard-tasks .v77-task-columns' in css
print('OK: static dashboard regression checks')
