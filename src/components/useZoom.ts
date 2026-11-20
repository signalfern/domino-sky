import { useEffect, useRef, useState } from 'react';

/** SVG view-box zoom & pan: wheel or pinch to zoom at the pointer, drag to pan, plus buttons. */
interface Box { x: number; y: number; w: number; h: number }
const lim = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
function fit(v: Box, W: number, H: number, maxZoom: number): Box {
  const w = lim(v.w, W / maxZoom, W);
  const h = (w * H) / W;
  return { w, h, x: lim(v.x, 0, W - w), y: lim(v.y, 0, H - h) };
}

/** Wheel / pinch to zoom, drag to pan, buttons for +, - and reset. */
export function useZoom(W: number, H: number, maxZoom: number) {
  const FULL: Box = { x: 0, y: 0, w: W, h: H };
  const svgRef = useRef<SVGSVGElement>(null);
  const [vb, setVb] = useState<Box>(() => ({ x: 0, y: 0, w: W, h: H }));
  const vbRef = useRef(vb);
  vbRef.current = vb;
  const drag = useRef({ pts: new Map<number, { x: number; y: number }>(), moved: false, dist: 0 });

  const toSvg = (cx: number, cy: number) => {
    const svg = svgRef.current;
    const m = svg?.getScreenCTM();
    if (!svg || !m) return { x: vbRef.current.x + vbRef.current.w / 2, y: vbRef.current.y + vbRef.current.h / 2 };
    const pt = svg.createSVGPoint();
    pt.x = cx;
    pt.y = cy;
    return pt.matrixTransform(m.inverse());
  };
  const zoomAt = (cx: number, cy: number, f: number) => {
    const p = toSvg(cx, cy);
    const v = vbRef.current;
    setVb(fit({ w: v.w / f, h: v.h / f, x: p.x - (p.x - v.x) / f, y: p.y - (p.y - v.y) / f }, W, H, maxZoom));
  };
  const zoomCenter = (f: number) => {
    const r = svgRef.current!.getBoundingClientRect();
    zoomAt(r.left + r.width / 2, r.top + r.height / 2, f);
  };

  useEffect(() => {
    const svg = svgRef.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0018));
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
    // zoomAt reads the latest view box through a ref, so the listener is attached once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const end = (e: React.PointerEvent) => {
    drag.current.pts.delete(e.pointerId);
    if (drag.current.pts.size < 2) drag.current.dist = 0;
  };
  const handlers = {
    onPointerDown: (e: React.PointerEvent) => {
      drag.current.pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      drag.current.moved = false;
      if (drag.current.pts.size === 2) {
        const [a, b] = [...drag.current.pts.values()];
        drag.current.dist = Math.hypot(a.x - b.x, a.y - b.y);
      }
    },
    onPointerMove: (e: React.PointerEvent) => {
      const d = drag.current;
      const prev = d.pts.get(e.pointerId);
      if (!prev) return;
      const cur = { x: e.clientX, y: e.clientY };
      if (d.pts.size === 1) {
        if (vbRef.current.w >= W - 0.5) return; // nothing to pan at full view
        if (!d.moved && Math.hypot(cur.x - prev.x, cur.y - prev.y) < 4) return;
        if (!d.moved) svgRef.current?.setPointerCapture(e.pointerId);
        d.moved = true;
        const m = svgRef.current?.getScreenCTM();
        const k = m ? m.a : 1;
        const v = vbRef.current;
        setVb(fit({ ...v, x: v.x - (cur.x - prev.x) / k, y: v.y - (cur.y - prev.y) / k }, W, H, maxZoom));
        d.pts.set(e.pointerId, cur);
      } else if (d.pts.size === 2) {
        d.pts.set(e.pointerId, cur);
        const [a, b] = [...d.pts.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        if (d.dist > 0) zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, dist / d.dist);
        d.dist = dist;
        d.moved = true;
      }
    },
    onPointerUp: end,
    onPointerCancel: end,
    onClickCapture: (e: React.MouseEvent) => {
      if (drag.current.moved) {
        e.stopPropagation();
        drag.current.moved = false;
      }
    },
  };
  return { svgRef, vb, zoomed: vb.w < W - 0.5, handlers, zoomIn: () => zoomCenter(1.6), zoomOut: () => zoomCenter(1 / 1.6), reset: () => setVb(FULL) };
}
