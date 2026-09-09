/** Selenium executeScript 내부에서만 실행한다. 브라우저 객체/원본 HTML은 반환하지 않는다. */
const K2B_SUBMISSION_GRID_RUNTIME_SCRIPT = String.raw`
  const fail = reason => { throw new Error('K2B_GRID_SCHEMA_MISMATCH:' + reason); };
  const text = value => String(value ?? '').trim();
  const normalize = value => text(value).normalize('NFKC').replace(/\s+/g, '');
  const count = value => value !== null && value !== undefined && value !== '' && Number.isSafeInteger(Number(value)) && Number(value) >= 0 ? Number(value) : null;
  const roots = [...document.querySelectorAll('[id$="_grid_fileList"]')]
    .filter(node => node.getClientRects().length > 0);
  if (roots.length !== 1) fail('grid_not_unique');
  const root = roots[0];
  const grids = new Set();
  const visited = new Set();
  const queue = [root._control, root._linkedcontrol, root._control_element?.linkedcontrol];
  try { queue.push(window.nexacro?.getApplication?.(), window.application); } catch {}
  // DOM control 연결 또는 Application의 명시적 component/frame 트리만 탐색한다.
  // 실제 DOM에는 control 연결이 없을 수 있다. Dataset은 작은 명시 component 트리에서
  // 화면 handle까지 일치하는 Grid를 찾을 때만 사용하고, 그 밖에는 DOM reader로 넘긴다.
  for (let cursor = 0; cursor < queue.length && cursor < 256; cursor++) {
    const item = queue[cursor];
    if (!item || typeof item !== 'object' || visited.has(item)) continue;
    visited.add(item);
    if ((item.id === 'grid_fileList' || item.name === 'grid_fileList') && typeof item.getCellProperty === 'function') {
      const handle = item.getElement?.()?.handle;
      if (!handle || handle === root || handle.id === root.id) grids.add(item);
    }
    for (const key of ['mainframe', 'form', 'components', 'frames', 'all', 'objects', 'VFrameSet', 'MainFrame']) {
      const child = item[key];
      if (!child || typeof child !== 'object') continue;
      queue.push(child);
      if (typeof child.length === 'number') {
        for (let i = 0; i < Math.min(child.length, 256); i++) queue.push(child[i]);
      }
    }
  }
  if (grids.size > 1) fail('component_not_unique');
  const grid = [...grids][0];
  let dataset;
  try {
    dataset = grid?.getBindDataset?.();
    if (!dataset && typeof grid?.binddataset === 'string') {
      const id = grid.binddataset.replace(/^@/, '');
      for (let parent = grid.parent; parent && !dataset; parent = parent.parent) dataset = parent[id] || parent.objects?.[id];
    }
  } catch { /* 직접 접근할 수 없는 런타임만 가상 스크롤로 전환한다. */ }
`;

export const K2B_BEGIN_SUBMISSION_REFRESH_SCRIPT = String.raw`
${K2B_SUBMISSION_GRID_RUNTIME_SCRIPT}
const key = '__k2bSubmissionGridRefreshObserver';
window[key]?.dispose?.();
const button = document.getElementById('mainframe_VFrameSet_MainFrame_form_div_Form_div_Work_103017203_div_Work_div_Search_btn_SearchTextBoxElement');
if (!button) throw new Error('K2B_GRID_REFRESH_UNVERIFIABLE:search_button_missing');
const supportsDatasetEvent = !!dataset && typeof dataset.addEventHandler === 'function' && typeof dataset.removeEventHandler === 'function';
const state = { dataset, armed: false, loadVersion: 0, failed: false, pending: false, searchVersion: 0, mutationVersion: 0, observer: null, dispose: null };
const onSearch = () => { state.armed = true; state.searchVersion++; state.loadVersion = 0; state.failed = false; state.pending = supportsDatasetEvent; };
const onLoad = (sender, event) => {
  if (!state.armed || sender !== dataset) return;
  if (typeof event?.errorcode !== 'number' || event.errorcode < 0) { state.failed = true; return; }
  // REASON_LOADPROCESS(1)는 부분 수신이다. 전체 수신 완료 REASON_LOAD(0)만 인정한다.
  if (event.reason === 1) { state.pending = true; return; }
  if (event.reason === 0) { state.loadVersion++; state.pending = false; }
};
state.dispose = () => {
  state.armed = false;
  state.observer?.disconnect?.();
  if (supportsDatasetEvent) dataset.removeEventHandler('onload', onLoad, grid);
  button.removeEventListener('click', onSearch, true);
};
// Dataset event가 없으면 검색 후 grid content mutation을 freshness 증거로 사용한다.
// style/class 변화만으로 stale 화면을 승인하지 않도록 child/text 변화만 관측한다.
if (typeof MutationObserver === 'function') {
  state.observer = new MutationObserver(records => {
    if (state.armed && records.some(record => record.type === 'childList' || record.type === 'characterData')) state.mutationVersion++;
  });
  state.observer.observe(root, { subtree: true, childList: true, characterData: true });
}
if (supportsDatasetEvent) dataset.addEventHandler('onload', onLoad, grid);
button.addEventListener('click', onSearch, { capture: true, once: true });
window[key] = state;
`;

