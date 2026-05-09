import json
import re
import os

def translate_label(label):
    if not label: return label
    
    # Common patterns for functions
    label = re.sub(r'(?i)^handle(.*)\(\)', r'\1 처리()', label)
    label = re.sub(r'(?i)^fetch(.*)\(\)', r'\1 조회()', label)
    label = re.sub(r'(?i)^update(.*)\(\)', r'\1 수정()', label)
    label = re.sub(r'(?i)^delete(.*)\(\)', r'\1 삭제()', label)
    label = re.sub(r'(?i)^create(.*)\(\)', r'\1 생성()', label)
    label = re.sub(r'(?i)^get(.*)\(\)', r'\1 조회()', label)
    label = re.sub(r'(?i)^set(.*)\(\)', r'\1 설정()', label)
    label = re.sub(r'(?i)^load(.*)\(\)', r'\1 로드()', label)
    label = re.sub(r'(?i)^search(.*)\(\)', r'\1 검색()', label)
    label = re.sub(r'(?i)^sync(.*)\(\)', r'\1 동기화()', label)
    label = re.sub(r'(?i)^toggle(.*)\(\)', r'\1 전환()', label)
    label = re.sub(r'(?i)^format(.*)\(\)', r'\1 포맷()', label)
    label = re.sub(r'(?i)^parse(.*)\(\)', r'\1 파싱()', label)
    label = re.sub(r'(?i)^validate(.*)\(\)', r'\1 검증()', label)
    
    # Specific Terms
    mapping = {
        "page.tsx": "메인 화면",
        "route.ts": "API 엔드포인트",
        "layout.tsx": "레이아웃",
        "createClient": "DB 클라이언트 생성",
        "K2BService": "K2B 연동 서비스",
        "NationalSupport": "국고지원",
        "Business": "사업장",
        "Journal": "측정일지",
        "Survey": "조사",
        "Quota": "할당량",
        "Measurer": "측정자",
        "Office": "기관/지사",
        "Jurisdiction": "관할구역",
        "Payment": "결제",
        "Invoice": "계산서",
        "User": "사용자",
        "Auth": "인증",
        "Calendar": "캘린더",
        "Excel": "엑셀",
        "Sync": "동기화",
        "Records": "기록",
        "Status": "상태",
        "Info": "정보",
        "Category": "카테고리",
        "Management": "관리",
        "Search": "검색",
        "Detail": "상세",
        "Register": "등록",
        "Upload": "업로드",
        "Download": "다운로드",
        "Recalculate": "재계산",
        "Maintenance": "유지보수",
        "Instrumentation": "계측/모니터링",
        "Middleware": "미들웨어",
        "Permission": "권한",
        "Bounce": "반송",
        "Recovery": "복구",
        "Truncated": "잘린",
        "Corrupted": "손상된",
        "Export": "내보내기",
        "Import": "가져오기",
    }
    
    for en, ko in mapping.items():
        pattern = re.compile(re.escape(en), re.IGNORECASE)
        label = pattern.sub(ko, label)
            
    return label

def translate_community(comm_id, nodes):
    labels = [n.get('label', '') for n in nodes]
    all_text = " ".join(labels).lower()
    
    if "k2b" in all_text: return "K2B 국가 시스템 연동"
    if "calendar" in all_text: return "Google 캘린더 동기화"
    if "excel" in all_text and "upload" in all_text: return "엑셀 업로드 처리"
    if "auth" in all_text or "login" in all_text: return "인증 및 사용자 관리"
    if "journal" in all_text: return "측정일지 관리 모듈"
    if "business" in all_text and "management" in all_text: return "사업장 정보 관리"
    if "national" in all_text and "support" in all_text: return "국고지원 사업 관리"
    if "survey" in all_text: return "실태조사 관리"
    if "quota" in all_text: return "할당량 및 예산 관리"
    if "jurisdiction" in all_text or "address" in all_text: return "관할지 매칭 및 주소 처리"
    if "api" in all_text or "route" in all_text: return "API 백엔드 서비스"
    if "middleware" in all_text: return "보안 및 요청 미들웨어"
    if "sync" in all_text: return "데이터 동기화 서비스"
    if "modal" in all_text: return "공통 UI 컴포넌트 (모달)"
    if "background" in all_text or "task" in all_text: return "백그라운드 작업 및 알림"
    if "payment" in all_text or "sales" in all_text: return "매출 및 결제 관리"
    
    return f"모듈 그룹 {comm_id}"

