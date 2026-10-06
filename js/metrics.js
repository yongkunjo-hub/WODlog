// 일량·파워·성장지수 계산
// 저장된 워크아웃의 item: { key, name, unit, qty, load, implements }
// block.result:
//   fortime 완주   { timeSec }
//   fortime 타임캡 { capped: true, repsDone }
//   amrap          { rounds, reps }

import { BY_KEY, G, J_PER_CAL, J_PER_KG_M, CARRY_J_PER_KG_M, SLED_MU } from './movements.js';

// 1회(1cal, 1m)당 일량(J). 계산할 수 없으면 null
export function workPerUnit(item, body) {
  const def = item.key && BY_KEY[item.key];
  if (!def) return null;
  const h = body.height / 100;
  const bwKg = body.weight;
  switch (def.kind) {
    case 'erg':
      if (item.unit === 'cal') return J_PER_CAL;
      if (item.unit === 'm') return def.jPerM;
      return null;
    case 'run':
      return item.unit === 'm' ? bwKg * J_PER_KG_M : null;
    case 'carry':
      return item.unit === 'm' ? (bwKg + (item.load || 0) * (item.implements ?? def.implements ?? 1)) * CARRY_J_PER_KG_M : null;
    case 'drag':
      return item.unit === 'm' && item.load ? item.load * SLED_MU * G : null;
    case 'load': {
      if (item.unit !== 'reps') return null;
      const implKg = def.equip ? (item.load || 0) * (item.implements ?? def.implements ?? 1) : 0;
      const implRom = def.romM ?? (def.rom || 0) * h;
      const bodyKg = (def.bw || 0) * bwKg;
      const bodyRom = item.boxIn ? item.boxIn * 0.0254 : def.bwRomM ?? (def.bwRom ?? def.rom ?? 0) * h;
      return (implKg * implRom + bodyKg * bodyRom) * G;
    }
    default:
      return null;
  }
}

// 앞에서부터 n 단위(회·cal·m)만큼 수행했을 때 운동별 수행량 (라운드 순서대로)
export function unitsDone(items, n) {
  const pr = items.map(it => (it.perRound?.length ? it.perRound : [it.qty || 0]));
  const R = Math.max(0, ...pr.map(p => p.length));
  const out = items.map(() => 0);
  let left = n;
  for (let r = 0; r < R && left > 0; r++) {
    for (let i = 0; i < items.length && left > 0; i++) {
      const take = Math.min(pr[i][r] || 0, left);
      out[i] += take;
      left -= take;
    }
  }
  return out;
}

function workForUnits(items, wpus, n) {
  return unitsDone(items, n).reduce((s, u, i) => s + u * (wpus[i] || 0), 0);
}

export function blockStats(block, body) {
  const items = block.items || [];
  const wpus = items.map(it => workPerUnit(it, body));
  const excluded = items.filter((it, i) => wpus[i] == null).map(it => it.name);
  const roundWork = items.reduce((s, it, i) => s + (it.qty || 0) * (wpus[i] || 0), 0);
  const r = block.result || {};
  let workJ = null;
  let timeSec = null;

  if (block.format === 'amrap') {
    if (r.rounds != null || r.reps != null) {
      workJ = (r.rounds || 0) * roundWork + workForUnits(items, wpus, r.reps || 0);
      timeSec = block.capSec;
    }
  } else if (r.capped) {
    if (r.repsDone != null) {
      workJ = workForUnits(items, wpus, r.repsDone);
      timeSec = block.capSec;
    }
  } else if (r.timeSec) {
    workJ = roundWork;
    timeSec = r.timeSec;
  }

  const powerW = workJ != null && timeSec ? workJ / timeSec : null;
  return { roundWork, workJ, timeSec, powerW, excluded };
}

export function workoutStats(w, fallbackBody) {
  const body = { weight: w.bodyweight || fallbackBody.weight, height: w.height || fallbackBody.height };
  const blocks = (w.blocks || []).map(b => blockStats(b, body));
  const done = blocks.filter(b => b.powerW != null);
  const workJ = done.reduce((s, b) => s + b.workJ, 0);
  const timeSec = done.reduce((s, b) => s + b.timeSec, 0);
  return {
    blocks,
    workJ: done.length ? workJ : null,
    timeSec: done.length ? timeSec : null,
    powerW: done.length && timeSec ? workJ / timeSec : null,
    excluded: [...new Set(blocks.flatMap(b => b.excluded))],
  };
}

