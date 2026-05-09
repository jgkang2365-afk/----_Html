import sys
import os

path = 'components/features/SummaryTable.tsx'
if not os.path.exists(path):
    print(f"File not found: {path}")
    sys.exit(1)

with open(path, 'r', encoding='utf-8') as f:
    lines = f.readlines()

# line 1481 -> index 1480
lines[1480] = lines[1480].replace('md:grid-cols-3', 'sm:grid-cols-3')
# line 1542 -> index 1541
lines[1541] = lines[1541].replace('md:grid-cols-12', 'sm:grid-cols-12')
# line 1665 -> index 1664
lines[1664] = lines[1664].replace('md:grid-cols-3', 'sm:grid-cols-3')
# line 1762 -> index 1761
lines[1761] = lines[1761].replace('md:grid-cols-3', 'sm:grid-cols-3')

with open(path, 'w', encoding='utf-8', newline='\r\n') as f:
    f.writelines(lines)

print("Successfully updated SummaryTable.tsx")
