import os

import pandas as pd
import requests

# 1. DB 설정
SUPABASE_URL = os.environ["SUPABASE_URL"].rstrip("/")
SUPABASE_ANON_KEY = os.environ["NEXT_PUBLIC_SUPABASE_ANON_KEY"]
URL = f"{SUPABASE_URL}/rest/v1/measurement_business"
HEADERS = {
    "apikey": SUPABASE_ANON_KEY,
    "Authorization": f"Bearer {SUPABASE_ANON_KEY}",
}

# 2. 데이터 추출
response = requests.get(URL, headers=HEADERS)
df = pd.DataFrame(response.json())

# 3. 전처리 (205 -> 2025 보정 및 우선순위 부여)
df['year'] = df['year'].replace(205, 2025)
df['priority'] = df.apply(lambda x: 1 if (x['year'] == 2026 and x['period'] == '상반기')
                         else 2 if (x['year'] == 2025 and x['period'] == '하반기')
                         else 3 if (x['year'] == 2025 and x['period'] == '상반기') else 99, axis=1)

# 4. 중복 제거 및 정렬
df = df[df['priority'] < 99]
df = df.sort_values(by=['code', 'priority'], ascending=True)
df = df.drop_duplicates(subset='code', keep='first')

# 5. 컬럼 매칭 및 추출 (알려주신 컬럼명 반영)
cols = {
    'code': '코드',
    'business_name': '사업장명',
    'representative_name': '대표자명',
    'designated_office': '관할청(지정지청)',
    'address': '주소',
    'business_category': '업종분류',
    'phone': '전화번호',
    'fax': 'Fax',
    'manager_name': '담당자명',
    'manager_position': '담당자 직책',
    'manager_phone': '담당자 휴대폰',
    'manager_email': '담당자 메일',
    'invoice_email': '계산서 메일',
    'business_number': '사업자번호',
    'industrial_accident_number': '산재관리번호'
}

# 컬럼 존재 여부 확인 후 안전하게 추출
available_cols = [c for c in cols.keys() if c in df.columns]
final_df = df[available_cols].rename(columns=cols)

# 6. 엑셀 저장 (포맷팅 포함)
with pd.ExcelWriter("사업장목록_추출.xlsx", engine='openpyxl') as writer:
    final_df.to_excel(writer, index=False, sheet_name='사업장목록')

    # 시트 자동 너비 조절
    worksheet = writer.sheets['사업장목록']
    for idx, col in enumerate(final_df.columns):
        # 한글 너비 고려하여 적절히 조절
        max_len = max(final_df[col].astype(str).map(len).max(), len(col)) + 4
        column_letter = chr(65 + idx)
        worksheet.column_dimensions[column_letter].width = max_len

print("사업장목록_추출.xlsx 생성 완료")
