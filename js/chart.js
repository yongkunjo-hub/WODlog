// 단일 시리즈 시계열 라인 차트 (SVG) + 탭/호버 툴팁
// points: [{ date: 'YYYY-MM-DD', value: number, tip: html }] (날짜 오름차순)

const NS = 'http://www.w3.org/2000/svg';

function niceTicks(min, max, count = 4) {
  if (min === max) { min -= 1; max += 1; }
  const span = max - min;
  const step0 = span / count;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map(f => f * mag).find(s => s >= step0);
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(+v.toFixed(6));
  return ticks;
}

function el(tag, attrs = {}, parent) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
}

const dayNum = d => Date.parse(d + 'T00:00:00Z') / 86400000;
const shortDate = d => `${+d.slice(5, 7)}/${+d.slice(8, 10)}`;

// trend: [{ date, value }] 를 주면 추세선(보조 시리즈)과 범례를 함께 그림
export function lineChart(container, points, { unit = '', fmt = v => Math.round(v).toLocaleString(), trend = null, labels = ['값', '추세'] } = {}) {
  container.innerHTML = '';
  container.classList.add('chart');
  if (!points.length) {
    container.innerHTML = '<p class="muted center">기록이 쌓이면 그래프가 표시됩니다</p>';
    return;
  }
  if (trend?.length) {
    const lg = document.createElement('div');
    lg.className = 'legend';
    lg.innerHTML = `<span><i class="key-dot"></i>${labels[0]}</span><span><i class="key-line"></i>${labels[1]}</span>`;
    container.appendChild(lg);
  }
  const W = Math.max(container.clientWidth || 340, 280);
  const H = 220;
  const m = { l: 44, r: 16, t: 20, b: 28 };
  const iw = W - m.l - m.r;
  const ih = H - m.t - m.b;

  const vals = points.map(p => p.value).concat((trend || []).map(p => p.value));
  const ticks = niceTicks(Math.min(...vals), Math.max(...vals));
  const y0 = ticks[0];
  const y1 = ticks[ticks.length - 1];
  const xs = points.map(p => dayNum(p.date));
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const X = d => (x1 === x0 ? m.l + iw / 2 : m.l + ((d - x0) / (x1 - x0)) * iw);
  const Y = v => m.t + ih - ((v - y0) / (y1 - y0)) * ih;

  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', height: H, role: 'img', 'aria-label': '추이 그래프' }, container);

  for (const t of ticks) {
    el('line', { x1: m.l, x2: W - m.r, y1: Y(t), y2: Y(t), class: t === y0 ? 'axis' : 'grid' }, svg);
    el('text', { x: m.l - 6, y: Y(t) + 4, 'text-anchor': 'end', class: 'tick' }, svg).textContent = fmt(t);
  }
  if (unit) el('text', { x: m.l - 6, y: m.t - 8, 'text-anchor': 'end', class: 'tick' }, svg).textContent = unit;

  // x축 라벨: 처음·마지막 (+ 가운데). 서로 44px 안으로 붙으면 마지막만 남김
  const xl = [points[0], points[points.length - 1]];
  if (points.length > 4) xl.splice(1, 0, points[Math.floor(points.length / 2)]);
  let uniq = [...new Map(xl.map(p => [p.date, p])).values()];
  const lastX = X(dayNum(uniq.at(-1).date));
  uniq = uniq.filter((p, i) => i === uniq.length - 1 || lastX - X(dayNum(p.date)) > 44);
  for (let i = uniq.length - 2; i > 0; i--) if (X(dayNum(uniq[i].date)) - X(dayNum(uniq[i - 1].date)) < 44) uniq.splice(i, 1);
  uniq.forEach((p, i) => {
    const anchor = points.length === 1 ? 'middle' : i === uniq.length - 1 ? 'end' : i === 0 ? 'start' : 'middle';
    el('text', { x: X(dayNum(p.date)), y: H - 8, 'text-anchor': anchor, class: 'tick' }, svg).textContent = shortDate(p.date);
  });

  if (trend?.length > 1) {
    const tp = trend.map(p => [X(dayNum(p.date)), Y(p.value)].map(n => n.toFixed(1)).join(','));
    el('path', { d: 'M' + tp.join('L'), class: 'trend-line' }, svg);
  }

  const pts = points.map(p => [X(dayNum(p.date)), Y(p.value)]);
  if (pts.length > 1) {
    el('path', { d: 'M' + pts.map(p => p.map(n => n.toFixed(1)).join(',')).join('L'), class: 'series-line' }, svg);
  }
  const showDots = points.length <= 40;
  if (showDots) pts.forEach(([x, y]) => el('circle', { cx: x, cy: y, r: 4, class: 'series-dot' }, svg));

  // 마지막 값 직접 라벨
  const [lx, ly] = pts[pts.length - 1];
  el('circle', { cx: lx, cy: ly, r: 5, class: 'series-dot' }, svg);
  el('text', { x: Math.min(lx, W - m.r), y: ly - 10, 'text-anchor': 'end', class: 'end-label' }, svg).textContent = fmt(points[points.length - 1].value) + (unit ? ' ' + unit : '');

  // 상호작용 레이어
  const cross = el('line', { y1: m.t, y2: m.t + ih, class: 'crosshair', visibility: 'hidden' }, svg);
  const focus = el('circle', { r: 6, class: 'series-dot focus', visibility: 'hidden' }, svg);
  const tip = document.createElement('div');
  tip.className = 'tooltip';
  tip.hidden = true;
  container.appendChild(tip);
  const hit = el('rect', { x: m.l - 10, y: 0, width: iw + 20, height: H, fill: 'transparent' }, svg);

  function show(clientX) {
    const r = svg.getBoundingClientRect();
    const sx = ((clientX - r.left) / r.width) * W;
    let best = 0;
    pts.forEach((p, i) => { if (Math.abs(p[0] - sx) < Math.abs(pts[best][0] - sx)) best = i; });
    const [px, py] = pts[best];
    cross.setAttribute('x1', px); cross.setAttribute('x2', px); cross.setAttribute('visibility', 'visible');
    focus.setAttribute('cx', px); focus.setAttribute('cy', py); focus.setAttribute('visibility', 'visible');
    tip.innerHTML = points[best].tip || `${points[best].date}<br><b>${fmt(points[best].value)} ${unit}</b>`;
    tip.hidden = false;
    const scale = r.width / W;
    const offY = r.top - container.getBoundingClientRect().top;
    const left = Math.min(Math.max(px * scale - tip.offsetWidth / 2, 0), r.width - tip.offsetWidth);
    tip.style.left = left + 'px';
    tip.style.top = Math.max(offY + py * scale - tip.offsetHeight - 14, 0) + 'px';
  }
  function hide() {
    cross.setAttribute('visibility', 'hidden');
    focus.setAttribute('visibility', 'hidden');
    tip.hidden = true;
  }
  hit.addEventListener('pointermove', e => show(e.clientX));
  hit.addEventListener('pointerdown', e => show(e.clientX));
  hit.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') hide(); });
}
