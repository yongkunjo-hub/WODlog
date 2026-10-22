// WOD 텍스트 규칙 파서
//
// 구조: 하루(day) → 섹션(A. / B. / Part A) → 버전(레벨별) → 블록(점수 단위)
//
// 버전 헤더 (이미 운동을 가진 버전 뒤에 오면 새 버전 = 다른 레벨)
//   12:00 x 2 · 5:00 x 4 · Every 3:00 for 5 rounds · For Time: · 5 rounds for time of:
//   AMRAP 20 · Complete as many rounds as possible in 20 minutes of: · EMOM 30
//   21-15-9 reps for time of: · Team of 2 · 2 Sets · 3 Rounds · 4 Sets @ 70%
// 연속 구간 (같은 와드 안에서 이어짐 → 한 블록으로 합침)
//   Then, / Rest 1 minute, then: 다음에 오는 헤더·운동
// 수정 줄
//   Alternating 14 Rounds · Time Cap: 4:00 each · Time cap: 15 minutes · -rest 4:00 b/t sets-
//   21-15-9 · 6 Reps x 6 Sets · 22.5/15 · Men: 185 lb / Women: 125 lb
// 운동 줄
//   25/20 Calorie Bike Erg · 1600-meter run · 80-foot sled pull (180/110 lb) · 50-yard sprint
//   15 DB Cleans (22.5/15kg) · 15 Wall Balls @ 20/14# · 21-15-9 DBx2 Deadlift 25/17.5 · -3 Burpee Pull-Up
//   40 DU <-> 100 SU · 5 Wall Walk + Handstand Push Up · 2 x (1 Squat Snatch + 1 Hang Squat Snatch)
//   10 shuttle runs (1 rep = 50 ft) · 21 DB snatches (arm 1) · Box Jump 24/20
// 단위 없는 무게는 장비별 기본 단위로 해석 (기본: 덤벨만 kg, 나머지 lb). 내부 저장은 kg.

import { matchMovement, BY_KEY, normalizeName, singular } from './movements.js';

export const DEFAULT_UNITS = { bb: 'lb', ball: 'lb', db: 'kg', kb: 'lb', other: 'lb' };
export const LB = 0.45359237;
const NUM = String.raw`(\d+(?:\.\d+)?)`;
const PAIR = String.raw`${NUM}(?:\s*\/\s*${NUM})?`;
const DIST = { m: 1, meter: 1, meters: 1, km: 1000, ft: 0.3048, feet: 0.3048, foot: 0.3048, yd: 0.9144, yard: 0.9144, yards: 0.9144, mile: 1609.34, miles: 1609.34 };

