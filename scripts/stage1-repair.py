from pathlib import Path
p = Path('scripts/stage1-firebase.json')
s = p.read_text()
assert s.count('../firestore.rules') == 1
p.write_text(s.replace('../firestore.rules', 'firestore.rules'))
print('Use repository-root security rules in the isolated emulator configuration.')
