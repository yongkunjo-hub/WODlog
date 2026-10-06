import { parseWod, pick, resolveBlocks, resolveStrength } from './parser.js';
import { BY_KEY, priorPace } from './movements.js';
import { workoutStats, parseTime, fmtTime, growthIndex, logTrend, strengthSummary, e1rm } from './metrics.js';
import { recommend, fitPaces } from './recommend.js';
import { BENCHMARKS, BENCH_BY_ID, BENCH_CATS, detectBenchmark } from './benchmarks.js';
import { weekProgress, liftBoard, GYM_MAX, parsePercents, percentTable, plates, resultText, scoreOf, bestOf, detectPRs, REGIONS, addDays, weekStart } from './features.js';
import { shareCard } from './share.js';
import * as db from './db.js';
import { lineChart } from './chart.js';
import {
  S, APP_VERSION, loadSettings, saveSetting, $, view, esc, today, uid, body, kJ, watt, numStr, toNum, WEEK, dateLabel, dateLong,
  UNIT_LABEL, badge, isStrength, dispName, secLabel, secChip, LU, showLoad, readLoad, loadText, CHEV, haptic, paint, resetPaint,
  stepper, qtyStep, loadStep, openSheet, openPanel, askConfirm, movementSheetItems, toast, sw,
} from './ui.js';

