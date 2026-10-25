import Link from "next/link";
import { CONTACT_EMAIL } from "@/lib/site";
import { Logo } from "./ui";

/** A plain, readable page for the legal texts, in the landing page's colours. */
export function LegalPage({ title, updated, children }: { title: string; updated: string; children: React.ReactNode }) {
  return (
    <div className="on-dark min-h-[100dvh] bg-night text-cream">
      <header className="border-b border-cream/10 px-4 py-6 md:px-12">
        <Link href="/" aria-label="Agent Company home" className="w-fit">
          <Logo className="!text-cream" />
        </Link>
      </header>
      <main className="mx-auto max-w-[72ch] px-4 py-16 md:py-24">
        <h1 className="font-display text-[clamp(36px,5vw,56px)] font-medium tracking-[-0.04em]">{title}</h1>
        <p className="mt-3 text-sm text-haze">Last updated {updated}</p>
        <div className="mt-10 space-y-8 text-base leading-relaxed text-cream/85 [&_h2]:font-display [&_h2]:text-xl [&_h2]:font-medium [&_h2]:text-cream [&_li]:ml-5 [&_li]:list-disc [&_ul]:mt-3 [&_ul]:space-y-2">
          {children}
          {CONTACT_EMAIL && (
            <section>
              <h2>Contact</h2>
              <p className="mt-3">
                Questions about this page: <a href={`mailto:${CONTACT_EMAIL}`} className="text-lime underline underline-offset-4">{CONTACT_EMAIL}</a>
              </p>
            </section>
          )}
        </div>
      </main>
    </div>
  );
}
