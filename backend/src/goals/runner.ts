// ponytail: in-process runner; move to a job table with SKIP LOCKED if the backend ever runs as several instances.
const controllers = new Map<string, Set<AbortController>>();

export function controllerFor(goalId: string): AbortController {
  const c = new AbortController();
  let set = controllers.get(goalId);
  if (!set) controllers.set(goalId, (set = new Set()));
  set.add(c);
  return c;
}

export function release(goalId: string, c: AbortController) {
  const set = controllers.get(goalId);
  set?.delete(c);
  if (set && !set.size) controllers.delete(goalId);
}

export function abortGoal(goalId: string) {
  for (const c of controllers.get(goalId) ?? []) c.abort();
  controllers.delete(goalId);
}

/** Schedules ready tasks. Filled in by Task 5. */
export function kickGoal(_goalId: string) {}
