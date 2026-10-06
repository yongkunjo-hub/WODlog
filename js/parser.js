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
// 단위 없는 무게는 장비별 기본 단위로 해석 (기본: 모두 lb). 내부 저장은 kg.

import { matchMovement, BY_KEY, normalizeName, singular } from './movements.js';

export const DEFAULT_UNITS = { bb: 'lb', ball: 'lb', db: 'lb', kb: 'lb', other: 'lb' };
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
  capHeader: /^(\d{1,2}):(\d{2})\s*[x×*]\s*(\d+)$/i,
  every: /^every\s+(\d{1,2})(?::(\d{2}))?\s*(?:min(?:ute)?s?)?\s*(?:for|x|×)\s*(\d+)\s*(rounds?|sets?|min(?:ute)?s?)?/i,
  emomLong: /^every\s+minute\s+on\s+the\s+minute\s+for\s+(\d+)\s*min/i,
  amrap: /^(?:amrap\s*(?:in\s*)?(\d+)|(\d+)\s*(?:min(?:ute)?s?|분|')?\s*amrap)\b/i,
  amrapLong: /as\s+many\s+(?:rounds|reps)[^0-9]*?in\s+(\d+)\s*min/i,
  emom: /^(?:emom\s*(\d+)|(\d+)\s*(?:min(?:ute)?s?|분|')?\s*emom)\b/i,
  forTime: /^(?:(\d+)\s*rounds?\s*)?for\s*time\b/i,
  schemeHeader: /^(\d+(?:\s*-\s*\d+)+)\s*reps?\b/i,
  team: /^team\s*of\s*(\d+)/i,
  sets: /^(\d+)\s*sets?\b\s*[,:]?\s*(.*)$/i,
  rounds: /^(\d+)\s*rounds?\s*(?:of)?\s*:?$/i,
  alternating: /^alternating\s*(\d+)\s*rounds?/i,
  timecap: /(?:time\s*)?cap\s*[:\-]?\s*(\d{1,2})(?::(\d{2}))?\s*(?:min(?:ute)?s?)?\s*(each)?/i,
  capAlt: /^(\d+)\s*min(?:ute)?s?\s*time\s*cap/i,
  rest: /^[-–(\s]*rest\s+(\d{1,3})(?::(\d{2}))?/i,
  restAlt: /^(\d+)\s*min(?:ute)?s?\s*rest\b/i,
  then: /^then\b[\s,:]*(.*)$/i,
  scheme: /^\d+(?:\s*-\s*\d+)+$/,
  schemePrefix: /^(\d+(?:\s*-\s*\d+)+)\s+(.+)$/,
  delta: /^([-+])\s*(\d+)\s+(.+)$/,
  repsXsets: /^(\d+)\s*reps?\s*[x×]\s*(\d+)\s*sets?$/i,
  target: /^(targets?|goals?|목표)\s*:?$/i,
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
const MODIFIERS = /\b(scaled|easy|strict|synchroni[sz]ed|sync|pause at knee|paused|tempo|unbroken|light|alternating|lateral|freestanding|free standing|weighted|seated)\b/gi;

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
function normLine(line) {
  return line
    .replace(/[‐‑‒–]/g, '-')
    .replace(/\b(?:pounds?|lbs?)\b\.?/gi, 'lb')
    .replace(/(\d)\s*-\s*(lb|kg|cal|calorie|calories|meter|meters|metre|metres|m|km|foot|feet|ft|yard|yards|yd|mile|miles|in|inch|minute|minutes|min)\b/gi, '$1 $2')
    .replace(/\bmetres?\b/gi, 'meter')
    .replace(/\binch(es)?\b/gi, 'in')
    .replace(/\bdumbbells?\b/gi, 'DB')
    .replace(/\bkettlebells?\b/gi, 'KB')
    .replace(/^(?:buy[- ]?in|cash[- ]?out)\s*:\s*/i, '')
    .trim();
}

// ───────────────────────── 운동 한 개
function parseSingle(text, ctx, inheritQty = null) {
  let s = text.trim();
  let qty = null;
  let unitRaw = '';

  let repDistM = null;
  const rd = s.match(RE.repDist);
  if (rd) {
    repDistM = +rd[1] * (DIST[rd[2].toLowerCase()] ?? 1);
    s = s.replace(RE.repDist, ' ').trim();
  }
  // (arm 1) (each arm) 같은 설명 괄호 제거, 끝의 숫자 괄호는 풀기: (24/20 in) → 24/20 in
  s = s.replace(/\((?:arm|each|per|alternating|right|left)[^)]*\)/gi, ' ').replace(/\((\d[^)]*)\)\s*$/, ' $1').replace(/\s+/g, ' ').trim();

  const m = s.match(RE_MOVE);
  if (m && /[a-z가-힣]/i.test(m[4])) {
    qty = pair(m[1], m[2]);
    unitRaw = (m[3] || '').toLowerCase();
    s = m[4].trim();
  } else if (inheritQty) {
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

  const sync = /\bsync(hroni[sz]ed)?\b/i.test(s);
  const variant = (s.match(MODIFIERS) || []).filter(w => !/^sync/i.test(w)).map(w => w[0].toUpperCase() + w.slice(1).toLowerCase()).join(' ');
  const core = s.replace(MODIFIERS, ' ').replace(/\s+/g, ' ').trim();
  const key = (hint && matchMovement(`${hint} ${core}`, ctx.aliases)) || matchMovement(core, ctx.aliases) || matchMovement(s, ctx.aliases);
  if (!key && !qty) return null;
  if (!key && unit === 'reps' && !/[a-z가-힣]/i.test(s)) return null;
  const def = key ? BY_KEY[key] : null;
  if (def?.kind === 'erg' && unit === 'reps') unit = 'cal';
  if (['run', 'carry', 'drag', 'none'].includes(def?.kind) && def.unit === 'm' && unit === 'reps') unit = 'm';

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
  const norm = x => singular(normalizeName(x)).split(' ').filter(w => !['pull', 'up', 'shot', 'the', 'a'].includes(w)).join(' ');
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
  };
}

// ───────────────────────── 운동 줄 (렙 스킴 접두, ±증감, 2 x (a + b), 대체 <->, 묶음 +)
function parseItemLine(line, v, ctx) {
  let s = line;
  let pattern = null;
  let delta = 0;
  let m = s.match(RE.schemePrefix);
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
    return it;
  };

  m = s.match(RE.multiplier);
  if (m) {
    const k = +m[1];
    return m[2].split(/\s+\+\s+/).map(p => parseSingle(p, ctx)).filter(Boolean)
      .map(it => ({ ...it, qty: it.qty.map(q => (q == null ? null : q * k)) }));
  }

  const alts = s.split(/\s*(?:<->|↔|<=>)\s*/);
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
    scheme: null, repsXsets: null, loadRaw: null, gender: {}, items: [], targets: [], notes: [],
    chain: false, prevRest: null, restAfter: null,
  };
}

// 버전을 시작/수정하는 헤더 줄이면 패치 객체를 반환
function headerOf(line) {
  let m = line.match(RE.capHeader);
  if (m) {
    const sec = mmss(m[1], m[2]);
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
  m = line.match(RE.amrap) || line.match(RE.amrapLong);
  if (m) return { format: 'amrap', capSec: (+(m[1] || m[2])) * 60 };
  m = line.match(RE.emom);
  if (m) return { format: 'emom', capSec: (+(m[1] || m[2])) * 60 };
  m = line.match(RE.forTime);
  if (m) {
    const p = { format: 'fortime' };
    if (m[1]) p.rounds = +m[1];
    const cap = line.match(RE.timecap);
    if (cap) p.capSec = mmss(cap[1], cap[2]);
    return p;
  }
  m = line.match(RE.schemeHeader);
  if (m && /reps?\s*(for\s*time|of|:|$)/i.test(line)) return { format: 'fortime', scheme: m[1].split('-').map(x => +x.trim()) };
  m = line.match(RE.team);
  if (m) return { team: +m[1] };
  m = line.match(RE.alternating);
  if (m) return { alternating: true, rounds: +m[1] };
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
  if (v.format === 'amrap') p.push(`AMRAP ${v.capSec / 60}`);
  else if (v.format === 'emom') p.push(`EMOM ${v.capSec / 60}`);
  else if (v.intervalSec && v.blockCount > 1) p.push(`${fmt(v.intervalSec)} × ${v.blockCount}${v.capEach && v.capSec !== v.intervalSec ? ` (캡 ${fmt(v.capSec)})` : ''}`);
  else p.push('For Time');
  if (v.sets > 1) p.push(`${v.sets} Sets`);
  if (v.alternating) p.push(`Alternating ${v.rounds}R`);
  else if (v.rounds > 1) p.push(`${v.rounds} Rounds`);
  if (v.scheme) p.push(v.scheme.join('-'));
  if (v.restSec) p.push(`휴식 ${fmt(v.restSec)}`);
  if (v.capSec && v.format === 'fortime' && !v.intervalSec) p.push(`캡 ${fmt(v.capSec)}`);
  return p.join(' · ');
}

function finalize(v, ctx) {
  if (v.repsXsets) {
    v.items.forEach(it => { if (it.qty[0] == null) it.qty = [v.repsXsets.reps]; });
    v.sets = v.sets || v.repsXsets.sets;
  }
  // 버전 공통 무게: "22.5/15" 줄 또는 Men/Women 줄 → 무게 없는 기구 운동에 적용
  const g = v.gender;
  const common = v.loadRaw || (g.m || g.w ? { v: [g.m?.v ?? g.w.v, g.w?.v ?? g.m.v], u: g.m?.u || g.w?.u || '' } : null);
  for (const it of v.items) {
    const equip = it.key && BY_KEY[it.key].equip;
    if (!it.load && equip && common) {
      const u = common.u || ctx.units[equip] || 'lb';
      it.load = common.v.map(x => toKg(x, u));
      it.loadSrc = `${common.v.join('/')} ${isLb(u) ? 'lb' : 'kg'}`;
    }
  }
  const load = common ? common.v.map(x => toKg(x, common.u || ctx.units.db || 'lb')) : null;
  const base = { targets: v.targets, notes: v.notes, load, loadSrc: common ? `${common.v.join('/')} ${isLb(common.u || ctx.units.db) ? 'lb' : 'kg'}` : null };

  if (v.repsXsets || (v.sets && !v.format)) {
    const kind = 'strength';
    return { kind, title: describe(v, kind), sets: v.sets || v.blockCount || 1, intensity: v.intensity, intervalSec: v.intervalSec, items: v.items, ...base };
  }

  const format = v.format === 'amrap' || v.format === 'emom' ? 'amrap' : 'fortime';
  const rounds = v.format === 'emom' ? 1 : v.rounds || v.scheme?.length || 1;
  const mk = (items, extra = {}) => ({
    format, emom: v.format === 'emom', capSec: v.capSec, rounds,
    team: v.team, alternating: v.alternating, restAfterSec: null, repeat: false, items, ...extra,
  });

  let blocks;
  if (v.intervalSec && v.blockCount > 1) {
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
  return { kind: 'metcon', title: describe(v, 'metcon'), format, capSec: v.capSec, blockCount: blocks.length, repeat: blocks[0].repeat, blocks, ...base };
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
  last.title = `${last.title.replace(/ · 캡 \d+:\d+$/, '')}${rest ? ` → 휴식 ${fmt(rest)}` : ''} → ${fin.title.replace(/^For Time · /, '')}`;
  if (a.capSec && !/캡/.test(last.title)) last.title += ` · 캡 ${fmt(a.capSec)}`;
  last.targets.push(...fin.targets);
  last.notes.push(...fin.notes);
}

// ───────────────────────── 하루
export function parseWod(text, { aliases = {}, units = {} } = {}) {
  const ctx = { aliases, units: { ...DEFAULT_UNITS, ...units } };
  const lines = text.split(/\r?\n/).map(normLine).filter(Boolean);
  const day = { date: null, notes: [], sections: [] };
  let sec = null;
  let v = null;
  let mode = 'items';
  let pendingChain = false;

  const section = () => {
    if (!sec) {
      sec = { label: '', title: '', versions: [] };
      day.sections.push(sec);
    }
    return sec;
  };
  const close = () => {
    if (v && (v.items.length || v.targets.length)) {
      const fin = finalize(v, ctx);
      const last = section().versions.at(-1);
      if (v.chain && last?.kind === 'metcon' && fin.kind === 'metcon' && last.blocks.length === 1 && fin.blocks.length === 1) mergeChain(last, fin, v.prevRest);
      else section().versions.push(fin);
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
  const cur = () => (v ||= newVersion());

  for (let line of lines) {
    let m = line.match(RE.date);
    if (m && !day.date) {
      const y = m[1].length === 2 ? 2000 + +m[1] : +m[1];
      if (+m[2] >= 1 && +m[2] <= 12 && +m[3] >= 1 && +m[3] <= 31) {
        day.date = `${y}-${m[2]}-${m[3]}`;
        continue;
      }
    }
    // 수업 시간표·공지 (영문 운동명이 없는 한글 공지 줄)
    if (RE.classTime.test(line) || (RE.notice.test(line) && !/[a-z]{3,}/i.test(line))) {
      day.notes.push(line);
      continue;
    }
    m = line.match(RE.section);
    if (m) {
      close();
      sec = { label: m[1].toUpperCase(), title: '', versions: [] };
      day.sections.push(sec);
      continue;
    }
    m = line.match(RE.part);
    if (m) {
      close();
      const title = `Part ${m[1].toUpperCase()}`;
      if (sec && !sec.versions.length && !sec.title) sec.title = title;
      else {
        sec = { label: sec?.label || '', title, versions: [] };
        day.sections.push(sec);
      }
      continue;
    }
    if (RE.target.test(line)) {
      cur();
      mode = 'targets';
      continue;
    }

    // 쉬는 시간: 세트 사이(b/t sets) / 라운드 사이(메모) / 구간 사이(다음 구간과 이어짐)
    m = line.match(RE.rest) || line.match(RE.restAlt);
    if (m) {
      const secs = /sec|초/i.test(line) && !m[2] ? +m[1] : mmss(m[1], m[2]);
      if (/b\/t\s*sets?|between\s*sets?/i.test(line) || (v?.sets && !v.items.length)) cur().restSec = secs;
      else if (/round/i.test(line)) cur().notes.push(line);
      else if (v?.items.length) {
        v.restAfter = secs;
        pendingChain = true;
      } else cur().restSec = secs;
      continue;
    }
    m = line.match(RE.then);
    if (m) {
      if (v?.items.length) chainNext();
      pendingChain = false;
      if (!m[1]) continue;
      line = m[1];
    }

    const hdr = headerOf(line);
    if (hdr) {
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

    m = (/^\(?\s*(time\s*)?cap\b/i.test(line) && line.match(RE.timecap)) || line.match(RE.capAlt);
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
      continue;
    }
    m = line.match(RE.repsXsets);
    if (m) {
      cur().repsXsets = { reps: +m[1], sets: +m[2] };
      continue;
    }
    m = line.match(RE.loadLine);
    if (m && (m[2] != null || m[3])) {
      cur().loadRaw = { v: pair(m[1], m[2]), u: m[3] || '' };
      continue;
    }
    if (/^[*※]/.test(line)) {
      cur().notes.push(line.replace(/^[*※]\s*/, ''));
      continue;
    }
    if (pendingChain) {
      chainNext();
      pendingChain = false;
    }
    const items = parseItemLine(line, cur(), ctx);
    if (items.length) v.items.push(...items);
    else v.notes.push(line);
  }
  close();
  return { ...day, versions: day.sections.flatMap(s => s.versions) };
}

// ───────────────────────── 파싱 결과 → 기록용 블록 (내 몫으로 환산)
// 팀 Alternating 이면 내 차례 라운드만, Synchronized 운동은 모든 라운드
function resolveItem(it, b, side) {
  const R = b.rounds || 1;
  const base = pick(it.qty, side);
  let per = it.pattern ? it.pattern.map(x => (x == null ? base ?? 0 : x)) : Array(R).fill(base ?? 0);
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
    items: b.items.map(it => resolveItem(it, b, side)),
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
