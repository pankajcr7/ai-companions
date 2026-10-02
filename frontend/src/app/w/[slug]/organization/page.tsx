"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, Trash } from "@phosphor-icons/react";
import { api } from "@/lib/api";
import { canAdmin, statusLabel, type Agent } from "@/lib/types";
import { useWorkspace } from "@/lib/workspace";
import { CompanionAvatar } from "@/components/app/CompanionAvatar";

function Tree({ agents, managerId }: { agents: Agent[]; managerId: string }) {
  const reports = agents.filter((a) => a.managerId === managerId && a.status !== "archived");
  if (!reports.length) return null;
  return (
    <ul className="ml-5 border-l border-line pl-4">
      {reports.map((a) => (
        <li key={a.id} className="py-1.5">
          <span className="flex flex-wrap items-center gap-x-2 text-sm">
            <CompanionAvatar look={a.appearance} size={28} /> <span className="font-medium">{a.name}</span> <span className="text-muted">{a.role}, {statusLabel(a)}</span>
          </span>
          <Tree agents={agents} managerId={a.id} />
        </li>
      ))}
    </ul>
  );
}

export default function Organization() {
  const { snapshot, reload, wsPath } = useWorkspace();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const admin = canAdmin(snapshot.role);
  const depts = snapshot.departments;
  const head = snapshot.agents.find((a) => a.isHead);
  const loose = snapshot.agents.filter((a) => !a.isHead && !a.managerId && a.status !== "archived");

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await fn();
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // Swap sort orders with the neighbour; indexes are unique per workspace in practice.
  const move = (i: number, dir: -1 | 1) =>
    run(async () => {
      const a = depts[i];
      const b = depts[i + dir];
      await api(wsPath(`/departments/${a.id}`), { method: "PATCH", body: { sortOrder: b.sortOrder } });
      await api(wsPath(`/departments/${b.id}`), { method: "PATCH", body: { sortOrder: a.sortOrder } });
    });

  return (
    <main className="grid gap-8 p-4 sm:p-6 lg:grid-cols-2">
      <section aria-labelledby="dept-title" className="min-w-0">
        <h1 id="dept-title" className="text-2xl font-semibold">Departments</h1>
        {!admin && <p className="mt-1 text-sm text-muted">Only owners and admins can change departments.</p>}
        {error && <p role="alert" className="mt-3 text-sm text-[#b42318]">{error}</p>}
        <ul className="mt-4 space-y-2">
          {depts.map((d, i) => (
            <li key={d.id} className="flex items-center gap-2 rounded-[12px] border border-line bg-paper p-2">
              <form
                className="flex min-w-0 flex-1 gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  const name = new FormData(e.currentTarget).get("name");
                  run(() => api(wsPath(`/departments/${d.id}`), { method: "PATCH", body: { name } }));
                }}
              >
                <label className="sr-only" htmlFor={`dept-${d.id}`}>Department name</label>
                <input id={`dept-${d.id}`} name="name" defaultValue={d.name} disabled={!admin} maxLength={60} className="min-w-0 flex-1 rounded-[8px] bg-transparent px-2 py-1.5 focus:bg-bg focus:outline-none" />
                {admin && <button disabled={busy} className="rounded-[8px] px-2 text-sm font-medium hover:bg-bg">Save</button>}
              </form>
              {admin && (
                <>
                  <button aria-label={`Move ${d.name} up`} disabled={busy || i === 0} onClick={() => move(i, -1)} className="grid size-8 place-items-center rounded-[8px] hover:bg-bg disabled:opacity-30"><ArrowUp size={14} /></button>
                  <button aria-label={`Move ${d.name} down`} disabled={busy || i === depts.length - 1} onClick={() => move(i, 1)} className="grid size-8 place-items-center rounded-[8px] hover:bg-bg disabled:opacity-30"><ArrowDown size={14} /></button>
                  <button
                    aria-label={`Delete ${d.name}`}
                    disabled={busy}
                    onClick={() => confirm(`Delete ${d.name}? Its companions stay and become unassigned.`) && run(() => api(wsPath(`/departments/${d.id}`), { method: "DELETE" }))}
                    className="grid size-8 place-items-center rounded-[8px] text-[#b42318] hover:bg-bg"
                  >
                    <Trash size={14} />
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
        {depts.length === 0 && <p className="mt-4 text-sm text-muted">No departments yet. Add one below.</p>}
        {admin && (
          <form
            className="mt-4 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget;
              const name = new FormData(form).get("name");
              run(async () => {
                await api(wsPath("/departments"), { method: "POST", body: { name } });
                form.reset();
              });
            }}
          >
            <label className="sr-only" htmlFor="new-dept">New department name</label>
            <input id="new-dept" name="name" required maxLength={60} placeholder="New department" className="min-w-0 flex-1 rounded-[10px] border border-line bg-paper px-3 py-2 text-sm" />
            <button disabled={busy} className="btn-dark rounded-[10px] px-4 text-sm font-semibold text-paper">Add</button>
          </form>
        )}
      </section>

      <section aria-labelledby="tree-title" className="min-w-0">
        <h2 id="tree-title" className="text-2xl font-semibold">Reporting lines</h2>
        <p className="mt-1 text-sm text-muted">Change who someone reports to from their Customize form in the office.</p>
        <div className="mt-4 rounded-[12px] border border-line bg-paper p-4">
          <p className="text-sm font-medium">You (owner)</p>
          {head && (
            <ul className="ml-5 border-l border-line pl-4">
              <li className="py-1.5">
                <span className="flex flex-wrap items-center gap-x-2 text-sm">
                  <CompanionAvatar look={head.appearance} size={28} /> <span className="font-medium">{head.name}</span> <span className="text-muted">{head.role}</span>
                </span>
                <Tree agents={snapshot.agents} managerId={head.id} />
              </li>
            </ul>
          )}
          {loose.length > 0 && (
            <>
              <p className="mt-4 text-sm font-medium">No manager yet</p>
              <ul className="ml-5 border-l border-line pl-4">
                {loose.map((a) => (
                  <li key={a.id} className="py-1.5 text-sm">
                    <span className="font-medium">{a.name}</span> <span className="text-muted">{a.role}</span>
                    <Tree agents={snapshot.agents} managerId={a.id} />
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </section>
    </main>
  );
}
