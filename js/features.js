// 기능 로직 (화면과 분리, 단위 테스트 대상)
// 출석 스트릭 · 1RM 보드 · % 무게/원판 계산 · PR 감지 · 벤치마크 점수 · 근육 부위

import { BY_KEY } from './movements.js';
import { strengthSummary, e1rm, workoutStats, fmtTime } from './metrics.js';

export const LB = 0.45359237;
const pad = n => String(n).padStart(2, '0');
export const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const addDays = (date, n) => {
  const d = new Date(date + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return ymd(d);
};
// 주 시작 = 월요일
export const weekStart = date => {
  const d = new Date(date + 'T00:00:00');
  return addDays(date, -((d.getDay() + 6) % 7));
};

// ───────────────────────── 출석
// 이번 주 7칸 + 목표 달성 연속 주 수 (이번 주는 달성했을 때만 포함)
export function weekProgress(workouts, goal, today) {
  const days = new Set(workouts.map(w => w.date));
  const ws = weekStart(today);
  const week = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(ws, i);
    return { date, done: days.has(date), today: date === today, future: date > today };
  });
  const count = week.filter(x => x.done).length;
  const countIn = start => [...days].filter(d => d >= start && d < addDays(start, 7)).length;
  let streak = count >= goal ? 1 : 0;
  for (let s = addDays(ws, -7); countIn(s) >= goal; s = addDays(s, -7)) streak++;
  return { week, count, goal, streak };
}

// ───────────────────────── 1RM 보드
export const LIFTS = ['back_squat', 'front_squat', 'overhead_squat', 'deadlift', 'clean', 'clean_and_jerk', 'snatch', 'shoulder_to_overhead', 'bench_press', 'thruster'];
export const GYM_MAX = ['pull_up', 'chest_to_bar', 'toes_to_bar', 'hspu', 'bar_muscle_up', 'ring_muscle_up', 'double_under'];

// Strength 기록(단일 동작)의 세트별 e1RM 최고값
export function autoMaxes(workouts) {
  const auto = {};
  for (const w of workouts) {
    if (w.kind !== 'strength') continue;
    const items = w.strength?.items || [];
    if (items.length !== 1 || !items[0].key) continue;
    const k = items[0].key;
    for (const s of w.strength.setResults || []) {
      if (!s.load) continue;
      const v = e1rm(s.load, s.reps || 1);
      if (!auto[k] || v > auto[k].e1rm) auto[k] = { e1rm: v, date: w.date, load: s.load, reps: s.reps || 1 };
    }
  }
  return auto;
}

// 1RM = 직접 입력(실측)과 기록 추정치 중 큰 값. 3RM/5RM 은 입력값이 없으면 1RM 에서 역산(Epley)
export function liftBoard(workouts, manual = {}) {
  const auto = autoMaxes(workouts);
  const keys = [...new Set([...LIFTS, ...Object.keys(auto), ...Object.keys(manual)])].filter(k => BY_KEY[k]);
  return keys.map(key => {
    const m = manual[key] || {};
    const a = auto[key] || null;
    let oneRM = null;
    let source = null;
    if (m.rm1 != null && (!a || m.rm1 >= a.e1rm)) { oneRM = m.rm1; source = 'manual'; }
    else if (a) { oneRM = a.e1rm; source = m.rm1 != null ? 'auto-up' : 'auto'; }
    const fromOne = r => (oneRM ? oneRM / (1 + r / 30) : null);
    return { key, name: BY_KEY[key].name, oneRM, source, auto: a, manual: m, rm3: m.rm3 ?? fromOne(3), rm5: m.rm5 ?? fromOne(5) };
  });
}

// ───────────────────────── % 무게 · 원판
// "@ 50-70%", "Building to 80%", "70%" → [50, 70] / [80] / [70]
export function parsePercents(text = '') {
  let m = text.match(/(\d{2,3})\s*(?:-|~|–|to)\s*(\d{2,3})\s*%/i);
  if (m) return [+m[1], +m[2]];
  m = text.match(/(\d{2,3})\s*%/);
  return m ? [+m[1]] : null;
}
export const roundTo = (x, step) => Math.round(x / step) * step;
// 한쪽에 끼울 원판 (lb). 바 45 lb, 원판 45/35/25/15/10/5/2.5
export function plates(totalLb, bar = 45, set = [45, 35, 25, 15, 10, 5, 2.5]) {
  let side = (totalLb - bar) / 2;
  if (side < 0) return null;
  const out = [];
  for (const p of set) {
    while (side >= p - 1e-9) {
      out.push(p);
      side -= p;
    }
  }
  return { perSide: out, rest: Math.round(side * 100) / 100 };
}
// 1RM(kg) 의 퍼센트 표 → lb 기준 5 lb 단위 반올림
export function percentTable(oneRMkg, pcts = [50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100]) {
  return pcts.map(p => {
    const lb = roundTo((oneRMkg / LB) * (p / 100), 5);
    return { pct: p, lb, kg: lb * LB, plates: plates(lb) };
  });
}

