// 공통 UI 도구: 설정 · 포맷 · 화면 그리기 · 시트/패널 · 스테퍼 · 토스트
import { MOVEMENTS, BY_KEY } from './movements.js';
import * as db from './db.js';

export const APP_VERSION = '0.6.1';

export const DEFAULTS = {
  weight: 86,
  height: 168,
  side: 'max', // 처방 A/B 중 선택: 'max' 남자(큰 값) / 'min' 여자(작은 값)
  levels: ['RX', 'RED', 'YELLOW', 'WHITE', 'RAINBOW'],
  baseLevel: null, // 기록이 없을 때 추천 출발점
  units: { bb: 'lb', ball: 'lb', db: 'lb', kb: 'lb', other: 'lb' }, // 단위 없는 무게 해석
  loadUnit: 'lb', // 화면 표시·입력 단위 (저장은 kg)
  unitsV2: false,
  weeklyGoal: 3, // 주간 출석 목표
  rm: {}, // 직접 입력한 1RM/3RM/5RM { key: { rm1, rm3, rm5 } } (kg)
  gmax: {}, // 체조 최대 횟수 { key: 회 }
  conds: {}, // 컨디션 { 'YYYY-MM-DD': { feel 1~5, sore: ['lower', ...], weight } }
  aliases: {}, // 사용자가 지정한 운동 이름 → key
  lastBackup: null,
  skin: 'blue', // 디자인 시스템
  mode: 'system', // 화면 모드: system / light / dark
};
export const S = { ...DEFAULTS };

