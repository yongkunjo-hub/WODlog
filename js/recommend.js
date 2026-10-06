// 레벨 추천
//
// ① 출발점: 최근 3회 중 주로 한 레벨 (기록이 없으면 설정의 평소 레벨)
// ② 자동조절(APRE 방식): 최근 3회 RPE·완주 여부로 한 단계 올리거나 내림
// ③ 안전장치: 예상 완료시간이 캡을 넘거나, 처방 무게가 내 최고 기록의 125%를 넘으면 한 단계씩 내림
//    (올릴 때는 위 레벨 예상이 캡의 92% 이내여야 함)
//    - 예상 시간: 블록 시간 T ≈ Σ 수행단위 × 사전페이스 × 무게보정 × r(운동별 내 배율) + 전환시간
//    - r 은 사전값 1 쪽으로 당기는 릿지 회귀로 추정 (기록이 적으면 사전값, 쌓일수록 내 페이스)
//    - 최근 기록일수록 가중치↑ (90일 스케일)
// ④ 부하 경고: 최근 7일 sRPE 부하 ÷ 28일 주평균 > 1.3 이면 경고만 표시 (ACWR 은 논란이 있어 강제하지 않음)
// 캡이 넉넉한 박스는 시간보다 RPE 가 레벨을 결정하므로 ①②를 주 기준으로, 시간은 ③에만 쓴다

import { BY_KEY, REF_LOAD, TRANSITION_SEC, priorPace } from './movements.js';
import { workPerUnit, unitsDone } from './metrics.js';
import { pick, resolveBlocks } from './parser.js';
import { soreHits } from './features.js';

const DAY = 86400000;
const RECENCY_DAYS = 90;
const LAMBDA = 1.5; // 사전값의 무게 (블록 기록 약 1.5개 분량)
export const BAND = { easy: 0.75, ok: 0.92, cap: 1.0 };

const dayOf = d => Date.parse(d + 'T00:00:00Z') / DAY;
const vid = it => `${it.key}:${it.unit}`;
const bodyOf = (w, def) => ({ weight: w.bodyweight || def.weight, height: w.height || def.height });

// 무거울수록 느려짐: 1회 일량 비율의 제곱근
function loadFactor(it, body) {
  const def = BY_KEY[it.key];
  if (!def || def.kind !== 'load' || !def.equip || !it.load || !REF_LOAD[def.equip]) return 1;
  const w = workPerUnit(it, body);
  const ref = workPerUnit({ ...it, load: REF_LOAD[def.equip] }, body);
  return w && ref ? Math.sqrt(w / ref) : 1;
}

function baseSec(it, body) {
  const p = it.key ? priorPace(it.key, it.unit) : null;
  return p == null ? null : p * loadFactor(it, body);
}

// 블록 결과 → 운동별 실제 수행 단위와 걸린 시간
export function observed(block) {
  const items = block.items || [];
  const r = block.result || {};
  const qty = items.map(it => it.qty || 0);
  const walk = n => unitsDone(items, Math.max(n, 0));
  if (block.format === 'amrap') {
    if ((r.rounds == null && r.reps == null) || !block.capSec) return null;
    const part = walk(r.reps || 0);
    return { units: qty.map((q, i) => (r.rounds || 0) * q + part[i]), T: block.capSec };
  }
  if (r.capped) {
    if (r.repsDone == null || !block.capSec) return null;
    return { units: walk(r.repsDone), T: block.capSec, capped: true };
  }
  if (r.timeSec) return { units: qty, T: r.timeSec };
  return null;
}