// ───────────────────────── 표시 도우미
// 라운드 구성 힌트: 21-15-9 / 21×3 / 내 몫 7R / 2구간
function perRoundHint(it, b) {
  const pr = it.perRound;
  if (!pr?.length) return '';
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
const fmtLabel = b => `${b.emom ? 'EMOM' : b.format === 'amrap' ? 'AMRAP' : 'For Time'}${b.capSec ? ` · 캡 ${numStr(b.capSec / 60)}분` : ''}`;
const workoutName = w => (isStrength(w)
  ? w.strength.items.map(i => i.label || i.name).join(' + ')
  : w.benchmark ? BENCH_BY_ID[w.benchmark]?.name : [...new Set(w.blocks.flatMap(b => b.items.map(i => i.label || i.name)))].slice(0, 3).join(' · ')) || 'WOD';

// 기록 한 줄 (오늘·기록 탭 공용)
function recordRow(w) {
  const dt = new Date(w.date + 'T00:00:00');
  const dateTile = `<div class="li-date"><b>${dt.getDate()}</b><span>${WEEK[dt.getDay()]}</span></div>`;
  const prMark = w.prs?.length ? '<span class="pr-dot" title="PR">PR</span>' : '';
  if (isStrength(w)) {
    const ss = strengthSummary(w);
    return `
      <a class="li" href="#/w/${w.id}">${dateTile}
        <div class="li-body">
          <div class="li-title"><span class="t">${esc(workoutName(w))}</span>${prMark}</div>
          <div class="li-sub">${[w.section, 'Strength', w.title].filter(Boolean).map(esc).join(' · ')}</div>
        </div>
        ${ss
          ? `<div class="li-val">${loadText(ss.single ? ss.e1rm : ss.top)}<small>${ss.single ? 'e1RM' : '최고'}</small></div>`
          : `<div class="li-val">${w.strength.setResults.length}세트<small>${w.strength.setResults.reduce((a, r) => a + (r.reps || 0), 0)}회</small></div>`}
      </a>`;
  }
  const st = workoutStats(w, body(w.date));
  const res = w.blocks.map((b, i) => `${w.blocks.length > 1 ? (w.repeat ? `${i + 1}회 ` : `B${i + 1} `) : ''}${resultText(b)}`).join(' · ');
  return `
    <a class="li" href="#/w/${w.id}">${dateTile}
      <div class="li-body">
        <div class="li-title">${badge(w.level)}<span class="t">${w.benchmark ? '🏆 ' : ''}${esc(workoutName(w))}</span>${prMark}</div>
        <div class="li-sub">${[w.section, res, w.rpe ? `RPE ${w.rpe}` : ''].filter(Boolean).map(esc).join(' · ')}</div>
      </div>
      <div class="li-val">${st.powerW != null ? Math.round(st.powerW) : '-'}<small>W</small></div>
    </a>`;
}

// ───────────────────────── 라우터
const routes = [
  [/^#\/?$/, renderToday],
  [/^#\/log$/, renderLog],
  [/^#\/new$/, renderNew],
  [/^#\/stats$/, renderStats],
  [/^#\/me$/, renderMe],
  [/^#\/m\/(.+)$/, renderMove],
  [/^#\/w\/(.+)$/, renderDetail],
  [/^#\/edit\/(.+)$/, renderEdit],
];
async function route() {
  const h = location.hash || '#/';
  for (const [re, fn] of routes) {
    const m = h.match(re);
    if (m) {
      document.querySelectorAll('nav a').forEach(a => a.classList.toggle('active', a.dataset.nav === (h.split('/')[1] || '')));
      resetPaint();
      await fn(...m.slice(1).map(decodeURIComponent));
      return;
    }
  }
  location.hash = '#/';
}
// 홈(#/)에서 연 화면이 많아 주소가 같으면 hashchange 가 없으므로 직접 다시 그림
function goHome() {
  if (['', '#', '#/'].includes(location.hash)) route();
  else location.hash = '#/';
}

// ───────────────────────── 오늘
const FEEL = { 1: '최악', 2: '피곤', 3: '보통', 4: '좋음', 5: '최고' };
let condOpen = null; // null = 자동(미입력이면 펼침)

function condHtml(t) {
  const c = S.conds[t] || {};
  const open = condOpen ?? !c.feel;
  if (!open) {
    const parts = [c.feel ? `컨디션 ${c.feel} ${FEEL[c.feel]}` : '', c.sore?.length ? `근육통 ${c.sore.map(r => REGIONS[r]).join('·')}` : '근육통 없음', c.weight ? `${numStr(c.weight)} kg` : ''].filter(Boolean);
    return `
      <div class="g-title"><span>오늘 컨디션</span></div>
      <div class="cells"><button class="cell" id="cond-edit"><span class="cell-main"><span class="cell-label">${esc(parts.join(' · '))}</span></span><span class="cell-value">수정</span>${CHEV}</button></div>`;
  }
  return `
    <div class="g-title"><span>오늘 컨디션</span>${c.feel ? '<button class="g-link" id="cond-close">완료</button>' : ''}</div>
    <div class="cells">
      <div class="cell col">
        <div class="feel">${[1, 2, 3, 4, 5].map(n => `<button type="button" data-feel="${n}" class="${c.feel === n ? 'on' : ''}"><b>${n}</b><span>${FEEL[n]}</span></button>`).join('')}</div>
      </div>
      <div class="cell col">
        <span class="cell-label small-label">근육통 부위</span>
        <div class="chips">${Object.entries(REGIONS).map(([k, l]) => `<button type="button" data-sore="${k}" class="${c.sore?.includes(k) ? 'on' : ''}">${l}</button>`).join('')}</div>
      </div>
      <div class="cell"><span class="cell-label">체중</span><span class="spacer"></span>${stepper('id="cw"', numStr(c.weight ?? S.weight), 0.5, 'kg', 'sm')}</div>
    </div>`;
}
function bindCond(t, rerender) {
  // 입력을 시작하면 '완료'를 누를 때까지 펼쳐 둔다
  const set = async patch => {
    condOpen = true;
    await saveSetting('conds', { ...S.conds, [t]: { ...S.conds[t], ...patch } });
    haptic();
  };
  view().querySelectorAll('[data-feel]').forEach(b => (b.onclick = async () => { await set({ feel: +b.dataset.feel }); rerender(); }));
  view().querySelectorAll('[data-sore]').forEach(b => (b.onclick = async () => {
    const cur = S.conds[t]?.sore || [];
    const k = b.dataset.sore;
    await set({ sore: cur.includes(k) ? cur.filter(x => x !== k) : [...cur, k] });
    rerender();
  }));
  const cw = $('#cw');
  if (cw) cw.onchange = async () => {
    const v = toNum(cw.value);
    if (!v) return;
    await set({ weight: v });
    await saveSetting('weight', v);
  };
  if ($('#cond-edit')) $('#cond-edit').onclick = () => { condOpen = true; rerender(); };
  if ($('#cond-close')) $('#cond-close').onclick = () => { condOpen = false; rerender(); };
}

function weekHtml(wp) {
  const msg = wp.count >= wp.goal ? '이번 주 목표 달성' : `목표까지 ${wp.goal - wp.count}회`;
  return `
    <div class="g-title"><span>이번 주</span><a class="g-link" href="#/log">달력</a></div>
    <div class="cells"><div class="cell col">
      <div class="week-row">${wp.week.map((d, i) => `<div class="wd ${d.done ? 'done' : ''} ${d.today ? 'today' : ''} ${d.future ? 'future' : ''}"><span>${'월화수목금토일'[i]}</span><i>${d.done ? '✓' : new Date(d.date + 'T00:00:00').getDate()}</i></div>`).join('')}</div>
      <div class="week-sum"><b>${wp.count}/${wp.goal}회</b><span>${msg}${wp.streak ? ` · ${wp.streak}주 연속 달성` : ''}</span></div>
    </div></div>`;
}

// 기록 대기 WOD 별 추천 레벨 (아직 안 고른 레벨 파트 기준)
async function planRecs(plans, ws) {
  const out = {};
  const hist = ws.filter(w => !isStrength(w));
  for (const pl of plans) {
    const p = parseWod(pl.raw, { aliases: S.aliases, units: S.units });
    const i = p.sections.findIndex((s, k) => s.versions.length > 1 && !pl.saved?.[k]);
    if (i < 0) continue;
    const r = recommend({ versions: p.sections[i].versions, workouts: hist.filter(w => w.date <= pl.date), levels: S.levels, side: S.side, body: body(pl.date), defaultLevel: S.baseLevel, now: Date.parse(pl.date + 'T12:00:00'), condition: S.conds[pl.date] });
    if (r) out[pl.id] = r.per[r.rec].level;
  }
  return out;
}

async function renderToday() {
  const t = today();
  const ws = await db.listWorkouts();
  const plans = await getPlans();
  const recs = await planRecs(plans, ws);
  const wp = weekProgress(ws, S.weeklyGoal, t);
  const prs = ws.filter(w => w.prs?.length).slice(0, 3).flatMap(w => w.prs.slice(0, 2).map(p => ({ ...p, w }))).slice(0, 4);
  paint(`
    <div class="large-head"><h1>오늘</h1><p>${dateLong(t)}</p></div>
    ${condHtml(t)}
    ${plans.length ? plansHtml(plans, recs) : `
      <div class="g-title"><span>오늘 WOD</span></div>
      <div class="cells">
        <a class="cell" href="#/new"><span class="cell-icon">＋</span><span class="cell-main"><span class="cell-label">WOD 붙여넣기</span><span class="cell-sub">박스 공지를 붙여넣어 두면 나중에 기록할 수 있어요</span></span>${CHEV}</a>
        <button class="cell" id="go-bench"><span class="cell-icon">🏆</span><span class="cell-main"><span class="cell-label">벤치마크</span><span class="cell-sub">Fran · Murph · Open · Games</span></span>${CHEV}</button>
      </div>`}
    ${weekHtml(wp)}
    ${prs.length ? `
      <div class="g-title"><span>최근 PR</span></div>
      <div class="cells">${prs.map(p => `<a class="cell" href="#/w/${p.w.id}"><span class="cell-icon gold">🏆</span><span class="cell-main"><span class="cell-label">${esc(p.name)}</span><span class="cell-sub">${esc(p.text)}</span></span><span class="cell-value">${dateLabel(p.w.date)}</span></a>`).join('')}</div>` : ''}
    ${ws.length ? `
      <div class="g-title"><span>최근 기록</span><a class="g-link" href="#/log">전체</a></div>
      <div class="card list-group">${ws.slice(0, 3).map(recordRow).join('')}</div>` : ''}`, 'tab', 'today');
  bindPlans(plans, renderToday);
  bindCond(t, renderToday);
  if ($('#go-bench')) $('#go-bench').onclick = () => renderBench();
}

// ───────────────────────── 기록 (달력 + 목록)
let calMonth = null;
let calDay = null;
async function renderLog() {
  const ws = await db.listWorkouts();
  const t = today();
  const m = calMonth || t.slice(0, 7);
  const [y, mo] = m.split('-').map(Number);
  const first = `${m}-01`;
  const lead = (new Date(first + 'T00:00:00').getDay() + 6) % 7;
  const days = new Date(y, mo, 0).getDate();
  const byDate = {};
  for (const w of ws) (byDate[w.date] ||= []).push(w);
  const monthWs = ws.filter(w => w.date.startsWith(m));
  const powers = monthWs.filter(w => !isStrength(w)).map(w => workoutStats(w, body(w.date)).powerW).filter(p => p != null);
  const avgP = powers.length ? powers.reduce((a, b) => a + b, 0) / powers.length : null;
  const activeDays = new Set(monthWs.map(w => w.date)).size;
  const list = calDay ? ws.filter(w => w.date === calDay) : monthWs;
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push('<span></span>');
  for (let d = 1; d <= days; d++) {
    const date = `${m}-${String(d).padStart(2, '0')}`;
    const n = byDate[date]?.length || 0;
    const pr = byDate[date]?.some(w => w.prs?.length);
    cells.push(`<button class="cd ${n ? 'has' : ''} ${date === t ? 'today' : ''} ${date === calDay ? 'sel' : ''}" data-d="${date}">${d}${n ? `<i class="${pr ? 'pr' : ''}"></i>` : ''}</button>`);
  }
  paint(`
    <h1>기록</h1>
    <div class="card cal">
      <div class="cal-head"><button class="icon" data-cal="-1" aria-label="이전 달">‹</button><b>${y}년 ${mo}월</b><button class="icon" data-cal="1" aria-label="다음 달">›</button></div>
      <div class="cal-grid">${'월화수목금토일'.split('').map(x => `<span class="wl">${x}</span>`).join('')}${cells.join('')}</div>
      <div class="cal-sum"><span><b>${activeDays}</b>일 운동</span><span><b>${monthWs.length}</b>개 기록</span><span>평균 <b>${avgP != null ? Math.round(avgP) : '-'}</b> W</span></div>
    </div>
    <div class="g-title"><span>${calDay ? dateLabel(calDay) : `${mo}월 기록`}</span>${calDay ? '<button class="g-link" id="all-month">월 전체</button>' : ''}</div>
    ${list.length ? `<div class="card list-group">${list.map(recordRow).join('')}</div>` : `<div class="card empty small-empty"><p class="muted">${calDay ? '이 날은 기록이 없어요' : '이 달은 기록이 없어요'}</p></div>`}`, 'tab', 'log');
  view().querySelectorAll('[data-cal]').forEach(b => (b.onclick = () => {
    const d = new Date(y, mo - 1 + +b.dataset.cal, 1);
    calMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    calDay = null;
    renderLog();
  }));
  view().querySelectorAll('[data-d]').forEach(b => (b.onclick = () => { calDay = calDay === b.dataset.d ? null : b.dataset.d; haptic(); renderLog(); }));
  if ($('#all-month')) $('#all-month').onclick = () => { calDay = null; renderLog(); };
}

// ───────────────────────── 입력 흐름
// 붙여넣기 → (섹션 여러 개면) 오늘의 WOD 목록 → (레벨 여러 개면) 레벨 선택 → 결과 입력 → 저장
let draft = null;
let day = null; // { date, notes, sections, raw, saved: Map(섹션 → 기록 id), drafts, planId }
let secIdx = 0;
let editing = false; // 저장된 기록 수정 중이면 기록 대기에 자동 저장하지 않음
let strengthBoard = []; // Strength 폼의 % 계산용 1RM 보드

// ───────────────────────── 기록 대기: 붙여넣은 WOD를 바로 보관하고 나중에 기록
const getPlans = async () => (await db.getSetting('plans', [])) || [];
async function putPlan(p) {
  const ps = await getPlans();
  const i = ps.findIndex(x => x.id === p.id);
  if (i >= 0) ps[i] = p;
  else ps.push(p);
  await db.setSetting('plans', ps);
}
async function deletePlan(id) {
  await db.setSetting('plans', (await getPlans()).filter(p => p.id !== id));
}
async function persistDay() {
  if (!day?.planId) return;
  await putPlan({ id: day.planId, date: day.date, raw: day.raw, benchmark: day.benchmark || null, saved: Object.fromEntries(day.saved), drafts: day.drafts || {}, createdAt: day.createdAt });
}
let persistTimer;
function persistDraft() {
  if (!day?.planId || !draft || editing) return;
  day.drafts ||= {};
  day.drafts[secIdx] = structuredClone(draft);
  clearTimeout(persistTimer);
  persistTimer = setTimeout(persistDay, 400);
}
function openPlan(plan) {
  const p = parseWod(plan.raw, { aliases: S.aliases, units: S.units });
  day = { ...p, date: plan.date, raw: plan.raw, benchmark: plan.benchmark, planId: plan.id, createdAt: plan.createdAt, saved: new Map(Object.entries(plan.saved || {}).map(([k, v]) => [+k, v])), drafts: plan.drafts || {} };
  resetPaint();
  if (day.sections.length === 1) openSection(0);
  else renderDay();
}
function planSummary(plan) {
  const p = parseWod(plan.raw, { aliases: S.aliases, units: S.units });
  const done = Object.keys(plan.saved || {}).length;
  const drafting = Object.keys(plan.drafts || {}).length;
  const title = plan.benchmark ? BENCH_BY_ID[plan.benchmark]?.name
    : p.sections.length > 1 ? p.sections.map(s => `${secLabel(s) || 'WOD'} ${s.versions[0].kind === 'strength' ? 'Strength' : 'Metcon'}`).join(' · ')
    : p.versions[0]?.title || 'WOD';
  const v = p.versions.find(x => x.kind === 'metcon') || p.versions[0];
  const moves = v ? [...new Set((v.kind === 'strength' ? v.items : v.blocks.flatMap(b => b.items)).map(i => i.label || i.name))].slice(0, 4).join(' · ') : '';
  const needLevel = p.sections.some((s, i) => s.versions.length > 1 && !plan.saved?.[i] && !plan.drafts?.[i]);
  const status = [p.sections.length > 1 ? `${done}/${p.sections.length} 기록` : '', drafting ? '작성 중' : '', needLevel ? '레벨 선택 전' : ''].filter(Boolean);
  return { title, moves, status };
}
function plansHtml(plans, recs = {}) {
  if (!plans.length) return '';
  return `
    <div class="g-title"><span>기록 대기 ${plans.length}</span></div>
    <div class="card list-group">${[...plans].sort((a, b) => b.date.localeCompare(a.date)).map(pl => {
      const s = planSummary(pl);
      const dt = new Date(pl.date + 'T00:00:00');
      return `
        <div class="li plan" data-plan="${pl.id}">
          <div class="li-date accent"><b>${dt.getDate()}</b><span>${WEEK[dt.getDay()]}</span></div>
          <div class="li-body">
            <div class="li-title"><span class="t">${esc(s.title)}</span></div>
            <div class="li-sub">${esc([...s.status, s.moves].filter(Boolean).join(' · '))}</div>
            ${recs[pl.id] ? `<div class="li-rec">추천 ${badge(recs[pl.id])}</div>` : ''}
          </div>
          <button class="icon" data-del-plan="${pl.id}" aria-label="삭제">✕</button>
        </div>`;
    }).join('')}</div>`;
}
function bindPlans(plans, rerender) {
  view().querySelectorAll('[data-plan]').forEach(el => (el.onclick = async e => {
    const del = e.target.closest('[data-del-plan]');
    if (del) {
      e.stopPropagation();
      if (!(await askConfirm('이 WOD를 기록 대기에서 지울까요?', '지우기'))) return;
      await deletePlan(del.dataset.delPlan);
      toast('지웠습니다');
      return rerender();
    }
    editing = false;
    openPlan(plans.find(p => p.id === el.dataset.plan));
  }));
}

async function renderNew() {
  draft = null;
  day = null;
  const plans = await getPlans();
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
    <div class="cells">
      <button class="cell" id="bench"><span class="cell-icon">🏆</span><span class="cell-main"><span class="cell-label">벤치마크에서 선택</span><span class="cell-sub">Girls · Hero · Open · Games ${BENCHMARKS.length}개</span></span>${CHEV}</button>
      <button class="cell" id="manual"><span class="cell-icon">✎</span><span class="cell-main"><span class="cell-label">원문 없이 직접 입력</span></span>${CHEV}</button>
    </div>
    ${plansHtml(plans)}`, 'tab', 'new');
  bindPlans(plans, renderNew);
  $('#bench').onclick = () => renderBench();
  $('#clip').onclick = async () => {
    try {
      $('#raw').value = await navigator.clipboard.readText();
    } catch {
      toast('클립보드 접근이 막혀 있어요. 입력칸을 길게 눌러 붙여넣어 주세요');
    }
  };
  $('#parse').onclick = async () => {
    const raw = $('#raw').value;
    const p = parseWod(raw, { aliases: S.aliases, units: S.units });
    if (!p.versions.length) return toast('운동을 찾지 못했습니다. 원문을 확인해 주세요');
    const same = (await getPlans()).find(pl => pl.raw.trim() === raw.trim());
    if (same) {
      toast('이미 저장된 WOD예요. 이어서 기록합니다');
      editing = false;
      return openPlan(same);
    }
    const typed = $('#date').value;
    const date = p.date && typed === today() ? p.date : typed || today();
    day = { ...p, date, raw, saved: new Map(), drafts: {}, benchmark: detectBenchmark(raw), planId: uid(), createdAt: Date.now() };
    editing = false;
    await persistDay();
    const notes = [p.date && date === p.date && p.date !== today() ? `${dateLabel(p.date)} WOD` : '', day.benchmark ? BENCH_BY_ID[day.benchmark].name : ''].filter(Boolean);
    toast(`${notes.length ? notes.join(' · ') + ' — ' : ''}저장했어요. 기록은 나중에 해도 돼요`);
    if (day.sections.length === 1) openSection(0);
    else renderDay();
  };
  $('#manual').onclick = () => {
    day = null;
    editing = false;
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
    <input id="q" class="search" placeholder="이름 또는 운동 검색 (예: Fran, thruster)" value="${esc(query)}">
    ${BENCH_CATS.map(cat => {
      const items = list.filter(b => b.cat === cat);
      if (!items.length) return '';
      return `<div class="g-title"><span>${cat}</span></div><div class="card list-group">` + items.map(b => {
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
            ${best ? `<div class="li-val">${esc(scoreOf(best).text)}<small>PR · ${tries.length}회</small></div>` : CHEV}
          </a>`;
      }).join('') + '</div>';
    }).join('')}
    ${list.length ? '' : '<p class="muted center">검색 결과가 없습니다</p>'}`, 'sub', 'bench');
  $('#back').onclick = () => history.length > 1 && location.hash === '#/new' ? renderNew() : goHome();
  const qi = $('#q');
  qi.oninput = () => { clearTimeout(qi.t); qi.t = setTimeout(() => renderBench(qi.value).then(() => { const n = $('#q'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }), 250); };
  view().querySelectorAll('.bcard').forEach(el => (el.onclick = () => {
    const b = BENCH_BY_ID[el.dataset.id];
    const p = parseWod(b.text, { aliases: S.aliases, units: S.units });
    day = { ...p, date: today(), raw: `${b.name}\n${b.text}`, saved: new Map(), benchmark: b.id, fromLibrary: true };
    openSection(0);
  }));
}

// ───────────────────────── 하루 WOD (파트 목록)
function renderDay() {
  paint(`
    <header class="bar"><button class="back" id="back">‹</button><h1>${dateLabel(day.date)} WOD</h1></header>
    ${day.notes.length ? `<p class="muted small" style="margin:0 8px 10px">${day.notes.map(esc).join(' · ')}</p>` : ''}
    <div class="cells">${day.sections.map((s, i) => {
      const v0 = s.versions[0];
      const kind = v0.kind === 'strength' ? 'Strength' : 'Metcon';
      const items = (v0.kind === 'strength' ? v0.items : v0.blocks[0].items).map(it => it.label || it.name);
      const saved = day.saved.get(i);
      const drafting = !saved && day.drafts?.[i];
      const state = saved ? '<span class="st ok">✓ 저장됨</span>'
        : drafting ? `<span class="st tight">작성 중${drafting.level ? ` · ${esc(drafting.level)}` : ''}</span>`
        : `<span class="cell-value">${s.versions.length > 1 ? `${s.versions.length}개 레벨` : ''}</span>`;
      return `
        <button class="cell sec ${saved ? 'saved' : ''}" data-i="${i}">
          <span class="cell-main">
            <span class="cell-label">${esc(secLabel(s) || 'WOD')} <span class="chip-kind">${kind}</span></span>
            <span class="cell-sub">${esc(v0.title)} · ${esc([...new Set(items)].join(' · '))}</span>
          </span>${state}${CHEV}
        </button>`;
    }).join('')}</div>
    <p class="muted small center">${day.planId ? '수행한 파트만 입력하면 됩니다<br>나중에 기록해도 오늘 탭의 <b>기록 대기</b>에 남아 있어요' : '수행한 파트만 입력하면 됩니다'}</p>
    <div class="cta-bar"><button class="primary wide" id="done">${day.saved.size ? '완료' : '나중에 기록하기'}</button></div>`, 'sub', 'day');
  $('#back').onclick = () => (day.planId ? goHome() : renderNew());
  $('#done').onclick = () => goHome();
  view().querySelectorAll('.sec').forEach(el => (el.onclick = () => openSection(+el.dataset.i)));
}

function openSection(i) {
  secIdx = i;
  const s = day.sections[i];
  if (day.saved.has(i)) return (location.hash = `#/w/${day.saved.get(i)}`);
  const kept = day.drafts?.[i];
  if (kept) {
    draft = structuredClone(kept);
    editing = false;
    return isStrength(draft) ? openStrengthForm(false) : renderForm(false);
  }
  if (s.versions.length > 1) renderPick();
  else startDraft(0);
}

function startDraft(vi) {
  editing = false;
  const s = day.sections[secIdx];
  const v = s.versions[vi];
  const lvlIdx = s.versions.length > 1 ? vi : -1;
  if (v.kind === 'strength') {
    draft = strengthDraft(v, day.date, day.raw, secLabel(s));
    openStrengthForm(false);
  } else {
    draft = metconDraft(v, lvlIdx, day.date, day.raw, secLabel(s));
    if (day.benchmark) {
      draft.benchmark = day.benchmark;
      draft.title = `${BENCH_BY_ID[day.benchmark].name} · ${draft.title}`;
      draft.notes = draft.notes.split('\n').filter(l => !detectBenchmark(l)).join('\n');
    }
    renderForm(false);
  }
}

function baseDraft(v, date, raw, section) {
  return { id: uid(), date, section, title: v.title || '', raw, notes: (v.notes || []).join('\n'), bodyweight: body(date).weight, height: S.height, createdAt: Date.now() };
}
function metconDraft(v, idx, date, raw, section) {
  return { ...baseDraft(v, date, raw, section), kind: 'metcon', level: idx >= 0 ? S.levels[idx] || '' : '', repeat: !!v.repeat, blocks: resolveBlocks(v, S.side), targets: (v.targets || []).map(t => ({ text: t, done: false })) };
}
function strengthDraft(v, date, raw, section) {
  return { ...baseDraft(v, date, raw, section), kind: 'strength', level: '', blocks: [], strength: resolveStrength(v, S.side), targets: (v.targets || []).map(t => ({ text: t, done: false })) };
}

function backFromForm(isEdit) {
  if (isEdit) location.hash = `#/w/${draft.id}`;
  else if (day?.fromLibrary) renderBench();
  else if (day && day.sections[secIdx]?.versions.length > 1) renderPick();
  else if (day && day.sections.length > 1) renderDay();
  else if (day?.planId) goHome();
  else renderNew();
}

// ───────────────────────── 레벨 선택
const STATUS = { easy: '↓ 여유', ok: '✓ 적정', tight: '! 빠듯', cap: '✕ 캡 위험' };
const CONF = { high: '신뢰도 높음', mid: '신뢰도 보통', low: '신뢰도 낮음' };

async function renderPick() {
  const side = S.side;
  const s = day.sections[secIdx];
  const date = day.date;
  const history = (await db.listWorkouts()).filter(w => !isStrength(w) && w.date <= date);
  const cond = S.conds[date];
  const rec = recommend({ versions: s.versions, workouts: history, levels: S.levels, side, body: body(date), defaultLevel: S.baseLevel, now: Date.parse(date + 'T12:00:00'), fmtLoad: loadText, condition: cond });
  paint(`
    <header class="bar"><button class="back" id="back">‹</button><h1>레벨 선택</h1>${secChip(secLabel(s))}</header>
    ${rec ? `
      <div class="card rec">
        <div class="head"><span class="k">오늘 추천</span>${badge(rec.per[rec.rec].level)}<span class="spacer"></span><span class="conf">${CONF[rec.confidence.level]}</span></div>
        <ul>${rec.reasons.map(r => `<li>${esc(r)}</li>`).join('')}</ul>
        ${rec.warning ? `<p class="warn">⚠ ${esc(rec.warning)}</p>` : ''}
        ${rec.soreWarning ? `<p class="warn">⚠ ${esc(rec.soreWarning)}</p>` : ''}
        <p class="muted small">${esc(rec.confidence.text)} · 블록 기록 ${rec.fit.blocks}개 반영${cond?.feel ? ` · 컨디션 ${cond.feel}/5` : ''}</p>
      </div>` : ''}
    <div class="g-title"><span>${s.versions.length}개 레벨</span></div>
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
  $('#back').onclick = () => (day.sections.length > 1 ? renderDay() : day.planId ? goHome() : renderNew());
  view().querySelectorAll('.vcard').forEach(el => (el.onclick = () => startDraft(+el.dataset.i)));
}

// ───────────────────────── 메트콘 입력 폼 (iOS 묶음 리스트)
// 운동 줄을 누르면 편집 패널, repeat(인터벌·세트 반복)이면 운동은 한 번만 편집하고 회차별 결과만 받는다
const RPE_DESC = { 1: '매우 쉬움', 2: '쉬움', 3: '가벼움', 4: '적당함', 5: '조금 힘듦', 6: '힘듦', 7: '힘들지만 여유 있음', 8: '많이 힘듦', 9: '거의 한계', 10: '완전 한계' };
const levelChips = sel => `<div class="chips">${S.levels.concat(sel && !S.levels.includes(sel) ? [sel] : []).map(l => `<button type="button" class="${l === sel ? 'on' : ''}" data-act="level" data-v="${esc(l)}">${esc(l)}</button>`).join('')}</div>`;

function itemCell(it, b, bi, ii) {
  if (!it.key) {
    return `<button class="cell" data-act="pick-key" data-b="${bi}" data-i="${ii}"><span class="cell-main"><span class="cell-label danger-text">❓ ${esc(it.name)}</span><span class="cell-sub">탭해서 어떤 운동인지 선택</span></span>${CHEV}</button>`;
  }
  const def = BY_KEY[it.key];
  const sub = [perRoundHint(it, b), it.boxIn ? `${it.boxIn}in` : '', it.sync ? 'Sync' : '', it.alt ? `⇄ ${dispName(it.alt)}` : ''].filter(Boolean).join(' · ');
  const right = [`${numStr(it.qty) || '-'}${it.unit === 'reps' ? '회' : ' ' + UNIT_LABEL[it.unit]}`, def.equip && it.load ? `${loadText(it.load)}${(it.implements || 1) > 1 ? ' ×' + it.implements : ''}` : ''].filter(Boolean).join(' · ');
  return `<button class="cell" data-act="edit-item" data-b="${bi}" data-i="${ii}"><span class="cell-main"><span class="cell-label">${esc(dispName(it))}</span>${sub ? `<span class="cell-sub">${esc(sub)}</span>` : ''}</span><span class="cell-value">${esc(right)}</span>${CHEV}</button>`;
}
function resultCells(b, bi, label = '') {
  const r = b.result || {};
  const total = b.items.reduce((s, it) => s + (it.qty || 0), 0);
  if (b.format === 'amrap') {
    return `
      <div class="cell"><span class="cell-label">${label}${b.emom ? '완료한 분' : '라운드'}</span><span class="spacer"></span>${stepper(`data-f="rounds" data-b="${bi}"`, numStr(r.rounds), 1, '', 'sm')}</div>
      ${b.emom ? '' : `<div class="cell"><span class="cell-label">+ 추가 횟수</span><span class="spacer"></span>${stepper(`data-f="reps" data-b="${bi}"`, numStr(r.reps), 1, '', 'sm')}</div>`}`;
  }
  const main = r.capped
    ? `<div class="cell"><span class="cell-main"><span class="cell-label">${label}완료 횟수</span><span class="cell-sub">총 ${total}회 중</span></span><span class="spacer"></span><input class="time-in" data-f="repsDone" data-b="${bi}" inputmode="numeric" placeholder="0" value="${numStr(r.repsDone)}"></div>`
    : `<div class="cell"><span class="cell-main"><span class="cell-label">${label}완료 시간</span>${b.team > 1 ? '<span class="cell-sub">팀 전체 시간</span>' : ''}</span><span class="spacer"></span><input class="time-in" data-f="time" data-b="${bi}" inputmode="numeric" placeholder="0:00" value="${r.timeSec ? fmtTime(r.timeSec) : ''}"></div>`;
  const cap = b.capSec ? `<div class="cell"><span class="cell-label ${label ? 'muted' : ''}">타임캡 걸림</span><span class="spacer"></span>${sw(`data-f="capped" data-b="${bi}"`, r.capped)}</div>` : '';
  return main + cap;
}
function blocksHtml() {
  const d = draft;
  const add = bi => `<button class="cell add" data-act="add-item" data-b="${bi}"><span class="cell-label">＋ 운동 추가</span></button>`;
  const head = (b, bi, label) => `<div class="g-title"><span>${label}</span><button class="g-link" data-act="block-cfg" data-b="${bi}">${fmtLabel(b)} ›</button></div>`;
  if (d.repeat && d.blocks.length > 1) {
    const b0 = d.blocks[0];
    return `
      ${head(b0, 0, `${d.blocks.length}회 반복`)}
      <div class="cells">${b0.items.map((it, ii) => itemCell(it, b0, 0, ii)).join('')}${add(0)}</div>
      ${b0.restAfterSec ? `<p class="g-foot">회차 사이 휴식 ${fmtTime(b0.restAfterSec)}</p>` : ''}
      <div class="g-title"><span>회차별 결과</span></div>
      <div class="cells">${d.blocks.map((b, bi) => resultCells(b, bi, `${bi + 1}회 `)).join('')}</div>
      <p class="g-foot" id="bstat-0"></p>`;
  }
  return d.blocks.map((b, bi) => `
    ${head(b, bi, d.blocks.length > 1 ? `블록 ${bi + 1}` : '운동')}
    ${b.team > 1 ? `<p class="g-foot top">Team of ${b.team}${b.alternating ? ` · Alternating ${b.rounds}R · 수량은 내 몫` : ''}</p>` : ''}
    <div class="cells">${b.items.map((it, ii) => itemCell(it, b, bi, ii)).join('')}${add(bi)}</div>
    <div class="g-title"><span>결과</span></div>
    <div class="cells">${resultCells(b, bi)}</div>
    <p class="g-foot" id="bstat-${bi}"></p>`).join('');
}
function commonTail(d, rpeRequired) {
  return `
    ${d.targets.length ? `
      <div class="g-title"><span>Target</span></div>
      <div class="cells">${d.targets.map((t, ti) => `<label class="cell"><span class="cell-label">${esc(t.text)}</span><span class="spacer"></span><input type="checkbox" class="check" data-f="target" data-t="${ti}" ${t.done ? 'checked' : ''}></label>`).join('')}</div>` : ''}
    <div class="g-title"><span>RPE · 체감 강도${rpeRequired ? '' : ' (선택)'}</span></div>
    <div class="cells"><div class="cell col">
      <div class="rpe">${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => `<label><input type="radio" name="rpe" data-f="rpe" value="${n}" ${d.rpe === n ? 'checked' : ''}><span>${n}</span></label>`).join('')}</div>
      <div class="rpe-desc" id="rpe-desc">${d.rpe ? `${d.rpe} · ${RPE_DESC[d.rpe]}` : '<span class="muted">1 매우 쉬움 · 7 힘들지만 여유 · 10 완전 한계</span>'}</div>
    </div></div>
    <div class="g-title"><span>메모</span></div>
    <div class="cells"><div class="cell col"><textarea class="bare" data-f="notes" rows="3" placeholder="컨디션, 스케일, 느낀 점">${esc(d.notes)}</textarea></div></div>`;
}

function renderForm(isEdit) {
  const d = draft;
  paint(`
    <div id="form">
      <header class="bar"><button class="back" data-act="back">‹</button><h1>${isEdit ? '기록 수정' : '결과 입력'}</h1>${secChip(d.section)}</header>
      ${d.title ? `<p class="wod-title">${esc(d.title)}</p>` : ''}
      <div class="cells">
        <div class="cell"><span class="cell-label">날짜</span><span class="spacer"></span><input type="date" class="inline-in" data-f="date" value="${d.date}"></div>
        <div class="cell"><span class="cell-label">체중</span><span class="spacer"></span>${stepper('data-f="bodyweight"', numStr(d.bodyweight), 0.5, 'kg', 'sm')}</div>
        <div class="cell col"><span class="cell-label small-label">레벨</span>${levelChips(d.level)}</div>
      </div>
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
    if (t.dataset.f === 'capped') renderForm(isEdit);
    if (t.dataset.f === 'time' && draft.blocks[+t.dataset.b].result.timeSec) t.value = fmtTime(draft.blocks[+t.dataset.b].result.timeSec);
  });
  root.addEventListener('click', e => {
    const t = e.target.closest('[data-act]');
    if (!t) return;
    const bi = +t.dataset.b;
    const ii = +t.dataset.i;
    const again = () => renderForm(isEdit);
    switch (t.dataset.act) {
      case 'back': return backFromForm(isEdit);
      case 'edit-item': return itemPanel(bi, ii, again);
      case 'block-cfg': return blockPanel(bi, again);
      case 'add-item':
        openSheet('운동 추가', movementSheetItems()).then(k => {
          if (!k) return;
          targets(bi).forEach(b => addItem(b, k));
          again();
          itemPanel(bi, draft.blocks[bi].items.length - 1, again);
        });
        return;
      case 'pick-key': {
        const it = draft.blocks[bi].items[ii];
        openSheet(`"${it.name}" 은(는) 어떤 운동인가요?`, movementSheetItems()).then(k => {
          if (!k) return;
          setKey(bi, ii, k);
          again();
        });
        return;
      }
      case 'level': draft.level = draft.level === t.dataset.v ? '' : t.dataset.v; haptic(); break;
      case 'add-block': draft.blocks.push({ format: 'fortime', capSec: draft.blocks.at(-1)?.capSec ?? null, rounds: 1, items: [], result: {} }); break;
      case 'save': return save(isEdit);
      default: return;
    }
    again();
  });
  updateSummary();
}

// 운동 편집 패널: 수량 · 무게 · 개수 · 단위 · 대체 동작 · 삭제
function itemPanel(bi, ii, rerender) {
  const it = draft.blocks[bi].items[ii];
  const def = BY_KEY[it.key];
  const b = draft.blocks[bi];
  const qtyLabel = it.unit === 'reps' ? '횟수' : it.unit === 'cal' ? '칼로리' : '거리';
  const html = `
    <div class="cells">
      <div class="cell"><span class="cell-main"><span class="cell-label">${qtyLabel}</span>${perRoundHint(it, b) ? `<span class="cell-sub">${esc(perRoundHint(it, b))}</span>` : ''}</span><span class="spacer"></span>${stepper('data-pf="qty"', numStr(it.qty), qtyStep(it.unit), UNIT_LABEL[it.unit])}</div>
      ${def.equip ? `<div class="cell"><span class="cell-label">무게</span><span class="spacer"></span>${stepper('data-pf="load"', showLoad(it.load), loadStep(), LU())}</div>` : ''}
      ${def.equip === 'db' || def.equip === 'kb' ? `<div class="cell"><span class="cell-label">개수</span><span class="spacer"></span><div class="seg sm">${[1, 2].map(n => `<label><input type="radio" name="impl" value="${n}" ${(it.implements || 1) === n ? 'checked' : ''}><span>${n}개</span></label>`).join('')}</div></div>` : ''}
      ${def.kind === 'erg' ? `<div class="cell"><span class="cell-label">단위</span><span class="spacer"></span><div class="seg sm">${['cal', 'm'].map(u => `<label><input type="radio" name="unit" value="${u}" ${it.unit === u ? 'checked' : ''}><span>${u}</span></label>`).join('')}</div></div>` : ''}
      ${it.alt ? `<button class="cell" data-pa="alt"><span class="cell-label">대체 동작으로 바꾸기</span><span class="spacer"></span><span class="cell-value">${esc(dispName(it.alt))}</span>${CHEV}</button>` : ''}
    </div>
    <div class="btns panel-btns"><button class="danger" data-pa="del">삭제</button><button class="primary" data-pa="done">완료</button></div>`;
  openPanel(dispName(it), html, (el, close) => {
    el.oninput = e => {
      const t = e.target;
      if (t.dataset.pf === 'qty') targets(bi).forEach(x => setQty(x.items[ii], toNum(t.value)));
      else if (t.dataset.pf === 'load') targets(bi).forEach(x => { x.items[ii].load = readLoad(t.value); });
      else if (t.name === 'impl') targets(bi).forEach(x => { x.items[ii].implements = +t.value; });
      else if (t.name === 'unit') targets(bi).forEach(x => { x.items[ii].unit = t.value; });
    };
    el.onclick = e => {
      const a = e.target.closest('[data-pa]')?.dataset.pa;
      if (a === 'del') { targets(bi).forEach(x => x.items.splice(ii, 1)); close(1); }
      else if (a === 'alt') { targets(bi).forEach(x => swapAlt(x, ii)); close(1); }
      else if (a === 'done') close(1);
    };
  }).then(rerender);
}

// 블록 설정 패널: 형식 · 타임캡 · 블록 삭제
function blockPanel(bi, rerender) {
  const b = draft.blocks[bi];
  const html = `
    <div class="cells">
      <div class="cell"><span class="cell-label">형식</span><span class="spacer"></span><div class="seg sm">${[['fortime', 'For Time'], ['amrap', b.emom ? 'EMOM' : 'AMRAP']].map(([v, l]) => `<label><input type="radio" name="fmt" value="${v}" ${b.format === v ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div></div>
      <div class="cell"><span class="cell-main"><span class="cell-label">타임캡</span><span class="cell-sub">0이면 없음</span></span><span class="spacer"></span>${stepper('data-pf="cap"', b.capSec ? numStr(b.capSec / 60) : '0', 1, '분')}</div>
    </div>
    <div class="btns panel-btns">${!draft.repeat && draft.blocks.length > 1 ? '<button class="danger" data-pa="del">블록 삭제</button>' : ''}<button class="primary" data-pa="done">완료</button></div>`;
  openPanel(draft.repeat ? '반복 블록 설정' : `블록 ${bi + 1} 설정`, html, (el, close) => {
    el.oninput = e => {
      const t = e.target;
      if (t.name === 'fmt') targets(bi).forEach(x => { x.format = t.value; x.result = {}; });
      if (t.dataset.pf === 'cap') targets(bi).forEach(x => { const m = toNum(t.value); x.capSec = m ? Math.round(m * 60) : null; });
    };
    el.onclick = e => {
      const a = e.target.closest('[data-pa]')?.dataset.pa;
      if (a === 'del') { draft.blocks.splice(bi, 1); close(1); }
      else if (a === 'done') close(1);
    };
  }).then(rerender);
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
  b.items.push({ key, name: def.name, variant: '', unit: def.unit || 'reps', qty: null, perRound: null, load: def.equip ? sameEquip?.load ?? null : null, implements: def.implements ?? 1 });
}
function applyField(t) {
  const f = t.dataset.f;
  const bi = +t.dataset.b;
  const b = draft.blocks?.[bi];
  switch (f) {
    case 'date': draft.date = t.value; break;
    case 'notes': draft.notes = t.value; break;
    case 'bodyweight': draft.bodyweight = toNum(t.value); break;
    case 'time': b.result = { timeSec: parseTime(t.value) }; break;
    case 'capped': b.result = t.checked ? { capped: true, repsDone: null } : {}; break;
    case 'repsDone': b.result.repsDone = toNum(t.value); break;
    case 'rounds': b.result.rounds = toNum(t.value); break;
    case 'reps': b.result.reps = toNum(t.value); break;
    case 'target': draft.targets[+t.dataset.t].done = t.checked; break;
    case 'rpe':
      draft.rpe = +t.value;
      if ($('#rpe-desc')) $('#rpe-desc').textContent = `${draft.rpe} · ${RPE_DESC[draft.rpe]}`;
      haptic();
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
  persistDraft();
  const st = workoutStats(draft, body(draft.date));
  st.blocks.forEach((bs, i) => {
    const el = $(`#bstat-${i}`);
    if (!el) return;
    el.textContent = draft.repeat
      ? st.blocks.map((x, k) => (x.powerW != null ? `${k + 1}회 ${watt(x.powerW)}` : '')).filter(Boolean).join(' · ')
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

// ───────────────────────── 저장 + PR 감지
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
  const history = (await db.listWorkouts()).filter(x => x.id !== draft.id && x.date <= draft.date);
  const prs = detectPRs(draft, history, body(draft.date), loadText);
  draft.prs = prs.map(p => ({ kind: p.kind, name: p.name, text: p.text }));
  draft.updatedAt = Date.now();
  const saved = draft;
  await db.putWorkout(saved);
  haptic(20);
  toast(isEdit ? '수정했습니다' : '저장했습니다');
  draft = null;
  clearTimeout(persistTimer);
  if (prs.length && !isEdit) await celebrate(saved);
  if (!isEdit && day) {
    day.saved.set(secIdx, saved.id);
    if (day.drafts) delete day.drafts[secIdx];
    if (day.planId) {
      if (day.saved.size >= day.sections.length) await deletePlan(day.planId);
      else await persistDay();
    }
    if (day.sections.length > 1) return renderDay();
  }
  day = null;
  location.hash = `#/w/${saved.id}`;
}

async function celebrate(w) {
  const html = `
    <div class="celebrate">
      <div class="trophy">🏆</div>
      <div class="cells">${w.prs.map(p => `<div class="cell"><span class="cell-main"><span class="cell-label">${esc(p.name)}</span><span class="cell-sub">${esc(p.text)}</span></span></div>`).join('')}</div>
    </div>
    <div class="btns panel-btns"><button class="ghost" data-pa="share">공유 카드 만들기</button><button class="primary" data-pa="ok">확인</button></div>`;
  const v = await openPanel(`새 기록 ${w.prs.length}개!`, html, (el, close) => {
    el.onclick = e => {
      const a = e.target.closest('[data-pa]')?.dataset.pa;
      if (a) close(a);
    };
  });
  if (v === 'share') await shareWorkout(w);
}

// ───────────────────────── 공유 카드
function cardOf(w) {
  const prs = (w.prs || []).map(p => `${p.name} ${p.text.split(' (')[0]}`);
  if (isStrength(w)) {
    const ss = strengthSummary(w);
    return {
      date: dateLabel(w.date), title: workoutName(w), level: w.section || 'Strength',
      big: ss ? showLoad(ss.single ? ss.e1rm : ss.top) : `${w.strength.setResults.length}세트`,
      bigLabel: ss ? `${ss.single ? 'e1RM' : '최고 무게'} (${LU()})` : '',
      lines: w.strength.setResults.slice(0, 5).map((r, i) => `${i + 1}세트   ${loadText(r.load)} × ${numStr(r.reps)}`),
      prs,
    };
  }
  const st = workoutStats(w, body(w.date));
  const b0 = w.blocks[0];
  const single = w.blocks.length === 1;
  const big = single && b0.format === 'amrap' ? resultText(b0) : single && b0.result?.timeSec ? fmtTime(b0.result.timeSec) : st.powerW != null ? `${Math.round(st.powerW)}` : '-';
  const bigLabel = single && b0.format === 'amrap' ? (b0.emom ? '완료' : '라운드') : single && b0.result?.timeSec ? '완료 시간' : '평균 파워 (W)';
  const lines = [
    ...w.blocks.slice(0, 3).map((b, i) => `${w.blocks.length > 1 ? (w.repeat ? `${i + 1}회  ` : `B${i + 1}  `) : ''}${resultText(b)}   ${b.items.slice(0, 3).map(it => it.label || it.name).join(' · ')}`),
    `평균 파워 ${watt(st.powerW)}${w.rpe ? ` · RPE ${w.rpe}` : ''}`,
  ];
  return { date: dateLabel(w.date), title: workoutName(w), level: w.level, big, bigLabel, lines, prs };
}
async function shareWorkout(w) {
  const r = await shareCard(cardOf(w));
  if (r.shared || r.cancelled) return;
  await openPanel('공유 카드', `
    <img class="share-img" src="${r.url}" alt="공유 카드">
    <p class="muted small center">이미지를 길게 눌러 저장하거나 공유하세요</p>
    <div class="btns panel-btns"><a class="btn ghost" download="wodlog-${w.date}.png" href="${r.url}">이미지 저장</a><button class="primary" data-pa="ok">닫기</button></div>`, (el, close) => {
    el.onclick = e => { if (e.target.closest('[data-pa]')) close(1); };
  });
}

// ───────────────────────── Strength 입력 폼 (% 무게 도우미 포함)
async function openStrengthForm(isEdit) {
  strengthBoard = liftBoard(await db.listWorkouts(), S.rm);
  renderStrengthForm(isEdit);
}
function pctHelper(d) {
  const s = d.strength;
  const pcts = parsePercents(`${s.intensity || ''} ${d.title || ''}`);
  if (!pcts) return '';
  const key = s.items[0]?.key;
  const row = strengthBoard.find(r => r.key === key);
  if (!row?.oneRM) {
    return `
      <div class="g-title"><span>% 무게</span></div>
      <div class="cells"><a class="cell" href="#/me"><span class="cell-main"><span class="cell-label">${esc(BY_KEY[key]?.name || '이 운동')} 1RM을 입력하면</span><span class="cell-sub">${pcts.join('–')}% 무게를 계산해 드려요</span></span>${CHEV}</a></div>`;
  }
  const list = pcts.length === 2 ? Array.from({ length: Math.floor((pcts[1] - pcts[0]) / 5) + 1 }, (_, i) => pcts[0] + i * 5) : [pcts[0] - 10, pcts[0] - 5, pcts[0]].filter(p => p > 0);
  const table = percentTable(row.oneRM, list);
  return `
    <div class="g-title"><span>% 무게 · ${esc(row.name)} 1RM ${loadText(row.oneRM)}</span></div>
    <div class="cells"><div class="cell col">
      <div class="pct-chips">${table.map(p => `<button type="button" data-pct-kg="${p.kg}" data-pct-lb="${p.lb}"><b>${p.pct}%</b><span>${LU() === 'lb' ? `${p.lb} lb` : `${numStr(Math.round(p.kg * 2) / 2)} kg`}</span></button>`).join('')}</div>
      <p class="muted small">탭하면 비어 있는 다음 세트에 들어가요 · 원판은 한쪽 기준 (바 45 lb)</p>
    </div></div>`;
}
function renderStrengthForm(isEdit) {
  const d = draft;
  const s = d.strength;
  const single = s.items.length === 1;
  const def = single && s.items[0].key ? BY_KEY[s.items[0].key] : null;
  const loadLabel = single && def && !def.equip ? '추가 중량' : '무게';
  paint(`
    <div id="form">
      <header class="bar"><button class="back" data-act="back">‹</button><h1>${isEdit ? '기록 수정' : 'Strength'}</h1>${secChip(d.section)}</header>
      <div class="card strength-head">
        <div class="k">${esc(d.title)}</div>
        <div class="complex">${s.items.map(it => `<span>${numStr(it.reps)} ${esc(dispName(it))}</span>`).join('<i>+</i>')}</div>
        ${d.notes ? `<p class="muted small pre">${esc(d.notes)}</p>` : ''}
      </div>
      <div class="cells">
        <div class="cell"><span class="cell-label">날짜</span><span class="spacer"></span><input type="date" class="inline-in" data-f="date" value="${d.date}"></div>
      </div>
      ${pctHelper(d)}
      <div class="g-title"><span>세트 · ${loadLabel} × ${single ? '횟수' : '컴플렉스'}</span>
        <div class="seg sm mini"><label><input type="radio" name="su" value="lb" ${LU() === 'lb' ? 'checked' : ''}><span>lb</span></label><label><input type="radio" name="su" value="kg" ${LU() === 'kg' ? 'checked' : ''}><span>kg</span></label></div>
      </div>
      <div class="cells">
        ${s.setResults.map((r, i) => `
          <div class="cell set-cell">
            <span class="set-n">${i + 1}</span>
            ${stepper(`data-f="sload" data-s="${i}" aria-label="${loadLabel}"`, showLoad(r.load), loadStep(), LU(), 'sm')}
            <span class="x">×</span>
            ${stepper(`data-f="sreps" data-s="${i}" aria-label="횟수"`, numStr(r.reps), 1, '', 'sm xs')}
            <button class="icon" data-act="del-set" data-s="${i}" aria-label="세트 삭제">✕</button>
          </div>`).join('')}
        <button class="cell add" data-act="add-set"><span class="cell-label">＋ 세트 추가</span></button>
      </div>
      <p class="g-foot" id="ssum"></p>
      ${commonTail(d, false)}
      <div class="cta-bar"><button class="primary wide" data-act="save">저장</button></div>
    </div>`, 'sub', 'strength');

  const root = $('#form');
  const upd = () => {
    persistDraft();
    const ss = strengthSummary(d);
    $('#ssum').innerHTML = ss
      ? (ss.single ? `최고 ${loadText(ss.top)} · <b>e1RM ${loadText(ss.e1rm)}</b> (Epley)` : `컴플렉스 최고 <b>${loadText(ss.top)}</b>`)
      : '무게를 입력하면 최고 무게와 e1RM이 계산됩니다';
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
    const pc = e.target.closest('[data-pct-kg]');
    if (pc) {
      const kg = +pc.dataset.pctKg;
      const lb = +pc.dataset.pctLb;
      let slot = s.setResults.find(r => r.load == null);
      if (!slot) {
        slot = { load: null, reps: s.setResults.at(-1)?.reps ?? (single ? s.items[0].reps : 1) };
        s.setResults.push(slot);
      }
      slot.load = kg;
      const pl = plates(lb);
      toast(`${lb} lb${pl ? ` · 한쪽 ${pl.perSide.join(' + ') || '바만'}` : ''}`);
      haptic();
      return renderStrengthForm(isEdit);
    }
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
const SHARE_ICON = '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M12 15V4M8 8l4-4 4 4M5 13v6a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
async function renderDetail(id) {
  const w = await db.getWorkout(id);
  if (!w) return goHome();
  const prHtml = w.prs?.length ? `<div class="cells pr-cells">${w.prs.map(p => `<div class="cell"><span class="cell-icon gold">🏆</span><span class="cell-main"><span class="cell-label">${esc(p.name)}</span><span class="cell-sub">${esc(p.text)}</span></span></div>`).join('')}</div>` : '';
  const tail = `
    ${w.targets?.length ? `<div class="g-title"><span>Target</span></div><div class="cells">${w.targets.map(t => `<div class="cell"><span class="cell-label">${esc(t.text)}</span><span class="spacer"></span><span class="${t.done ? 'st ok' : 'muted'}">${t.done ? '✓ 달성' : '미달성'}</span></div>`).join('')}</div>` : ''}
    ${w.notes ? `<div class="g-title"><span>메모</span></div><div class="cells"><div class="cell"><p class="pre">${esc(w.notes)}</p></div></div>` : ''}
    ${w.raw ? `<details class="card raw"><summary>원문 보기</summary><pre>${esc(w.raw)}</pre></details>` : ''}`;
  const head = extra => `<header class="bar"><a class="back" href="#/">‹</a><h1>${dateLabel(w.date)}</h1>${extra}<span class="spacer"></span><button class="icon share-btn" id="share" aria-label="공유">${SHARE_ICON}</button></header>`;
  const buttons = `
    <div class="cta-bar"><div class="btns">
      <button class="danger" id="del" style="flex:0 0 30%">삭제</button>
      <a class="btn primary" href="#/edit/${w.id}">수정</a>
    </div></div>`;

  if (isStrength(w)) {
    const ss = strengthSummary(w);
    paint(`
      ${head(`${secChip(w.section)}<span class="chip-kind">Strength</span>`)}
      <div class="card hero">
        <div class="k">${ss?.single ? 'e1RM (추정 1RM)' : '최고 무게'}</div>
        <div class="hero-v">${ss ? loadText(ss.single ? ss.e1rm : ss.top) : '-'}</div>
        <div class="muted">${esc(w.title)}${w.rpe ? ` · RPE ${w.rpe}` : ''}</div>
      </div>
      ${prHtml}
      <div class="g-title"><span>${esc(workoutName(w))}</span></div>
      <div class="cells">${w.strength.setResults.map((r, i) => `<div class="cell"><span class="set-n">${i + 1}</span><span class="cell-label">${loadText(r.load)} × ${numStr(r.reps)}</span><span class="spacer"></span>${ss?.single && r.load ? `<span class="cell-value">e1RM ${loadText(e1rm(r.load, r.reps || 1))}</span>` : ''}</div>`).join('')}</div>
      ${tail}${buttons}`, 'sub', 'detail');
  } else {
    const st = workoutStats(w, body(w.date));
    const blockGroup = (b, i, label) => `
      <div class="g-title"><span>${label}</span><span class="muted small">${fmtLabel(b)}</span></div>
      <div class="cells">
        ${b.items.map(it => `<${it.key ? `a href="#/m/${it.key}"` : 'div'} class="cell"><span class="cell-main"><span class="cell-label">${itemText(it, b)}</span></span>${it.key ? CHEV : ''}</${it.key ? 'a' : 'div'}>`).join('')}
        <div class="cell result-cell"><b>${resultText(b)}</b><span class="spacer"></span><span class="muted">${kJ(st.blocks[i].workJ)} · ${watt(st.blocks[i].powerW)}</span></div>
      </div>`;
    const blocks = w.repeat && w.blocks.length > 1
      ? `<div class="g-title"><span>${w.blocks.length}회 반복</span><span class="muted small">${fmtLabel(w.blocks[0])}</span></div>
         <div class="cells">${w.blocks[0].items.map(it => `<a href="#/m/${it.key}" class="cell"><span class="cell-main"><span class="cell-label">${itemText(it, w.blocks[0])}</span></span>${CHEV}</a>`).join('')}</div>
         <div class="g-title"><span>회차별</span></div>
         <div class="cells">${w.blocks.map((b, i) => `<div class="cell"><span class="set-n">${i + 1}</span><b>${resultText(b)}</b><span class="spacer"></span><span class="muted">${watt(st.blocks[i].powerW)}</span></div>`).join('')}</div>`
      : w.blocks.map((b, i) => blockGroup(b, i, w.blocks.length > 1 ? `블록 ${i + 1}` : '운동')).join('');
    paint(`
      ${head(`${secChip(w.section)}${badge(w.level)}`)}
      <div class="card hero">
        <div class="k">평균 파워</div>
        <div class="hero-v">${watt(st.powerW)}</div>
        <div class="muted">${kJ(st.workJ)} · ${st.timeSec ? fmtTime(st.timeSec) : '-'}${w.rpe ? ` · RPE ${w.rpe}` : ''}</div>
      </div>
      ${prHtml}
      ${w.benchmark ? await benchHistoryHtml(w) : ''}
      ${w.title ? `<p class="wod-title">${esc(w.title)}</p>` : ''}
      ${blocks}
      ${tail}
      ${st.excluded.length ? `<p class="g-foot">일량 계산 제외: ${esc(st.excluded.join(', '))}</p>` : ''}
      ${buttons}`, 'sub', 'detail');
  }
  $('#share').onclick = () => shareWorkout(w);
  $('#del').onclick = async () => {
    if (!(await askConfirm('이 기록을 삭제할까요?', '삭제'))) return;
    await db.deleteWorkout(w.id);
    toast('삭제했습니다');
    goHome();
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
    <div class="g-title"><span>🏆 ${esc(b?.name || w.benchmark)} · ${all.length}회</span>${delta ? `<span class="muted small">${delta}</span>` : ''}</div>
    <div class="cells">${all.map(x => `<a class="cell ${x.id === w.id ? 'cur' : ''}" href="#/w/${x.id}"><span class="cell-label">${dateLabel(x.date)}</span>${badge(x.level)}<span class="spacer"></span><span class="cell-value strong">${esc(scoreOf(x).text)}</span>${x.id === best?.id ? '<span class="pr-dot">PR</span>' : ''}</a>`).join('')}</div>`;
}

async function renderEdit(id) {
  const w = await db.getWorkout(id);
  if (!w) return goHome();
  draft = structuredClone(w);
  draft.targets ||= [];
  day = null;
  editing = true;
  if (isStrength(draft)) await openStrengthForm(true);
  else renderForm(true);
}

// ───────────────────────── 성장
async function renderStats() {
  const all = (await db.listWorkouts()).reverse();
  const ws = all.filter(w => !isStrength(w));
  const rows = ws.map(w => ({ w, s: workoutStats(w, body(w.date)) })).filter(x => x.s.powerW != null);
  const powerPts = rows.map(x => ({ date: x.w.date, value: x.s.powerW }));
  const gi = growthIndex(powerPts);
  const tr = logTrend(powerPts);
  const PHASE = { growing: '성장 중', plateau: '정체 구간', declining: '하락 중' };
  const best = rows.reduce((m, x) => (!m || x.s.powerW > m.s.powerW ? x : m), null);
  const board = liftBoard(all, S.rm).filter(r => r.oneRM).sort((a, b) => b.oneRM - a.oneRM).slice(0, 4);

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

  // 운동별 집계
  const agg = new Map();
  for (const w of all) {
    const items = isStrength(w) ? w.strength.items.map(i => ({ ...i, qty: (i.reps || 0) * w.strength.setResults.length, load: Math.max(0, ...w.strength.setResults.map(r => r.load || 0)) || null })) : w.blocks.flatMap(b => b.items);
    for (const it of items) {
      if (!it.key) continue;
      const a = agg.get(it.key) || { key: it.key, name: BY_KEY[it.key].name, unit: it.unit || 'reps', days: new Set(), total: 0, maxLoad: null };
      a.days.add(w.date);
      a.total += it.qty || 0;
      if (it.load) a.maxLoad = Math.max(a.maxLoad || 0, it.load);
      agg.set(it.key, a);
    }
  }
  const moves = [...agg.values()].sort((a, b) => b.days.size - a.days.size);
  const byBench = new Map();
  for (const w of ws) if (w.benchmark) byBench.set(w.benchmark, [...(byBench.get(w.benchmark) || []), w]);
  const benchRows = [...byBench].map(([id, list]) => ({ name: BENCH_BY_ID[id]?.name || id, n: list.length, best: bestOf(list), last: list.at(-1) })).sort((a, b) => b.n - a.n);
  const levels = {};
  for (const w of ws) if (w.level) levels[w.level] = (levels[w.level] || 0) + 1;

  paint(`
    <h1>성장</h1>
    <div class="card hero">
      <div class="k">메트콘 성장지수</div>
      ${gi ? `
        <div class="hero-v">${Math.round(gi.index)}</div>
        <div class="muted small">첫 4주 평균 ${Math.round(gi.baseline)} W = 100 기준 · 최근 4주 ${Math.round(gi.current)} W</div>
        ${tr ? `<div class="phase ${tr.phase}">${PHASE[tr.phase]} · 월 ${tr.perMonth >= 0 ? '+' : ''}${tr.perMonth.toFixed(1)} W</div>` : ''}`
      : `<div class="hero-v muted">-</div><div class="muted small">결과가 입력된 기록이 2개 이상 쌓이면 표시됩니다</div>`}
    </div>
    <div class="card">
      <div class="row"><h2>평균 파워</h2><span class="spacer"></span>${best ? `<span class="muted small">최고 ${Math.round(best.s.powerW)} W · ${dateLabel(best.w.date)}</span>` : ''}</div>
      <div id="powerChart"></div>
      <p class="muted small">무게·횟수·시간을 일량(J) ÷ 시간으로 환산한 값이라 레벨이 달라도 비교됩니다.${tr ? ' 회색 선은 장기 성장 연구의 선형-로그 추세선입니다.' : ''}</p>
    </div>
    <div class="g-title"><span>1RM</span><a class="g-link" href="#/me">전체</a></div>
    ${board.length ? `<div class="tiles">${board.slice(0, 3).map(r => `<a class="card tile" href="#/m/${r.key}"><div class="k">${esc(r.name)}</div><div class="v">${showLoad(r.oneRM)}<span class="small muted"> ${LU()}</span></div><div class="muted small">${r.source === 'manual' ? '실측' : '추정'}</div></a>`).join('')}</div>`
      : `<div class="cells"><a class="cell" href="#/me"><span class="cell-main"><span class="cell-label">1RM을 입력하거나 Strength를 기록해 보세요</span><span class="cell-sub">% 무게 계산과 근력 추이에 쓰여요</span></span>${CHEV}</a></div>`}
    ${liftIds.length ? `
      <div class="card">
        <select id="lift" class="plain-select">${liftIds.map(id => `<option value="${esc(id)}">${esc(lifts.get(id).label)} (${lifts.get(id).pts.length}회)</option>`).join('')}</select>
        <div id="liftChart"></div>
        <p class="muted small" id="liftNote"></p>
      </div>` : ''}
    ${benchRows.length ? `
      <div class="g-title"><span>벤치마크 PR</span></div>
      <div class="cells">${benchRows.map(r => `<a class="cell" href="#/w/${r.best.id}"><span class="cell-main"><span class="cell-label">${esc(r.name)}</span><span class="cell-sub">${r.n}회 · 최근 ${esc(scoreOf(r.last).text)}</span></span><span class="cell-value strong">${esc(scoreOf(r.best).text)}</span>${CHEV}</a>`).join('')}</div>` : ''}
    ${moves.length ? `
      <div class="g-title"><span>운동별</span></div>
      <div class="cells">${moves.map(a => `<a class="cell" href="#/m/${a.key}"><span class="cell-main"><span class="cell-label">${esc(a.name)}</span><span class="cell-sub">${a.days.size}일 · 누적 ${Math.round(a.total).toLocaleString()} ${UNIT_LABEL[a.unit] || '회'}</span></span>${a.maxLoad ? `<span class="cell-value">${loadText(a.maxLoad)}</span>` : ''}${CHEV}</a>`).join('')}</div>` : ''}
    ${Object.keys(levels).length ? `
      <div class="g-title"><span>레벨 분포</span></div>
      <div class="cells"><div class="cell levels">${S.levels.concat(Object.keys(levels).filter(l => !S.levels.includes(l))).filter(l => levels[l]).map(l => `<span>${badge(l)} ${levels[l]}회</span>`).join('')}</div></div>` : ''}`, 'tab', 'stats');

  lineChart($('#powerChart'), rows.map(x => ({
    date: x.w.date,
    value: x.s.powerW,
    tip: `${dateLabel(x.w.date)} ${x.w.level ? esc(x.w.level) : ''}<br><b>${Math.round(x.s.powerW)} W</b><br><span class="muted">${kJ(x.s.workJ)} / ${fmtTime(x.s.timeSec)}</span>`,
  })), { unit: 'W', trend: tr ? powerPts.map(p => ({ date: p.date, value: tr.at(p.date) })) : null, labels: ['평균 파워', '추세'] });

  const drawLift = id => {
    const l = lifts.get(id);
    const lt = logTrend(l.pts);
    const disp = kg => +showLoad(kg);
    lineChart($('#liftChart'), l.pts.map(p => ({ date: p.date, value: disp(p.value), tip: `${dateLabel(p.date)}<br><b>${loadText(p.value)}</b>${l.single ? `<br><span class="muted">최고 세트 ${loadText(p.top)}</span>` : ''}` })),
      { unit: LU(), trend: lt ? l.pts.map(p => ({ date: p.date, value: disp(lt.at(p.date)) })) : null, labels: [l.single ? 'e1RM' : '최고 무게', '추세'] });
    $('#liftNote').textContent = l.single ? 'e1RM = 무게 × (1 + 횟수/30) (Epley), 세트 중 최고값' : '컴플렉스는 세트 최고 무게';
  };
  if (liftIds.length) {
    drawLift(liftIds[0]);
    $('#lift').onchange = e => drawLift(e.target.value);
  }
}

// ───────────────────────── 운동별 상세
async function renderMove(key) {
  const def = BY_KEY[key];
  if (!def) return goHome();
  const all = await db.listWorkouts();
  const uses = [];
  for (const w of all) {
    if (isStrength(w)) {
      if (w.strength.items.some(i => i.key === key)) {
        const top = Math.max(0, ...w.strength.setResults.map(r => r.load || 0)) || null;
        uses.push({ w, qty: w.strength.setResults.reduce((a, r) => a + (r.reps || 0), 0), load: top, unit: 'reps', strength: true });
      }
      continue;
    }
    let qty = 0;
    let load = null;
    let unit = def.unit || 'reps';
    for (const b of w.blocks) for (const it of b.items) if (it.key === key) { qty += it.qty || 0; unit = it.unit; if (it.load) load = Math.max(load || 0, it.load); }
    if (qty || load) uses.push({ w, qty, load, unit });
  }
  const board = liftBoard(all, S.rm).find(r => r.key === key);
  const maxLoad = uses.reduce((m, u) => Math.max(m, u.load || 0), 0) || null;
  const total = uses.reduce((s, u) => s + u.qty, 0);
  const unit = uses[0]?.unit || def.unit || 'reps';
  // 내 페이스 추정 (메트콘 블록 시간 기반)
  const fit = fitPaces(all.filter(w => !isStrength(w)), body(), Date.now());
  const ratio = fit.ratio.get(`${key}:${unit}`);
  const base = priorPace(key, unit);
  const pace = ratio && base ? base * ratio : null;
  const strengthPts = all.filter(w => isStrength(w) && w.strength.items.length === 1 && w.strength.items[0].key === key).map(w => ({ date: w.date, value: strengthSummary(w)?.value })).filter(p => p.value).reverse();
  const loadPts = uses.filter(u => u.load).map(u => ({ date: u.w.date, value: u.load })).reverse();
  const pts = strengthPts.length >= 2 ? strengthPts : loadPts;
  paint(`
    <header class="bar"><button class="back" id="back">‹</button><h1>${esc(def.name)}</h1></header>
    <div class="card hero">
      <div class="k">${board?.oneRM ? `1RM (${board.source === 'manual' ? '실측' : '추정'})` : maxLoad ? '최고 무게' : '누적'}</div>
      <div class="hero-v">${board?.oneRM ? loadText(board.oneRM) : maxLoad ? loadText(maxLoad) : `${Math.round(total).toLocaleString()}<span class="small muted"> ${UNIT_LABEL[unit]}</span>`}</div>
      <div class="muted">${uses.length}일 기록${pace ? ` · 내 페이스 약 ${pace < 1 ? pace.toFixed(2) : pace.toFixed(1)}초/${UNIT_LABEL[unit]}` : ''}</div>
    </div>
    ${pace ? `<p class="g-foot top">메트콘 블록 시간으로 추정한 페이스예요. 중급 기준(${base}초) 대비 ${ratio.toFixed(2)}배${ratio < 1 ? '로 빠릅니다' : '입니다'}.</p>` : ''}
    ${pts.length >= 2 ? `<div class="card"><h2>${strengthPts.length >= 2 ? 'e1RM 추이' : '사용 무게 추이'}</h2><div id="moveChart"></div></div>` : ''}
    <div class="g-title"><span>기록 ${uses.length}</span></div>
    ${uses.length ? `<div class="cells">${uses.map(u => `<a class="cell" href="#/w/${u.w.id}"><span class="cell-main"><span class="cell-label">${dateLabel(u.w.date)} ${badge(u.w.level)}</span><span class="cell-sub">${esc(workoutName(u.w))}</span></span><span class="cell-value">${[u.qty ? `${numStr(u.qty)}${UNIT_LABEL[u.unit] === '회' ? '회' : ' ' + UNIT_LABEL[u.unit]}` : '', u.load ? loadText(u.load) : ''].filter(Boolean).join(' · ')}</span>${CHEV}</a>`).join('')}</div>` : '<div class="card empty small-empty"><p class="muted">아직 기록이 없어요</p></div>'}`, 'sub', 'move');
  $('#back').onclick = () => history.back();
  if (pts.length >= 2) lineChart($('#moveChart'), pts.map(p => ({ date: p.date, value: +showLoad(p.value), tip: `${dateLabel(p.date)}<br><b>${loadText(p.value)}</b>` })), { unit: LU() });
}

// ───────────────────────── 내 정보 (1RM · 체조 · 컨디션 · 설정)
async function renderMe() {
  const all = await db.listWorkouts();
  const board = liftBoard(all, S.rm);
  const conds = Object.entries(S.conds).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 7);
  const aliases = Object.entries(S.aliases);
  const unitSel = (k, label) => `<div class="cell"><span class="cell-label">${label}</span><span class="spacer"></span><div class="seg sm">${['lb', 'kg'].map(u => `<label><input type="radio" name="u-${k}" data-unit="${k}" value="${u}" ${S.units[k] === u ? 'checked' : ''}><span>${u}</span></label>`).join('')}</div></div>`;
  paint(`
    <h1>내 정보</h1>
    <div class="g-title"><span>1RM · PR</span><span class="muted small">탭해서 입력 · % 표</span></div>
    <div class="cells">${board.map(r => `<button class="cell" data-lift="${r.key}"><span class="cell-main"><span class="cell-label">${esc(r.name)}</span>${r.auto ? `<span class="cell-sub">기록 추정 ${loadText(r.auto.e1rm)} · ${dateLabel(r.auto.date)}</span>` : ''}</span><span class="cell-value ${r.oneRM ? 'strong' : ''}">${r.oneRM ? `${loadText(r.oneRM)}` : '입력'}</span>${r.source ? `<span class="tag ${r.source === 'manual' ? '' : 'soft'}">${r.source === 'manual' ? '실측' : '추정'}</span>` : ''}${CHEV}</button>`).join('')}</div>
    <div class="g-title"><span>체조 최대 횟수 (언브로큰)</span></div>
    <div class="cells">${GYM_MAX.map(k => `<button class="cell" data-gym="${k}"><span class="cell-label">${esc(BY_KEY[k].name)}</span><span class="spacer"></span><span class="cell-value ${S.gmax[k] ? 'strong' : ''}">${S.gmax[k] ? `${S.gmax[k]}회` : '입력'}</span>${CHEV}</button>`).join('')}</div>
    <div class="g-title"><span>컨디션 기록</span></div>
    ${conds.length ? `<div class="cells">${conds.map(([d, c]) => `<div class="cell"><span class="cell-label">${dateLabel(d)}</span><span class="spacer"></span><span class="cell-value">${[c.feel ? `${c.feel} ${FEEL[c.feel]}` : '', c.sore?.length ? c.sore.map(r => REGIONS[r]).join('·') : '', c.weight ? `${numStr(c.weight)}kg` : ''].filter(Boolean).join(' · ')}</span></div>`).join('')}</div>` : '<div class="cells"><a class="cell" href="#/"><span class="cell-label">오늘 탭에서 컨디션을 남겨 보세요</span><span class="spacer"></span>' + CHEV + '</a></div>'}

    <div class="g-title"><span>목표</span></div>
    <div class="cells">
      <div class="cell"><span class="cell-label">주간 출석 목표</span><span class="spacer"></span>${stepper('id="goal"', S.weeklyGoal, 1, '회', 'sm')}</div>
    </div>
    <div class="g-title"><span>신체 정보 (파워 계산)</span></div>
    <div class="cells">
      <div class="cell"><span class="cell-label">체중</span><span class="spacer"></span>${stepper('id="weight"', numStr(S.weight), 0.5, 'kg', 'sm')}</div>
      <div class="cell"><span class="cell-label">키</span><span class="spacer"></span>${stepper('id="height"', numStr(S.height), 1, 'cm', 'sm')}</div>
    </div>
    <div class="g-title"><span>처방 · 단위</span></div>
    <div class="cells">
      <div class="cell"><span class="cell-main"><span class="cell-label">A/B 처방 기준</span><span class="cell-sub">"65/95 lb"처럼 값이 두 개일 때</span></span><span class="spacer"></span><div class="seg sm"><label><input type="radio" name="side" value="max" ${S.side === 'max' ? 'checked' : ''}><span>남자</span></label><label><input type="radio" name="side" value="min" ${S.side === 'min' ? 'checked' : ''}><span>여자</span></label></div></div>
      <div class="cell"><span class="cell-label">표시 단위</span><span class="spacer"></span><div class="seg sm"><label><input type="radio" name="lu" value="lb" ${LU() === 'lb' ? 'checked' : ''}><span>lb</span></label><label><input type="radio" name="lu" value="kg" ${LU() === 'kg' ? 'checked' : ''}><span>kg</span></label></div></div>
    </div>
    <p class="g-foot">원문에 단위가 없을 때 해석</p>
    <div class="cells">${unitSel('bb', '바벨')}${unitSel('db', '덤벨')}${unitSel('ball', '월볼')}${unitSel('kb', '케틀벨')}${unitSel('other', '썰매·요크·샌드백')}</div>
    <div class="g-title"><span>레벨</span></div>
    <div class="cells">
      <div class="cell col"><span class="cell-label small-label">레벨 이름 (공지 순서, 쉼표로 구분)</span><input id="levels" class="bare" value="${esc(S.levels.join(', '))}"></div>
      <div class="cell"><span class="cell-main"><span class="cell-label">평소 레벨</span><span class="cell-sub">기록이 없을 때 추천 출발점</span></span><span class="spacer"></span><select id="baseLevel" class="plain-select inline"><option value="">자동</option>${S.levels.map(l => `<option ${l === S.baseLevel ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div>
    </div>
    <div class="g-title"><span>백업</span><span class="muted small">마지막 ${S.lastBackup ? esc(S.lastBackup.slice(0, 10)) : '없음'}</span></div>
    <div class="cells">
      <button class="cell" id="exp"><span class="cell-label">내보내기 (JSON)</span><span class="spacer"></span>${CHEV}</button>
      <button class="cell" id="imp"><span class="cell-label">가져오기</span><span class="spacer"></span>${CHEV}</button>
    </div>
    <input type="file" id="file" accept="application/json,.json" hidden>
    ${aliases.length ? `
      <div class="g-title"><span>학습된 운동 이름</span></div>
      <div class="cells">${aliases.map(([k, v]) => `<div class="cell"><span class="cell-label">${esc(k)}</span><span class="spacer"></span><span class="cell-value">${esc(BY_KEY[v]?.name || v)}</span><button class="icon" data-alias="${esc(k)}" aria-label="삭제">✕</button></div>`).join('')}</div>` : ''}
    <p class="muted small center" style="margin-top:20px">WOD Log v${APP_VERSION}</p>`, 'tab', 'me');

  view().querySelectorAll('[data-lift]').forEach(b => (b.onclick = () => liftPanel(b.dataset.lift, all)));
  view().querySelectorAll('[data-gym]').forEach(b => (b.onclick = () => gymPanel(b.dataset.gym)));
  const num = (id, fn) => ($('#' + id).onchange = e => { const v = toNum(e.target.value); if (v > 0) fn(v); });
  num('goal', v => saveSetting('weeklyGoal', Math.round(v)));
  num('weight', v => saveSetting('weight', v));
  num('height', v => saveSetting('height', v));
  view().querySelectorAll('input[name=side]').forEach(r => (r.onchange = () => { saveSetting('side', r.value); toast('저장했습니다'); }));
  view().querySelectorAll('input[name=lu]').forEach(r => (r.onchange = async () => { await saveSetting('loadUnit', r.value); renderMe(); }));
  view().querySelectorAll('[data-unit]').forEach(r => (r.onchange = () => { saveSetting('units', { ...S.units, [r.dataset.unit]: r.value }); toast('저장했습니다'); }));
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
    renderMe();
  };
  $('#imp').onclick = () => $('#file').click();
  $('#file').onchange = async e => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const n = await db.importAll(JSON.parse(await f.text()));
      await loadSettings();
      toast(`${n}개 기록을 가져왔습니다`);
      renderMe();
    } catch (err) {
      toast('가져오기 실패: ' + err.message);
    }
  };
  view().querySelectorAll('[data-alias]').forEach(b => (b.onclick = async () => {
    const next = { ...S.aliases };
    delete next[b.dataset.alias];
    await saveSetting('aliases', next);
    renderMe();
  }));
}

// 1RM 입력 + % 표 (원판 포함)
function liftPanel(key, all) {
  const draw = () => {
    const r = liftBoard(all, S.rm).find(x => x.key === key);
    const m = S.rm[key] || {};
    const rows = r.oneRM ? percentTable(r.oneRM) : [];
    return `
      <div class="cells">
        ${[['rm1', '1RM'], ['rm3', '3RM'], ['rm5', '5RM']].map(([k, l]) => `<div class="cell"><span class="cell-main"><span class="cell-label">${l} 실측</span>${k === 'rm1' && r.auto ? `<span class="cell-sub">기록 추정 ${loadText(r.auto.e1rm)}</span>` : k !== 'rm1' && r[k.replace('rm', 'rm')] && !m[k] ? `<span class="cell-sub">1RM 기준 약 ${loadText(r[k])}</span>` : ''}</span><span class="spacer"></span>${stepper(`data-rm="${k}"`, m[k] != null ? showLoad(m[k]) : '', loadStep(), LU(), 'sm')}</div>`).join('')}
      </div>
      ${rows.length ? `
        <div class="g-title"><span>% 무게표 · 1RM ${loadText(r.oneRM)}</span></div>
        <div class="cells pct-table">${rows.map(p => `<div class="cell"><span class="pct">${p.pct}%</span><span class="cell-label strong">${p.lb} lb</span><span class="spacer"></span><span class="cell-value">${p.plates ? (p.plates.perSide.length ? p.plates.perSide.join(' + ') : '바만') : '-'}</span></div>`).join('')}</div>
        <p class="g-foot">원판은 한쪽 기준 · 바 45 lb · 5 lb 단위 반올림</p>` : '<p class="g-foot">1RM을 입력하면 % 무게표가 나타나요</p>'}
      <div class="btns panel-btns">${S.rm[key] ? '<button class="danger" data-pa="clear">실측값 지우기</button>' : ''}<button class="primary" data-pa="ok">완료</button></div>`;
  };
  openPanel(BY_KEY[key].name, draw(), (el, close) => {
    el.onchange = async e => {
      const k = e.target.dataset.rm;
      if (!k) return;
      const v = readLoad(e.target.value);
      const cur = { ...(S.rm[key] || {}) };
      if (v) cur[k] = v;
      else delete cur[k];
      await saveSetting('rm', { ...S.rm, [key]: cur });
      el.innerHTML = draw();
    };
    el.onclick = async e => {
      const a = e.target.closest('[data-pa]')?.dataset.pa;
      if (a === 'clear') {
        const next = { ...S.rm };
        delete next[key];
        await saveSetting('rm', next);
        el.innerHTML = draw();
      } else if (a === 'ok') close(1);
    };
  }).then(() => renderMe());
}
function gymPanel(key) {
  openPanel(`${BY_KEY[key].name} 최대 횟수`, `
    <div class="cells"><div class="cell"><span class="cell-label">언브로큰 최대</span><span class="spacer"></span>${stepper('data-g="1"', S.gmax[key] ?? '', 1, '회')}</div></div>
    <div class="btns panel-btns"><button class="primary" data-pa="ok">완료</button></div>`, (el, close) => {
    el.onchange = async e => {
      if (!e.target.dataset.g) return;
      const v = toNum(e.target.value);
      const next = { ...S.gmax };
      if (v) next[key] = Math.round(v);
      else delete next[key];
      await saveSetting('gmax', next);
    };
    el.onclick = e => { if (e.target.closest('[data-pa]')) close(1); };
  }).then(() => renderMe());
}

// ───────────────────────── 시작
async function start() {
  await loadSettings();
  if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
  window.addEventListener('hashchange', route);
  document.querySelectorAll('nav a').forEach(a => a.addEventListener('click', () => {
    if (a.getAttribute('href') === (location.hash || '#/')) route();
  }));
  await route();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('./sw.js').catch(() => {});
}
start();
