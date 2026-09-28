from pathlib import Path
p = Path('src/server/store.ts')
s = p.read_text()
old = 'tx.update(ref, updated);'
assert s.count(old) == 1
p.write_text(s.replace(old, 'tx.update(ref, { ...updated });'))
print('Corrected the Firebase transaction update type without changing validation.')
