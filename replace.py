import codecs
import re

path = r"c:\Users\USER\Desktop\cursor\측정일지_html\components\features\SalesManagement.tsx"
with codecs.open(path, 'r', 'utf-8') as f:
    content = f.read()

# 1. Replace StatTables (from 년도별 집계 to 매출 관리 탭)
start_marker = "      {/* 년도별 집계 */}"
end_marker = "      {/* 매출 관리 탭 */}"
start_idx = content.find(start_marker)
end_idx = content.find(end_marker)

if start_idx != -1 and end_idx != -1:
    new_middle = """      {/* 년도별 집계 및 미수금 현황 */}
      {summary && (
        <StatTables
          summary={summary}
          measurementRevenue={measurementRevenue}
          otherRevenue={otherRevenue}
          formatCurrency={formatCurrency}
          yearOptions={yearOptions}
        />
      )}

"""
    content = content[:start_idx] + new_middle + content[end_idx:]
    print("Replaced StatTables successfully.")
else:
    print("Could not find start/end markers for StatTables.")

# 2. Fix OtherRevenueTable syntax
other_target = """              content: (() => {
                  <OtherRevenueTable
                    data={otherRevenue}
                    formatCurrency={formatCurrency}
                    onEdit={handleOtherEdit}
                  />
                );
              })(),"""
other_replace = """              content: (
                <OtherRevenueTable
                  data={otherRevenue}
                  onEdit={handleOtherEdit}
                  formatCurrency={formatCurrency}
                />
              ),"""
if other_target in content:
    content = content.replace(other_target, other_replace)
    print("Fixed OtherRevenueTable syntax successfully.")
else:
    # Try an alternative matching using regex in case indentation is slightly off
    pattern = re.compile(r'content:\s*\(\(\)\s*=>\s*\{\s*<OtherRevenueTable[^>]*/>\s*\);\s*\}\)\(\),', re.DOTALL)
    match = pattern.search(content)
    if match:
        content = content[:match.start()] + other_replace + content[match.end():]
        print("Fixed OtherRevenueTable using regex.")
    else:
        print("Could not find OtherRevenueTable syntax to fix.")

# 3. ThirdPartyTable extraction
third_party_pattern = re.compile(
    r'\{\s*id:\s*"third_party",\s*label:\s*"타업체 발행 현황",\s*content:\s*\(\(\)\s*=>\s*\{.*?(?=\}\s*\]\s*/>)',
    re.DOTALL
)
match = third_party_pattern.search(content)
if match:
    third_party_replacement = """{
              id: "third_party",
              label: "타업체 발행 현황",
              content: (
                <ThirdPartyTable 
                  data={measurementRevenue}
                  formatCurrency={formatCurrency}
                />
              ),
            },
          """
    content = content[:match.start()] + third_party_replacement + content[match.end():]
    print("Replaced ThirdPartyTable successfully.")
else:
    print("Could not find ThirdPartyTable to replace.")

with codecs.open(path, 'w', 'utf-8') as f:
    f.write(content)
    
print("Write complete.")
