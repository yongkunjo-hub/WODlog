// 공유 카드: 1080×1350 (4:5, 인스타 피드·스토리 겸용) PNG
// card: { date, title, level, big, bigLabel, lines: [string], prs: [string] }

const W = 1080;
const H = 1350;
const FONT = '"Pretendard Variable", Pretendard, -apple-system, "Apple SD Gothic Neo", "Noto Sans KR", Roboto, sans-serif';

function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// 폭을 넘으면 말줄임
function fit(ctx, text, maxW) {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
  return t + '…';
}

export function drawCard(card) {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');
  // 색: 선택한 디자인의 포인트 색 (없으면 블루)
  const C = { accent: '#3182f6', press: '#1b4fd6', ink: '#ffffff', ...(card.colors || {}) };
  const ink = a => {
    ctx.fillStyle = C.ink;
    ctx.globalAlpha = a;
  };

  // 배경: 포인트 색 그라데이션
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, C.accent);
  g.addColorStop(1, C.press);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // 상단: 앱 이름 · 날짜
  ink(0.75);
  ctx.font = `700 34px ${FONT}`;
  ctx.fillText('WOD LOG', 80, 120);
  ctx.textAlign = 'right';
  ctx.font = `600 34px ${FONT}`;
  ctx.fillText(card.date, W - 80, 120);
  ctx.textAlign = 'left';

  // 제목 · 레벨
  ink(1);
  ctx.font = `800 64px ${FONT}`;
  ctx.fillText(fit(ctx, card.title || 'WOD', W - 160), 80, 250);
  if (card.level) {
    ctx.font = `700 34px ${FONT}`;
    const tw = ctx.measureText(card.level).width + 44;
    ink(0.2);
    rr(ctx, 80, 290, tw, 60, 18);
    ctx.fill();
    ink(1);
    ctx.fillText(card.level, 102, 332);
  }

  // 큰 숫자
  ink(0.75);
  ctx.font = `600 36px ${FONT}`;
  ctx.fillText(card.bigLabel || '', 80, 470);
  ink(1);
  ctx.font = `800 190px ${FONT}`;
  ctx.fillText(card.big || '-', 72, 640);

  // 결과 카드
  const lines = (card.lines || []).slice(0, 5);
  const boxY = 710;
  const boxH = 70 + lines.length * 64;
  ink(0.14);
  rr(ctx, 60, boxY, W - 120, boxH, 36);
  ctx.fill();
  ink(1);
  ctx.font = `600 40px ${FONT}`;
  lines.forEach((l, i) => ctx.fillText(fit(ctx, l, W - 220), 110, boxY + 82 + i * 64));

  // PR 배지
  let y = boxY + boxH + 70;
  for (const pr of (card.prs || []).slice(0, 3)) {
    ctx.font = `700 38px ${FONT}`;
    const text = fit(ctx, `🏆 ${pr}`, W - 200);
    const tw = ctx.measureText(text).width + 60;
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#ffd43b';
    rr(ctx, 60, y - 52, tw, 76, 24);
    ctx.fill();
    ctx.fillStyle = '#191f28';
    ctx.fillText(text, 90, y);
    y += 96;
  }
  return c;
}

// 공유 시트(Android/iOS) → 안 되면 이미지를 돌려줘 화면에 보여주고 길게 눌러 저장
export async function shareCard(card) {
  const canvas = drawCard(card);
  const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
  const file = new File([blob], `wodlog-${card.date}.png`, { type: 'image/png' });
  try {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: card.title });
      return { shared: true, url: null };
    }
  } catch (e) {
    if (e?.name === 'AbortError') return { shared: false, url: null, cancelled: true };
  }
  return { shared: false, url: canvas.toDataURL('image/png') };
}
