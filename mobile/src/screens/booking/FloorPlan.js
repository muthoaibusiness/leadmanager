// The floor plan, drawn: the phone version of the web's FloorCanvas.jsx. The same
// data (textFloor() and landmarks() in src/lib/floorText.js: every unit a tile at its
// own position and size, the building outline, lifts, stairs, parking and the rest),
// drawn in SVG instead of CSS. Zoom is the web's +/- steps; a zoomed plan scrolls
// both ways. A tap on a tile picks it.
import { useState } from 'react';
import { ScrollView, View, useWindowDimensions } from 'react-native';
import Svg, { G, Polygon, Rect, Text as SvgText } from 'react-native-svg';
import { Button, Row, T } from '../../ui';
import { useTheme, space, radius } from '../../theme';
import { shortCode, takaShort } from '../../../../src/lib/floorText.js';
import { tileColors } from './bits';

export const ZOOMS = [1, 1.5, 2, 3, 4]; // ShopBookingView ZOOMS: plan width as a multiple of the box
const VW = 1000; // the drawing's width in SVG units; its height follows the floor's aspect

// landmarks().hull is a CSS clip-path, "polygon(12.5% 40%, …)": back to 0–1 points.
const hullPoints = (hull) => (hull ? [...hull.matchAll(/(-?[\d.]+)%\s+(-?[\d.]+)%/g)].map((m) => [m[1] / 100, m[2] / 100]) : null);

// Mark colours per kind (ShopBooking.css .bk-mark.k-*), from the phone theme.
function markStyle(t, kind) {
  switch (kind) {
    case 'lift': return { fill: t.raised, stroke: t.sub };
    case 'cargo': return { fill: t.raised, stroke: t.warn };
    case 'stair': return { fill: t.line, stroke: t.mute };
    case 'escalator': case 'esclane': return { fill: t.card, stroke: t.warn };
    case 'void': return { fill: 'none', stroke: t.mute, dash: true };
    case 'wc': case 'kiosk': return { fill: t.card, stroke: t.info };
    case 'service': return { fill: t.card, stroke: t.mute, dash: true };
    case 'plant': return { fill: t.brand, stroke: 'none', round: true, opacity: 0.55 };
    case 'seating': return { fill: t.warnSoft, stroke: t.warn, dash: true };
    case 'parking': return { fill: t.line, stroke: t.info };
    case 'zone': return { fill: t.brandSoft, stroke: t.brand, dash: true };
    case 'label': return { fill: 'none', stroke: 'none' };
    default: return { fill: t.line, stroke: t.mute };
  }
}

// One text size that fits a tile (FloorCanvas codeFit(): mono, about 0.62 em a character).
const fitText = (w, h, text, max) => Math.max(5, Math.min(max, h * 0.42, (w - 6) / (0.62 * Math.max(1, String(text).length))));

