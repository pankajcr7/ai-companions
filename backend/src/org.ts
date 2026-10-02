/** True when giving `agentId` the manager `managerId` would create a reporting loop. */
export function createsCycle(agentId: string, managerId: string, managerOf: Map<string, string | null>): boolean {
  const seen = new Set<string>();
  for (let cur: string | null | undefined = managerId; cur; cur = managerOf.get(cur)) {
    if (cur === agentId || seen.has(cur)) return true;
    seen.add(cur);
  }
  return false;
}