def process():
    json_path = 'graphify-out/graph.json'
    ko_html_path = 'graphify-out/graph-ko.html'
    
    if not os.path.exists(json_path):
        print(f"Error: {json_path} not found")
        return

    # 1. Extract vibrant colors from graph-ko.html if available
    cid_to_color = {}
    if os.path.exists(ko_html_path):
        print(f"Extracting colors from {ko_html_path}...")
        with open(ko_html_path, 'r', encoding='utf-8') as f:
            html_content = f.read()
            # Find LEGEND array
            m = re.search(r'const LEGEND = (\[.*?\]);', html_content, re.DOTALL)
            if m:
                legend_list = json.loads(m.group(1))
                for item in legend_list:
                    cid_to_color[item['cid']] = item['color']
                print(f"Found {len(cid_to_color)} community colors.")

    # 2. Load and Translate Data
    with open(json_path, 'r', encoding='utf-8') as f:
        data = json.load(f)
    
    comms = {}
    for node in data['nodes']:
        orig_label = node.get('label', '')
        node['label_en'] = orig_label
        node['label'] = translate_label(orig_label)
        node['title'] = f"{node['label']} ({orig_label})"
        
        cid = node.get('community')
        if cid not in comms: comms[cid] = []
        comms[cid].append(node)
        
        # Inject explicit color for vis.js
        if cid in cid_to_color:
            c = cid_to_color[cid]
            node['color'] = {'background': c, 'border': c, 'highlight': {'background': c, 'border': '#333'}}

    legend_data = []
    sorted_cids = sorted(comms.keys(), key=lambda c: len(comms[c]), reverse=True)
    
    for cid in sorted_cids:
        nodes = comms[cid]
        name = translate_community(cid, nodes)
        for node in nodes:
            node['community_name'] = name
            # Update node's title to show Korean community name
            node['title'] = f"<b>{node['label']}</b><br>파일: {node['label_en']}<br>그룹: {name}"
            
        color = cid_to_color.get(cid, '#888')
        legend_data.append({
            "cid": cid,
            "color": color,
            "label": name,
            "count": len(nodes)
        })

    # 3. Update BOTH HTML Files
    targets = ['graphify-out/graph.html', 'graphify-out/graph-ko.html']
    for target in targets:
        if os.path.exists(target):
            with open(target, 'r', encoding='utf-8') as f:
                html = f.read()
            
            # Inject RAW_NODES
            new_nodes_json = json.dumps(data['nodes'], ensure_ascii=False)
            html = re.sub(r'const RAW_NODES = \[.*?\];', lambda m: f'const RAW_NODES = {new_nodes_json};', html, flags=re.DOTALL)
            
            # Inject LEGEND
            new_legend_json = json.dumps(legend_data, ensure_ascii=False)
            html = re.sub(r'const LEGEND = \[.*?\];', lambda m: f'const LEGEND = {new_legend_json};', html, flags=re.DOTALL)
            
            # 3. Improved Search Logic and Display
            search_fix = """
  const q = searchInput.value.toLowerCase().trim();
  searchResults.innerHTML = '';
  if (!q) { searchResults.style.display = 'none'; return; }
  const matches = RAW_NODES.filter(n => 
    (n.label || '').toLowerCase().includes(q) || 
    (n.label_en || '').toLowerCase().includes(q) || 
    (n.community_name || '').toLowerCase().includes(q)
  ).slice(0, 30);
  if (!matches.length) { searchResults.style.display = 'none'; return; }
  searchResults.style.display = 'block';
  matches.forEach(n => {
    const el = document.createElement('div');
    el.className = 'search-item';
    el.style.height = 'auto';
    el.style.padding = '6px 10px';
    el.style.borderLeft = `4px solid ${n.color.background}`;
    el.innerHTML = `<div style="font-weight:600; font-size:12px;">${n.label}</div>
                    <div style="font-size:10px; color:#888; overflow:hidden; text-overflow:ellipsis;">${n.label_en} <span style="color:#666">| ${n.community_name}</span></div>`;
    el.onclick = () => {
"""
            html = re.sub(r'const q = searchInput\.value\.toLowerCase\(\)\.trim\(\);.*?el\.onclick = \(\) => \{', search_fix, html, flags=re.DOTALL)

            # 4. Disable improvedLayout to fix rendering freeze
            if 'improvedLayout: false' not in html:
                html = html.replace("solver: 'forceAtlas2Based',", "solver: 'forceAtlas2Based', improvedLayout: false,")
            
            # 5. CSS Fix for Search Results (Make it pop)
            html = html.replace("#search-results {", "#search-results { background: #1a1a2e; border: 1px solid #3a3a5e; border-top: none; z-index: 100; position: relative; ")
            
            # Ensure the sidebar title is Korean
            html = html.replace('<h3>Communities</h3>', '<h3>모듈 그룹(커뮤니티)</h3>')
            html = html.replace('<h3>Node Info</h3>', '<h3>노드 정보</h3>')
            
            # Replace common UI text
            ui_replacements = {
                '<title>graphify': '<title>지식 그래프 (한글판)',
                'placeholder="Search nodes..."': 'placeholder="노드 검색..."',
                'Click a node to inspect it': '노드를 클릭하여 상세 정보를 확인하세요',
                'nodes &middot;': '개 노드 &middot;',
                'edges &middot;': '개 연결 &middot;',
                'communities': '개 그룹',
                'Search results': '검색 결과',
                'Neighbors': '연결된 노드'
            }
            for old, new in ui_replacements.items():
                html = html.replace(old, new)
            
            with open(target, 'w', encoding='utf-8') as f:
                f.write(html)
            print(f"Success: Updated {target}")

if __name__ == "__main__":
    process()
