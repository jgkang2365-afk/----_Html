import openpyxl
import os
import sys

# 표준 출력 인코딩을 utf-8로 설정하여 한글 깨짐 방지
sys.stdout.reconfigure(encoding='utf-8')

template_path = r"c:\Users\USER\Desktop\안티그래티비\측정일지_html\public\templates\measure_target_template.xlsx"

if os.path.exists(template_path):
    wb = openpyxl.load_workbook(template_path, read_only=True)
    sheet = wb.active
    print("Sheet Title:", sheet.title)
    
    # 첫 3행 출력 (최대 25열)
    for r_idx, row in enumerate(sheet.iter_rows(max_row=3, values_only=True), start=1):
        clean_row = [str(val) if val is not None else "None" for val in row[:25]]
        print(f"Row {r_idx}: {clean_row}")
else:
    print("Template file not found at", template_path)
