import { parseWod, pick, resolveBlocks, resolveStrength } from './parser.js';
import { MOVEMENTS, BY_KEY } from './movements.js';
import { workoutStats, parseTime, fmtTime, growthIndex, logTrend, strengthSummary, e1rm } from './metrics.js';
import { recommend } from './recommend.js';
import { BENCHMARKS, BENCH_BY_ID, BENCH_CATS, detectBenchmark } from './benchmarks.js';
import * as db from './db.js';
import { lineChart } from './chart.js';

export const APP_VERSION = '0.5.0';

const DEFAULTS = {
  weight: 86,
  height: 168,
  side: 'max', // 처방 A/B 중 선택: 'max' 남자(큰 값) / 'min' 여자(작은 값)
  levels: ['RX', 'RED', 'YELLOW', 'WHITE', 'RAINBOW'],
  baseLevel: null, // 기록이 없을 때 추천 출발점
  units: { bb: 'lb', ball: 'lb', db: 'lb', kb: 'lb', other: 'lb' }, // 단위 없는 무게 해석
  loadUnit: 'lb', // 화면 표시·입력 단위 (저장은 kg)
  unitsV2: false, // lb 통일 이전 설정을 한 번 덮어썼는지
  aliases: {}, // 사용자가 지정한 운동 이름 → key
  lastBackup: null,
};
const S = { ...DEFAULTS };

// ───────────────────────── 유틸
const $ = (sel, root = document) => root.querySelector(sel);
const view = () => $('#view');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const body = () => ({ weight: S.weight, height: S.height });
const kJ = j => (j == null ? '-' : (j / 1000).toFixed(1) + ' kJ');
const watt = p => (p == null ? '-' : Math.round(p) + ' W');
const numStr = n => (n == null || Number.isNaN(n) ? '' : String(+(+n).toFixed(2)));
const toNum = v => (v === '' || v == null ? null : parseFloat(String(v).replace(',', '.')));
const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
const dateLabel = d => { const dt = new Date(d + 'T00:00:00'); return `${dt.getMonth() + 1}/${dt.getDate()} (${WEEK[dt.getDay()]})`; };
const UNIT_LABEL = { reps: '회', cal: 'cal', m: 'm' };
const levelClass = l => 'lvl-' + String(l || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const badge = l => (l ? `<span class="badge ${levelClass(l)}">${esc(l)}</span>` : '');
const isStrength = w => w.kind === 'strength';
// 표시 이름: 변형(Scaled 등) + 원문 이름(없으면 대표 이름)
const dispName = it => `${it.variant ? it.variant + ' ' : ''}${it.label || it.name}`;
const secLabel = s => [s.label, s.title].filter(Boolean).join(' · ');
const secChip = t => (t ? `<span class="chip-sec">${esc(t)}</span>` : '');
// 무게: 저장은 kg, 화면은 설정 단위(기본 lb)
const KG_PER_LB = 0.45359237;
const LU = () => S.loadUnit;
const showLoad = kg => (kg == null ? '' : S.loadUnit === 'lb' ? numStr(Math.round((kg / KG_PER_LB) * 2) / 2) : numStr(Math.round(kg * 10) / 10));
const readLoad = v => { const n = toNum(v); return n == null ? null : S.loadUnit === 'lb' ? +(n * KG_PER_LB).toFixed(3) : n; };
const loadText = kg => (kg == null ? '-' : `${showLoad(kg)} ${LU()}`);

// 터치 진동 (사용자가 화면을 한 번 이상 터치한 뒤에만 브라우저가 허용)
const haptic = (ms = 8) => {
  if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
  try { navigator.vibrate?.(ms); } catch {}
};

// 화면 그리기: kind 'tab'(하단 탭바) / 'sub'(뒤로가기 + 하단 고정 버튼)
// 같은 화면을 다시 그릴 때(입력 중 갱신)는 애니메이션·스크롤 유지
let lastPaint = '';
function paint(html, kind, key) {
  document.body.dataset.screen = kind;
  const v = view();
  v.innerHTML = html;
  if (key !== lastPaint) {
    v.classList.remove('enter');
    void v.offsetWidth;
    v.classList.add('enter');
    window.scrollTo(0, 0);
  }
  lastPaint = key;
}

// − / + 스테퍼 (data-step 버튼이 옆 input 값을 바꾸고 input 이벤트를 보냄)
function stepper(attrs, value, step, unit = '') {
  return `<div class="stepper"><button type="button" data-step="-${step}" aria-label="빼기">−</button><input class="num" ${attrs} inputmode="decimal" value="${value}"><button type="button" data-step="${step}" aria-label="더하기">+</button>${unit ? `<span class="u">${unit}</span>` : ''}</div>`;
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-step]');
  if (!b) return;
  const inp = b.parentElement.querySelector('input');
  const cur = toNum(inp.value) || 0;
  const next = Math.max(0, Math.round((cur + +b.dataset.step) * 100) / 100);
  inp.value = numStr(next);
  inp.dispatchEvent(new Event('input', { bubbles: true }));
  inp.dispatchEvent(new Event('change', { bubbles: true }));
  haptic();
});
const qtyStep = unit => (unit === 'm' ? 10 : 1);
const loadStep = () => (S.loadUnit === 'lb' ? 5 : 2.5);

// 바텀시트 선택: items [{ value, label, sub, group }] → 고른 value (닫으면 null)
function openSheet(title, items, { search = true, selected = null } = {}) {
  return new Promise(resolve => {
    const sh = $('#sheet');
    const q = $('#sheet-q');
    const list = $('#sheet-list');
    $('#sheet-title').textContent = title;
    q.hidden = !search;
    q.value = '';
    const draw = () => {
      const s = q.value.trim().toLowerCase();
      let group = '';
      list.innerHTML = items.filter(it => !s || it.label.toLowerCase().includes(s) || (it.sub || '').toLowerCase().includes(s)).map(it => {
        const g = it.group && it.group !== group ? `<div class="group">${esc((group = it.group))}</div>` : '';
        return `${g}<button data-v="${esc(it.value)}" class="${it.value === selected ? 'on' : ''}"><span>${esc(it.label)}</span>${it.sub ? `<small>${esc(it.sub)}</small>` : ''}</button>`;
      }).join('') || '<p class="muted center">결과가 없습니다</p>';
    };
    const close = v => {
      sh.hidden = true;
      sh.onclick = null;
      q.oninput = null;
      resolve(v);
    };
    draw();
    q.oninput = draw;
    sh.onclick = e => {
      if (e.target.closest('[data-sheet-close]')) return close(null);
      const b = e.target.closest('[data-v]');
      if (b) { haptic(); close(b.dataset.v); }
    };
    sh.hidden = false;
  });
}
const EQUIP_GROUP = { db: '덤벨', kb: '케틀벨', bb: '바벨', ball: '볼', other: '기타 기구' };
const movementSheetItems = () => MOVEMENTS.map(m => ({
  value: m.key,
  label: m.name,
  sub: m.kind === 'erg' ? 'cal / m' : m.unit === 'm' ? 'm' : '',
  group: m.kind === 'erg' || m.kind === 'run' ? '유산소' : EQUIP_GROUP[m.equip] || '맨몸·체조',
})).sort((a, b) => a.group.localeCompare(b.group) || a.label.localeCompare(b.label));

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), 2200);
}

async function loadSettings() {
  for (const k of Object.keys(DEFAULTS)) S[k] = await db.getSetting(k, DEFAULTS[k]);
  S.units = { ...DEFAULTS.units, ...S.units };
  // v0.4: 바벨·덤벨 모두 lb 로 통일 (이전 기본값 덮어쓰기, 1회)
  if (!S.unitsV2) {
    await saveSetting('units', { ...DEFAULTS.units });
    await saveSetting('loadUnit', 'lb');
    await saveSetting('unitsV2', true);
  }
  // v0.4.1: 앞/뒤 숫자 → 남자(큰 값) 기준
  if (S.side !== 'max' && S.side !== 'min') await saveSetting('side', 'max');
}
async function saveSetting(k, v) {
  S[k] = v;
  await db.setSetting(k, v);
}

function resultText(b) {
  const r = b.result || {};
  if (b.format === 'amrap') return r.rounds != null || r.reps != null ? `${r.rounds || 0}R+${r.reps || 0}` : '-';
  if (r.capped) return r.repsDone != null ? `CAP ${r.repsDone}` : 'CAP';
  return r.timeSec ? fmtTime(r.timeSec) : '-';
}

// 라운드 구성 힌트: 21-15-9 / 21×3 / 내 몫 7R
function perRoundHint(it, b) {
  const pr = it.perRound;
  if (!pr?.length) return '';
  // 연속 구간(24.3 등)의 앞쪽 0 라운드는 숨기고 "2구간"으로 표시
  const nz = pr.filter(x => x > 0);
  if (nz.length <= 1) return pr[0] === 0 && nz.length ? '2구간' : '';
  const same = nz.every(x => x === nz[0]);
  let s = same ? `${nz[0]}×${nz.length}` : nz.join('-');
  if (pr[0] === 0) s += ' · 2구간';
  if (b?.team > 1 && b.alternating) s += it.sync ? ' (싱크·전 라운드)' : ` (내 몫 ${pr.length}R)`;
  return s;
}