export const K2B_SUBMISSION_REFRESH_STATE_SCRIPT = String.raw`
${K2B_SUBMISSION_GRID_RUNTIME_SCRIPT}
const state = window.__k2bSubmissionGridRefreshObserver;
return { datasetLoadVersion: state?.dataset === dataset ? state.loadVersion : 0,
  datasetLoadFailed: !state || state.failed,
  datasetLoading: state?.pending === true,
  searchVersion: state?.searchVersion ?? 0,
  mutationVersion: state?.mutationVersion ?? 0,
  datasetEventAvailable: !!state && state.dataset === dataset && typeof state.dataset?.addEventHandler === 'function' };
`;

export const K2B_END_SUBMISSION_REFRESH_SCRIPT = String.raw`
window.__k2bSubmissionGridRefreshObserver?.dispose?.();
delete window.__k2bSubmissionGridRefreshObserver;
`;

export const K2B_READ_SUBMISSION_GRID_SCRIPT = String.raw`
return (async () => {
${K2B_SUBMISSION_GRID_RUNTIME_SCRIPT}
  const identityReader = headers => {
    const fieldIndex = aliases => {
      const matches = headers.map((header, index) => aliases.includes(normalize(header)) ? index : -1).filter(index => index >= 0);
      if (matches.length !== 1) fail('identity_schema');
      return matches[0];
    };
    const submission = fieldIndex(['접수번호', '제출번호', '파일접수번호']);
    const sequence = fieldIndex(['순번', '일련번호', '시퀀스번호']);
    const management = fieldIndex(['산재관리번호', '관리번호']);
    const commencement = fieldIndex(['개시번호']);
    const file = fieldIndex(['청구파일명', '파일명']);
    return row => {
      if (text(row[submission])) return JSON.stringify(['submission', text(row[submission])]);
      const parts = [text(row[management]).replace(/\D/g, ''), text(row[commencement]).replace(/\D/g, ''), text(row[sequence]), text(row[file])];
      if (parts.some(value => !value)) fail('missing_row_identity');
      return JSON.stringify(parts);
    };
  };
  const errorValue = value => {
    if (/^(|0|false|n|no)$/i.test(text(value))) return '';
    if (/^(1|true|y|yes)$/i.test(text(value))) return '오류 있음';
    if (/^(오류보기|보기|확인)$/.test(normalize(value))) fail('error_control_not_value');
    return text(value);
  };

  if (dataset && typeof dataset.getRowCount === 'function' && typeof dataset.getColumn === 'function') {
    try {
    // getRowCountNF/getColumnNF는 filter를 무시한다. 현재 검색 결과는 항상 일반 API만 쓴다.
    const rowCount = () => dataset.getRowCount();
    const expectedRowCount = count(rowCount());
    if (expectedRowCount === null) fail('dataset_count');
    const body = Array.from({ length: grid.getCellCount('body') }, (_, cell) => ({
      cell, col: Number(grid.getCellProperty('body', cell, 'col')),
      span: Number(grid.getCellProperty('body', cell, 'colspan') ?? 1),
      binding: text(grid.getCellProperty('body', cell, 'text')),
    }));
    const columns = [];
    for (let cell = 0; cell < grid.getCellCount('head'); cell++) {
      const header = text(grid.getCellProperty('head', cell, 'text'));
      if (!header) continue;
      const col = Number(grid.getCellProperty('head', cell, 'col'));
      const span = Number(grid.getCellProperty('head', cell, 'colspan') ?? 1);
      const matches = body.filter(item => item.col === col && item.span === span);
      if (matches.length !== 1 || span !== 1 || /^(expr|bind):/i.test(header)) fail('ambiguous_header_binding');
      const binding = matches[0].binding.match(/^bind:([A-Za-z_][\w]*)$/i);
      const isErrorControl = /^오류(보기|여부|유무|발생여부)$/.test(normalize(header));
      if (!binding) {
        // 정적 오류보기 컨트롤은 데이터가 아니다. 별도 실제 오류 컬럼이 있어야 한다.
        if (normalize(header) === '오류보기' && normalize(matches[0].binding) === '오류보기') continue;
        fail('unresolved_dataset_binding');
      }
      if (typeof dataset.getColumnInfo !== 'function' || !dataset.getColumnInfo(binding[1])) fail('missing_dataset_column');
      columns.push({ header: isErrorControl ? '오류상세(값)' : header, id: binding[1], cell: matches[0].cell, isErrorControl });
    }
    const headers = columns.map(column => column.header);
    if (new Set(headers.map(normalize)).size !== headers.length) fail('duplicate_dataset_header');
    const rows = [];
    for (let row = 0; row < expectedRowCount; row++) {
      rows.push(columns.map(column => {
        const value = dataset.getColumn(row, column.id);
        if (value === undefined) fail('unreadable_dataset_value');
        // 상태 코드/expr를 임의 번역하지 않는다. 실제 표시값이 다르면 schema 확인이 필요하다.
        if (/^(처리상태|접수상태|상태)$/.test(normalize(column.header)) && typeof grid.getCellText === 'function'
          && text(grid.getCellText(row, column.cell)) !== text(value)) fail('status_binding_not_literal');
        if (column.isErrorControl || /오류(내용|상세|사유)/.test(normalize(column.header))) return errorValue(value);
        return text(value);
      }));
    }
    const stable = count(rowCount()) === expectedRowCount;
    const rowKey = identityReader(headers);
    const collectedUniqueRowCount = new Set(rows.map(rowKey)).size;
    // 중복/충돌 원본 행은 보존해 downstream exact 후보가 사라지지 않게 한다.
    return { headers, rows, expectedRowCount, collectedUniqueRowCount,
      readMethod: 'nexacro_dataset', completeness: stable && rows.length === expectedRowCount && collectedUniqueRowCount === expectedRowCount ? 'COMPLETE' : 'INCOMPLETE' };
    } catch (error) {
      if (String(error?.message).startsWith('K2B_GRID_SCHEMA_MISMATCH:')) throw error;
      // Dataset API 호출 자체가 불가능한 런타임에서는 아래 대체 경로로 읽는다.
    }
  }

  const cellText = element => text(element.innerText || element.textContent);
  const headersByIndex = new Map();
  for (const element of root.querySelectorAll('[id*="_head"][id*="GridCellTextContainerElement"]')) {
    const match = element.id.match(/_cell_-?\d+_(\d+)/);
    if (match && cellText(element)) {
      const index = Number(match[1]);
      if (headersByIndex.has(index) && headersByIndex.get(index) !== cellText(element)) fail('ambiguous_dom_header');
      headersByIndex.set(index, cellText(element));
    }
  }
  const indexes = [...headersByIndex.keys()].sort((a, b) => a - b);
  const headers = indexes.map(index => headersByIndex.get(index));
  const rowKey = identityReader(headers);
  const errorDetails = headers.map((header, index) => /오류(내용|상세|사유)/.test(normalize(header)) ? index : -1).filter(index => index >= 0);
  const errorFlags = headers.map((header, index) => /^오류(보기|여부|유무|발생여부)$/.test(normalize(header)) ? index : -1).filter(index => index >= 0);
  const staticErrorControls = new Set();
  if (typeof grid?.getCellCount === 'function' && typeof grid?.getCellProperty === 'function') {
    for (const index of errorFlags) {
      const col = Number(grid.getCellProperty('head', indexes[index], 'col'));
      const cells = Array.from({ length: grid.getCellCount('body') }, (_, cell) => cell)
        .filter(cell => Number(grid.getCellProperty('body', cell, 'col')) === col);
      if (cells.length === 1 && normalize(grid.getCellProperty('body', cells[0], 'text')) === '오류보기') staticErrorControls.add(index);
    }
  }
  const outputHeaders = headers.map((header, index) => errorFlags.includes(index) && !staticErrorControls.has(index) ? '오류상세(값' + index + ')' : header);
  const normalizeErrors = row => row.map((value, index) => {
    if (errorFlags.includes(index)) {
      // component가 정적 라벨임을 증명하고 별도 실제 오류 컬럼도 있을 때만 제외한다.
      // 정적 오류보기 라벨은 실제 오류값이 아니다. 별도 오류 column이 없으면 그대로
      // 보존하되 parser가 오류 근거로 사용하지 않는다.
      if (normalize(value) === '오류보기' && staticErrorControls.has(index)) return value;
      return errorValue(value);
    }
    return errorDetails.includes(index) ? errorValue(value) : value;
  });
  // 공식 Grid API → 구버전 Grid/독립 scrollbar → 실제 native scroller 순서.
  const scrollbar = grid?.vscrollbar;
  const nativeScrollers = [root, ...root.querySelectorAll('*')].filter(node => node.clientHeight > 0 && node.scrollHeight > node.clientHeight);
  const native = nativeScrollers.sort((a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight))[0]
    ?? (root.clientHeight > 0 ? root : null);
  const officialScroll = typeof grid?.scrollTo === 'function' && typeof grid?.getVScrollPos === 'function';
  const componentScroll = !officialScroll && scrollbar && typeof grid.set_vscrollpos === 'function';
  const horizontal = officialScroll ? Number(grid.getHScrollPos?.() ?? grid.hscrollbar?.pos ?? 0) : 0;
  let officialMax = count(scrollbar?.max);
  const officialInitial = officialScroll ? Number(grid.getVScrollPos()) : null;
  if (officialScroll && officialMax === null) {
    // scrollTo는 max 초과 값을 실제 최하단으로 clamp한다. 행 선택/조회는 하지 않는다.
    try { grid.scrollTo(horizontal, Number.MAX_SAFE_INTEGER); officialMax = count(grid.getVScrollPos()); }
    finally { grid.scrollTo(horizontal, officialInitial); }
  }
  const metrics = () => componentScroll
    ? { position: Number(scrollbar.pos), max: Number(scrollbar.max), step: Math.max(1, Math.floor((Number(scrollbar.page) || root.clientHeight) / 2)) }
    : officialScroll ? { position: Number(grid.getVScrollPos()), max: officialMax, step: Math.max(1, Math.floor(root.clientHeight / 2)) }
    : !scrollbar && native ? { position: native.scrollTop, max: Math.max(0, native.scrollHeight - native.clientHeight), step: Math.max(1, Math.floor(native.clientHeight / 2)) } : null;
  const move = position => {
    if (officialScroll) grid.scrollTo(horizontal, position);
    else if (componentScroll) grid.set_vscrollpos(position);
    else if (!scrollbar && native) { native.scrollTop = position; native.dispatchEvent(new Event('scroll')); }
  };
  const expected = () => {
    const counts = [count(grid?.rowcount), count(root.getAttribute('aria-rowcount')), count(root.getAttribute('data-rowcount'))].filter(value => value !== null);
    if (new Set(counts).size > 1) return null;
    return counts[0] ?? null;
  };
  const expectedRowCount = expected();
  const snapshot = () => {
    const rowMap = new Map();
    for (const element of root.querySelectorAll('[id*="_body_gridrow_"][id*="GridCellTextContainerElement"]')) {
      const match = element.id.match(/gridrow_(\d+)_cell_\d+_(\d+)/);
      if (!match) continue;
      const row = Number(match[1]), column = Number(match[2]);
      if (!rowMap.has(row)) rowMap.set(row, new Map());
      rowMap.get(row).set(column, cellText(element));
    }
    return [...rowMap.keys()].sort((a, b) => a - b).map(row => normalizeErrors(indexes.map(column => {
      if (!rowMap.get(row).has(column)) fail('missing_dom_cell');
      return rowMap.get(row).get(column);
    })));
  };
  const rowsByKey = new Map();
  const started = Date.now();
  let reachedTop = false, reachedBottom = false, conflict = false, stableEnd = false;
  const initial = metrics();
  move(0);
  try {
    for (let pass = 0; pass < 400 && Date.now() - started < 20000; pass++) {
      // 렌더 갱신 후 같은 viewport를 두 번 확인한다. 재사용 DOM id는 행 식별에 쓰지 않는다.
      await new Promise(resolve => setTimeout(resolve, 40));
      const first = snapshot();
      await new Promise(resolve => setTimeout(resolve, 40));
      const rows = snapshot();
      if (JSON.stringify(first) !== JSON.stringify(rows)) continue;
      const current = metrics();
      if (pass === 0 || !reachedTop) reachedTop = current?.position === 0;
      for (const row of rows) {
        const key = rowKey(row);
        const versions = rowsByKey.get(key) ?? new Map();
        versions.set(JSON.stringify(row), row);
        if (versions.size > 1) conflict = true;
        rowsByKey.set(key, versions);
      }
      if (!current || !Number.isFinite(current.max) || !Number.isFinite(current.step)) break;
      if (current.position >= current.max) {
        reachedBottom = true;
        stableEnd = rows.length > 0 || expectedRowCount === 0;
        break;
      }
      const next = Math.min(current.max, current.position + current.step);
      move(next);
      if (metrics()?.position === current.position) break;
    }
  } finally { if (initial) move(initial.position); }
  const rows = [...rowsByKey.values()].flatMap(versions => [...versions.values()]);
  const collectedUniqueRowCount = rowsByKey.size;
  const stableCount = expectedRowCount !== null && expected() === expectedRowCount;
  const complete = reachedTop && reachedBottom && stableEnd && stableCount && !conflict && collectedUniqueRowCount === expectedRowCount;
  return { headers: outputHeaders, rows, expectedRowCount, collectedUniqueRowCount, readMethod: 'virtual_scroll',
    completeness: complete ? 'COMPLETE' : expectedRowCount === null ? 'UNKNOWN' : 'INCOMPLETE' };
})();
`;
