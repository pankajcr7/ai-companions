"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Buildings, FolderSimple, GearSix, Plugs, SignOut, TreeStructure } from "@phosphor-icons/react";
import { authClient } from "@/lib/auth-client";
import { useWorkspace } from "@/lib/workspace";
import { Logo } from "@/components/landing/ui";

export function AppShell({ children }: { children: React.ReactNode }) {
  const { snapshot } = useWorkspace();
  const pathname = usePathname();
  const router = useRouter();
  const base = `/w/${snapshot.workspace.slug}`;
  const nav = [
    { href: base, label: "Office", icon: Buildings },
    { href: `${base}/projects`, label: "Projects", icon: FolderSimple },
    { href: `${base}/organization`, label: "Organization", icon: TreeStructure },
    { href: `${base}/providers`, label: "AI providers", icon: Plugs },
    { href: `${base}/settings`, label: "Settings", icon: GearSix },
  ];
  const { theme, reducedMotion, calmMode } = snapshot.preferences;

  async function signOut() {
    await authClient.signOut();
    router.push("/sign-in");
  }

  return (
    <div className="app flex min-h-[100dvh] flex-col lg:flex-row" data-theme={theme} data-still={reducedMotion || calmMode}>
      <aside className="flex items-center justify-between gap-2 border-b border-line bg-paper px-4 py-3 lg:w-60 lg:flex-col lg:items-stretch lg:justify-start lg:border-b-0 lg:border-r lg:p-5">
        <Link href={base} aria-label="Office home"><Logo compact className="text-base sm:text-lg" /></Link>
        <p className="hidden truncate text-sm font-medium text-muted lg:mt-6 lg:block">{snapshot.workspace.name}</p>
        <nav aria-label="App" className="flex gap-1 lg:mt-4 lg:flex-col">
          {nav.map(({ href, label, icon: Icon }) => {
            const active = href === base ? pathname === href : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={`flex items-center gap-2 rounded-[10px] px-2.5 py-2 text-sm font-medium sm:px-3 ${active ? "bg-ink text-paper" : "text-ink hover:bg-bg"}`}
              >
                <Icon size={18} /> <span className="hidden sm:inline">{label}</span>
              </Link>
            );
          })}
        </nav>
        <button onClick={signOut} className="flex items-center gap-2 rounded-[10px] px-2.5 py-2 text-sm text-muted hover:bg-bg sm:px-3 lg:mt-auto">
          <SignOut size={18} /> <span className="hidden sm:inline">Sign out</span>
        </button>
      </aside>
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