function itemText(it, b) {
  const def = it.key && BY_KEY[it.key];
  let s = `${numStr(it.qty)}${it.unit === 'reps' ? '' : ' ' + UNIT_LABEL[it.unit]} ${esc(dispName(it))}`;
  const hint = perRoundHint(it, b);
  if (hint) s += ` <span class="muted">(${hint})</span>`;
  if (def?.equip && it.load) s += ` <span class="muted">· ${loadText(it.load)}${(it.implements || 1) > 1 ? ' ×' + it.implements : ''}</span>`;
  if (it.boxIn) s += ` <span class="muted">· ${it.boxIn}in</span>`;
  if (it.sync) s += ' <span class="muted">· Sync</span>';
  return s;
}

// 처방 요약 (레벨 선택 카드용)
function prescText(it, side) {
  const q = it.pattern ? it.pattern.join('-') : pick(it.qty, side) ?? '';
  const u = it.unit === 'cal' ? 'cal' : it.unit === 'm' ? 'm' : '';
  const alt = it.alt ? ` ⇄ ${pick(it.alt.qty, side) ?? ''} ${esc(dispName(it.alt))}` : '';
  return `${q}${u} ${esc(dispName(it))}${it.key ? '' : ' ❓'}${alt}`;
}


// ───────────────────────── 라우터
const routes = [
  [/^#\/?$/, renderList],
  [/^#\/new$/, renderNew],
  [/^#\/w\/(.+)$/, renderDetail],
  [/^#\/edit\/(.+)$/, renderEdit],
  [/^#\/stats$/, renderStats],
  [/^#\/settings$/, renderSettings],
];

async function route() {
  const h = location.hash || '#/';
  for (const [re, fn] of routes) {
    const m = h.match(re);
    if (m) {
      document.querySelectorAll('nav a').forEach(a => a.classList.toggle('active', a.dataset.nav === (h.split('/')[1] || '')));
      lastPaint = '';
      await fn(...m.slice(1));
      return;
    }
  }
  location.hash = '#/';
}

// ───────────────────────── 기록 목록
async function renderList() {
  const ws = await db.listWorkouts();
  if (!ws.length) {
    paint(`
      <h1>기록</h1>
      <div class="empty card">
        <div class="empty-ico"><svg viewBox="0 0 24 24" width="32" height="32"><path d="M3 10v4M6 7v10M18 7v10M21 10v4M6 12h12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg></div>
        <h2>첫 WOD를 기록해 보세요</h2>
        <p class="muted">박스 공지를 붙여넣거나<br>벤치마크에서 골라 바로 기록할 수 있어요</p>
        <a class="btn primary" href="#/new">WOD 입력하기</a>
      </div>`, 'tab', 'list');
    return;
  }

  // 이번 달 요약
  const ym = today().slice(0, 7);
  const thisMonth = ws.filter(w => w.date.startsWith(ym));
  const powers = thisMonth.filter(w => !isStrength(w)).map(w => workoutStats(w, body()).powerW).filter(p => p != null);
  const avgP = powers.length ? powers.reduce((a, b) => a + b, 0) / powers.length : null;
  let html = `
    <h1>기록</h1>
    <div class="card summary-card">
      <div><div class="k">이번 달</div><div class="v">${thisMonth.length}<span class="small muted"> 회</span></div></div>
      <div><div class="k">평균 파워</div><div class="v">${avgP != null ? Math.round(avgP) : '-'}<span class="small muted"> W</span></div></div>
      <div><div class="k">전체</div><div class="v">${ws.length}<span class="small muted"> 회</span></div></div>
    </div>`;

  const row = w => {
    const dt = new Date(w.date + 'T00:00:00');
    const dateTile = `<div class="li-date"><b>${dt.getDate()}</b><span>${WEEK[dt.getDay()]}</span></div>`;
    if (isStrength(w)) {
      const ss = strengthSummary(w);
      return `
        <a class="li" href="#/w/${w.id}">${dateTile}
          <div class="li-body">
            <div class="li-title"><span class="t">${esc(w.strength.items.map(i => i.label || i.name).join(' + '))}</span></div>
            <div class="li-sub">${[w.section, 'Strength', w.title].filter(Boolean).map(esc).join(' · ')}</div>
          </div>
          ${ss
            ? `<div class="li-val">${loadText(ss.single ? ss.e1rm : ss.top)}<small>${ss.single ? 'e1RM' : '최고'}</small></div>`
            : `<div class="li-val">${w.strength.setResults.length}세트<small>${w.strength.setResults.reduce((a, r) => a + (r.reps || 0), 0)}회</small></div>`}
        </a>`;
    }
    const st = workoutStats(w, body());
    const name = w.benchmark ? BENCH_BY_ID[w.benchmark]?.name : [...new Set(w.blocks.flatMap(b => b.items.map(i => i.label || i.name)))].slice(0, 3).join(' · ');
    const res = w.blocks.map((b, i) => `${w.blocks.length > 1 ? (w.repeat ? `${i + 1}회 ` : `B${i + 1} `) : ''}${resultText(b)}`).join(' · ');
    return `
      <a class="li" href="#/w/${w.id}">${dateTile}
        <div class="li-body">
          <div class="li-title">${badge(w.level)}<span class="t">${w.benchmark ? '🏆 ' : ''}${esc(name || 'WOD')}</span></div>
          <div class="li-sub">${[w.section, res, w.rpe ? `RPE ${w.rpe}` : ''].filter(Boolean).map(esc).join(' · ')}</div>
        </div>
        <div class="li-val">${st.powerW != null ? Math.round(st.powerW) : '-'}<small>W</small></div>
      </a>`;
  };

  const months = [];
  for (const w of ws) {
    const m = w.date.slice(0, 7);
    if (months.at(-1)?.m !== m) months.push({ m, list: [] });
    months.at(-1).list.push(w);
  }
  html += months.map(g => `
    <h3 class="month">${+g.m.slice(0, 4)}년 ${+g.m.slice(5)}월</h3>
    <div class="card list-group">${g.list.map(row).join('')}</div>`).join('');
  paint(html, 'tab', 'list');
}

// ───────────────────────── 입력 흐름
// 붙여넣기 → (섹션 여러 개면) 오늘의 WOD 목록 → (레벨 여러 개면) 레벨 선택 → 결과 입력 → 저장
let draft = null;
let day = null; // { date, notes, sections, raw, saved: Map(섹션 → 기록 id) }
let secIdx = 0;

function renderNew() {
  draft = null;
  day = null;
  paint(`
    <h1>WOD 입력</h1>
    <div class="card">
      <label>날짜<input type="date" id="date" value="${today()}"></label>
      <label>WOD 원문
        <textarea id="raw" rows="9" placeholder="박스 WOD 공지를 그대로 붙여넣으세요&#10;A/B 파트, 레벨별 버전이 여러 개여도 됩니다"></textarea>
      </label>
      <div class="btns">
        <button class="ghost" id="clip">붙여넣기</button>
        <button class="primary" id="parse">분석하기</button>
      </div>
    </div>
    <button class="card li-btn" id="bench">
      <div class="li" style="padding:0">
        <div class="li-date" style="background:var(--accent-soft);color:var(--accent)"><svg viewBox="0 0 24 24" width="24" height="24"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM7 6H4v2a3 3 0 0 0 3 3M17 6h3v2a3 3 0 0 1-3 3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
        <div class="li-body"><div class="li-title">벤치마크에서 선택</div><div class="li-sub">Girls · Hero · Open · Games ${BENCHMARKS.length}개</div></div>
        <svg viewBox="0 0 24 24" width="20" height="20" style="color:var(--faint)"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </div>
    </button>
    <button class="link" id="manual">원문 없이 직접 입력</button>`, 'tab', 'new');
  $('#bench').onclick = () => renderBench();

  $('#clip').onclick = async () => {
    try {
      $('#raw').value = await navigator.clipboard.readText();
    } catch {
      toast('클립보드 접근이 거부되었습니다. 길게 눌러 붙여넣어 주세요');
    }
  };
  $('#parse').onclick = () => {
    const raw = $('#raw').value;
    const p = parseWod(raw, { aliases: S.aliases, units: S.units });
    if (!p.versions.length) return toast('운동을 찾지 못했습니다. 원문을 확인해 주세요');
    const typed = $('#date').value;
    const date = p.date && typed === today() ? p.date : typed || today();
    if (p.date && date === p.date && p.date !== today()) toast(`원문 날짜 ${dateLabel(p.date)}로 설정했습니다`);
    day = { ...p, date, raw, saved: new Map(), benchmark: detectBenchmark(raw) };
    if (day.benchmark) toast(`벤치마크 ${BENCH_BY_ID[day.benchmark].name}로 인식했습니다`);
    if (day.sections.length === 1) openSection(0);
    else renderDay();
  };
  $('#manual').onclick = () => {
    day = null;
    draft = metconDraft({ blocks: [{ format: 'fortime', capSec: null, rounds: 1, items: [] }], targets: [], notes: [], title: '' }, -1, $('#date').value || today(), '', '');
    renderForm(false);
  };
}

// ───────────────────────── 벤치마크 라이브러리
async function renderBench(query = '') {
  const ws = await db.listWorkouts();
  const done = new Map();
  for (const w of ws) if (w.benchmark) done.set(w.benchmark, [...(done.get(w.benchmark) || []), w]);
  const q = query.trim().toLowerCase();
  const list = BENCHMARKS.filter(b => !q || b.name.toLowerCase().includes(q) || b.text.toLowerCase().includes(q));
  paint(`
    <header class="bar"><button class="back" id="back">‹</button><h1>벤치마크</h1></header>
    <input id="q" placeholder="이름 또는 운동 검색 (예: Fran, thruster)" value="${esc(query)}">
    ${BENCH_CATS.map(cat => {
      const items = list.filter(b => b.cat === cat);
      if (!items.length) return '';
      return `<h3 class="month">${cat}</h3><div class="card list-group">` + items.map(b => {
        const v = parseWod(b.text, { aliases: S.aliases, units: S.units }).versions[0];
        const tries = done.get(b.id) || [];
        const best = bestOf(tries);
        const moves = [...new Set(v.blocks.flatMap(x => x.items.map(i => i.label || i.name)))].join(' · ');
        return `
          <a class="li bcard" data-id="${b.id}" href="javascript:void 0">
            <div class="li-body">
              <div class="li-title"><span class="t">${esc(b.name)}</span>${b.year ? `<span class="muted small">${b.year}</span>` : ''}</div>
              <div class="li-sub">${esc(v?.title || '')} · ${esc(moves)}</div>
            </div>
            ${best ? `<div class="li-val">${esc(scoreOf(best).text)}<small>PR · ${tries.length}회</small></div>` : ''}
          </a>`;
      }).join('') + '</div>';
    }).join('')}
    ${list.length ? '' : '<p class="muted center">검색 결과가 없습니다</p>'}`, 'sub', 'bench');
  $('#back').onclick = () => renderNew();
  const qi = $('#q');
  qi.oninput = () => { clearTimeout(qi.t); qi.t = setTimeout(() => renderBench(qi.value).then(() => { const n = $('#q'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }), 250); };
  view().querySelectorAll('.bcard').forEach(el => (el.onclick = () => {
    const b = BENCH_BY_ID[el.dataset.id];
    const p = parseWod(b.text, { aliases: S.aliases, units: S.units });
    day = { ...p, date: today(), raw: `${b.name}\n${b.text}`, saved: new Map(), benchmark: b.id, fromLibrary: true };
    openSection(0);
  }));
}

// 벤치마크 점수: For Time 은 시간(짧을수록 좋음, 캡은 완주보다 뒤), AMRAP·EMOM 은 총 수행량(많을수록 좋음)
function scoreOf(w) {
  const bs = w.blocks || [];
  if (!bs.length) return { better: 'none', value: 0, text: '-' };
  if (bs.some(b => b.format === 'amrap')) {
    const total = bs.reduce((s, b) => {
      const r = b.result || {};
      const round = b.items.reduce((a, it) => a + (it.qty || 0), 0);
      return s + (r.rounds || 0) * round + (r.reps || 0);
    }, 0);
    const b0 = bs[0];
    const text = bs.length === 1 && !b0.emom ? `${b0.result?.rounds || 0}R+${b0.result?.reps || 0}` : bs.map(resultText).join(' · ');
    return { better: 'high', value: total, text };
  }
  const capped = bs.some(b => b.result?.capped);
  if (capped) {
    const reps = bs.reduce((s, b) => s + (b.result?.capped ? b.result.repsDone || 0 : b.items.reduce((a, it) => a + (it.qty || 0), 0)), 0);
    return { better: 'low', value: 1e7 - reps, text: `CAP ${reps}회` };
  }
  const t = bs.reduce((s, b) => s + (b.result?.timeSec || 0), 0);
  return { better: 'low', value: t || Infinity, text: t ? fmtTime(t) : '-' };
}
const cmpScore = (a, b) => {
  const sa = scoreOf(a);
  const sb = scoreOf(b);
  return sa.better === 'high' ? sb.value - sa.value : sa.value - sb.value;
};
const bestOf = ws => (ws.length ? [...ws].sort(cmpScore)[0] : null);

function renderDay() {
  paint(`
    <header class="bar"><button class="back" id="back">‹</button><h1>${dateLabel(day.date)} WOD</h1></header>
    ${day.notes.length ? `<p class="muted small" style="margin:0 8px 10px">${day.notes.map(esc).join(' · ')}</p>` : ''}
    ${day.sections.map((s, i) => {
      const v0 = s.versions[0];
      const kind = v0.kind === 'strength' ? 'Strength' : 'Metcon';
      const items = (v0.kind === 'strength' ? v0.items : v0.blocks[0].items).map(it => esc(it.label || it.name));
      const saved = day.saved.get(i);
      return `
        <button class="card vcard sec ${saved ? 'saved' : ''}" data-i="${i}">
          <div class="row"><h2>${esc(secLabel(s) || 'WOD')}</h2><span class="chip-kind">${kind}</span><span class="spacer"></span>
            <span class="${saved ? 'st ok' : 'muted small'}">${saved ? '✓ 저장됨' : s.versions.length > 1 ? `${s.versions.length}개 레벨` : ''}</span></div>
          <div class="sub">${esc(v0.title)}</div>
          <div class="sub muted ellipsis">${[...new Set(items)].join(' · ')}</div>
        </button>`;
    }).join('')}
    <p class="muted small center">수행한 파트만 입력하면 됩니다</p>
    <div class="cta-bar"><a class="btn primary wide" href="#/">완료</a></div>`, 'sub', 'day');
  $('#back').onclick = () => renderNew();
  view().querySelectorAll('.sec').forEach(el => (el.onclick = () => openSection(+el.dataset.i)));
}

function openSection(i) {
  secIdx = i;
  const s = day.sections[i];
  if (s.versions.length > 1) renderPick();
  else startDraft(0);
}

function startDraft(vi) {
  const s = day.sections[secIdx];
  const v = s.versions[vi];
  const lvlIdx = s.versions.length > 1 ? vi : -1;
  if (v.kind === 'strength') {
    draft = strengthDraft(v, day.date, day.raw, secLabel(s));
    renderStrengthForm(false);
  } else {
    draft = metconDraft(v, lvlIdx, day.date, day.raw, secLabel(s));
    if (day.benchmark) {
      draft.benchmark = day.benchmark;
      draft.title = `${BENCH_BY_ID[day.benchmark].name} · ${draft.title}`;
      // 벤치마크 이름 줄("Fran", "24.3")은 메모에서 제외
      draft.notes = draft.notes.split('\n').filter(l => !detectBenchmark(l)).join('\n');
    }
    renderForm(false);
  }
}

function baseDraft(v, date, raw, section) {
  return {
    id: uid(),
    date,
    section,
    title: v.title || '',
    raw,
    notes: (v.notes || []).join('\n'),
    bodyweight: S.weight,
    height: S.height,
    createdAt: Date.now(),
  };
}

function metconDraft(v, idx, date, raw, section) {
  return {
    ...baseDraft(v, date, raw, section),
    kind: 'metcon',
    level: idx >= 0 ? S.levels[idx] || '' : '',
    repeat: !!v.repeat,
    blocks: resolveBlocks(v, S.side),
    targets: (v.targets || []).map(t => ({ text: t, done: false })),
  };
}

function strengthDraft(v, date, raw, section) {
  return {
    ...baseDraft(v, date, raw, section),
    kind: 'strength',
    level: '',
    blocks: [],
    strength: resolveStrength(v, S.side),
    targets: (v.targets || []).map(t => ({ text: t, done: false })),
  };
}

function backFromForm(isEdit) {
  if (isEdit) location.hash = `#/w/${draft.id}`;
  else if (day?.fromLibrary) renderBench();
  else if (day && day.sections[secIdx]?.versions.length > 1) renderPick();
  else if (day && day.sections.length > 1) renderDay();
  else renderNew();
}

const STATUS = { easy: '↓ 여유', ok: '✓ 적정', tight: '! 빠듯', cap: '✕ 캡 위험' };
const CONF = { high: '신뢰도 높음', mid: '신뢰도 보통', low: '신뢰도 낮음' };

async function renderPick() {
  const side = S.side;
  const s = day.sections[secIdx];
  const date = day.date;
  const history = (await db.listWorkouts()).filter(w => !isStrength(w) && w.date <= date);
  const rec = recommend({ versions: s.versions, workouts: history, levels: S.levels, side, body: body(), defaultLevel: S.baseLevel, now: Date.parse(date + 'T12:00:00'), fmtLoad: loadText });

  paint(`
    <header class="bar"><button class="back" id="back">‹</button><h1>레벨 선택</h1>${secChip(secLabel(s))}</header>
    ${rec ? `
      <div class="card rec">
        <div class="head"><span class="k">오늘 추천</span>${badge(rec.per[rec.rec].level)}<span class="spacer"></span><span class="conf">${CONF[rec.confidence.level]}</span></div>
        <ul>${rec.reasons.map(r => `<li>${esc(r)}</li>`).join('')}</ul>
        ${rec.warning ? `<p class="warn">⚠ ${esc(rec.warning)}</p>` : ''}
        <p class="muted small">${esc(rec.confidence.text)} · 블록 기록 ${rec.fit.blocks}개 반영</p>
      </div>` : ''}
    <p class="muted small" style="margin:14px 8px 10px">${s.versions.length}개 레벨 중 수행한 레벨을 누르세요</p>
    ${s.versions.map((v, i) => {
      const p = rec?.per[i];
      const blocks = v.repeat ? [v.blocks[0]] : v.blocks;
      return `
      <button class="card vcard ${rec?.rec === i ? 'recommended' : ''}" data-i="${i}">
        <div class="row">${badge(S.levels[i] || `레벨 ${i + 1}`)}${rec?.rec === i ? '<span class="tag-rec">추천</span>' : ''}<span class="spacer"></span>
          <span class="muted small">${esc(v.title)}</span></div>
        ${blocks.map((b, bi) => `<div class="sub">${blocks.length > 1 ? `<b>B${bi + 1}</b> ` : ''}${b.items.map(it => prescText(it, side)).join(' · ')}</div>`).join('')}
        ${p && p.blocks.length ? `
          <div class="pred"><span class="muted">예상 ${(v.repeat ? [p.blocks[0]] : p.blocks).map(b => fmtTime(b.sec)).join(' · ')}${v.repeat ? ` ×${v.blocks.length}` : ''}</span>${p.status ? `<span class="st ${p.status}">${STATUS[p.status]}</span>` : ''}
          ${p.loadFlags.filter(f => f.kind === 'over').map(f => `<span class="flag">▲ ${esc(f.name)} 최고 ${loadText(f.max)}</span>`).join('')}</div>` : ''}
      </button>`;
    }).join('')}`, 'sub', 'pick');
  $('#back').onclick = () => (day.sections.length > 1 ? renderDay() : renderNew());
  view().querySelectorAll('.vcard').forEach(el => (el.onclick = () => startDraft(+el.dataset.i)));
}

// ───────────────────────── 메트콘 입력 폼
// repeat(인터벌·세트 반복)이면 운동은 한 번만 편집하고 회차별 결과만 받는다
function itemRows(b, bi) {
  return b.items.map((it, ii) => {
    const def = it.key && BY_KEY[it.key];
    const unitBtn = def?.kind === 'erg'
      ? `<button class="unit chip" data-act="unit" data-b="${bi}" data-i="${ii}">${UNIT_LABEL[it.unit]}</button>`
      : `<span class="unit">${UNIT_LABEL[it.unit]}</span>`;
    const hint = perRoundHint(it, b);
    const extras = [hint, it.boxIn ? `${it.boxIn}in` : '', it.sync ? 'Sync' : ''].filter(Boolean);
    return `
      <div class="item ${it.key ? '' : 'unknown'}">
        <div class="iname">${it.key ? esc(dispName(it)) : `
          <button class="chip pick-key" data-act="pick-key" data-b="${bi}" data-i="${ii}">❓ ${esc(it.name)} → 운동 선택</button>`}
          ${it.alt ? `<button class="chip alt" data-act="alt" data-b="${bi}" data-i="${ii}">⇄ ${esc(dispName(it.alt))}</button>` : ''}
          ${extras.length ? `<span class="muted small">${esc(extras.join(' · '))}</span>` : ''}
        </div>
        <div class="ifields">
          ${stepper(`data-f="qty" data-b="${bi}" data-i="${ii}"`, numStr(it.qty), qtyStep(it.unit))}${unitBtn}
          ${def?.equip ? stepper(`data-f="load" data-b="${bi}" data-i="${ii}"`, showLoad(it.load), loadStep(), LU()) : ''}
          ${def?.equip === 'db' || def?.equip === 'kb' ? `<button class="chip" data-act="impl" data-b="${bi}" data-i="${ii}" title="덤벨 개수">×${it.implements || 1}</button>` : ''}
          <button class="icon" data-act="del-item" data-b="${bi}" data-i="${ii}" aria-label="삭제">✕</button>
        </div>
      </div>`;
  }).join('');
}

function resultFields(b, bi) {
  const r = b.result || {};
  const total = b.items.reduce((s, it) => s + (it.qty || 0), 0);
  const team = b.team > 1 ? ' <span class="muted">(팀 전체)</span>' : '';
  if (b.format === 'amrap') {
    return `<label>${b.emom ? '완료한 분' : '라운드'}<input class="num" data-f="rounds" data-b="${bi}" inputmode="numeric" value="${numStr(r.rounds)}"></label>
      ${b.emom ? '' : `<label>+ 횟수<input class="num" data-f="reps" data-b="${bi}" inputmode="numeric" value="${numStr(r.reps)}"></label>`}`;
  }
  return `${r.capped
    ? `<label>완료 횟수 <span class="muted">(총 ${total})</span><input class="num" data-f="repsDone" data-b="${bi}" inputmode="numeric" value="${numStr(r.repsDone)}"></label>`
    : `<label>완료 시간${team}<input class="time" data-f="time" data-b="${bi}" inputmode="numeric" placeholder="9:30" value="${r.timeSec ? fmtTime(r.timeSec) : ''}"></label>`}
    ${b.capSec ? `<label class="chk"><input type="checkbox" data-f="capped" data-b="${bi}" ${r.capped ? 'checked' : ''}>타임캡</label>` : ''}`;
}

function blockHead(b, bi, label) {
  return `
    <div class="block-head">
      <h2>${label}</h2>
      <select data-f="format" data-b="${bi}">
        <option value="fortime" ${b.format === 'fortime' ? 'selected' : ''}>For Time</option>
        <option value="amrap" ${b.format === 'amrap' ? 'selected' : ''}>${b.emom ? 'EMOM' : 'AMRAP'}</option>
      </select>
      <label class="inline">캡<input class="num sm" data-f="capMin" data-b="${bi}" inputmode="decimal" value="${b.capSec ? numStr(b.capSec / 60) : ''}">분</label>
      ${draft.repeat ? '' : `<button class="icon" data-act="del-block" data-b="${bi}" aria-label="블록 삭제">✕</button>`}
    </div>`;
}

function blocksHtml() {
  const d = draft;
  const addSel = bi => `<button class="add-btn" data-act="add-item" data-b="${bi}">＋ 운동 추가</button>`;
  if (d.repeat && d.blocks.length > 1) {
    const b0 = d.blocks[0];
    return `
      <section class="card block">
        ${blockHead(b0, 0, `${d.blocks.length}회 반복`)}
        ${b0.restAfterSec ? `<p class="muted small">회차 사이 휴식 ${fmtTime(b0.restAfterSec)}</p>` : ''}
        <div class="items">${itemRows(b0, 0)}</div>
        ${addSel(0)}
      </section>
      <section class="card">
        <h2>회차별 결과</h2>
        ${d.blocks.map((b, bi) => `
          <div class="rep-row">
            <span class="rep-n">${bi + 1}회</span>
            <div class="result">${resultFields(b, bi)}</div>
          </div>
          <div class="bstat muted" id="bstat-${bi}"></div>`).join('')}
      </section>`;
  }
  return d.blocks.map((b, bi) => `
    <section class="card block">
      ${blockHead(b, bi, d.blocks.length > 1 ? `블록 ${bi + 1}` : '운동')}
      ${b.team > 1 ? `<p class="muted small">Team of ${b.team}${b.alternating ? ` · Alternating ${b.rounds}R — 수량은 내 몫` : ''}</p>` : ''}
      <div class="items">${itemRows(b, bi)}</div>
      ${addSel(bi)}
      <div class="result">${resultFields(b, bi)}</div>
      <div class="bstat muted" id="bstat-${bi}"></div>
    </section>`).join('');
}

const RPE_DESC = { 1: '매우 쉬움', 2: '쉬움', 3: '가벼움', 4: '적당함', 5: '조금 힘듦', 6: '힘듦', 7: '힘들지만 여유 있음', 8: '많이 힘듦', 9: '거의 한계', 10: '완전 한계' };
const levelChips = sel => `<div class="chips">${S.levels.concat(sel && !S.levels.includes(sel) ? [sel] : []).map(l => `<button type="button" class="${l === sel ? 'on' : ''}" data-act="level" data-v="${esc(l)}">${esc(l)}</button>`).join('')}</div>`;

function commonTail(d, rpeRequired) {
  return `
    ${d.targets.length ? `
      <div class="card">
        <h2>Target</h2>
        ${d.targets.map((t, ti) => `<label class="chk"><input type="checkbox" data-f="target" data-t="${ti}" ${t.done ? 'checked' : ''}>${esc(t.text)}</label>`).join('')}
      </div>` : ''}
    <div class="card">
      <h2>RPE <span class="muted small">체감 강도${rpeRequired ? ' · 필수' : ' · 선택'}</span></h2>
      <div class="rpe">${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => `<label><input type="radio" name="rpe" data-f="rpe" value="${n}" ${d.rpe === n ? 'checked' : ''}><span>${n}</span></label>`).join('')}</div>
      <div class="rpe-desc" id="rpe-desc">${d.rpe ? `${d.rpe} · ${RPE_DESC[d.rpe]}` : ''}</div>
      <div class="rpe-hint"><span>1 매우 쉬움</span><span>7 힘들지만 여유</span><span>10 완전 한계</span></div>
    </div>
    <div class="card"><label>메모<textarea data-f="notes" rows="3" placeholder="컨디션, 스케일, 느낀 점">${esc(d.notes)}</textarea></label></div>`;
}

function renderForm(isEdit) {
  const d = draft;
  paint(`
    <div id="form">
      <header class="bar"><button class="back" data-act="back">‹</button><h1>${isEdit ? '기록 수정' : '결과 입력'}</h1>${secChip(d.section)}</header>
      <div class="card">
        <div class="grid3">
          <label>날짜<input type="date" data-f="date" value="${d.date}"></label>
          <label>체중 (kg)<input class="num" data-f="bodyweight" inputmode="decimal" value="${numStr(d.bodyweight)}"></label>
        </div>
        <label style="margin:14px 0 6px">레벨</label>
        ${levelChips(d.level)}
      </div>
      ${d.title ? `<p class="wod-title">${esc(d.title)}</p>` : ''}
      ${blocksHtml()}
      ${d.repeat ? '' : '<button class="ghost wide" data-act="add-block">＋ 블록 추가</button>'}
      ${commonTail(d, true)}
      <div class="card summary" id="sum"></div>
      <div class="cta-bar"><button class="primary wide" data-act="save">저장</button></div>
    </div>`, 'sub', 'form');

  const root = $('#form');
  root.addEventListener('input', e => {
    if (!e.target.dataset.f) return;
    applyField(e.target);
    updateSummary();
  });
  root.addEventListener('change', e => {
    const t = e.target;
    if (t.dataset.act === 'add-item') {
      if (t.value) targets(+t.dataset.b).forEach(b => addItem(b, t.value));
      return renderForm(isEdit);
    }
    if (['key', 'format', 'capped'].includes(t.dataset.f)) renderForm(isEdit);
    if (t.dataset.f === 'time' && draft.blocks[+t.dataset.b].result.timeSec) t.value = fmtTime(draft.blocks[+t.dataset.b].result.timeSec);
  });
  root.addEventListener('click', e => {
    const t = e.target.closest('[data-act]');
    if (!t || t.tagName === 'SELECT') return;
    const bi = +t.dataset.b;
    const ii = +t.dataset.i;
    switch (t.dataset.act) {
      case 'back': return backFromForm(isEdit);
      case 'add-item':
        openSheet('운동 추가', movementSheetItems()).then(k => {
          if (!k) return;
          targets(bi).forEach(b => addItem(b, k));
          renderForm(isEdit);
        });
        return;
      case 'pick-key': {
        const it = draft.blocks[bi].items[ii];
        openSheet(`"${it.name}" 은(는) 어떤 운동인가요?`, movementSheetItems()).then(k => {
          if (!k) return;
          setKey(bi, ii, k);
          renderForm(isEdit);
        });
        return;
      }
      case 'level': draft.level = draft.level === t.dataset.v ? '' : t.dataset.v; haptic(); break;
      case 'impl': targets(bi).forEach(b => { b.items[ii].implements = (b.items[ii].implements || 1) === 2 ? 1 : 2; }); break;
      case 'unit': targets(bi).forEach(b => { b.items[ii].unit = b.items[ii].unit === 'cal' ? 'm' : 'cal'; }); break;
      case 'alt': targets(bi).forEach(b => swapAlt(b, ii)); break;
      case 'del-item': targets(bi).forEach(b => b.items.splice(ii, 1)); break;
      case 'del-block':
        if (!confirm(`블록 ${bi + 1}을 삭제할까요?`)) return;
        draft.blocks.splice(bi, 1);
        break;
      case 'add-block': draft.blocks.push({ format: 'fortime', capSec: draft.blocks.at(-1)?.capSec ?? null, rounds: 1, items: [], result: {} }); break;
      case 'save': return save(isEdit);
      default: return;
    }
    renderForm(isEdit);
  });
  updateSummary();
}

// 반복 블록이면 운동 편집을 모든 회차에 적용
const targets = bi => (draft.repeat ? draft.blocks : [draft.blocks[bi]]);

function swapAlt(b, ii) {
  const cur = { ...b.items[ii] };
  const next = { ...cur.alt };
  delete cur.alt;
  next.alt = cur;
  b.items[ii] = next;
}

function setQty(it, n) {
  const pr = it.perRound;
  if (pr?.length && n != null) {
    const sum = pr.reduce((a, c) => a + c, 0) || 1;
    const scaled = pr.map(x => Math.round((x * n) / sum));
    scaled[scaled.length - 1] += n - scaled.reduce((a, c) => a + c, 0);
    it.perRound = scaled;
  }
  it.qty = n;
}

function addItem(b, key) {
  const def = BY_KEY[key];
  const sameEquip = b.items.find(it => it.key && BY_KEY[it.key].equip === def.equip && it.load);
  b.items.push({
    key,
    name: def.name,
    variant: '',
    unit: def.unit || 'reps',
    qty: null,
    perRound: null,
    load: def.equip ? sameEquip?.load ?? null : null,
    implements: def.implements ?? 1,
  });
}

function applyField(t) {
  const f = t.dataset.f;
  const bi = +t.dataset.b;
  const ii = +t.dataset.i;
  const b = draft.blocks?.[bi];
  const it = b?.items[ii];
  switch (f) {
    case 'date': draft.date = t.value; break;
    case 'level': draft.level = t.value; break;
    case 'notes': draft.notes = t.value; break;
    case 'bodyweight': draft.bodyweight = toNum(t.value); break;
    case 'format': targets(bi).forEach(x => { x.format = t.value; x.result = {}; }); break;
    case 'capMin': targets(bi).forEach(x => { x.capSec = t.value ? Math.round(toNum(t.value) * 60) : null; }); break;
    case 'time': b.result = { timeSec: parseTime(t.value) }; break;
    case 'capped': b.result = t.checked ? { capped: true, repsDone: null } : {}; break;
    case 'repsDone': b.result.repsDone = toNum(t.value); break;
    case 'rounds': b.result.rounds = toNum(t.value); break;
    case 'reps': b.result.reps = toNum(t.value); break;
    case 'qty': targets(bi).forEach(x => setQty(x.items[ii], toNum(t.value))); break;
    case 'load': targets(bi).forEach(x => { x.items[ii].load = readLoad(t.value); }); break;
    case 'target': draft.targets[+t.dataset.t].done = t.checked; break;
    case 'rpe':
      draft.rpe = +t.value;
      if ($('#rpe-desc')) $('#rpe-desc').textContent = `${draft.rpe} · ${RPE_DESC[draft.rpe]}`;
      haptic();
      break;
    case 'key':
      if (t.value && !it.key) setKey(bi, ii, t.value);
      break;
  }
}

// 인식 못한 운동에 운동 지정 + 다음부터 자동 인식하도록 학습
function setKey(bi, ii, key) {
  const def = BY_KEY[key];
  learnAlias(draft.blocks[bi].items[ii].name, key);
  targets(bi).forEach(x => {
    const y = x.items[ii];
    y.key = key;
    y.name = def.name;
    y.implements = def.implements ?? 1;
    if (def.kind === 'erg' && y.unit === 'reps') y.unit = 'cal';
    if (['run', 'carry', 'drag'].includes(def.kind)) y.unit = 'm';
  });
}

function learnAlias(raw, key) {
  const k = raw.trim().toLowerCase();
  if (!k) return;
  saveSetting('aliases', { ...S.aliases, [k]: key });
  toast(`"${raw}" → ${BY_KEY[key].name} 학습했습니다`);
}

function updateSummary() {
  const st = workoutStats(draft, body());
  st.blocks.forEach((bs, i) => {
    const el = $(`#bstat-${i}`);
    if (!el) return;
    el.textContent = draft.repeat && i > 0
      ? (bs.powerW != null ? `${kJ(bs.workJ)} · ${watt(bs.powerW)}` : '')
      : `1회 완주 일량 ${kJ(bs.roundWork)}` + (bs.powerW != null ? ` · 수행 ${kJ(bs.workJ)} · ${watt(bs.powerW)}` : '');
  });
  const unknown = draft.blocks.flatMap(b => b.items).filter(it => !it.key).length;
  $('#sum').innerHTML = `
    <div class="stats3">
      <div><div class="k">총 일량</div><div class="v">${kJ(st.workJ)}</div></div>
      <div><div class="k">시간</div><div class="v">${st.timeSec ? fmtTime(st.timeSec) : '-'}</div></div>
      <div><div class="k">평균 파워</div><div class="v">${watt(st.powerW)}</div></div>
    </div>
    ${unknown ? `<p class="warn">❓ 인식하지 못한 운동 ${unknown}개: 운동을 선택하면 다음부터 자동 인식됩니다</p>` : ''}
    ${st.excluded.length && !unknown ? `<p class="muted small">일량 계산 제외: ${esc(st.excluded.join(', '))}</p>` : ''}`;
}

async function save(isEdit) {
  if (!draft.date) return toast('날짜를 입력해 주세요');
  if (isStrength(draft)) {
    draft.strength.setResults = draft.strength.setResults.filter(s => s.load != null || s.reps != null);
    if (!draft.strength.setResults.length) return toast('세트를 하나 이상 입력해 주세요');
  } else {
    if (!draft.blocks.some(b => b.items.length)) return toast('운동이 하나 이상 필요합니다');
    if (!draft.rpe) {
      $('.rpe')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return toast('RPE(체감 강도)를 선택해 주세요');
    }
  }
  draft.updatedAt = Date.now();
  await db.putWorkout(draft);
  toast(isEdit ? '수정했습니다' : '저장했습니다');
  const id = draft.id;
  draft = null;
  if (!isEdit && day && day.sections.length > 1) {
    day.saved.set(secIdx, id);
    return renderDay();
  }
  day = null;
  location.hash = `#/w/${id}`;
}

// ───────────────────────── Strength 입력 폼
function renderStrengthForm(isEdit) {
  const d = draft;
  const s = d.strength;
  const single = s.items.length === 1;
  const def = single && s.items[0].key ? BY_KEY[s.items[0].key] : null;
  const loadLabel = single && def && !def.equip ? '추가 중량' : '무게';
  paint(`
    <div id="form">
      <header class="bar"><button class="back" data-act="back">‹</button><h1>${isEdit ? '기록 수정' : 'Strength 입력'}</h1>${secChip(d.section)}</header>
      <div class="card"><label>날짜<input type="date" data-f="date" value="${d.date}"></label></div>
      <div class="card">
        <h2>${esc(d.title)}</h2>
        <div class="complex">${s.items.map(it => `<span>${numStr(it.reps)} ${esc(dispName(it))}</span>`).join('<i>+</i>')}</div>
        ${d.notes ? `<p class="muted small pre">${esc(d.notes)}</p>` : ''}
      </div>
      <div class="card">
        <div class="row"><h2>세트 기록</h2><span class="spacer"></span>
          <div class="seg sm">
            <label><input type="radio" name="su" value="lb" ${LU() === 'lb' ? 'checked' : ''}><span>lb</span></label>
            <label><input type="radio" name="su" value="kg" ${LU() === 'kg' ? 'checked' : ''}><span>kg</span></label>
          </div>
        </div>
        ${s.setResults.map((r, i) => `
          <div class="set-row">
            <span class="rep-n" style="padding:0">${i + 1}세트</span>
            ${stepper(`data-f="sload" data-s="${i}" aria-label="${loadLabel}"`, showLoad(r.load), loadStep(), LU())}
            <span class="x">×</span>
            ${stepper(`data-f="sreps" data-s="${i}" aria-label="${single ? '회' : '컴플렉스'}"`, numStr(r.reps), 1)}
            <button class="icon" data-act="del-set" data-s="${i}" aria-label="세트 삭제">✕</button>
          </div>`).join('')}
        <p class="muted small">${loadLabel} × ${single ? '횟수' : '컴플렉스 횟수'}</p>
        <button class="ghost wide" data-act="add-set">＋ 세트 추가</button>
        <div class="bstat" id="ssum"></div>
      </div>
      ${commonTail(d, false)}
      <div class="cta-bar"><button class="primary wide" data-act="save">저장</button></div>
    </div>`, 'sub', 'strength');

  const root = $('#form');
  const upd = () => {
    const ss = strengthSummary(d);
    $('#ssum').innerHTML = ss
      ? (ss.single ? `최고 ${loadText(ss.top)} · <b>e1RM ${loadText(ss.e1rm)}</b> <span class="muted">(Epley)</span>` : `컴플렉스 최고 <b>${loadText(ss.top)}</b>`)
      : '<span class="muted">무게를 입력하면 최고 무게와 e1RM이 계산됩니다</span>';
  };
  root.addEventListener('input', e => {
    const t = e.target;
    const i = +t.dataset.s;
    if (t.dataset.f === 'sload') s.setResults[i].load = readLoad(t.value);
    else if (t.dataset.f === 'sreps') s.setResults[i].reps = toNum(t.value);
    else if (t.dataset.f) applyField(t);
    upd();
  });
  root.addEventListener('change', async e => {
    if (e.target.name === 'su') {
      await saveSetting('loadUnit', e.target.value);
      renderStrengthForm(isEdit);
    }
  });
  root.addEventListener('click', e => {
    const t = e.target.closest('[data-act]');
    if (!t) return;
    switch (t.dataset.act) {
      case 'back': return backFromForm(isEdit);
      case 'add-set': {
        const last = s.setResults.at(-1);
        s.setResults.push({ load: last?.load ?? null, reps: last?.reps ?? (single ? s.items[0].reps : 1) });
        break;
      }
      case 'del-set': s.setResults.splice(+t.dataset.s, 1); break;
      case 'save': return save(isEdit);
      default: return;
    }
    renderStrengthForm(isEdit);
  });
  upd();
}

// ───────────────────────── 상세
async function renderDetail(id) {
  const w = await db.getWorkout(id);
  if (!w) return (location.hash = '#/');
  const tail = `
    ${w.targets?.length ? `<div class="card"><h2>Target</h2>${w.targets.map(t => `<div>${t.done ? '✅' : '⬜'} ${esc(t.text)}</div>`).join('')}</div>` : ''}
    ${w.notes ? `<div class="card"><h2>메모</h2><p class="pre">${esc(w.notes)}</p></div>` : ''}
    ${w.raw ? `<details class="card"><summary>원문 보기</summary><pre>${esc(w.raw)}</pre></details>` : ''}`;
  const buttons = `
    <div class="cta-bar"><div class="btns">
      <button class="danger" id="del" style="flex:0 0 30%">삭제</button>
      <a class="btn primary" href="#/edit/${w.id}">수정</a>
    </div></div>`;

  if (isStrength(w)) {
    const ss = strengthSummary(w);
    paint(`
      <header class="bar"><a class="back" href="#/">‹</a><h1>${dateLabel(w.date)}</h1>${secChip(w.section)}<span class="chip-kind">Strength</span></header>
      <div class="card hero">
        <div class="k">${ss?.single ? 'e1RM (추정 1RM)' : '최고 무게'}</div>
        <div class="hero-v">${ss ? loadText(ss.single ? ss.e1rm : ss.top) : '-'}</div>
        <div class="muted">${esc(w.title)}${w.rpe ? ` · RPE ${w.rpe}` : ''}</div>
      </div>
      <div class="card">
        <div class="complex">${w.strength.items.map(it => `<span>${numStr(it.reps)} ${esc(dispName(it))}</span>`).join('<i>+</i>')}</div>
        <table class="tbl"><thead><tr><th>세트</th><th>무게</th><th>${w.strength.items.length === 1 ? '회' : '컴플렉스'}</th>${ss?.single ? '<th>e1RM</th>' : ''}</tr></thead>
        <tbody>${w.strength.setResults.map((r, i) => `<tr><td>${i + 1}</td><td>${loadText(r.load)}</td><td>${numStr(r.reps)}</td>${ss?.single ? `<td>${r.load ? loadText(e1rm(r.load, r.reps || 1)) : '-'}</td>` : ''}</tr>`).join('')}</tbody></table>
      </div>
      ${tail}${buttons}`, 'sub', 'detail');
  } else {
    const st = workoutStats(w, body());
    const blockCard = (b, i, label) => `
      <div class="card">
        <div class="row"><h2>${label}</h2><span class="muted">${b.format === 'amrap' ? (b.emom ? 'EMOM' : 'AMRAP') : 'For Time'}${b.capSec ? ` · ${numStr(b.capSec / 60)}분 캡` : ''}</span></div>
        <ul class="ilist">${b.items.map(it => `<li>${itemText(it, b)}</li>`).join('')}</ul>
        <div class="row result-row"><b>${resultText(b)}</b><span class="spacer"></span><span class="muted">${kJ(st.blocks[i].workJ)} · ${watt(st.blocks[i].powerW)}</span></div>
      </div>`;
    const blocks = w.repeat && w.blocks.length > 1
      ? `<div class="card">
          <div class="row"><h2>${w.blocks.length}회 반복</h2><span class="muted">${w.blocks[0].capSec ? `${numStr(w.blocks[0].capSec / 60)}분 캡` : ''}</span></div>
          <ul class="ilist">${w.blocks[0].items.map(it => `<li>${itemText(it, w.blocks[0])}</li>`).join('')}</ul>
          ${w.blocks.map((b, i) => `<div class="row result-row"><span>${i + 1}회</span><b>${resultText(b)}</b><span class="spacer"></span><span class="muted">${watt(st.blocks[i].powerW)}</span></div>`).join('')}
        </div>`
      : w.blocks.map((b, i) => blockCard(b, i, w.blocks.length > 1 ? `블록 ${i + 1}` : '운동')).join('');
    paint(`
      <header class="bar"><a class="back" href="#/">‹</a><h1>${dateLabel(w.date)}</h1>${secChip(w.section)}${badge(w.level)}</header>
      <div class="card hero">
        <div class="k">평균 파워</div>
        <div class="hero-v">${watt(st.powerW)}</div>
        <div class="muted">${kJ(st.workJ)} · ${st.timeSec ? fmtTime(st.timeSec) : '-'}${w.rpe ? ` · RPE ${w.rpe}` : ''}</div>
      </div>
      ${w.benchmark ? await benchHistoryHtml(w) : ''}
      ${w.title ? `<p class="wod-title">${esc(w.title)}</p>` : ''}
      ${blocks}
      ${tail}
      ${st.excluded.length ? `<p class="muted small">일량 계산 제외: ${esc(st.excluded.join(', '))}</p>` : ''}
      ${buttons}`, 'sub', 'detail');
  }
  $('#del').onclick = async () => {
    if (!confirm('이 기록을 삭제할까요?')) return;
    await db.deleteWorkout(w.id);
    toast('삭제했습니다');
    location.hash = '#/';
  };
}

// 같은 벤치마크의 기록 비교 (PR, 직전 대비)
async function benchHistoryHtml(w) {
  const b = BENCH_BY_ID[w.benchmark];
  const all = (await db.listWorkouts()).filter(x => x.benchmark === w.benchmark).sort((a, c) => c.date.localeCompare(a.date) || c.createdAt - a.createdAt);
  const best = bestOf(all);
  const idx = all.findIndex(x => x.id === w.id);
  const prev = all[idx + 1];
  let delta = '';
  if (prev) {
    const s = scoreOf(w);
    const p = scoreOf(prev);
    if (s.better === 'low' && s.value < 1e6 && p.value < 1e6) {
      const d = s.value - p.value;
      delta = d === 0 ? '직전과 동일' : `직전 대비 ${d < 0 ? '−' : '+'}${fmtTime(Math.abs(d))}`;
    } else if (s.better === 'high') {
      const d = s.value - p.value;
      delta = `직전 대비 ${d >= 0 ? '+' : '−'}${Math.abs(d)}회`;
    }
  }
  return `
    <div class="card">
      <div class="row"><h2>🏆 ${esc(b?.name || w.benchmark)}</h2><span class="spacer"></span><span class="muted small">${all.length}회 기록</span></div>
      ${best?.id === w.id && all.length > 1 ? '<p class="pr">🎉 개인 최고 기록(PR)입니다</p>' : ''}
      ${delta ? `<p class="muted small">${delta}</p>` : ''}
      <table class="tbl">
        <thead><tr><th>날짜</th><th>레벨</th><th>기록</th><th></th></tr></thead>
        <tbody>${all.map(x => `<tr class="${x.id === w.id ? 'cur' : ''}"><td>${dateLabel(x.date)}</td><td>${badge(x.level) || '-'}</td><td>${esc(scoreOf(x).text)}</td><td>${x.id === best?.id ? 'PR' : ''}</td></tr>`).join('')}</tbody>
      </table>
    </div>`;
}

async function renderEdit(id) {
  const w = await db.getWorkout(id);
  if (!w) return (location.hash = '#/');
  draft = structuredClone(w);
  draft.targets ||= [];
  day = null;
  if (isStrength(draft)) renderStrengthForm(true);
  else renderForm(true);
}

// ───────────────────────── 통계
async function renderStats() {
  const all = (await db.listWorkouts()).reverse();
  const ws = all.filter(w => !isStrength(w));
  const rows = ws.map(w => ({ w, s: workoutStats(w, body()) })).filter(x => x.s.powerW != null);
  const powerPts = rows.map(x => ({ date: x.w.date, value: x.s.powerW }));
  const gi = growthIndex(powerPts);
  const tr = logTrend(powerPts);
  const PHASE = { growing: '성장 중', plateau: '정체 구간', declining: '하락 중' };
  const last30 = all.filter(w => (Date.now() - Date.parse(w.date)) / 86400000 <= 30).length;
  const best = rows.reduce((m, x) => (!m || x.s.powerW > m.s.powerW ? x : m), null);

  // 근력: 운동(또는 컴플렉스)별 날짜별 최고값
  const lifts = new Map();
  for (const w of all.filter(isStrength)) {
    const ss = strengthSummary(w);
    if (!ss) continue;
    const l = lifts.get(ss.id) || { label: ss.label, single: ss.single, pts: [] };
    l.pts.push({ date: w.date, value: ss.value, top: ss.top });
    lifts.set(ss.id, l);
  }
  const liftIds = [...lifts.keys()].sort((a, b) => lifts.get(b).pts.length - lifts.get(a).pts.length);

  // 운동별 집계 (메트콘)
  const agg = new Map();
  for (const w of ws) {
    for (const b of w.blocks) {
      for (const it of b.items) {
        if (!it.key) continue;
        const a = agg.get(it.key) || { name: it.name, unit: it.unit, days: new Set(), total: 0, maxLoad: null };
        a.days.add(w.date);
        a.total += it.qty || 0;
        if (it.load) a.maxLoad = Math.max(a.maxLoad || 0, it.load);
        agg.set(it.key, a);
      }
    }
  }
  const moves = [...agg.values()].sort((a, b) => b.days.size - a.days.size);
  const levels = {};
  for (const w of ws) if (w.level) levels[w.level] = (levels[w.level] || 0) + 1;

  const byBench = new Map();
  for (const w of ws) if (w.benchmark) byBench.set(w.benchmark, [...(byBench.get(w.benchmark) || []), w]);
  const benchRows = [...byBench].map(([id, list]) => ({
    name: BENCH_BY_ID[id]?.name || id,
    n: list.length,
    best: bestOf(list),
    last: list.at(-1),
  })).sort((a, b) => b.n - a.n);

  paint(`
    <h1>통계</h1>
    <div class="card hero">
      <div class="k">메트콘 성장지수</div>
      ${gi ? `
        <div class="hero-v">${Math.round(gi.index)}</div>
        <div class="muted small">첫 4주 평균 ${Math.round(gi.baseline)} W (${gi.baseCount}회) = 100 기준<br>최근 4주 평균 ${Math.round(gi.current)} W (${gi.recentCount}회)</div>`
      : `<div class="hero-v muted">-</div><div class="muted small">결과가 입력된 기록이 2개 이상 쌓이면 표시됩니다</div>`}
    </div>
    <div class="tiles">
      <div class="card tile"><div class="k">총 기록</div><div class="v">${all.length}</div></div>
      <div class="card tile"><div class="k">최근 30일</div><div class="v">${last30}</div></div>
      <div class="card tile"><div class="k">최고 파워</div><div class="v">${best ? Math.round(best.s.powerW) : '-'}<span class="small muted"> W</span></div><div class="muted small">${best ? dateLabel(best.w.date) : ''}</div></div>
    </div>
    <div class="card">
      <h2>메트콘 평균 파워 추이</h2>
      ${tr ? `<p class="trend-sum"><b>${PHASE[tr.phase]}</b> · 현재 추세 월 ${tr.perMonth >= 0 ? '+' : ''}${tr.perMonth.toFixed(1)} W (${tr.pct >= 0 ? '+' : ''}${tr.pct.toFixed(1)}%)</p>` : ''}
      <div id="powerChart"></div>
      <p class="muted small">무게·횟수·시간을 일량(J) ÷ 시간으로 환산한 값입니다. 레벨이 달라도 같은 기준으로 비교됩니다.${tr ? ' 추세선은 장기 성장 연구에서 쓰는 선형-로그 곡선(초반 빠르게, 점점 완만하게)입니다. 월 +1% 미만이면 정체 구간으로 봅니다.' : ''}</p>
    </div>
    <div class="card">
      <h2>근력</h2>
      ${liftIds.length ? `
        <select id="lift">${liftIds.map(id => `<option value="${esc(id)}">${esc(lifts.get(id).label)} (${lifts.get(id).pts.length}회)</option>`).join('')}</select>
        <div id="liftChart"></div>
        <p class="muted small" id="liftNote"></p>`
      : '<p class="muted small">Strength 파트를 기록하면 운동별 e1RM(추정 1RM) 추이가 표시됩니다.</p>'}
    </div>
    <div class="card">
      <h2>🏆 벤치마크</h2>
      ${benchRows.length ? `
        <table class="tbl">
          <thead><tr><th>와드</th><th>횟수</th><th>PR</th><th>최근</th></tr></thead>
          <tbody>${benchRows.map(r => `<tr><td><a href="#/w/${r.best.id}">${esc(r.name)}</a></td><td>${r.n}</td><td>${esc(scoreOf(r.best).text)}</td><td>${esc(scoreOf(r.last).text)}</td></tr>`).join('')}</tbody>
        </table>` : '<p class="muted small">입력 → 벤치마크에서 선택으로 Fran, Murph, Open 와드 등을 기록하면 PR이 여기에 쌓입니다.</p>'}
    </div>
    ${Object.keys(levels).length ? `
      <div class="card">
        <h2>레벨 분포</h2>
        <div class="levels">${S.levels.concat(Object.keys(levels).filter(l => !S.levels.includes(l))).filter(l => levels[l]).map(l => `<span>${badge(l)} ${levels[l]}회</span>`).join('')}</div>
      </div>` : ''}
    <div class="card">
      <h2>운동별 (메트콘)</h2>
      ${moves.length ? `
        <table class="tbl">
          <thead><tr><th>운동</th><th>일수</th><th>누적</th><th>최고 ${LU()}</th></tr></thead>
          <tbody>${moves.map(a => `<tr><td>${esc(a.name)}</td><td>${a.days.size}</td><td>${Math.round(a.total).toLocaleString()} ${UNIT_LABEL[a.unit]}</td><td>${a.maxLoad ? showLoad(a.maxLoad) : '-'}</td></tr>`).join('')}</tbody>
        </table>` : '<p class="muted">기록이 없습니다</p>'}
    </div>
    `, 'tab', 'stats');

  lineChart($('#powerChart'), rows.map(x => ({
    date: x.w.date,
    value: x.s.powerW,
    tip: `${dateLabel(x.w.date)} ${x.w.level ? esc(x.w.level) : ''}<br><b>${Math.round(x.s.powerW)} W</b><br><span class="muted">${kJ(x.s.workJ)} / ${fmtTime(x.s.timeSec)}</span>`,
  })), {
    unit: 'W',
    trend: tr ? powerPts.map(p => ({ date: p.date, value: tr.at(p.date) })) : null,
    labels: ['평균 파워', '추세 (선형-로그)'],
  });

  const drawLift = id => {
    const l = lifts.get(id);
    const lt = logTrend(l.pts);
    const disp = kg => +showLoad(kg);
    lineChart($('#liftChart'), l.pts.map(p => ({
      date: p.date,
      value: disp(p.value),
      tip: `${dateLabel(p.date)}<br><b>${loadText(p.value)}</b>${l.single ? `<br><span class="muted">최고 세트 ${loadText(p.top)}</span>` : ''}`,
    })), { unit: LU(), trend: lt ? l.pts.map(p => ({ date: p.date, value: disp(lt.at(p.date)) })) : null, labels: [l.single ? 'e1RM' : '최고 무게', '추세'] });
    $('#liftNote').textContent = l.single
      ? 'e1RM = 무게 × (1 + 횟수/30) (Epley). 세트 중 가장 높은 값을 씁니다.'
      : '컴플렉스는 e1RM 대신 세트 최고 무게를 표시합니다.';
  };
  if (liftIds.length) {
    drawLift(liftIds[0]);
    $('#lift').onchange = e => drawLift(e.target.value);
  }
}

// ───────────────────────── 설정
function renderSettings() {
  const aliases = Object.entries(S.aliases);
  const unitSel = (k, label) => `
    <label>${label}<select data-unit="${k}">
      <option value="lb" ${S.units[k] === 'lb' ? 'selected' : ''}>lb</option>
      <option value="kg" ${S.units[k] === 'kg' ? 'selected' : ''}>kg</option>
    </select></label>`;
  paint(`
    <h1>설정</h1>
    <div class="card">
      <h2>신체 정보 <span class="muted small">(파워 계산용)</span></h2>
      <div class="grid2">
        <label>체중 (kg)<input class="num" id="weight" inputmode="decimal" value="${numStr(S.weight)}"></label>
        <label>키 (cm)<input class="num" id="height" inputmode="decimal" value="${numStr(S.height)}"></label>
      </div>
    </div>
    <div class="card">
      <h2>처방 기본값</h2>
      <p class="muted small">"22.5/15", "25/20 Cal", "65/95 lb"처럼 값이 두 개일 때 (표기 순서와 무관)</p>
      <div class="seg">
        <label><input type="radio" name="side" value="max" ${S.side === 'max' ? 'checked' : ''}><span>남자 (큰 값)</span></label>
        <label><input type="radio" name="side" value="min" ${S.side === 'min' ? 'checked' : ''}><span>여자 (작은 값)</span></label>
      </div>
    </div>
    <div class="card">
      <h2>무게 단위</h2>
      <p class="muted small">화면 표시·입력 단위</p>
      <div class="seg">
        <label><input type="radio" name="lu" value="lb" ${LU() === 'lb' ? 'checked' : ''}><span>lb</span></label>
        <label><input type="radio" name="lu" value="kg" ${LU() === 'kg' ? 'checked' : ''}><span>kg</span></label>
      </div>
      <p class="muted small" style="margin-top:12px">원문에 단위가 없을 때 해석 (예: "Push Jerks 155/105", "DBx2 Deadlift 30/22.5")</p>
      <div class="grid2">${unitSel('bb', '바벨')}${unitSel('db', '덤벨')}${unitSel('ball', '월볼')}${unitSel('kb', '케틀벨')}${unitSel('other', '썰매·요크·샌드백')}</div>
    </div>
    <div class="card">
      <h2>레벨 이름</h2>
      <p class="muted small">공지에 나오는 버전 순서대로, 쉼표로 구분</p>
      <input id="levels" value="${esc(S.levels.join(', '))}">
      <label style="margin-top:12px">평소 레벨 <span class="muted">(기록이 없을 때 추천 출발점)</span>
        <select id="baseLevel"><option value="">자동 (가운데 레벨)</option>${S.levels.map(l => `<option ${l === S.baseLevel ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>
      </label>
    </div>
    <div class="card">
      <h2>백업</h2>
      <p class="muted small">기록은 이 폰에만 저장됩니다. 주기적으로 내보내 두세요.<br>마지막 백업: ${S.lastBackup ? esc(S.lastBackup.slice(0, 10)) : '없음'}</p>
      <div class="btns">
        <button class="ghost" id="imp">가져오기</button>
        <button class="primary" id="exp">내보내기</button>
      </div>
      <input type="file" id="file" accept="application/json,.json" hidden>
    </div>
    <div class="card">
      <h2>학습된 운동 이름</h2>
      ${aliases.length ? aliases.map(([k, v]) => `<div class="row alias"><span>${esc(k)} → ${esc(BY_KEY[v]?.name || v)}</span><span class="spacer"></span><button class="icon" data-alias="${esc(k)}">✕</button></div>`).join('') : '<p class="muted small">아직 없습니다. 인식 못한 운동을 직접 선택하면 여기에 추가됩니다.</p>'}
    </div>
    <p class="muted small center">WOD Log v${APP_VERSION}</p>`, 'tab', 'settings');

  const saveNum = (id, key) => ($('#' + id).onchange = e => {
    const v = toNum(e.target.value);
    if (v > 0) { saveSetting(key, v); toast('저장했습니다'); }
  });
  saveNum('weight', 'weight');
  saveNum('height', 'height');
  view().querySelectorAll('input[name=side]').forEach(r => (r.onchange = () => { saveSetting('side', r.value); toast('저장했습니다'); }));
  view().querySelectorAll('input[name=lu]').forEach(r => (r.onchange = () => { saveSetting('loadUnit', r.value); toast('저장했습니다'); }));
  view().querySelectorAll('[data-unit]').forEach(sel => (sel.onchange = () => { saveSetting('units', { ...S.units, [sel.dataset.unit]: sel.value }); toast('저장했습니다'); }));
  $('#levels').onchange = e => {
    const ls = e.target.value.split(',').map(s => s.trim()).filter(Boolean);
    if (ls.length) { saveSetting('levels', ls); toast('저장했습니다'); }
  };
  $('#baseLevel').onchange = e => { saveSetting('baseLevel', e.target.value || null); toast('저장했습니다'); };
  $('#exp').onclick = async () => {
    const data = await db.exportAll();
    const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `wodlog-backup-${today()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    await saveSetting('lastBackup', new Date().toISOString());
    renderSettings();
  };
  $('#imp').onclick = () => $('#file').click();
  $('#file').onchange = async e => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const n = await db.importAll(JSON.parse(await f.text()));
      await loadSettings();
      toast(`${n}개 기록을 가져왔습니다`);
      renderSettings();
    } catch (err) {
      toast('가져오기 실패: ' + err.message);
    }
  };
  view().querySelectorAll('[data-alias]').forEach(b => (b.onclick = async () => {
    const next = { ...S.aliases };
    delete next[b.dataset.alias];
    await saveSetting('aliases', next);
    renderSettings();
  }));
}

// ───────────────────────── 시작
async function start() {
  await loadSettings();
  if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
  window.addEventListener('hashchange', route);
  // 같은 메뉴를 다시 누르면 처음 화면으로 (예: 입력 중 하단 '입력' → 새 입력)
  document.querySelectorAll('nav a').forEach(a => a.addEventListener('click', () => {
    if (a.getAttribute('href') === (location.hash || '#/')) route();
  }));
  await route();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('./sw.js').catch(() => {});
}

start();