// 성장지수: 첫 기록부터 28일 평균 = 100, 마지막 기록 기준 최근 28일 평균과 비교
export function growthIndex(points, windowDays = 28) {
  const pts = points.filter(p => p.value != null).sort((a, b) => a.date.localeCompare(b.date));
  if (pts.length < 2) return null;
  const day = d => Date.parse(d + 'T00:00:00Z') / 86400000;
  const first = day(pts[0].date);
  const last = day(pts[pts.length - 1].date);
  const avg = arr => arr.reduce((s, p) => s + p.value, 0) / arr.length;
  const base = pts.filter(p => day(p.date) - first < windowDays);
  const recent = pts.filter(p => last - day(p.date) < windowDays);
  const baseline = avg(base);
  const current = avg(recent);
  return { baseline, current, index: (current / baseline) * 100, baseCount: base.length, recentCount: recent.length };
}

// 장기 추세: value = a + b·ln(1 + 경과일)  (Steele 외 2022 의 선형-로그 성장 모델 형태)
// 기록 4개 이상, 기간 21일 이상일 때만 계산
export function logTrend(points) {
  const pts = points.filter(p => p.value != null).sort((a, b) => a.date.localeCompare(b.date));
  if (pts.length < 4) return null;
  const day = d => Date.parse(d + 'T00:00:00Z') / 86400000;
  const d0 = day(pts[0].date);
  const tLast = day(pts[pts.length - 1].date) - d0;
  if (tLast < 21) return null;
  const xs = pts.map(p => Math.log(1 + day(p.date) - d0));
  const ys = pts.map(p => p.value);
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let sxy = 0;
  let sxx = 0;
  xs.forEach((x, i) => { sxy += (x - mx) * (ys[i] - my); sxx += (x - mx) ** 2; });
  if (!sxx) return null;
  const b = sxy / sxx;
  const a = my - b * mx;
  const at = date => a + b * Math.log(1 + day(date) - d0);
  const current = at(pts[pts.length - 1].date);
  const perMonth = (b / (1 + tLast)) * 30; // 현재 시점의 기울기 (월 단위)
  const pct = current ? (perMonth / current) * 100 : 0;
  const phase = pct >= 1 ? 'growing' : pct >= 0 ? 'plateau' : 'declining';
  return { a, b, at, current, perMonth, pct, phase };
}

// Strength 기록 요약: 단일 운동이면 세트별 e1RM 최고값, 컴플렉스면 최고 무게
export function strengthSummary(w) {
  const sets = (w.strength?.setResults || []).filter(s => s.load > 0);
  const items = w.strength?.items || [];
  if (!sets.length || !items.length) return null;
  const single = items.length === 1;
  const top = Math.max(...sets.map(s => s.load));
  const best = single ? Math.max(...sets.map(s => e1rm(s.load, s.reps || 1) || 0)) : null;
  const id = single ? items[0].key || items[0].name : 'cx:' + items.map(i => i.key || i.name).join('+');
  const label = items.map(i => i.label || i.name).join(' + ');
  return { id, label, single, top, e1rm: best, value: single ? best : top };
}

// 추정 1RM (Epley). 1회면 그대로
export function e1rm(load, reps) {
  if (!load || !reps) return null;
  return reps === 1 ? load : load * (1 + reps / 30);
}

// "9:30" "930" "9.30" "570s" → 초
export function parseTime(s) {
  if (s == null) return null;
  s = String(s).trim();
  if (!s) return null;
  let m = s.match(/^(\d{1,3})[:.](\d{1,2})$/);
  if (m) return (+m[1]) * 60 + (+m[2]);
  m = s.match(/^(\d+)s$/i);
  if (m) return +m[1];
  m = s.match(/^\d{3,4}$/);
  if (m) return Math.floor(+s / 100) * 60 + (+s % 100);
  m = s.match(/^\d{1,2}$/);
  if (m) return (+s) * 60;
  return null;
}

export function fmtTime(sec) {
  if (sec == null) return '-';
  const t = Math.round(sec);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}