const RE = {
  date: /^(\d{2}|\d{4})(\d{2})(\d{2})$/,
  classTime: /^\d{1,2}:\d{2}\s*\/\s*\d{1,2}:\d{2}/,
  notice: /공지|참고|시간표|소등|부탁|안내|변경|휴무|예약/,
  section: /^([A-H])\s*[.)]\s*$/,
  part: /^part\s*([A-Z0-9]+)\s*\)?\s*:?$/i,
  // 수업 구분: 10:00 CrossFit · 11:30 Lifting · 10:00 / 11:00 CrossFit · Lifting
  classHdr: /^(?:\d{1,2}:\d{2}\s*(?:\/\s*\d{1,2}:\d{2}\s*)?)?(crossfit|lifting|weightlifting|gymnastics|endurance)\b\s*(?:\/.*)?$/i,
  subTitle: /^(skill\s*training|skill|upper\s*body\s*conditioning|lower\s*body\s*conditioning|conditioning|core\s*tabata|tabata|core|accessory|warm[- ]?up|cool[- ]?down|mobility|knee\s*health)\s*\)?\s*:?$/i,
  // 2:00 On/1:00 Off · :30 On : 2:30 Off · 1:30 AMRAP/1:30 Rest · :20 on / :10 off
  onOff: /^(?:(\d{1,2})?:(\d{2})|(\d{1,2})\s*min(?:ute)?s?)\s*(on|amrap|work|min)\s*[:\/,]*\s*(?:(\d{1,2})?:(\d{2})|(\d{1,2})\s*min(?:ute)?s?)\s*(?:off|rest)$/i,
  capHeader: /^(\d{1,2})?:(\d{2})\s*[x×*]\s*(\d+)\s*(?:sets?|rounds?)?\s*:?$/i,
  every: /^every\s+(\d{1,2})(?::(\d{2}))?\s*(?:min(?:ute)?s?)?\s*(?:for|x|×)\s*(\d+)\s*(rounds?|sets?|min(?:ute)?s?)?/i,
  emomLong: /^every\s+minute,?\s+on\s+the\s+minute\s*(?:for|x|×)\s*(\d+)/i,
  amrap: /^(?:amrap\s*(?:in\s*)?[x×]?\s*(\d+)(?::(\d{2}))?(?!\d|:\d)|(\d+)(?::(\d{2}))?\s*(?:min(?:ute)?s?|분|')?\s*amrap\b)/i,
  amrapLong: /as\s+many\s+(?:rounds|reps)[^0-9]*?in\s+(\d+)\s*min/i,
  emom: /^(?:emom\s*[x×]?\s*(\d+)(?!\d|:\d)|(\d+)(?::00)?\s*(?:min(?:ute)?s?|분|')?\s*emom\b)/i,
  roundsFor: /^(\d+)\s*rounds?\s*for\s*(?:max\s*)?(reps|calories|cals?|load|distance)\b/i,
  setsXreps: /^(\d+)\s*sets?\s*[x×]\s*(\d+(?:\s*\+\s*\d+)*)\s*reps?\b\s*:?\s*(.*)$/i,
  forTime: /^(?:(\d+)\s*)?(alternating\s*)?(?:rounds?\s*)?for\s*time\b/i,
  scoreBy: /^for\s+(calories|cals?|reps|load|distance)\s*:?$/i,
  schemeHeader: /^(\d+(?:\s*-\s*\d+)+)\s*reps?\b/i,
  team: /^team\s*of\s*(\d+)/i,
  sets: /^(\d+)\s*sets?\b\s*[,:]?\s*(.*)$/i,
  // 2 Sets: 1 + 3 @55%~60% (컴플렉스 세트 구성)
  setsReps: /^(\d+)\s*sets?\s*:?\s*(\d+(?:\s*\+\s*\d+)*)\s*(.*)$/i,
  rounds: /^(\d+)\s*rounds?\s*(?:of|each)?\s*:?$/i,
  alternating: /^(?:(\d+)\s*)?alternating\s*(?:(\d+)\s*)?(?:rounds?|sets?|sections?)\b(?:\s*,\s*(\d+)\s*(?:rounds?|sets?))?/i,
  timecap: /(?:time\s*cap|\btc\b|\bcap\b)\s*[:\-]?\s*(\d{1,2})(?::(\d{2}))?\s*(?:min(?:ute)?s?)?\s*(each)?/i,
  capSets: /^(?:time\s*cap|tc)\s*[:\-]?\s*(\d+)\s*(?:sets?|rounds?)$/i,
  capAlt: /^(\d+)\s*min(?:ute)?s?\s*time\s*cap/i,
  rest: /^[-–(\s]*rest\s+(?:(\d{1,3})(?::(\d{2}))?|:(\d{2}))/i,
  restAlt: /^(\d+)\s*min(?:ute)?s?\s*rest\b/i,
  then: /^(?:then|into)\b[\s,:.\-]*(.*)$/i,
  scheme: /^\d+(?:\s*-\s*\d+)+$/,
  schemePrefix: /^(\d+(?:\s*-\s*\d+)+)\s+(.+)$/,
  // 사다리: 1-2-3-4-5-... · 10-9-8-...-2-1 · 1-2-..-10 · 30-20-10...
  ladder: /^(\d+(?:\s*-\s*\d+)*\s*-?\s*\.{2,}\s*(?:-?\s*\d+(?:\s*-\s*\d+)*)?)\s*(.*)$/,
  delta: /^([-+])(\d+)\s+(.+)$/,
  repsXsets: /^(?:part\s*\d+\s*[.):]?\s*)?(\d+(?:\s*\+\s*\d+)*)\s*(?:reps?\s*)?[x×]\s*(\d+)\s*sets?\s*:?\s*(.*)$/i,
  intensity: /^(?:@|~?\d+(?:\.\d+)?\s*%|~?\s*\d+\s*~\s*\d+\s*sets?\s*:|(?:rpe|rir)\b)/i,
  target: /^(targets?|goals?|목표)\s*:?$/i,
  targetInline: /^(?:targets?|goals?|목표)\s*[-:]\s*(.+)$/i,
  until: /^until\s+(\d+)\s+(.+?)\s+(?:are|is)?\s*complete/i,
  skip: /^(?:\[[a-z0-9]\]|[a-z]\s*\+\s*[a-z]\s*=\s*1\s*sets?|a\s*:\s*\d+\s*,.*|lifting|crossfit)$/i,
  remainder: /^in\s+(?:the\s+)?remain(?:der|ing)(?:\s+time)?\s*,?\s*(?:max)?$/i,
  numbered: /^\d+\s*[.)]\s*(.+)$/,
  loadLine: new RegExp(String.raw`^${PAIR}\s*(kg|lb|#)?$`, 'i'),
  gender: /^(?:men\b|women\b|male\b|female\b|♂|♀)/i,
  men: /(?:(?<!wo)\bmen\b|\bmale\b|♂)\s*[:\-]?\s*(\d+(?:\.\d+)?)\s*(lb|kg)?/i,
  women: /(?:\bwomen\b|\bfemale\b|♀)\s*[:\-]?\s*(\d+(?:\.\d+)?)\s*(lb|kg)?/i,
  multiplier: /^(\d+)\s*[x×]\s*\((.+)\)$/i,
  equipPrefix: /^(db|kb)\s*[x×]\s*(\d)\s+/i,
  repDist: /\(\s*1\s*rep\s*=\s*(\d+(?:\.\d+)?)\s*(ft|feet|m|meters?|yd|yards?)\s*\)/i,
};
const UNIT_WORDS = String.raw`cal(?:orie)?s?|m|meters?|km|ft|feet|foot|yd|yards?|miles?`;
const RE_MOVE = new RegExp(String.raw`^${PAIR}\s*(?:(${UNIT_WORDS})\b\.?)?\s*(.+)$`, 'i');
const RE_INLINE_LOAD = new RegExp(String.raw`(?:@\s*${PAIR}\s*(kg|lb|#)?|\(?\s*${PAIR}\s*(kg|lb|#)\s*\)?)`, 'i');
const RE_TRAIL = new RegExp(String.raw`\s+${PAIR}\s*(kg|lb|#|in|"|cm)?\s*$`, 'i');
const MODIFIERS = /\b(scaled|easy|strict|synchroni[sz]ed|sync|syn|pause at knee|paused|tempo|unbroken|light|alternating|alt|lateral|freestanding|free standing|weighted|seated|together|dual)\b/gi;

const isLb = u => /lb|#/i.test(u || '');
export function toKg(v, unit) {
  if (v == null) return null;
  return isLb(unit) ? +(v * LB).toFixed(3) : v;
}
function pair(a, b) {
  const x = a != null ? parseFloat(a) : null;
  const y = b != null ? parseFloat(b) : null;
  return y != null ? [x, y] : [x];
}
const mmss = (m, s) => (+m) * 60 + (+(s || 0));
const fmt = sec => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;

// 처방 [A, B] 중 선택
//   'max' = 큰 값(남자 처방: 무게·칼로리·박스 높이 모두 남자가 큼, 표기 순서와 무관)
//   'min' = 작은 값(여자 처방), 0 / 1 = 앞 / 뒤 숫자
export function pick(arr, side = 'max') {
  if (!arr) return null;
  const vals = arr.filter(x => x != null);
  if (!vals.length) return arr[0] ?? null;
  if (side === 'max') return Math.max(...vals);
  if (side === 'min') return Math.min(...vals);
  return arr[Math.min(side, arr.length - 1)];
}

// 표기 정리: 50-lb → 50 lb, pounds → lb, 1600-meter → 1600 meter, dumbbell → DB, Buy-in: 제거
// 카페 글에 자주 나오는 오타
const TYPOS = {
  bupree: 'burpee', buprees: 'burpees', duoble: 'double', inders: 'unders', santch: 'snatch', snacth: 'snatch', rpes: 'reps', plnak: 'plank',
  dealift: 'deadlift', deadlfit: 'deadlift', thurster: 'thruster', thrster: 'thruster', thrutser: 'thruster', thrstuer: 'thruster',
  sqaut: 'squat', wallk: 'walk', badnded: 'banded', muslce: 'muscle', kettelbell: 'kettlebell', tartget: 'target',
};
const RE_TYPO = new RegExp(String.raw`\b(${Object.keys(TYPOS).join('|')})\b`, 'gi');

function normLine(line) {
  return line
    .replace(/[​-‍﻿]/g, '')
    .replace(/ /g, ' ')
    .replace(/…/g, '...')
    .replace(RE_TYPO, w => (/^[A-Z]/.test(w) ? TYPOS[w.toLowerCase()].replace(/^./, c => c.toUpperCase()) : TYPOS[w.toLowerCase()]))
    .replace(/(\d+(?:\.\d+)?)\s*(m|km|ft|cal)\s*\/\s*(\d+(?:\.\d+)?)\s*\2\b/gi, '$1/$3 $2')
    .replace(/\bwall\s*ball\s*shots?\b/gi, 'Wall Ball Shot')
    .replace(/(\d)(rounds?|sets?|reps?)\b/gi, '$1 $2')
    .replace(/([a-z])&([a-z])/gi, '$1 & $2')
    .replace(/\s*-?\s*rem(?:aining|ainder)?\.?\s*time\s*$/i, '')
    .replace(/[‐‑‒–]/g, '-')
    .replace(/\b(?:pounds?|lbs?)\b\.?/gi, 'lb')
    .replace(/(\d)\s*-\s*(lb|kg|cal|calorie|calories|meter|meters|metre|metres|m|km|foot|feet|ft|yard|yards|yd|mile|miles|in|inch|minute|minutes|min)\b/gi, '$1 $2')
    .replace(/\bmetres?\b/gi, 'meter')
    .replace(/\binch(es)?\b/gi, 'in')
    .replace(/\bdumbbells?\b/gi, 'DB')
    .replace(/\bkettlebells?\b/gi, 'KB')
    .replace(/^(?:buy[- ]?in|cash[- ]?out)(?:\s*(?:or|\/|&)\s*(?:out|in|cash[- ]?out|buy[- ]?in))?\s*:\s*/i, '')
    .trim();
}

// ───────────────────────── 운동 한 개
function parseSingle(text, ctx, inheritQty = null) {
  let s = text.trim();
  let qty = null;
  let unitRaw = '';
  let max = false;
  let durSec = null;

  let repDistM = null;
  const rd = s.match(RE.repDist);
  if (rd) {
    repDistM = +rd[1] * (DIST[rd[2].toLowerCase()] ?? 1);
    s = s.replace(RE.repDist, ' ').trim();
  }
  // 설명 괄호 제거: (Knee OK) (Band Ok) (Between Feet) (arm 1) — 숫자 무게·높이 괄호만 남기고 끝이면 풀기
  s = s.replace(/\(([^)]*)\)/g, (all, inner) => (/^\s*[\d.\/\s~]+\s*(kg|lb|#|in|"|cm)?\s*$/i.test(inner) ? all : ' '))
    .replace(/\((\d[^)]*)\)\s*$/, ' $1').replace(/\s+/g, ' ').trim();
  // 시간 처방(:30 Max Toes To Bar · 1:00 Plank)
  const tm = s.match(/^(\d{1,2})?:(\d{2})\s+(.+)$/);
  if (tm) {
    durSec = mmss(tm[1] || 0, tm[2]);
    s = tm[3];
  }
  // 범위 렙수 2~6 · 15~40 → 큰 값 처방과 같은 방식으로 둘 다 보관
  s = s.replace(/^(\d+(?:\.\d+)?)\s*~\s*(\d+(?:\.\d+)?)\b/, '$1/$2');
  if (/^max\b/i.test(s)) {
    max = true;
    s = s.replace(/^max\s*/i, '');
  }
  // 거리 × 횟수: 7m x 12 Walking Lunge · 7.5m x 24 Shuttle Runs
  const dx = s.match(/^(\d+(?:\.\d+)?)\s*(m|ft|yd)\s*[x×]\s*(\d+)\s+(.+)$/i);
  if (dx) {
    qty = [Math.round(+dx[1] * DIST[dx[2].toLowerCase()] * +dx[3] * 10) / 10];
    unitRaw = 'm';
    s = dx[4].trim();
  }

  const m = dx ? null : s.match(RE_MOVE);
  if (m && /[a-z가-힣]/i.test(m[4])) {
    qty = pair(m[1], m[2]);
    unitRaw = (m[3] || '').toLowerCase();
    s = m[4].trim();
  } else if (!dx && inheritQty) {
    qty = [...inheritQty];
  }

  let hint = null;
  let impl = null;
  const em = s.match(RE.equipPrefix);
  if (em) {
    hint = em[1].toLowerCase();
    impl = +em[2];
    s = s.slice(em[0].length);
  }

  let explicit = null;
  let trail = null;
  const il = s.match(RE_INLINE_LOAD);
  if (il) {
    const [a, b, u] = il[1] != null ? [il[1], il[2], il[3]] : [il[4], il[5], il[6]];
    explicit = { v: pair(a, b), u: u || '' };
    s = (s.slice(0, il.index) + s.slice(il.index + il[0].length));
    // 남은 괄호 설명(예: , 9/10 feet)) 제거
    s = s.replace(/\([^)]*\)|[(),].*$/g, ' ').replace(/\s+/g, ' ').trim();
  }
  // "225/155 lb 100/70 kg" 처럼 단위 두 개면 lb 우선
  for (let k = 0; k < 2; k++) {
    s = s.replace(/[\s,]+$/, '');
    const t = s.match(RE_TRAIL);
    if (!t || !/[a-z가-힣]/i.test(s.slice(0, t.index))) break;
    const cand = { v: pair(t[1], t[2]), u: (t[3] || '').toLowerCase() };
    if (!trail || isLb(cand.u)) trail = cand;
    s = s.slice(0, t.index).trim();
  }
  if (explicit && trail && !/in|cm|"/.test(trail.u)) trail = null;

  let unit = 'reps';
  let distMul = 1;
  if (/^cal/.test(unitRaw) || /\bcal(orie)?s?$/i.test(s)) {
    unit = 'cal';
    s = s.replace(/\bcal(orie)?s?$/i, '').trim();
  } else if (unitRaw && DIST[unitRaw] != null) {
    unit = 'm';
    distMul = DIST[unitRaw];
  }
  if (qty && distMul !== 1) qty = qty.map(q => Math.round(q * distMul * 10) / 10);
  if (repDistM && qty) {
    unit = 'm';
    qty = qty.map(q => Math.round(q * repDistM * 10) / 10);
  }

  const sync = /\bsync?(hroni[sz]ed)?\b/i.test(s);
  const variant = (s.match(MODIFIERS) || []).filter(w => !/^syn|^together$|^dual$|^alt$/i.test(w)).map(w => w[0].toUpperCase() + w.slice(1).toLowerCase()).join(' ');
  const core = s.replace(MODIFIERS, ' ').replace(/\s+/g, ' ').trim();
  const key = (hint && matchMovement(`${hint} ${core}`, ctx.aliases)) || matchMovement(core, ctx.aliases) || matchMovement(s, ctx.aliases);
  if (!key && !qty) return null;
  if (!key && unit === 'reps' && !/[a-z가-힣]/i.test(s)) return null;
  const def = key ? BY_KEY[key] : null;
  if (def?.kind === 'erg' && unit === 'reps') unit = 'cal';
  if (['run', 'carry', 'drag', 'none'].includes(def?.kind) && def.unit === 'm' && unit === 'reps') unit = 'm';
  // 런지·버피 같은 횟수 운동을 거리로 처방하면 걸음 수로 환산 (한 걸음 ≈ 0.8m)
  if (def && def.kind === 'load' && !def.unit && unit === 'm' && qty) {
    unit = 'reps';
    qty = qty.map(q => (q == null ? null : Math.round(q / 0.8)));
  }
  // 6/6 DBx1 … = 한 팔씩 6회 → 12회
  if (impl === 1 && qty?.length === 2 && qty[0] === qty[1]) qty = [qty[0] * 2];

  let load = null;
  let loadSrc = null;
  let boxIn = null;
  for (const src of [explicit, trail].filter(Boolean)) {
    if (/in|cm|"/.test(src.u) || (!src.u && def?.boxHeight && !def?.equip)) {
      if (def?.boxHeight) boxIn = src.u === 'cm' ? src.v.map(v => Math.round(v / 2.54)) : src.v;
    } else if (explicit === src || def?.equip) {
      const u = src.u || (def?.equip && ctx.units[def.equip]) || 'lb';
      load = src.v.map(v => toKg(v, u));
      loadSrc = `${src.v.join('/')} ${isLb(u) ? 'lb' : 'kg'}`;
    } else {
      s = `${s} ${src.v.join('/')}`;
    }
  }

  // 원문 이름이 다른 변형 동작이면 표시용으로 보관 (Push Press, Squat Clean 등)
  // 약어(DU, T2B), 복수형, 군더더기 단어(pull-up, shot) 차이만 있으면 대표 이름을 쓴다
  const shown = hint ? `${hint.toUpperCase()} ${core}` : core;
  const norm = x => singular(normalizeName(x)).replace(/\band\b/g, '&').replace(/\bpull up\b/g, '').split(' ').filter(w => w && !['up', 'shot', 'the', 'a'].includes(w)).join(' ');
  let label = def && core.length > 4 && norm(shown) !== norm(def.name) ? shown : '';
  if (label && label === label.toLowerCase()) label = label.replace(/(^|[\s-])([a-z])/g, (_, p, c) => p + c.toUpperCase());
  return {
    key,
    name: def ? def.name : s,
    label,
    variant: def ? variant : '',
    raw: text.trim(),
    unit,
    qty: qty || [null],
    load,
    loadSrc,
    implements: impl ?? def?.implements ?? 1,
    sync,
    boxIn,
    ...(max ? { max: true } : {}),
    ...(durSec ? { durSec } : {}),
  };
}

// 사다리 렙 펼치기: 1-2-3-... (열린 사다리는 limit 칸까지) · 10-9-...-2-1 · 1-2-..-10 · 1-1-2-2-... · 30-20-10...(끝 값 유지)
export function expandLadder(str, limit = 30) {
  const s = str.replace(/\s+/g, '');
  const [headS, tailS] = s.split(/-?\.{2,}-?/);
  const head = headS.split('-').filter(Boolean).map(Number);
  if (!head.length || head.some(isNaN)) return null;
  if (tailS === undefined) return head.length > 1 ? head : null;
  const tail = tailS.split('-').filter(Boolean).map(Number);
  let p = 1;
  let d = tail.length ? Math.sign(tail[0] - head.at(-1)) || 1 : 1;
  if (head.length > 1) {
    for (p = 1; p < head.length; p++) {
      const ds = head.slice(p).map((x, i) => x - head[i]);
      if (ds.every(x => x === ds[0])) { d = ds[0]; break; }
    }
    if (p >= head.length) { p = 1; d = head[1] - head[0]; }
  }
  const out = [...head];
  const stop = tail.length ? tail[0] : null;
  while (out.length < (stop != null ? 200 : limit)) {
    const nx = out[out.length - p] + d;
    if (stop != null && (d > 0 ? nx >= stop : nx <= stop)) break;
    if (stop == null && nx <= 0) { // 내려가는 열린 사다리: 마지막 값 고정
      if (d === 0) break;
      d = 0;
      continue;
    }
    if (d === 0 && stop != null) break;
    out.push(nx);
  }
  if (tail.length) out.push(...tail);
  return out.length > 1 ? out : null;
}

// ───────────────────────── 운동 줄 (렙 스킴 접두, ±증감, 2 x (a + b), 대체 <->, 묶음 +)
function parseItemLine(line, v, ctx) {
  let s = line;
  let pattern = null;
  let delta = 0;
  let ladderText = null;
  let m = s.match(RE.ladder);
  if (m && /[a-z가-힣]/i.test(m[2])) {
    const lad = expandLadder(m[1]);
    if (lad) {
      pattern = lad;
      if (/\.{2,}\s*$/.test(m[1])) ladderText = m[1].replace(/\s+/g, '').replace(/-?\.{2,}$/, '-…');
      s = m[2];
      if (!v.scheme) { v.scheme = pattern; v.ladderText = ladderText; }
    }
  }
  m = !pattern && s.match(RE.schemePrefix);
  if (m) {
    pattern = m[1].split('-').map(x => +x.trim());
    s = m[2];
    if (!v.scheme) v.scheme = pattern;
  }
  m = s.match(RE.delta);
  if (m) {
    delta = (m[1] === '-' ? -1 : 1) * +m[2];
    s = m[3];
  }
  const withPattern = it => {
    const scheme = pattern || (v.scheme && (it.qty[0] == null || delta) ? v.scheme : null);
    if (scheme) it.pattern = scheme.map(x => Math.max(0, x + delta));
    const lt = pattern ? ladderText : v.scheme && scheme === v.scheme ? v.ladderText : null;
    if (lt && !delta) it.ladder = lt;
    return it;
  };

  // 10 DBx2 (HSN + PP) 17.5/12.5 → 같은 횟수·무게로 두 동작
  // 8 (2 Lunge Wall Ball + 1 Wall Ball) 14/10 → 16 + 8
  m = s.match(/^(\d+(?:\/\d+)?)\s+((?:db|kb)\s*[x×]\s*\d\s+)?\(([^)]+\+[^)]+)\)\s*(.*)$/i);
  if (m) {
    const outer = m[1];
    return m[3].split(/\s*\+\s*/).map(p => {
      const k = p.match(/^(\d+)\s+(.+)$/);
      const q = k ? outer.split('/').map(x => +x * +k[1]).join('/') : outer;
      return parseSingle(`${q} ${m[2] || ''}${k ? k[2] : p} ${m[4]}`, ctx);
    }).filter(Boolean).map(withPattern);
  }
  m = s.match(RE.multiplier);
  if (m) {
    const k = +m[1];
    return m[2].split(/\s+\+\s+/).map(p => parseSingle(p, ctx)).filter(Boolean)
      .map(it => ({ ...it, qty: it.qty.map(q => (q == null ? k : q * k)) }));
  }
  // 묶음(+)·대체(/) 분리 전에 설명 괄호 제거: 12 Burpee Over Bar (1 Burpee + 2 Over)
  s = s.replace(/\(([^)]*)\)/g, (all, inner) => (/^\s*[\d.\/\s~]+\s*(kg|lb|#|in|"|cm)?\s*$/i.test(inner) || /^\s*1\s*rep\s*=/i.test(inner) ? all : ' ')).replace(/\s+/g, ' ').trim();

  // 대체 동작: 40 DU <-> 100 SU · Bar Muscle Ups/Chest to bar
  let alts = s.split(/\s*(?:<->|↔|<=>)\s*/);
  if (alts.length === 1 && !/[()]/.test(s)) alts = s.split(/(?<=[a-z]{2})\s*\/\s*(?=[a-z]{2})/i);
  if (alts.length > 1) {
    const [a, b] = alts.map(p => parseSingle(p, ctx));
    if (a) {
      if (b) a.alt = b;
      return [withPattern(a)];
    }
  }

  const parts = s.split(/\s+\+\s+/);
  const first = parseSingle(parts[0], ctx);
  if (!first) return [];
  return [first, ...parts.slice(1).map(p => parseSingle(p, ctx, first.qty)).filter(Boolean)].map(withPattern);
}

// ───────────────────────── 버전
function newVersion() {
  return {
    format: null, capSec: null, capEach: false, intervalSec: null, blockCount: 1,
    sets: null, intensity: '', rounds: null, team: null, alternating: false, restSec: null,
    scheme: null, repsXsets: null, schemes: [], loadRaw: null, gender: {}, items: [], targets: [], notes: [],
    chain: false, prevRest: null, restAfter: null,
    onOff: false, offSec: null, capSets: null, until: null, scoreBy: null, tabata: false, boxRaw: null,
  };
}

const mmssOpt = (m, s) => mmss(m || 0, s);

// 버전을 시작/수정하는 헤더 줄이면 패치 객체를 반환
function headerOf(line) {
  let m = line.match(RE.onOff);
  if (m) {
    const on = m[3] ? +m[3] * 60 : mmssOpt(m[1], m[2]);
    const off = m[7] ? +m[7] * 60 : mmssOpt(m[5], m[6]);
    const p = { onOff: true, intervalSec: on + off, capSec: on, offSec: off, capEach: true };
    if (/amrap/i.test(m[4])) p.format = 'amrap';
    return p;
  }
  m = line.match(RE.capHeader);
  if (m) {
    const sec = mmssOpt(m[1], m[2]);
    return { intervalSec: sec, capSec: sec, blockCount: +m[3], format: 'fortime' };
  }
  m = line.match(RE.emomLong);
  if (m) return { format: 'emom', capSec: +m[1] * 60 };
  m = line.match(RE.every);
  if (m) {
    const sec = mmss(m[1], m[2]);
    const n = /min/i.test(m[4] || '') ? Math.round((+m[3] * 60) / sec) : +m[3];
    return { intervalSec: sec, capSec: sec, blockCount: n, format: 'fortime' };
  }
  m = line.match(RE.amrap);
  if (m) return { format: 'amrap', capSec: m[1] != null ? mmss(m[1], m[2]) : mmss(m[3], m[4]) };
  m = line.match(RE.amrapLong);
  if (m) return { format: 'amrap', capSec: +m[1] * 60 };
  m = line.match(RE.emom);
  if (m) return { format: 'emom', capSec: (+(m[1] || m[2])) * 60 };
  m = line.match(RE.scoreBy);
  if (m) return { scoreBy: /cal/i.test(m[1]) ? 'cal' : m[1].toLowerCase() };
  m = line.match(RE.roundsFor);
  if (m) return { rounds: +m[1], scoreBy: /cal/i.test(m[2]) ? 'cal' : m[2].toLowerCase() };
  m = line.match(RE.forTime);
  if (m) {
    const p = { format: 'fortime' };
    if (m[1]) p.rounds = +m[1];
    if (m[2]) p.alternating = true;
    const cap = line.match(RE.timecap);
    if (cap) p.capSec = mmss(cap[1], cap[2]);
    return p;
  }
  m = line.match(RE.schemeHeader);
  if (m && /reps?\s*(for\s*time|of|:|$)/i.test(line)) return { format: 'fortime', scheme: m[1].split('-').map(x => +x.trim()) };
  m = line.match(RE.team);
  if (m) return { team: +m[1] };
  m = line.match(RE.alternating);
  if (m) {
    const n = m[1] || m[2] || m[3];
    return n ? { alternating: true, rounds: +n } : { alternating: true };
  }
  m = line.match(RE.rounds);
  if (m) return { rounds: +m[1] };
  m = line.match(RE.sets);
  if (m && !/reps?\s*[x×]/i.test(line)) return { sets: +m[1], intensity: m[2].trim() };
  return null;
}

// 같은 운동이 다시 나오면 새 블록으로 분리
function splitBlocks(items) {
  const blocks = [];
  let cur = [];
  let seen = new Set();
  for (const it of items) {
    const id = it.key || it.name.toLowerCase();
    if (seen.has(id) && cur.length) {
      blocks.push(cur);
      cur = [];
      seen = new Set();
    }
    cur.push(it);
    seen.add(id);
  }
  if (cur.length) blocks.push(cur);
  return blocks;
}

const cloneItems = items => items.map(it => structuredClone(it));

function describe(v, kind) {
  if (kind === 'strength') {
    return [`${v.sets || v.repsXsets?.sets || v.blockCount} Sets`, v.intensity, v.intervalSec ? `${fmt(v.intervalSec)}마다` : ''].filter(Boolean).join(' · ');
  }
  const p = [];
  if (v.team) p.push(`Team of ${v.team}`);
  if (v.onOff) p.push(`${v.format === 'amrap' ? 'AMRAP ' : ''}${fmt(v.capSec)} On / ${fmt(v.offSec)} Off × ${v.blockCount}`);
  else if (v.format === 'amrap') p.push(`AMRAP ${fmt(v.capSec).replace(/:00$/, '')}`);
  else if (v.format === 'emom') p.push(`EMOM ${v.capSec / 60}`);
  else if (v.intervalSec && v.blockCount > 1) p.push(`${fmt(v.intervalSec)} × ${v.blockCount}${v.capEach && v.capSec !== v.intervalSec ? ` (캡 ${fmt(v.capSec)})` : ''}`);
  else p.push('For Time');
  if (v.sets > 1 && !v.onOff) p.push(`${v.sets} Sets`);
  if (v.alternating) p.push(`Alternating${v.rounds ? ` ${v.rounds}R` : ''}`);
  else if (v.rounds > 1 && !v.onOff) p.push(`${v.rounds} Rounds`);
  if (v.scheme) p.push(v.ladderText || v.scheme.join('-'));
  if (v.until) p.push(`${v.until.qty}개 완료까지`);
  if (v.scoreBy === 'cal') p.push('칼로리 점수');
  if (v.restSec) p.push(`휴식 ${fmt(v.restSec)}`);
  if (v.capSec && v.format === 'fortime' && !v.intervalSec) p.push(`캡 ${fmt(v.capSec)}`);
  return p.join(' · ');
}

// 바벨·맨몸 저반복 위주(유산소·거리·Max 없음, 명시 무게 없음)면 리프팅
function liftLike(v) {
  return v.items.length > 0 && !v.team && v.items.every(it => {
    const def = it.key && BY_KEY[it.key];
    const q = it.qty.filter(x => x != null);
    return it.unit === 'reps' && !it.max && (!def || def.kind === 'load' || def.kind === 'none') && (!q.length || Math.max(...q) <= 12);
  });
}

function strengthOf(v, base) {
  const schemes = v.schemes.length ? v.schemes : v.repsXsets ? [v.repsXsets] : [];
  if (schemes.length) {
    const reps = schemes[0].reps;
    v.items.forEach((it, i) => {
      if (it.qty[0] != null) return;
      if (reps.length === v.items.length) it.qty = [reps[i]];
      else if (reps.length === 1) it.qty = [reps[0]];
    });
    v.sets = schemes.reduce((a, s) => a + s.sets, 0);
    const desc = schemes.length > 1 || reps.length > 1
      ? schemes.map(s => `${s.sets}×${s.reps.join('+')}${s.intensity ? ` ${s.intensity}` : ''}`)
      : [schemes[0].intensity].filter(Boolean);
    v.intensity = [...desc, v.intensity].filter(Boolean).join(' · ');
  } else if (!v.sets) {
    v.sets = v.blockCount || 1;
  }
  // 컴플렉스(+로 이은 여러 동작)에서 횟수가 없으면 1회씩
  if (v.items.length > 1) v.items.forEach(it => { if (it.qty[0] == null && !it.pattern) it.qty = [1]; });
  return { kind: 'strength', title: describe(v, 'strength'), sets: v.sets, intensity: v.intensity, intervalSec: v.intervalSec, items: v.items, ...base };
}

function finalize(v, ctx) {
  // 버전 공통 무게: "22.5/15" 줄, "DB: 15/10" 줄, Men/Women 줄 → 무게 없는 기구 운동에 적용
  const g = v.gender;
  const common = v.loadRaw || (g.m || g.w ? { v: [g.m?.v ?? g.w.v, g.w?.v ?? g.m.v], u: g.m?.u || g.w?.u || '' } : null);
  for (const it of v.items) {
    const equip = it.key && BY_KEY[it.key].equip;
    if (v.boxRaw && !it.boxIn && it.key && BY_KEY[it.key].boxHeight) it.boxIn = v.boxRaw;
    if (!it.load && equip && common && (!common.equip || common.equip === equip)) {
      const u = common.u || ctx.units[equip] || 'lb';
      it.load = common.v.map(x => toKg(x, u));
      it.loadSrc = `${common.v.join('/')} ${isLb(u) ? 'lb' : 'kg'}`;
    }
  }
  const load = common ? common.v.map(x => toKg(x, common.u || ctx.units.db || 'lb')) : null;
  const base = { targets: v.targets, notes: v.notes, load, loadSrc: common ? `${common.v.join('/')} ${isLb(common.u || ctx.units.db) ? 'lb' : 'kg'}` : null };

  const noLoads = v.items.every(it => !it.load);
  const strengthy = /%|rpe|rir|weight/i.test(v.intensity) || v.items.every(it => it.key && BY_KEY[it.key].equip === 'bb');
  if (v.schemes.length || v.repsXsets
    || (v.sets && !v.format && !v.onOff && liftLike(v))
    || (v.intervalSec && !v.onOff && v.format === 'fortime' && liftLike(v) && noLoads && strengthy)
    || (!v.format && !v.onOff && v.scheme && !v.team && liftLike(v) && noLoads && strengthy)) {
    // 3-3-3-2-2 Front Squat @RPE: 세트별 반복 수
    if (!v.schemes.length && !v.repsXsets && !v.sets && v.scheme) {
      v.sets = v.scheme.length;
      v.intensity = [v.scheme.join('-'), v.intensity].filter(Boolean).join(' · ');
      v.items.forEach(it => { if (it.qty[0] == null) { it.qty = [v.scheme[0]]; delete it.pattern; } });
    }
    return strengthOf(v, base);
  }

  const format = v.format === 'amrap' || v.format === 'emom' ? 'amrap' : 'fortime';
  let rounds = v.format === 'emom' ? 1 : v.rounds || v.scheme?.length || 1;
  // Set 1: … / Minute 2 - … 처럼 회차가 정해진 운동은 그 회차에만
  if (rounds > 1) {
    for (const it of v.items) if (it.slot && !it.pattern && it.slot <= rounds) it.pattern = Array.from({ length: rounds }, (_, i) => (i === it.slot - 1 ? null : 0));
  }
  const mk = (items, extra = {}) => ({
    format, emom: v.format === 'emom', capSec: v.capSec, rounds,
    team: v.team, alternating: v.alternating, restAfterSec: null, repeat: false, items, ...extra,
  });

  let blocks;
  if (v.onOff) {
    // 2:00 On / 1:00 Off × N: 세트 수는 4 Sets · 4 Rounds · Time Cap: 6 Sets 중 있는 것
    const n = v.sets || v.rounds || v.capSets || (v.tabata ? 8 : 1);
    v.blockCount = n;
    if (v.until) {
      // Until 150 Wall Ball Shots are Complete: 목표 개수 채우면 끝나는 For Time (최대 n세트)
      const target = v.items.find(it => it.max && (it.key === v.until.key || !v.until.key)) || v.items.find(it => it.max);
      if (target) target.qty = [v.until.qty];
      rounds = 1;
      blocks = [mk(v.items, { format: 'fortime', rounds: 1, capSec: n * v.intervalSec - v.offSec })];
    } else {
      blocks = Array.from({ length: n }, (_, i) => mk(cloneItems(v.items), { rounds: 1, repeat: true, restAfterSec: i < n - 1 ? v.offSec : null }));
    }
  } else if (v.intervalSec && v.blockCount > 1) {
    const split = splitBlocks(v.items);
    if (split.length === v.blockCount) {
      blocks = split.map(items => mk(items));
    } else {
      const rest = v.intervalSec - v.capSec;
      blocks = Array.from({ length: v.blockCount }, (_, i) => mk(cloneItems(v.items), { repeat: true, restAfterSec: rest > 0 && i < v.blockCount - 1 ? rest : null }));
    }
  } else if (v.sets > 1) {
    blocks = Array.from({ length: v.sets }, (_, i) => mk(cloneItems(v.items), { repeat: true, restAfterSec: i < v.sets - 1 ? v.restSec : null }));
  } else {
    blocks = [mk(v.items)];
  }
  return { kind: 'metcon', title: describe(v, 'metcon'), format: blocks[0].format, capSec: blocks[0].capSec, blockCount: blocks.length, repeat: blocks[0].repeat, blocks, ...base };
}

// 휴식을 사이에 둔 AMRAP 여러 개 등: 앞 버전에 블록으로 이어 붙임
function appendChain(last, fin, rest) {
  last.blocks.at(-1).restAfterSec = rest || null;
  last.blocks.push(...fin.blocks);
  last.blockCount = last.blocks.length;
  last.repeat = false;
  last.title = `${last.title}${rest ? ` → 휴식 ${fmt(rest)}` : ''} → ${fin.title}`;
  last.targets.push(...fin.targets);
  last.notes.push(...fin.notes);
}

// 연속 구간을 앞 블록 뒤에 이어 붙임: 뒷 구간 운동은 앞 구간 라운드 수만큼 0을 채워
// 라운드 순서대로 진행되도록 한다 (타임캡 걸렸을 때 수행량 계산이 맞도록)
function mergeChain(last, fin, rest) {
  const a = last.blocks[0];
  const b = fin.blocks[0];
  const Ra = a.rounds || 1;
  const Rb = b.rounds || 1;
  a.items.forEach(it => { if (!it.pattern) it.pattern = Array(Ra).fill(null); });
  b.items.forEach(it => { it.pattern = [...Array(Ra).fill(0), ...(it.pattern || Array(Rb).fill(null))]; });
  a.items.push(...b.items);
  a.rounds = Ra + Rb;
  a.capSec = a.capSec || b.capSec;
  a.restInsideSec = (a.restInsideSec || 0) + (rest || 0);
  last.capSec = a.capSec;
  const tail = fin.title.replace(/^For Time( · |$)/, '');
  last.title = `${last.title.replace(/ · 캡 \d+:\d+$/, '')}${rest ? ` → 휴식 ${fmt(rest)}` : ''}${tail ? ` → ${tail}` : ' → 이어서'}`;
  if (a.capSec && !/캡/.test(last.title)) last.title += ` · 캡 ${fmt(a.capSec)}`;
  last.targets.push(...fin.targets);
  last.notes.push(...fin.notes);
}

// ───────────────────────── 하루
// 운동 정보가 없는 한글 문장(박스 규칙·안내문)
function isProse(line) {
  if (!/[가-힣]{2,}/.test(line) || /^[*※]/.test(line)) return false;
  if (/[a-z]{3,}/i.test(line.replace(/wod|t_t/gi, ''))) return false;
  if (/\d+\s*(?:kg|lb|cal|m)\b/i.test(line)) return false;
  return !matchMovement(line.replace(/^[\d.\s)]+/, ''));
}
const CLASS_NAME = { crossfit: 'CrossFit', lifting: 'Lifting', weightlifting: 'Weightlifting', gymnastics: 'Gymnastics', endurance: 'Endurance' };
const titleCase = s => s.replace(/\s+/g, ' ').toLowerCase().replace(/(^|\s)([a-z])/g, (_, p, c) => p + c.toUpperCase());

export function parseWod(text, { aliases = {}, units = {} } = {}) {
  const ctx = { aliases, units: { ...DEFAULT_UNITS, ...units } };
  const lines = text.split(/\r?\n/).map(normLine).filter(Boolean);
  const day = { date: null, notes: [], sections: [] };
  let sec = null;
  let group = '';
  let v = null;
  let mode = 'items';
  let pendingChain = false;
  let nextMax = false;
  let complexName = null;
  let roundAlt = null;
  let tabataNext = false;

  const newSection = (label = '', title = '') => {
    sec = { label, title, group, versions: [] };
    day.sections.push(sec);
    return sec;
  };
  const section = () => sec || newSection();
  const close = () => {
    if (v && (v.items.length || v.targets.length)) {
      const fin = finalize(v, ctx);
      const last = section().versions.at(-1);
      if (v.chain && last?.kind === 'metcon' && fin.kind === 'metcon') {
        if (last.blocks.length === 1 && fin.blocks.length === 1 && last.format !== 'amrap' && fin.format !== 'amrap') mergeChain(last, fin, v.prevRest);
        else appendChain(last, fin, v.prevRest);
      } else section().versions.push(fin);
    }
    v = null;
    mode = 'items';
  };
  const chainNext = () => {
    const rest = v?.restAfter ?? null;
    close();
    v = newVersion();
    v.chain = true;
    v.prevRest = rest;
    v.format = 'fortime';
  };
  const cur = () => {
    if (!v) {
      v = newVersion();
      if (tabataNext) v.tabata = true;
      tabataNext = false;
    }
    return v;
  };
  const strengthish = () => v && !v.format && !v.onOff && (v.sets || v.repsXsets || v.schemes.length);

  for (let line of lines) {
    let m = line.match(RE.date);
    if (m && !day.date) {
      const y = m[1].length === 2 ? 2000 + +m[1] : +m[1];
      if (+m[2] >= 1 && +m[2] <= 12 && +m[3] >= 1 && +m[3] <= 31) {
        day.date = `${y}-${m[2]}-${m[3]}`;
        // 날짜 위쪽의 박스 규칙·안내문은 버림
        if (!day.sections.length && !v) day.notes = [];
        continue;
      }
    }
    // 수업 시간표·공지·안내문 (영문 운동명이 없는 한글 문장)
    if (RE.notice.test(line) && !/[a-z]{3,}/i.test(line)) {
      day.notes.push(line);
      continue;
    }
    if (isProse(line)) {
      if (mode === 'targets') v.targets.push(line);
      else if (v?.items.length) v.notes.push(line);
      else day.notes.push(line);
      continue;
    }
    m = line.match(RE.classHdr);
    if (m) {
      close();
      group = CLASS_NAME[m[1].toLowerCase()];
      sec = null;
      if (/\d:\d{2}/.test(line)) day.notes.push(line);
      continue;
    }
    if (RE.classTime.test(line)) {
      day.notes.push(line);
      continue;
    }
    m = line.match(RE.section);
    if (m) {
      close();
      newSection(m[1].toUpperCase());
      continue;
    }
    m = line.match(RE.part);
    if (m) {
      close();
      const title = `Part ${m[1].toUpperCase()}`;
      if (sec && !sec.versions.length && !sec.title) sec.title = title;
      else newSection(sec?.label || '', title);
      continue;
    }
    m = line.match(RE.subTitle);
    if (m) {
      close();
      const title = titleCase(m[1]);
      if (/tabata/i.test(title)) tabataNext = true;
      if (sec && !sec.versions.length) sec.title = [sec.title, title].filter(Boolean).join(' · ');
      else newSection(sec?.label || '', title);
      continue;
    }
    if (RE.skip.test(line)) continue;
    if (RE.remainder.test(line)) {
      nextMax = true;
      continue;
    }
    m = line.match(RE.targetInline);
    if (m) {
      cur().targets.push(m[1].trim());
      continue;
    }
    if (RE.target.test(line)) {
      cur();
      mode = 'targets';
      continue;
    }
    // 목표 목록 뒤에 렙 스킴이 오면 다음 레벨 시작
    if (mode === 'targets' && (RE.scheme.test(line) || RE.ladder.test(line))) close();
    // *Option) 아래 대체 동작 안내는 메모로 (다음 헤더까지)
    if (/^\*?\s*options?\s*[):]?\s*$/i.test(line) && v) {
      mode = 'notes';
      continue;
    }
    if (mode === 'notes') {
      if (!headerOf(line)) {
        v.notes.push(line.replace(/^[*※]\s*/, ''));
        continue;
      }
      mode = 'items';
    }
    // 12:30 26.1 재측정 HEAT 1 같은 시간표 줄
    if (/^\d{1,2}:\d{2}\s+\S/.test(line) && /[가-힣]/.test(line)) {
      day.notes.push(line);
      continue;
    }

    // 앞머리 정리: Minute 2 - … · Set 1: … · 1R: … · Round 1,3,5) … · ODD - … · - 6 Devil Press · -Max … · + 1 Hang Power Snatch
    let slot = null;
    m = line.match(/^(?:minute|min)\s*(\d+)(?:\s*~\s*\d+)?\s*[-:)]\s*(.+)$/i) || line.match(/^set\s*(\d+)\s*[:)\-]\s*(.+)$/i) || line.match(/^(\d+)\s*r\s*[:)]\s*(.+)$/i);
    if (m) {
      slot = +m[1];
      line = m[2];
    }
    m = line.match(/^(odd|even)\s*(?:minutes?)?\s*[-:)]\s*(.+)$/i) || line.match(/^rounds?\s*[\d,\s]+\)\s*(.+)$/i);
    const roundPrefix = !!m && /^round/i.test(m[0]);
    if (m) line = m.at(-1);
    // 1 Round of "Cindy" → 동작으로 펼침
    m = line.match(/^(?:(\d+)\s*)?rounds?\s+of\s+["'“”‘’]?\s*(strict\s+cindy|cindy|easy\s+dt|dt)\s*["'“”‘’]?$/i);
    if (m) {
      const k = +(m[1] || 1);
      const name = m[2].toLowerCase().replace(/\s+/g, ' ');
      const def = name.includes('cindy') ? [`${5 * k} ${name.includes('strict') ? 'Strict ' : ''}Pull-up`, `${10 * k} Push-up`, `${15 * k} Air Squat`]
        : [`${12 * k} Deadlift${name === 'dt' ? ' 155/105' : ''}`, `${9 * k} Hang Power Clean${name === 'dt' ? ' 155/105' : ''}`, `${6 * k} Push Jerk${name === 'dt' ? ' 155/105' : ''}`];
      const its = def.map(t => parseSingle(t, ctx)).filter(Boolean);
      if (slot) its.forEach(it => (it.slot = slot));
      cur().items.push(...its);
      continue;
    }
    if (/^[-•·]\s+/.test(line)) line = line.replace(/^[-•·]\s+/, '');
    else if (/^-(?=[a-z])/i.test(line)) line = line.slice(1);
    else if (/^\+\s*/.test(line) && !(v?.scheme && /^\+\d/.test(line))) line = line.replace(/^\+\s*/, '');

    // 쉬는 시간: 세트 사이(b/t sets) / 라운드 사이 / 리프팅 세트 안 / 구간 사이(다음 구간과 이어짐)
    m = line.match(RE.rest) || line.match(RE.restAlt) || line.match(/^(?:(\d{1,2})?:(\d{2}))\s*rest$/i);
    if (m) {
      const secs = m[3] != null ? +m[3] : /sec|초|"/i.test(line) && !m[2] ? +m[1] : mmss(m[1] || 0, m[2]);
      if (/b\/t\s*sets?|between\s*sets?/i.test(line) || (v?.sets && !v.items.length)) cur().restSec = secs;
      else if (/round/i.test(line)) cur().notes.push(line);
      else if (strengthish()) {
        if (!v.restSec) v.restSec = secs;
        else v.notes.push(line);
      } else if (v?.items.length && v.rounds > 1 && !v.onOff && !/then/i.test(line)) v.restSec = secs; // 5 Rounds For Time … Rest 1:30 = 라운드 사이 휴식
      else if (v?.items.length) {
        v.restAfter = secs;
        pendingChain = true;
      } else cur().restSec = secs;
      continue;
    }
    m = line.match(RE.then);
    if (m) {
      // 리프팅(Back Squat → Build to heavy → then → 3 Reps x 3 Sets)은 같은 버전으로 이어감
      const lifting = v && (v.sets || v.repsXsets || v.schemes.length || (!v.format && !v.scheme && liftLike(v)));
      if (v?.items.length && !lifting) chainNext();
      pendingChain = false;
      if (!m[1]) continue;
      line = m[1];
    }

    // 컴플렉스 세트 구성: 2 Sets: 1 + 3 @55%~60% · 3 Sets: 2 + 1
    m = line.match(RE.setsReps);
    if (m && (/\+/.test(m[2]) || /^@|%/.test(m[3])) && !/[a-z]{3,}/i.test(m[3].replace(/rpe|rir|of|rm|tng|touch|and|go|not|dead|stop|speed/gi, ''))) {
      if (v?.items.length && !strengthish() && v.format) close();
      cur().schemes.push({ sets: +m[1], reps: m[2].split('+').map(x => +x.trim()), intensity: m[3].trim() });
      continue;
    }

    const hdr = headerOf(line);
    if (hdr) {
      // 3 Sets: @RPE 8~9 처럼 같은 컴플렉스의 다음 묶음이면 새 버전
      if (v && (v.items.length || mode === 'targets')) {
        if (pendingChain) chainNext();
        else close();
      }
      pendingChain = false;
      Object.assign(cur(), hdr);
      continue;
    }
    if (mode === 'targets') {
      const n = line.match(RE.numbered);
      if (/^[*※]/.test(line)) v.notes.push(line);
      else v.targets.push((n ? n[1] : line).trim());
      continue;
    }

    // 강도 줄: @70%~75% · @RPE 7~8.5 · RPE~9 · 65%~80% · 1~4 Sets: 65%
    if (RE.intensity.test(line.replace(/^[*※]\s*/, ''))) {
      const t = line.replace(/^[*※]\s*/, '').trim();
      cur().intensity = [v.intensity, t].filter(Boolean).join(' · ');
      continue;
    }
    // 별표 메모 중 처방에 쓰이는 것: *Time Cap: 6 Sets · *Until 150 … are Complete · *A+B = 1 Set · *BB Complex:
    const bare = line.replace(/^[*※]\s*/, '');
    m = bare.match(RE.capSets);
    if (m) {
      cur().capSets = +m[1];
      continue;
    }
    m = bare.match(RE.until);
    if (m) {
      cur().until = { qty: +m[1], key: matchMovement(m[2], ctx.aliases) };
      continue;
    }
    if (RE.skip.test(bare)) continue;
    // 자리표시 정의: *BB Complex: · *Cardio) · *Machine) · Gymnastic) → 다음 줄이 실제 동작
    m = bare.match(/^(.*?\b(?:complex|cardio|machine|gymnastics?))\s*[:)]\s*$/i);
    if (m) {
      complexName = m[1].toLowerCase();
      continue;
    }

    m = (/^\(?\s*(time\s*cap|tc|cap)\b/i.test(bare) && bare.match(RE.timecap)) || bare.match(RE.capAlt);
    if (m) {
      cur().capSec = m.length > 3 ? mmss(m[1], m[2]) : +m[1] * 60;
      v.capEach = !!m[3] || !!v.intervalSec;
      continue;
    }
    if (RE.gender.test(line)) {
      const g = cur().gender;
      const mm = line.match(RE.men);
      const ww = line.match(RE.women);
      if (mm) g.m = { v: +mm[1], u: mm[2] || '' };
      if (ww) g.w = { v: +ww[1], u: ww[2] || '' };
      if (mm || ww) continue;
    }
    if (RE.scheme.test(line)) {
      cur().scheme = line.split('-').map(x => +x.trim());
      v.ladderText = null;
      continue;
    }
    m = line.match(RE.ladder);
    if (m && !m[2]) {
      const lad = expandLadder(m[1]);
      if (lad) {
        cur().scheme = lad;
        v.ladderText = /\.{2,}\s*$/.test(m[1]) ? m[1].replace(/\s+/g, '').replace(/-?\.{2,}$/, '-…') : null;
        continue;
      }
    }
    // 6 Reps x 6 Sets · 3+1 Reps x 3 Sets @~70% · 8 Reps (Each Leg) x 4 Sets · 4 Sets x 2 Reps
    const noParen = line.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
    m = noParen.match(RE.repsXsets);
    const mr = !m && noParen.match(RE.setsXreps);
    if (m || mr) {
      const [repsS, setsS, rest] = m ? [m[1], m[2], m[3]] : [mr[2], mr[1], mr[3]];
      const reps = repsS.split('+').map(x => +x.trim());
      const s = { reps, sets: +setsS, intensity: rest.trim() };
      if (!cur().repsXsets) v.repsXsets = { ...s, reps: reps[0] };
      v.schemes.push(s);
      continue;
    }
    // Box: 24/20in · Box: 20in → 박스 높이
    m = line.match(/^box\s*[:\-]\s*(\d+)(?:\s*\/\s*(\d+))?\s*(?:in|"|inch)?$/i);
    if (m) {
      cur().boxRaw = pair(m[1], m[2]);
      continue;
    }
    m = line.match(RE.loadLine) || line.match(/^(db|kb|bb|barbell|ball|wb)\s*[:\-]\s*(\d+(?:\.\d+)?)(?:\s*\/\s*(\d+(?:\.\d+)?))?\s*(kg|lb|#)?(?:\s*x\s*\d)?$/i);
    if (m && m.length === 4 && (m[2] != null || m[3])) {
      cur().loadRaw = { v: pair(m[1], m[2]), u: m[3] || '' };
      continue;
    }
    if (m && m.length === 5) {
      const eq = { db: 'db', kb: 'kb', bb: 'bb', barbell: 'bb', ball: 'ball', wb: 'ball' }[m[1].toLowerCase()];
      cur().loadRaw = { v: pair(m[2], m[3]), u: m[4] || '', equip: eq };
      continue;
    }
    if (/^[*※]/.test(line)) {
      // *BB Complex: 다음 줄이 별표 없이 구성 동작을 적는 경우를 위해 complexName 유지
      cur().notes.push(bare);
      continue;
    }
    if (pendingChain) {
      chainNext();
      pendingChain = false;
    }
    // BB Complex 95/65 · Cardio · Machine · 16 Gymnastic: 구성은 아래 *BB Complex: 줄에서 채움 (없으면 운동 선택 대기)
    m = line.match(/^(\d+)?\s*((?:bb|db|kb|barbell)?\s*(?:complex|cardio|machine|gymnastics?))\b(?!\s*[:)])\s*(.*)$/i);
    if (m) {
      const it = { key: null, name: titleCase(m[2]).replace(/^Bb\b/, 'BB').replace(/^Db\b/, 'DB').replace(/^Kb\b/, 'KB'), label: '', variant: '', raw: line, unit: 'reps', qty: [m[1] ? +m[1] : null], load: null, loadSrc: null, implements: 1, sync: false, boxIn: null };
      if (cur().scheme && it.qty[0] == null) {
        it.pattern = [...v.scheme];
        if (v.ladderText) it.ladder = v.ladderText;
      }
      v.items.push(it);
      continue;
    }
    const items = parseItemLine(complexName && !/complex/.test(complexName) ? line.split(/\s*,\s*/)[0] : line, cur(), ctx);
    if (roundAlt && items.length && roundPrefix) {
      // Round 1,3,5,7) A / Round 2,4,6,8) B → B는 A의 대체 동작
      roundAlt.alt = items[0];
      roundAlt = null;
      continue;
    }
    roundAlt = null;
    if (complexName && items.length) {
      const ci = v.items.findIndex(it => !it.key && it.name.toLowerCase().includes(complexName));
      if (ci >= 0 && !/complex/.test(complexName)) {
        // Cardio · Machine · Gymnastic 자리에 실제 동작 (자리표시 횟수가 있으면 그 횟수)
        const c = v.items[ci];
        const out = { ...items[0] };
        if (c.qty[0] != null) out.qty = [...c.qty];
        if (c.pattern) out.pattern = [...c.pattern];
        if (c.ladder) out.ladder = c.ladder;
        if (slot) out.slot = slot;
        v.items.splice(ci, 1, out);
        if (roundPrefix) roundAlt = out;
        complexName = null;
        continue;
      }
      // BB Complex 95/65 (이름만 있는 줄)을 구성 동작으로 바꿔 끼움: 각 동작 = 컴플렉스 횟수 × 동작 횟수
      if (ci >= 0) {
        const c = v.items[ci];
        const parts = items.map(it => {
          const k = pick(it.qty) ?? 1;
          const out = { ...it, qty: c.qty.map(q => (q == null ? null : q * k)) };
          if (c.pattern) out.pattern = c.pattern.map(x => (x == null ? null : x * k));
          if (c.ladder) out.ladder = c.ladder;
          if (!out.load && c.load) { out.load = c.load; out.loadSrc = c.loadSrc; }
          else if (!out.load && BY_KEY[out.key]?.equip) {
            const t = c.raw.match(/(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s*(kg|lb)?\s*$/i);
            if (t) {
              const u = t[3] || ctx.units[BY_KEY[out.key].equip] || 'lb';
              out.load = [toKg(+t[1], u), toKg(+t[2], u)];
              out.loadSrc = `${t[1]}/${t[2]} ${isLb(u) ? 'lb' : 'kg'}`;
            }
          }
          return out;
        });
        v.items.splice(ci, 1, ...parts);
        complexName = null;
        continue;
      }
      complexName = null;
    }
    if (items.length) {
      for (const it of items) {
        if (slot) it.slot = slot;
        if (nextMax && it.qty[0] == null) it.max = true;
      }
      nextMax = false;
      v.items.push(...items);
    } else v.notes.push(line);
  }
  close();
  day.sections = day.sections.filter(s => s.versions.length);
  splitLiftingSections(day);
  // CrossFit · Lifting 처럼 수업이 둘 이상인 날만 섹션 제목에 수업 이름을 붙임
  const multi = new Set(day.sections.map(s => s.group)).size > 1;
  for (const s of day.sections) {
    if (multi && s.group) s.title = [s.group, s.title].filter(Boolean).join(' · ');
    delete s.group;
  }
  return { ...day, versions: day.sections.flatMap(s => s.versions) };
}

// 리프팅 구간에서 한 섹션에 Strength 버전이 여럿이면 레벨이 아니라 순서대로 하는 세트 묶음 → 섹션을 나눔
function splitLiftingSections(day) {
  const out = [];
  for (const s of day.sections) {
    if (s.versions.length > 1 && s.versions.every(v => v.kind === 'strength')) {
      s.versions.forEach((v, i) => out.push({ ...s, title: [s.title, `${i + 1}`].filter(Boolean).join(' · '), versions: [v] }));
    } else out.push(s);
  }
  day.sections = out;
}

// ───────────────────────── 파싱 결과 → 기록용 블록 (내 몫으로 환산)
// 팀 Alternating 이면 내 차례 라운드만, Synchronized 운동은 모든 라운드
function resolveItem(it, b, side) {
  const R = b.rounds || 1;
  const base = pick(it.qty, side);
  let per = it.pattern ? it.pattern.map(x => (x == null ? base ?? 0 : x)) : Array(R).fill(base ?? 0);
  // 20 Alternating Rounds + 1-2-..-10: 사다리 한 칸을 팀원이 차례로 한 번씩
  if (b.team > 1 && b.alternating && it.pattern && per.length * b.team === R) per = per.flatMap(x => Array(b.team).fill(x));
  if (b.team > 1 && b.alternating && !it.sync) per = per.filter((_, r) => r % b.team === 0);
  const qty = per.reduce((a, c) => a + c, 0);
  return {
    key: it.key,
    name: it.name,
    label: it.label || '',
    variant: it.variant || '',
    unit: it.unit,
    qty: qty || base,
    perRound: per.length > 1 ? per : null,
    rxQty: it.qty,
    load: pick(it.load, side),
    rxLoad: it.load,
    loadSrc: it.loadSrc || null,
    implements: it.implements ?? 1,
    sync: !!it.sync,
    boxIn: pick(it.boxIn, side),
    alt: it.alt ? resolveItem(it.alt, { ...b, rounds: per.length || 1, team: null }, side) : null,
    ...(it.max ? { max: true } : {}),
    ...(it.ladder ? { ladder: it.ladder } : {}),
    ...(it.durSec ? { durSec: it.durSec } : {}),
  };
}

export function resolveBlocks(version, side = 'max') {
  return version.blocks.map(b => ({
    format: b.format,
    emom: !!b.emom,
    capSec: b.capSec,
    rounds: b.rounds || 1,
    team: b.team || null,
    alternating: !!b.alternating,
    restAfterSec: b.restAfterSec || null,
    restInsideSec: b.restInsideSec || null,
    repeat: !!b.repeat,
    items: b.items.map(it => {
      const r = resolveItem(it, b, side);
      // 열린 사다리 AMRAP: 사다리 아닌 동작은 라운드당 횟수로 표시
      if (!r.ladder && b.items.some(x => x.ladder)) r.perRoundQty = pick(it.qty, side);
      return r;
    }),
    result: {},
  }));
}

// 운동 개수가 여러 개면 컴플렉스
export function resolveStrength(version, side = 'max') {
  const items = version.items.map(it => ({
    key: it.key,
    name: it.name,
    label: it.label || '',
    variant: it.variant || '',
    unit: it.unit,
    reps: pick(it.qty, side),
    load: pick(it.load, side),
  }));
  const single = items.length === 1;
  return {
    sets: version.sets,
    intensity: version.intensity || '',
    intervalSec: version.intervalSec || null,
    items,
    setResults: Array.from({ length: version.sets }, () => ({ load: single ? items[0].load ?? null : null, reps: single ? items[0].reps : 1 })),
  };
}