// ───────────────────────── 디자인 시스템
// pv / pvDark: 미리보기 색 [배경, 카드, 포인트] (라이트 / 다크)
export const SKINS = [
  { key: 'blue', name: '블루', desc: '토스형 · 깔끔한 기본', pv: ['#f2f4f6', '#ffffff', '#3182f6'], pvDark: ['#17171c', '#202027', '#4c9aff'] },
  { key: 'lime', name: '네온 라임', desc: '애플 피트니스 · 다크 모드 추천', pv: ['#f2f2f7', '#ffffff', '#3fa300'], pvDark: ['#000000', '#1c1c1e', '#b6ff3b'] },
  { key: 'red', name: '바벨 레드', desc: '크로스핏 박스 · 차콜과 레드', pv: ['#f4f2f0', '#ffffff', '#d92d20'], pvDark: ['#121110', '#1e1c1b', '#ff4d3d'] },
  { key: 'mono', name: '모노크롬', desc: '나이키 · 흑백만', pv: ['#f5f5f5', '#ffffff', '#111111'], pvDark: ['#0a0a0a', '#171717', '#fafafa'] },
  { key: 'orange', name: '선셋 오렌지', desc: '스트라바 · 따뜻한 에너지', pv: ['#f7f5f2', '#ffffff', '#fc5200'], pvDark: ['#141210', '#201d1a', '#ff6a1f'] },
];
// 지금 화면이 다크인지 (설정 우선, 시스템 따라감)
export const isDarkNow = () => S.mode === 'dark' || (S.mode !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
// <html> 에 data-skin / data-theme 적용 + 다음 실행 때 깜빡임 없도록 localStorage 에도 기록
export function applyTheme() {
  const r = document.documentElement;
  if (S.skin && S.skin !== 'blue') r.dataset.skin = S.skin;
  else delete r.dataset.skin;
  if (S.mode === 'light' || S.mode === 'dark') r.dataset.theme = S.mode;
  else delete r.dataset.theme;
  try {
    localStorage.setItem('wod-skin', S.skin || 'blue');
    localStorage.setItem('wod-mode', S.mode || 'system');
  } catch {}
  // 상태 표시줄 색 = 현재 배경색
  requestAnimationFrame(() => {
    const page = getComputedStyle(r).getPropertyValue('--page').trim();
    document.querySelectorAll('meta[name="theme-color"]').forEach(m => m.setAttribute('content', page));
  });
}
// 현재 테마의 색 (공유 카드 등 캔버스용)
export function themeColors() {
  const cs = getComputedStyle(document.documentElement);
  const v = n => cs.getPropertyValue(n).trim();
  return { accent: v('--accent'), press: v('--accent-press'), ink: v('--accent-ink') };
}

export async function loadSettings() {
  for (const k of Object.keys(DEFAULTS)) S[k] = await db.getSetting(k, DEFAULTS[k]);
  S.units = { ...DEFAULTS.units, ...S.units };
  if (!S.unitsV2) {
    await saveSetting('units', { ...DEFAULTS.units });
    await saveSetting('loadUnit', 'lb');
    await saveSetting('unitsV2', true);
  }
  if (S.side !== 'max' && S.side !== 'min') await saveSetting('side', 'max');
  applyTheme();
}
export async function saveSetting(k, v) {
  S[k] = v;
  await db.setSetting(k, v);
}

// ───────────────────────── 포맷
export const $ = (sel, root = document) => root.querySelector(sel);
export const view = () => $('#view');
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
export const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
// 그날 컨디션에 체중이 있으면 그 체중으로 파워 계산
export const body = date => ({ weight: (date && S.conds[date]?.weight) || S.weight, height: S.height });
export const kJ = j => (j == null ? '-' : (j / 1000).toFixed(1) + ' kJ');
export const watt = p => (p == null ? '-' : Math.round(p) + ' W');
export const numStr = n => (n == null || Number.isNaN(n) ? '' : String(+(+n).toFixed(2)));
export const toNum = v => (v === '' || v == null ? null : parseFloat(String(v).replace(',', '.')));
export const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
export const dateLabel = d => { const dt = new Date(d + 'T00:00:00'); return `${dt.getMonth() + 1}/${dt.getDate()} (${WEEK[dt.getDay()]})`; };
export const dateLong = d => { const dt = new Date(d + 'T00:00:00'); return `${dt.getMonth() + 1}월 ${dt.getDate()}일 ${WEEK[dt.getDay()]}요일`; };
export const UNIT_LABEL = { reps: '회', cal: 'cal', m: 'm' };
const levelClass = l => 'lvl-' + String(l || '').toLowerCase().replace(/[^a-z0-9]/g, '');
export const badge = l => (l ? `<span class="badge ${levelClass(l)}">${esc(l)}</span>` : '');
export const isStrength = w => w.kind === 'strength';
export const dispName = it => `${it.variant ? it.variant + ' ' : ''}${it.label || it.name}`;
export const secLabel = s => [s.label, s.title].filter(Boolean).join(' · ');
export const secChip = t => (t ? `<span class="chip-sec">${esc(t)}</span>` : '');
export const KG_PER_LB = 0.45359237;
export const LU = () => S.loadUnit;
export const showLoad = kg => (kg == null ? '' : S.loadUnit === 'lb' ? numStr(Math.round((kg / KG_PER_LB) * 2) / 2) : numStr(Math.round(kg * 10) / 10));
export const readLoad = v => { const n = toNum(v); return n == null ? null : S.loadUnit === 'lb' ? +(n * KG_PER_LB).toFixed(3) : n; };
export const loadText = kg => (kg == null ? '-' : `${showLoad(kg)} ${LU()}`);
export const CHEV = '<svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

// 터치 진동 (사용자가 화면을 한 번 이상 터치한 뒤에만 브라우저가 허용)
export const haptic = (ms = 8) => {
  if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
  try { navigator.vibrate?.(ms); } catch {}
};

// ───────────────────────── 화면 그리기
// kind 'tab'(하단 탭바) / 'sub'(뒤로가기 + 하단 고정 버튼). 같은 key 로 다시 그리면 애니메이션·스크롤 유지
let lastPaint = '';
export const resetPaint = () => { lastPaint = ''; };
export function paint(html, kind, key) {
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

// ───────────────────────── 스테퍼 (data-step 버튼이 옆 input 값을 바꾸고 input 이벤트를 보냄)
export function stepper(attrs, value, step, unit = '', cls = '') {
  return `<div class="stepper ${cls}"><button type="button" data-step="-${step}" aria-label="빼기">−</button><input class="num" ${attrs} inputmode="decimal" value="${value}"><button type="button" data-step="${step}" aria-label="더하기">+</button>${unit ? `<span class="u">${unit}</span>` : ''}</div>`;
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
export const qtyStep = unit => (unit === 'm' ? 10 : 1);
export const loadStep = () => (S.loadUnit === 'lb' ? 5 : 2.5);

// ───────────────────────── 바텀시트
// 목록 선택: items [{ value, label, sub, group, danger }] → 고른 value (닫으면 null)
export function openSheet(title, items, { search = true, selected = null } = {}) {
  return new Promise(resolve => {
    const sh = $('#sheet');
    const q = $('#sheet-q');
    const list = $('#sheet-list');
    $('#sheet-title').textContent = title;
    $('#sheet-body').hidden = true;
    list.hidden = false;
    q.hidden = !search;
    q.value = '';
    const draw = () => {
      const s = q.value.trim().toLowerCase();
      let group = '';
      list.innerHTML = items.filter(it => !s || it.label.toLowerCase().includes(s) || (it.sub || '').toLowerCase().includes(s)).map(it => {
        const g = it.group && it.group !== group ? `<div class="group">${esc((group = it.group))}</div>` : '';
        return `${g}<button data-v="${esc(it.value)}" class="${it.value === selected ? 'on' : ''} ${it.danger ? 'danger-row' : ''}"><span>${esc(it.label)}</span>${it.sub ? `<small>${esc(it.sub)}</small>` : ''}</button>`;
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
// 자유 내용 패널: mount(bodyEl, close) 에서 이벤트를 연결. 닫히면 close 에 넘긴 값으로 resolve
export function openPanel(title, html, mount) {
  return new Promise(resolve => {
    const sh = $('#sheet');
    const bodyEl = $('#sheet-body');
    $('#sheet-title').textContent = title;
    $('#sheet-q').hidden = true;
    $('#sheet-list').hidden = true;
    bodyEl.hidden = false;
    bodyEl.innerHTML = html;
    const close = v => {
      sh.hidden = true;
      sh.onclick = null;
      bodyEl.hidden = true;
      bodyEl.innerHTML = '';
      resolve(v);
    };
    sh.onclick = e => { if (e.target.closest('[data-sheet-close]')) close(null); };
    mount?.(bodyEl, close);
    sh.hidden = false;
  });
}
// 확인 시트 (브라우저 confirm 대신)
export async function askConfirm(message, okLabel = '확인') {
  const v = await openSheet(message, [{ value: 'ok', label: okLabel, danger: true }, { value: 'no', label: '취소' }], { search: false });
  return v === 'ok';
}
const EQUIP_GROUP = { db: '덤벨', kb: '케틀벨', bb: '바벨', ball: '볼', other: '기타 기구' };
export const movementSheetItems = () => MOVEMENTS.map(m => ({
  value: m.key,
  label: m.name,
  sub: m.kind === 'erg' ? 'cal / m' : m.unit === 'm' ? 'm' : '',
  group: m.kind === 'erg' || m.kind === 'run' ? '유산소' : EQUIP_GROUP[m.equip] || '맨몸·체조',
})).sort((a, b) => a.group.localeCompare(b.group) || a.label.localeCompare(b.label));
export const moveName = key => BY_KEY[key]?.name || key;

export function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), 2400);
}

// iOS 스위치
export const sw = (attrs, on) => `<label class="switch"><input type="checkbox" ${attrs} ${on ? 'checked' : ''}><span></span></label>`;
