import { LegalPage } from "@/components/landing/LegalPage";

export const metadata = { title: "Privacy | Agent Company" };

export default function Privacy() {
  return (
    <LegalPage title="Privacy" updated="October 25, 2026">
      <p>This page explains what Agent Company keeps about you, why, and who else sees it. In short: we keep what you put in so your team can work on it, we send it only to the services that do that work, and we don&apos;t sell it or track you for ads.</p>
      <section>
        <h2>What we keep</h2>
        <ul>
          <li>Your account: name, email and a hashed password, or your Google sign-in if you use it.</li>
          <li>Your workspace: your company and companions, chats, goals, plans, task results, and the files you upload or your team creates.</li>
          <li>Keys and sign-ins you connect, such as AI provider keys or your ChatGPT sign-in, stored encrypted.</li>
          <li>If you joined our earlier waitlist: your name, email and the note you left, to tell you when access opens.</li>
        </ul>
      </section>
      <section>
        <h2>Who else sees it</h2>
        <p className="mt-3">Only the services that do the work you ask for:</p>
        <ul>
          <li>The AI services you connect (for example OpenAI, ChatGPT, Anthropic, Google, or another service you add) receive the messages, instructions and files your companions need for a task.</li>
          <li>When your team looks things up: Exa or Tavily for web searches, and Jina Reader for reading web pages.</li>
          <li>When your team makes pictures and your company has it set up: Cloudflare or Pollinations.</li>
          <li>Our hosting: Vercel (the website), Render (the server) and Neon (the database).</li>
        </ul>
        <p className="mt-3">Each of these handles the data under its own privacy terms.</p>
      </section>
      <section>
        <h2>Cookies and tracking</h2>
        <p className="mt-3">We use one cookie to keep you signed in. Your browser also remembers small choices, such as pausing the motion on our home page. We don&apos;t use advertising or analytics trackers.</p>
      </section>
      <section>
        <h2>How long we keep it</h2>
        <p className="mt-3">As long as your account exists. You can delete projects and chats in the app at any time. To delete your whole account and everything in it, contact us and we will do it.</p>
      </section>
      <section>
        <h2>Changes</h2>
        <p className="mt-3">If we change how we handle your data, we will update this page and the date at the top.</p>
      </section>
    </LegalPage>
  );
}