// ───────────────────────── 벤치마크 점수
export function resultText(b) {
  const r = b.result || {};
  if (b.format === 'amrap') return r.rounds != null || r.reps != null ? `${r.rounds || 0}R+${r.reps || 0}` : '-';
  if (r.capped) return r.repsDone != null ? `CAP ${r.repsDone}` : 'CAP';
  return r.timeSec ? fmtTime(r.timeSec) : '-';
}
// For Time 은 시간(짧을수록 좋음, 캡은 완주보다 뒤), AMRAP·EMOM 은 총 수행량(많을수록 좋음)
export function scoreOf(w) {
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
  if (bs.some(b => b.result?.capped)) {
    const reps = bs.reduce((s, b) => s + (b.result?.capped ? b.result.repsDone || 0 : b.items.reduce((a, it) => a + (it.qty || 0), 0)), 0);
    return { better: 'low', value: 1e7 - reps, text: `CAP ${reps}회` };
  }
  const t = bs.reduce((s, b) => s + (b.result?.timeSec || 0), 0);
  return { better: 'low', value: t || Infinity, text: t ? fmtTime(t) : '-' };
}
export const cmpScore = (a, b) => {
  const sa = scoreOf(a);
  const sb = scoreOf(b);
  return sa.better === 'high' ? sb.value - sa.value : sa.value - sb.value;
};
export const bestOf = ws => (ws.length ? [...ws].sort(cmpScore)[0] : null);

// ───────────────────────── 같은 동작이 나온 기록 (비교용)
export const workoutKeys = w => [...new Set((w.kind === 'strength' ? w.strength?.items || [] : (w.blocks || []).flatMap(b => b.items || [])).map(i => i.key).filter(Boolean))];

// 그 기록에서 해당 동작을 한 양: 총 횟수(내 몫)·최고 무게
export function moveUse(w, key) {
  if (w.kind === 'strength') {
    if (!w.strength?.items?.some(i => i.key === key)) return null;
    const sets = w.strength.setResults || [];
    return { unit: 'reps', qty: sets.reduce((a, s) => a + (s.reps || 0), 0), load: Math.max(0, ...sets.map(s => s.load || 0)) || null, sets: sets.length };
  }
  let qty = 0;
  let load = null;
  let unit = 'reps';
  let found = false;
  for (const b of w.blocks || []) for (const it of b.items || []) {
    if (it.key !== key) continue;
    found = true;
    qty += it.qty || 0;
    unit = it.unit || unit;
    if (it.load) load = Math.max(load || 0, it.load);
  }
  return found ? { unit, qty, load } : null;
}

// 겹치는 동작이 많은 순 → (같은 종류: 메트콘/스트렝스) → 그 기록에서 겹친 비율 → 최근 순
export function similarRecords(keys, workouts, { excludeId = null, before = null, kind = null, limit = 5 } = {}) {
  const want = new Set(keys.filter(Boolean));
  if (!want.size) return [];
  return workouts
    .filter(w => w.id !== excludeId && (!before || w.date <= before))
    .map(w => {
      const ks = workoutKeys(w);
      const shared = ks.filter(k => want.has(k));
      return { w, shared, ratio: ks.length ? shared.length / ks.length : 0, same: !kind || (w.kind === 'strength') === (kind === 'strength') };
    })
    .filter(x => x.shared.length)
    .sort((a, b) => b.shared.length - a.shared.length || b.same - a.same || b.ratio - a.ratio || b.w.date.localeCompare(a.w.date) || (b.w.createdAt || 0) - (a.w.createdAt || 0))
    .slice(0, limit);
}

// ───────────────────────── PR 감지 (저장 직전 기록 w 를 이전 기록들과 비교)
// 반환: [{ kind: 'load'|'e1rm'|'complex'|'bench'|'power', name, value, prev, text }]
export function detectPRs(w, history, body, fmtLoad = kg => `${Math.round(kg / LB)} lb`) {
  const prev = history.filter(h => h.id !== w.id);
  const prs = [];
  if (w.kind === 'strength') {
    const ss = strengthSummary(w);
    if (!ss) return prs;
    const before = prev.filter(h => h.kind === 'strength').map(strengthSummary).filter(s => s && s.id === ss.id);
    if (!before.length) return prs;
    const best = Math.max(...before.map(s => s.value));
    if (ss.value > best + 0.01) {
      prs.push({ kind: ss.single ? 'e1rm' : 'complex', name: ss.label, value: ss.value, prev: best, text: `${ss.single ? 'e1RM' : '최고'} ${fmtLoad(ss.value)} (이전 ${fmtLoad(best)})` });
    }
    return prs;
  }
  // 기구 운동 최고 무게
  const maxLoad = {};
  for (const h of prev) {
    for (const b of h.blocks || []) for (const it of b.items) if (it.key && it.load) maxLoad[it.key] = Math.max(maxLoad[it.key] || 0, it.load);
  }
  const seen = new Set();
  for (const b of w.blocks || []) {
    for (const it of b.items) {
      if (!it.key || !it.load || seen.has(it.key) || !BY_KEY[it.key].equip) continue;
      seen.add(it.key);
      const p = maxLoad[it.key];
      if (p && it.load > p + 0.01) prs.push({ kind: 'load', name: it.label || it.name, value: it.load, prev: p, text: `최고 무게 ${fmtLoad(it.load)} (이전 ${fmtLoad(p)})` });
    }
  }
  // 벤치마크
  if (w.benchmark) {
    const same = prev.filter(h => h.benchmark === w.benchmark);
    const best = bestOf(same);
    if (best && cmpScore(w, best) < 0) prs.push({ kind: 'bench', name: w.title?.split(' · ')[0] || w.benchmark, text: `${scoreOf(w).text} (이전 ${scoreOf(best).text})` });
  }
  // 최고 평균 파워 (메트콘 기록 3개 이상일 때)
  const p = workoutStats(w, body).powerW;
  const powers = prev.filter(h => h.kind !== 'strength').map(h => workoutStats(h, body).powerW).filter(x => x != null);
  if (p != null && powers.length >= 3 && p > Math.max(...powers)) prs.push({ kind: 'power', name: '평균 파워', value: p, text: `${Math.round(p)} W (이전 ${Math.round(Math.max(...powers))} W)` });
  return prs;
}

