/* ============================================================================
   Canvas geometry.

   Nodes carry positions; enclosures are *derived* from the nodes they hold, so
   dragging a node grows its boundary instead of escaping it. Every hop between
   two boundaries therefore crosses two enclosure walls, and those crossings are
   the ports the canvas draws.
   ========================================================================= */

export type BoundaryId = "agent" | "tool" | "app" | "impact";
export type Point = { x: number; y: number };
export type Rect = { x: number; y: number; w: number; h: number };
export type Positions = Record<string, Point>;

export const NODE_W = 176;
export const NODE_H = 88;

/** Breathing room between a node and its enclosure wall. */
const PAD = 28;
/** Extra headroom at the top of an enclosure for its label tab. */
const TAB = 26;
/** Corner radius on routed connections. */
const BEND = 9;

export const boundaries: { id: BoundaryId; label: string; nodes: string[] }[] = [
  { id: "agent", label: "Agent intent", nodes: ["evt_001"] },
  { id: "tool", label: "Tool boundary", nodes: ["call_checkout_01"] },
  { id: "app", label: "Application", nodes: ["req_checkout_42", "state_payment_07", "render_checkout_12"] },
  { id: "impact", label: "User impact", nodes: ["error_type_01"] }
];

export const boundaryOf = (nodeId: string): BoundaryId =>
  boundaries.find((boundary) => boundary.nodes.includes(nodeId))!.id;

export const initialPositions: Positions = {
  evt_001: { x: 40, y: 60 },
  call_checkout_01: { x: 300, y: 60 },
  req_checkout_42: { x: 560, y: 60 },
  state_payment_07: { x: 560, y: 300 },
  render_checkout_12: { x: 560, y: 440 },
  error_type_01: { x: 200, y: 660 }
};

/** `h` hops leave the right edge and enter the left; `v` hops top-to-bottom. */
export type Edge = { from: string; to: string; axis: "h" | "v"; hop: string };

export const edges: Edge[] = [
  { from: "evt_001", to: "call_checkout_01", axis: "h", hop: "4ms" },
  { from: "call_checkout_01", to: "req_checkout_42", axis: "h", hop: "28ms" },
  { from: "req_checkout_42", to: "state_payment_07", axis: "v", hop: "1.19s" },
  { from: "state_payment_07", to: "render_checkout_12", axis: "v", hop: "5ms" },
  { from: "render_checkout_12", to: "error_type_01", axis: "v", hop: "8ms" }
];

export const nodeRect = (point: Point): Rect => ({ ...point, w: NODE_W, h: NODE_H });

export function enclosureRect(nodeIds: string[], positions: Positions): Rect {
  const rects = nodeIds.map((id) => nodeRect(positions[id]));
  const left = Math.min(...rects.map((r) => r.x)) - PAD;
  const top = Math.min(...rects.map((r) => r.y)) - PAD - TAB;
  const right = Math.max(...rects.map((r) => r.x + r.w)) + PAD;
  const bottom = Math.max(...rects.map((r) => r.y + r.h)) + PAD;
  return { x: left, y: top, w: right - left, h: bottom - top };
}

export type Route = { d: string; from: Point; to: Point };

/** Right-angle routing — a schematic runs traces, it does not draw beziers. */
export function routeEdge(a: Rect, b: Rect, axis: "h" | "v"): Route {
  if (axis === "h") {
    const from = { x: a.x + a.w, y: a.y + a.h / 2 };
    const to = { x: b.x, y: b.y + b.h / 2 };
    if (Math.abs(from.y - to.y) < 1) return { d: `M ${from.x} ${from.y} H ${to.x}`, from, to };
    const mid = (from.x + to.x) / 2;
    const step = to.y > from.y ? 1 : -1;
    const d = [
      `M ${from.x} ${from.y}`,
      `H ${mid - BEND}`,
      `Q ${mid} ${from.y} ${mid} ${from.y + BEND * step}`,
      `V ${to.y - BEND * step}`,
      `Q ${mid} ${to.y} ${mid + BEND} ${to.y}`,
      `H ${to.x}`
    ].join(" ");
    return { d, from, to };
  }

  const from = { x: a.x + a.w / 2, y: a.y + a.h };
  const to = { x: b.x + b.w / 2, y: b.y };
  if (Math.abs(from.x - to.x) < 1) return { d: `M ${from.x} ${from.y} V ${to.y}`, from, to };
  const mid = (from.y + to.y) / 2;
  const step = to.x > from.x ? 1 : -1;
  const d = [
    `M ${from.x} ${from.y}`,
    `V ${mid - BEND}`,
    `Q ${from.x} ${mid} ${from.x + BEND * step} ${mid}`,
    `H ${to.x - BEND * step}`,
    `Q ${to.x} ${mid} ${to.x} ${mid + BEND}`,
    `V ${to.y}`
  ].join(" ");
  return { d, from, to };
}

/** Where a hop punches through the two enclosure walls. Empty for hops that
 *  stay inside one boundary — those cross nothing and should not claim to. */
export function portsFor(axis: "h" | "v", route: Route, out: Rect, into: Rect): Point[] {
  return axis === "h"
    ? [{ x: out.x + out.w, y: route.from.y }, { x: into.x, y: route.to.y }]
    : [{ x: route.from.x, y: out.y + out.h }, { x: route.to.x, y: into.y }];
}

export function worldBounds(positions: Positions): Rect {
  const rects = boundaries.map((boundary) => enclosureRect(boundary.nodes, positions));
  const left = Math.min(...rects.map((r) => r.x));
  const top = Math.min(...rects.map((r) => r.y));
  const right = Math.max(...rects.map((r) => r.x + r.w));
  const bottom = Math.max(...rects.map((r) => r.y + r.h));
  return { x: left, y: top, w: right - left, h: bottom - top };
}
