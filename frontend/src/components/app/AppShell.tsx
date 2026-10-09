"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { ChatCircle, FolderSimple, GearSix, List, SignOut, UsersThree, X } from "@phosphor-icons/react";
import { authClient } from "@/lib/auth-client";
import { useWorkspace } from "@/lib/workspace";
import { Logo } from "@/components/landing/ui";
import "./dashboard.css";

// Chat history lives in the app sidebar while its state stays with the chat page.
const SidebarContext = createContext<{ history: HTMLDivElement | null; close: () => void }>({ history: null, close: () => {} });
export const useAppSidebar = () => useContext(SidebarContext);

export function AppShell({ children }: { children: React.ReactNode }) {
  const { snapshot } = useWorkspace();
  const pathname = usePathname();
  const router = useRouter();
  const [history, setHistory] = useState<HTMLDivElement | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [error, setError] = useState("");
  const sidebar = useRef<HTMLElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setMenuOpen(false), []);
  const base = `/w/${snapshot.workspace.slug}`;
  const isChat = pathname === base;
  const nav = [
    { href: base, label: "Chat", icon: ChatCircle },
    { href: `${base}/projects`, label: "Projects", icon: FolderSimple },
    { href: `${base}/team`, label: "Team", icon: UsersThree },
  ];
  const { theme, reducedMotion, calmMode } = snapshot.preferences;

  useEffect(() => {
    if (!menuOpen) return;
    const trigger = menuButton.current;
    sidebar.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const desktop = window.matchMedia("(min-width: 1024px)");
    const onResize = () => { if (desktop.matches) close(); };
    desktop.addEventListener("change", onResize);
    return () => {
      desktop.removeEventListener("change", onResize);
      trigger?.focus();
    };
  }, [menuOpen, close]);

  async function signOut() {
    try {
      await authClient.signOut();
      router.push("/sign-in");
    } catch {
      setError("Couldn't sign out. Please try again.");
    }
  }

  return (
    <SidebarContext value={{ history, close }}>
      <div className="app workspace-shell" data-theme={theme} data-still={reducedMotion || calmMode}>
        <a href="#workspace-content" className="workspace-skip">Skip to content</a>
        {menuOpen && <div className="workspace-backdrop" onClick={close} aria-hidden="true" />}
        <aside
          ref={sidebar}
          id="workspace-sidebar"
          className="workspace-sidebar"
          data-open={menuOpen}
          role={menuOpen ? "dialog" : undefined}
          aria-modal={menuOpen || undefined}
          aria-label="Workspace navigation"
          onKeyDown={(e) => {
            if (!menuOpen) return;
            if (e.key === "Escape") { e.preventDefault(); close(); }
            if (e.key !== "Tab") return;
            const controls = [...(sidebar.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input, select, [tabindex="0"]') ?? [])].filter((el) => el.getClientRects().length);
            const first = controls[0];
            const last = controls.at(-1);
            if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
            if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
          }}
        >
          <div className="workspace-brand">
            <Link href={base} aria-label="Agent Company home" onClick={close}><Logo className="!text-[19px]" /></Link>
            <button className="workspace-icon-button workspace-close" onClick={close} aria-label="Close navigation"><X size={20} /></button>
          </div>
          <div className="workspace-company">
            <span className="workspace-company-avatar" aria-hidden="true">{snapshot.workspace.name.slice(0, 1).toUpperCase()}</span>
            <div className="min-w-0"><p className="truncate text-sm font-semibold">{snapshot.workspace.name}</p><p className="text-xs text-muted">Your workspace</p></div>
          </div>
          <nav aria-label="App" className="workspace-nav">
            {nav.map(({ href, label, icon: Icon }) => {
              const active = href === base ? isChat : pathname.startsWith(href);
              return <Link key={href} href={href} onClick={close} aria-current={active ? "page" : undefined} className="workspace-nav-link"><Icon size={19} weight={active ? "fill" : "regular"} /><span>{label}</span>{active && <span className="workspace-active-dot" />}</Link>;
            })}
          </nav>
          <div ref={setHistory} className="workspace-history-slot" />
          <div className="workspace-sidebar-footer">
            <Link href={`${base}/settings`} onClick={close} aria-current={pathname.startsWith(`${base}/settings`) ? "page" : undefined} className="workspace-nav-link"><GearSix size={19} /><span>Settings</span></Link>
            <button onClick={signOut} className="workspace-nav-link"><SignOut size={19} /><span>Sign out</span></button>
            {error && <p role="alert" className="px-3 text-xs text-[#b42318]">{error}</p>}
          </div>
        </aside>
        <div className="workspace-main" inert={menuOpen}>
          <div className="workspace-mobile-bar">
            <button ref={menuButton} onClick={() => setMenuOpen(true)} aria-label="Open navigation" aria-expanded={menuOpen} aria-controls="workspace-sidebar" className="workspace-icon-button"><List size={22} /></button>
            <Link href={base} aria-label="Agent Company home"><Logo className="!text-base" /></Link>
            <span className="workspace-company-avatar !size-8 !text-xs" aria-hidden="true">{snapshot.workspace.name.slice(0, 1).toUpperCase()}</span>
          </div>
          <main id="workspace-content" tabIndex={-1} className={`workspace-content ${isChat ? "workspace-content-chat" : ""}`}>{children}</main>
        </div>
      </div>
    </SidebarContext>
  );
}