// ───────────────────────── 카페 WOD 암호화 (공개 저장소에 회원 전용 글을 그대로 두지 않기 위해)
// 형식: { v: 1, iter, salt, iv, ct } (base64). 키 = PBKDF2-SHA256(암호, salt, iter) → AES-GCM 256
// PC 동기화 도구(sync/cafe_sync.py 의 ENC_JS)와 같은 방식
const b64 = u8 => btoa(Array.from(u8, c => String.fromCharCode(c)).join(''));
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
async function deriveKey(pass, salt, iter, usage) {
  const km = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' }, km, { name: 'AES-GCM', length: 256 }, false, [usage]);
}
export async function encryptJSON(obj, pass, iter = 200000) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(pass, salt, iter, 'encrypt');
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(obj))));
  return { v: 1, iter, salt: b64(salt), iv: b64(iv), ct: b64(ct) };
}
// 암호가 틀리면 OperationError
export async function decryptJSON(enc, pass) {
  const key = await deriveKey(pass, unb64(enc.salt), enc.iter, 'decrypt');
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(enc.iv) }, key, unb64(enc.ct));
  return JSON.parse(new TextDecoder().decode(pt));
}

// ───────────────────────── 근육 부위 (컨디션 근육통 → 와드 경고)
export const REGIONS = { lower: '하체', upper: '상체', core: '코어', grip: '그립' };
const R = {
  lower: ['back_squat', 'front_squat', 'overhead_squat', 'air_squat', 'goblet_squat', 'pistol', 'thruster', 'db_thruster', 'wall_ball', 'deadlift', 'db_deadlift', 'sdhp', 'clean', 'hang_clean', 'clean_and_jerk', 'snatch', 'hang_snatch', 'db_clean', 'db_hang_clean', 'db_snatch', 'ground_to_overhead', 'db_front_lunge', 'db_walking_lunge', 'overhead_lunge', 'box_jump', 'burpee_box_jump_over', 'step_up', 'db_box_step_over', 'kb_swing', 'run', 'bike_erg', 'echo_bike', 'row', 'sled_push', 'sled_pull', 'yoke_carry', 'bag_carry', 'burpee', 'bar_facing_burpee', 'burpee_pull_up', 'double_under', 'single_under', 'devil_press', 'db_hang_clean_and_jerk'],
  upper: ['pull_up', 'chest_to_bar', 'bar_muscle_up', 'ring_muscle_up', 'hspu', 'push_up', 'ring_dip', 'shoulder_to_overhead', 'db_shoulder_to_overhead', 'bench_press', 'thruster', 'db_thruster', 'rope_climb', 'pegboard', 'wall_walk', 'devil_press', 'ski_erg', 'burpee_pull_up', 'clean_and_jerk', 'snatch', 'db_snatch', 'ground_to_overhead', 'handstand_walk', 'sled_pull', 'db_hang_clean_and_jerk'],
  core: ['toes_to_bar', 'knees_to_elbow', 'knee_to_chest', 'sit_up', 'ghd_sit_up', 'kip_swing', 'wall_walk', 'overhead_squat', 'overhead_lunge', 'handstand_walk'],
  grip: ['pull_up', 'chest_to_bar', 'toes_to_bar', 'knees_to_elbow', 'knee_to_chest', 'kip_swing', 'bar_muscle_up', 'ring_muscle_up', 'rope_climb', 'pegboard', 'deadlift', 'db_deadlift', 'kb_swing', 'farmer_carry', 'bag_carry', 'row', 'burpee_pull_up', 'sdhp'],
};
// 와드가 근육통 부위를 얼마나 쓰는지: [{ region, label, moves: [운동명] }]
export function soreHits(items, sore = []) {
  return sore.map(r => ({
    region: r,
    label: REGIONS[r],
    moves: [...new Set(items.filter(it => it.key && R[r]?.includes(it.key)).map(it => it.label || it.name))],
  })).filter(h => h.moves.length);
}
