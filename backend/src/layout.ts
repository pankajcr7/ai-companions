export type Zone = { departmentId: string; x: number; y: number; w: number; h: number };
export type Layout = { zones: Zone[]; desks: Record<string, { x: number; y: number }> };

export const UNASSIGNED = "unassigned";

const COLS = 3;
const ZONE_W = 460;
const GAP = 48;
const PER_ROW = 3;
const DESK_X = 140;
const DESK_Y = 130;
const TOP = 80;

const contains = (z: Zone, p: { x: number; y: number }) => p.x >= z.x && p.x <= z.x + z.w && p.y >= z.y && p.y <= z.y + z.h;

/**
 * Departments in a 3-column grid, desks in a 3-per-row grid inside each zone.
 * A previous desk position is kept when its zone did not move and the desk was inside it,
 * so user drags survive adding companions.
 */
export function autoLayout(
  departmentIds: string[],
  agents: { id: string; departmentId: string | null }[],
  prev?: Layout,
): Layout {
  const ids = [...departmentIds];
  const groups = new Map(ids.map((id) => [id, [] as string[]]));
  const lobby: string[] = [];
  for (const a of agents) (a.departmentId && groups.has(a.departmentId) ? groups.get(a.departmentId)! : lobby).push(a.id);
  if (lobby.length) {
    ids.push(UNASSIGNED);
    groups.set(UNASSIGNED, lobby);
  }

  const zones: Zone[] = [];
  const desks: Layout["desks"] = {};
  let y = 0;
  for (let row = 0; row < ids.length; row += COLS) {
    const rowIds = ids.slice(row, row + COLS);
    const rows = Math.max(1, ...rowIds.map((id) => Math.ceil(groups.get(id)!.length / PER_ROW)));
    const h = TOP + rows * DESK_Y;
    rowIds.forEach((id, col) => {
      const zone: Zone = { departmentId: id, x: col * (ZONE_W + GAP), y, w: ZONE_W, h };
      zones.push(zone);
      const prevZone = prev?.zones.find((z) => z.departmentId === id);
      groups.get(id)!.forEach((agentId, i) => {
        const old = prev?.desks[agentId];
        const keep = old && prevZone && prevZone.x === zone.x && prevZone.y === zone.y && contains(prevZone, old);
        desks[agentId] = keep
          ? old
          : { x: zone.x + 90 + (i % PER_ROW) * DESK_X, y: zone.y + TOP + 40 + Math.floor(i / PER_ROW) * DESK_Y };
      });
    });
    y += h + GAP;
  }
  return { zones, desks };
}