export default function FloorPlan({ floor, lm, shopCode, onPick }) {
  const t = useTheme();
  const { width } = useWindowDimensions();
  const [zoom, setZoom] = useState(1);
  const box = width - space.lg * 2;
  const W = box * zoom;
  const VH = VW / floor.aspect;
  const H = W / floor.aspect;
  const hull = hullPoints(lm.hull);
  const scaled = (list) => list.map(([x, y]) => `${(x * VW).toFixed(1)},${(y * VH).toFixed(1)}`).join(' ');

  const zoomOut = () => setZoom([...ZOOMS].reverse().find((z) => z < zoom - 0.01) ?? 1);
  const zoomIn = () => setZoom(ZOOMS.find((z) => z > zoom + 0.01) ?? ZOOMS[ZOOMS.length - 1]);

  const plan = (
    <Svg width={W} height={H} viewBox={`0 0 ${VW} ${VH}`}>
      {hull ? <Polygon points={scaled(hull)} fill={t.card} stroke={t.mute} strokeWidth={2} /> : null}

      {lm.marks.map((m, i) => {
        const s = markStyle(t, m.kind);
        const x = m.x * VW, y = m.y * VH, w = m.w * VW, h = m.h * VH;
        const shape = m.clip
          ? <Polygon points={scaled(m.clip.map(([cx, cy]) => [m.x + cx * m.w, m.y + cy * m.h]))} fill={s.fill} stroke={s.stroke} strokeWidth={1.5} strokeDasharray={s.dash ? '6 4' : undefined} opacity={s.opacity} />
          : <Rect x={x} y={y} width={w} height={h} rx={s.round ? Math.min(w, h) / 2 : 3} fill={s.fill} stroke={s.stroke} strokeWidth={1.5} strokeDasharray={s.dash ? '6 4' : undefined} opacity={s.opacity} />;
        const fs = m.label ? fitText(w, h, m.label, 16) : 0;
        return (
          <G key={`m${i}`}>
            {shape}
            {m.label && fs >= 5 ? (
              <SvgText x={x + w / 2} y={y + h / 2 + fs * 0.35} fontSize={fs} fontWeight="600" fill={m.kind === 'label' ? t.mute : t.sub} textAnchor="middle">
                {m.label}
              </SvgText>
            ) : null}
          </G>
        );
      })}

      {floor.shops.map((s) => {
        const c = tileColors(t, s);
        const on = shopCode === s.code;
        const x = s.x * VW, y = s.y * VH, w = s.w * VW, h = s.h * VH;
        const code = shortCode(s.code);
        const big = s.w >= 0.3 && s.shape;
        const fs = fitText(w, h, code, big ? 48 : 36);
        const second = h > fs * 2.7;
        const third = h > fs * 3.9 && s.w >= 0.085;
        const sub = `${s.size || ''}${s.size && s.w >= 0.075 ? ' sft' : ''}`;
        const price = s.status === 'available' ? (takaShort(s.price) || '') : s.look.label;
        const stroke = on ? t.text : c.stroke;
        const sw = on ? 4 : 1.5;
        const lines = 1 + (second && sub ? 1 : 0) + (third && price ? 1 : 0);
        const top = y + h / 2 - ((lines - 1) * fs * 0.95) / 2 + fs * 0.35;
        return (
          <G key={s.code} onPress={() => onPick(s.code)} accessibilityLabel={`${s.code}, ${s.size} sq ft, ${s.look.label}`}>
            {s.shape
              ? <Polygon points={scaled(s.shape.map(([px, py]) => [s.x + px * s.w, s.y + py * s.h]))} fill={c.fill} stroke={stroke} strokeWidth={sw} strokeDasharray={c.dash && !on ? '6 4' : undefined} />
              : <Rect x={x + 1} y={y + 1} width={Math.max(1, w - 2)} height={Math.max(1, h - 2)} rx={4} fill={c.fill} stroke={stroke} strokeWidth={sw} strokeDasharray={c.dash && !on ? '6 4' : undefined} />}
            <SvgText x={x + w / 2} y={top} fontSize={fs} fontWeight="700" fill={c.text} textAnchor="middle"
              textDecoration={s.status === 'sold' ? 'line-through' : undefined}>{code}</SvgText>
            {second && sub ? <SvgText x={x + w / 2} y={top + fs * 0.95} fontSize={fs * 0.72} fill={t.sub} textAnchor="middle">{sub}</SvgText> : null}
            {third && price ? <SvgText x={x + w / 2} y={top + fs * 1.9} fontSize={fs * 0.72} fill={t.sub} textAnchor="middle">{price}</SvgText> : null}
          </G>
        );
      })}
    </Svg>
  );

  return (
    <View style={{ gap: space.sm }}>
      <Row style={{ justifyContent: 'flex-end' }}>
        <Button label="−" variant="ghost" small full={false} disabled={zoom <= 1} onPress={zoomOut} />
        <Button label={zoom === 1 ? 'Fit' : `${Math.round(zoom * 100)}%`} variant="ghost" small full={false} onPress={() => setZoom(1)} />
        <Button label="+" variant="ghost" small full={false} disabled={zoom >= ZOOMS[ZOOMS.length - 1]} onPress={zoomIn} />
      </Row>
      <View style={{ height: Math.min(H, box * 1.35), borderRadius: radius.md, backgroundColor: t.bg, borderWidth: 1, borderColor: t.line, overflow: 'hidden' }}>
        <ScrollView horizontal nestedScrollEnabled showsHorizontalScrollIndicator={zoom > 1} scrollEnabled={zoom > 1}>
          <ScrollView nestedScrollEnabled showsVerticalScrollIndicator={H > box * 1.35}>
            {plan}
          </ScrollView>
        </ScrollView>
      </View>
      {zoom > 1 ? <T v="tiny" tone="mute" style={{ textAlign: 'center' }}>Drag to move the plan. Tap a unit to open it.</T> : null}
    </View>
  );
}
