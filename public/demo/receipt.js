// 체험 데모의 '샘플 영수증으로 해 보기'. 이자카야 영수증을 캔버스에 그려 사진을 고른 것처럼 넘긴다(그림 파일을 따로 두지 않는다).
// 가상의 가게·금액이다. 방 화면(room.js)이 체험 데모일 때만 불러온다
import { DEMO_EXPENSES } from '../data.js';

// 영수증에 찍힌 일본어 메뉴 이름(화면에는 서버가 읽은 한국어 이름이 들어간다)
const PRINTED = { beer: '生ビール', highball: 'ハイボール', oolong: '烏龍茶', yakitori: '焼鳥盛合せ', karaage: '唐揚げ', sashimi: '刺身盛合せ', ochazuke: 'お茶漬け' };
const FONT = '"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", "Apple SD Gothic Neo", sans-serif';
const yen = (n) => `¥${n.toLocaleString('ja-JP')}`;

export function sampleReceiptFile() {
  const items = DEMO_EXPENSES.find((e) => e.id === 'izakaya').items;
  const W = 560;
  const H = 300 + items.length * 34 + 150;
  const canvas = Object.assign(document.createElement('canvas'), { width: W, height: H });
  const g = canvas.getContext('2d');
  g.fillStyle = '#fbfaf6';
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#1d1d1f';
  const text = (s, x, y, { size = 22, weight = 400, align = 'left' } = {}) => {
    g.font = `${weight} ${size}px ${FONT}`;
    g.textAlign = align;
    g.fillText(s, x, y);
  };
  const rule = (y) => { g.fillRect(36, y, W - 72, 2); };
  text('居酒屋 なにわ', W / 2, 72, { size: 34, weight: 700, align: 'center' });
  text('大阪市中央区 (SAMPLE)', W / 2, 108, { size: 18, align: 'center' });
  text('2026/11/07 20:45', W / 2, 138, { size: 18, align: 'center' });
  rule(162);
  let y = 204;
  for (const it of items) {
    text(PRINTED[it.id] ?? it.name, 40, y);
    text(`${it.qty} × ${yen(it.unit)}`, 340, y, { size: 18, align: 'right' });
    text(yen(it.qty * it.unit), W - 40, y, { align: 'right' });
    y += 34;
  }
  rule(y - 8);
  const total = items.reduce((s, it) => s + it.qty * it.unit, 0);
  text('合計', 40, y + 36, { size: 26, weight: 700 });
  text(yen(total), W - 40, y + 36, { size: 26, weight: 700, align: 'right' });
  text('現金', 40, y + 72, { size: 18 });
  // 데모용임을 사진 안에서도 알린다
  g.save();
  g.translate(W / 2, H / 2);
  g.rotate(-0.35);
  g.fillStyle = 'rgba(215, 0, 21, 0.14)';
  text('SAMPLE · 체험 데모', 0, 0, { size: 46, weight: 800, align: 'center' });
  g.restore();
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(new File([blob], 'sample-receipt.jpg', { type: 'image/jpeg' })), 'image/jpeg', 0.85));
}