function solve(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

export function fitPaces(workouts, defBody, now = Date.now()) {
  const rows = [];
  for (const w of workouts) {
    const body = bodyOf(w, defBody);
    const weight = Math.exp(-Math.max(0, now / DAY - dayOf(w.date)) / RECENCY_DAYS);
    for (const b of w.blocks || []) {
      const o = observed(b);
      if (!o || o.T <= 0) continue;
      const z = new Map();
      let ok = true;
      b.items.forEach((it, i) => {
        if (!o.units[i]) return;
        const s = baseSec(it, body);
        if (s == null) { ok = false; return; }
        z.set(vid(it), (z.get(vid(it)) || 0) + o.units[i] * s);
      });
      // 팀 Alternating 은 내가 일한 시간만 (전체 ÷ 인원)
      const T = b.team > 1 && b.alternating ? o.T / b.team : o.T;
      // 전환 시간은 고정값으로 빼고 운동 시간만 회귀에 사용
      const transitions = o.units.filter(u => u > 0).length * Math.max(1, b.items[0]?.perRound?.length || 1);
      const work = Math.max(T - transitions * TRANSITION_SEC, T * 0.5);
      if (ok && z.size) rows.push({ z, T: work, weight });
    }
  }
  const vars = [...new Set(rows.flatMap(r => [...r.z.keys()]))];
  const ix = new Map(vars.map((v, i) => [v, i]));
  const n = vars.length;
  const A = Array.from({ length: n }, () => Array(n).fill(0));
  const bv = Array(n).fill(0);
  const count = Array(n).fill(0);
  const sq = Array(n).fill(0);
  for (const r of rows) {
    const a = [...r.z].map(([v, s]) => [ix.get(v), s / r.T]);
    for (const [i, ai] of a) {
      bv[i] += r.weight * ai;
      count[i]++;
      sq[i] += ai * ai;
      for (const [j, aj] of a) A[i][j] += r.weight * ai * aj;
    }
  }
  // 계층형 축소: 먼저 선수 전체 배율 g(모든 운동 공통)를 구하고, 운동별 r 은 g 쪽으로 당긴다.
  // 매번 같은 구성의 WOD 만 하면 운동별로 나눌 근거가 없으므로 전부 g 에 가깝게 남고,
  // 구성이 다양해질수록 운동별 차이가 드러난다. g 자체는 사전값 1 쪽으로 당긴다.
  let gs = 0;
  let gss = 0;
  for (const r of rows) {
    const s = [...r.z.values()].reduce((t, v) => t + v, 0) / r.T;
    gs += r.weight * s;
    gss += r.weight * s * s;
  }
  const lam0 = rows.length ? LAMBDA * (gss / rows.reduce((t, r) => t + r.weight, 0)) : 0;
  const g = rows.length ? (gs + lam0) / (gss + lam0) : 1;
  // 사전값 페널티를 각 운동의 평균 계수 크기로 정규화 → LAMBDA = "블록 기록 몇 개 분량의 믿음"
  for (let i = 0; i < n; i++) {
    const lam = LAMBDA * (sq[i] / count[i]);
    A[i][i] += lam;
    bv[i] += lam * g;
  }
  const sol = n ? solve(A, bv) : [];
  const ratio = new Map();
  const nObs = new Map();
  vars.forEach((v, i) => {
    ratio.set(v, Math.min(5, Math.max(0.3, sol[i])));
    nObs.set(v, count[i]);
  });
  return { ratio, nObs, blocks: rows.length, overall: g };
}

export function predict(items, fit, body) {
  let sec = 0;
  let minObs = Infinity;
  const unknown = [];
  for (const it of items) {
    const s = baseSec(it, body);
    if (s == null) { unknown.push(it.name); continue; }
    // 처음 하는 운동은 내 전체 배율(overall)로 추정
    sec += (it.qty || 0) * s * (fit.ratio.get(vid(it)) ?? fit.overall ?? 1) + (it.qty ? TRANSITION_SEC * (it.perRound?.length || 1) : 0);
    minObs = Math.min(minObs, fit.nObs.get(vid(it)) || 0);
  }
  return { sec, unknown, minObs: minObs === Infinity ? 0 : minObs };
}

function statusOf(r) {
  if (r == null) return null;
  if (r <= BAND.easy) return 'easy';
  if (r <= BAND.ok) return 'ok';
  if (r <= BAND.cap) return 'tight';
  return 'cap';
}

// 최근 세션 1회 평가: +1 여유, -1 과부하, 0 적정
export function sessionScore(w) {
  if (!w.rpe) return 0;
  const capped = (w.blocks || []).some(b => b.result?.capped);
  const ratios = (w.blocks || []).map(b => (b.result?.timeSec && b.capSec ? b.result.timeSec / b.capSec : null)).filter(x => x != null);
  const easyFinish = !capped && ratios.length > 0 && Math.max(...ratios) <= 0.85;
  const tg = w.targets?.length ? w.targets.filter(t => t.done).length / w.targets.length : 1;
  if (capped || w.rpe >= 9) return -1;
  if (w.rpe <= 7 && easyFinish && tg >= 0.5) return 1;
  return 0;
}

function sessionLoad(w) {
  if (!w.rpe) return 0;
  const min = (w.blocks || []).reduce((s, b) => s + (observed(b)?.T || 0), 0) / 60;
  return w.rpe * min;
}

const fmt = sec => {
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export function recommend({ versions, workouts, levels, side = 'max', body, defaultLevel = null, now = Date.now(), fmtLoad = kg => `${+(+kg).toFixed(1)}kg`, condition = null }) {
  const fit = fitPaces(workouts, body, now);

  // 내가 실제로 수행해본 최고 무게
  const maxLoad = new Map();
  for (const w of workouts) {
    for (const b of w.blocks || []) {
      const o = observed(b);
      if (!o) continue;
      b.items.forEach((it, i) => {
        if (it.key && it.load && o.units[i] > 0) maxLoad.set(it.key, Math.max(maxLoad.get(it.key) || 0, it.load));
      });
    }
  }

  const per = versions.map((v, idx) => {
    const blocks = (v.kind === 'strength' ? [] : resolveBlocks(v, side)).map(b => {
      const p = predict(b.items, fit, body);
      // 팀 Alternating: 파트너가 하는 동안 쉬므로 전체 시간 ≈ 내 시간 × 인원
      if (b.team > 1 && b.alternating) p.sec *= b.team;
      return { ...p, cap: b.capSec, ratio: b.capSec && p.sec ? p.sec / b.capSec : null };
    });
    const ratios = blocks.map(b => b.ratio).filter(x => x != null);
    const maxRatio = ratios.length ? Math.max(...ratios) : null;
    const flags = new Map();
    for (const b of v.blocks || []) {
      for (const it of b.items) {
        const load = pick(it.load, side);
        if (!it.key || !load || flags.has(it.key)) continue;
        const m = maxLoad.get(it.key);
        if (m == null) flags.set(it.key, { name: it.name, load, kind: 'new' });
        else if (load > m * 1.1) flags.set(it.key, { name: it.name, load, max: m, jump: load / m, kind: 'over' });
      }
    }
    return {
      idx,
      level: levels[idx] || `레벨 ${idx + 1}`,
      blocks,
      maxRatio,
      status: statusOf(maxRatio),
      loadFlags: [...flags.values()],
      unknown: [...new Set(blocks.flatMap(b => b.unknown))],
      minObs: blocks.length ? Math.min(...blocks.map(b => b.minObs)) : 0,
    };
  });
  if (!per.length || versions.some(v => v.kind === 'strength')) return null;

  const reasons = [];
  const n = per.length;
  const bigJump = p => p.loadFlags.some(f => f.kind === 'over' && f.jump > 1.25);
  const predText = p => `예상 ${p.blocks.map(b => fmt(b.sec)).join(' · ')}`;
  // 내려야 하는 경우: 캡 초과 예상, 또는 무게 급증
  const blockedWhy = p => {
    const over = p.loadFlags.find(f => f.kind === 'over' && f.jump > 1.25);
    if (over) return `${over.name} ${fmtLoad(over.load)}은 최고 기록(${fmtLoad(over.max)})보다 25% 넘게 무겁습니다`;
    if (p.maxRatio != null && p.maxRatio > BAND.cap) return `${predText(p)}로 캡 위험입니다`;
    return null;
  };
  // 올릴 수 없는 경우: 위 조건 + 캡의 92% 초과(빠듯)
  const noUpWhy = p => blockedWhy(p) || (p.maxRatio != null && p.maxRatio > BAND.ok ? `${predText(p)}로 빠듯합니다` : null);

  // 출발점: 최근 3회 중 가장 많이 한 레벨 (동률이면 최근), 기록이 없으면 평소 레벨
  const lv = w => levels.indexOf(w.level);
  const recentLv = workouts.filter(w => lv(w) >= 0).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 3);
  let rec;
  if (recentLv.length) {
    const cnt = new Map();
    recentLv.forEach(w => cnt.set(lv(w), (cnt.get(lv(w)) || 0) + 1));
    rec = recentLv.map(lv).sort((a, b) => cnt.get(b) - cnt.get(a))[0];
    reasons.push(`최근 주로 수행한 레벨은 ${levels[rec]}입니다`);
  } else {
    const d = levels.indexOf(defaultLevel);
    rec = d >= 0 ? d : Math.floor(n / 2);
    reasons.push(`기록이 없어 평소 레벨(${levels[rec]}) 기준으로 추천합니다`);
  }
  rec = Math.min(rec, n - 1);

  // ② 자동조절
  const recent = workouts.filter(w => w.rpe).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 3);
  const score = recent.reduce((s, w) => s + sessionScore(w), 0);
  if (recent.length >= 2) {
    if (score >= 2 && rec > 0 && !noUpWhy(per[rec - 1])) {
      rec -= 1;
      reasons.push(`최근 ${recent.length}회 여유 있게 완주했습니다 (RPE 7 이하) → 한 단계 올렸습니다`);
    } else if (score <= -2 && rec < n - 1) {
      rec += 1;
      reasons.push(`최근 ${recent.length}회 중 타임캡 또는 RPE 9 이상이 많았습니다 → 한 단계 낮췄습니다`);
    } else if (score >= 2 && rec > 0) {
      reasons.push(`최근 여유가 있었지만 ${per[rec - 1].level}는 ${noUpWhy(per[rec - 1])}`);
    }
  }

  // 오늘 컨디션이 낮으면(1~2/5) 한 단계 보수적으로
  if (condition?.feel != null && condition.feel <= 2 && rec < n - 1) {
    rec += 1;
    reasons.push(`오늘 컨디션이 낮습니다 (${condition.feel}/5) → 한 단계 낮췄습니다`);
  }

  // 안전장치: 캡 위험이거나 무게가 급격히 늘면 한 단계씩 내림
  while (rec < n - 1 && blockedWhy(per[rec])) {
    reasons.push(`${per[rec].level}: ${blockedWhy(per[rec])} → 한 단계 낮췄습니다`);
    rec += 1;
  }

  const r = per[rec];
  if (r.blocks.some(b => b.ratio != null)) {
    reasons.unshift('예상 완료 ' + r.blocks.map((b, i) => `B${i + 1} ${fmt(b.sec)}`).join(' · ') + (r.blocks[0].cap ? ` (캡 ${fmt(r.blocks[0].cap)})` : ''));
  }
  if (r.status === 'tight') reasons.push('예상 시간이 캡에 가깝습니다. 초반 페이스를 아껴 주세요');
  const newMoves = [...new Set(versions[rec].blocks.flatMap(b => b.items).filter(it => it.key && !fit.nObs.get(vid({ key: it.key, unit: it.unit }))).map(it => it.name))];
  if (newMoves.length && fit.blocks) reasons.push(`처음 기록하는 동작: ${newMoves.join(', ')}`);
  for (const f of r.loadFlags) {
    reasons.push(f.kind === 'new' ? `${f.name} ${fmtLoad(f.load)}은 첫 기록입니다` : `${f.name} ${fmtLoad(f.load)}은 최고 기록(${fmtLoad(f.max)})보다 무겁습니다`);
  }
  if (r.unknown.length) reasons.push(`페이스를 모르는 운동은 예상시간에서 빠졌습니다: ${r.unknown.join(', ')}`);

  // ③ 부하 경고
  let warning = null;
  const today = now / DAY;
  const inDays = (w, d) => today - dayOf(w.date) < d && today - dayOf(w.date) >= 0;
  const withRpe = workouts.filter(w => w.rpe);
  const oldest = withRpe.filter(w => inDays(w, 28)).reduce((m, w) => Math.max(m, today - dayOf(w.date)), 0);
  if (oldest >= 21) {
    const acute = withRpe.filter(w => inDays(w, 7)).reduce((s, w) => s + sessionLoad(w), 0);
    const chronic = withRpe.filter(w => inDays(w, 28)).reduce((s, w) => s + sessionLoad(w), 0) / 4;
    if (chronic > 0 && acute / chronic > 1.3) {
      warning = `최근 7일 부하가 4주 평균의 ${(acute / chronic).toFixed(1)}배입니다. 한 단계 낮추는 것도 고려해 보세요`;
    }
  }

  let confidence;
  if (!fit.blocks) confidence = { level: 'low', text: '기록이 없어 일반 중급자 기준으로 추정했습니다' };
  else if (r.minObs >= 3) confidence = { level: 'high', text: '운동별 기록이 충분합니다' };
  else if (r.minObs >= 1) confidence = { level: 'mid', text: '일부 운동은 기록이 1~2회뿐입니다' };
  else confidence = { level: 'low', text: '처음 하는 운동이 있어 일반 기준으로 추정했습니다' };

  // 근육통 부위를 쓰는 동작 경고
  const sore = soreHits(versions[rec].blocks.flatMap(b => b.items), condition?.sore || []);
  const soreWarning = sore.length ? sore.map(h => `${h.label} 근육통: ${h.moves.join(', ')}`).join(' / ') : null;

  return { rec, per, reasons, warning, soreWarning, confidence, fit };
}
