import { LegalPage } from "@/components/landing/LegalPage";

export const metadata = { title: "Terms | Agent Company" };

export default function Terms() {
  return (
    <LegalPage title="Terms" updated="October 25, 2026">
      <p>These terms cover your use of Agent Company. By creating an account you agree to them.</p>
      <section>
        <h2>The service</h2>
        <p className="mt-3">Agent Company gives you a team of AI companions that plan, build and check work for you. It is new and changing quickly, so features may change, and it is provided as it is, without guarantees that it will always be available or free of mistakes.</p>
      </section>
      <section>
        <h2>Your content</h2>
        <p className="mt-3">What you put in and what your team makes for you stays yours. You give us permission to store it and to send it to the services that do the work you ask for, as described on the Privacy page, only to run the service for you.</p>
      </section>
      <section>
        <h2>Check the work</h2>
        <p className="mt-3">AI can be wrong. Nova checks tasks, but you are responsible for reviewing results before you use, publish or rely on them.</p>
      </section>
      <section>
        <h2>Your AI accounts</h2>
        <p className="mt-3">Your team runs on the AI keys or ChatGPT plan you connect. Their usage, costs and terms are between you and those providers.</p>
      </section>
      <section>
        <h2>Fair use</h2>
        <ul>
          <li>Don&apos;t use the service for anything illegal or harmful, or to create content that harms or deceives people.</li>
          <li>Don&apos;t upload content you don&apos;t have the right to use.</li>
          <li>Don&apos;t try to break, overload or get around the service&apos;s security.</li>
        </ul>
        <p className="mt-3">We may suspend accounts that break these rules.</p>
      </section>
      <section>
        <h2>Liability</h2>
        <p className="mt-3">As far as the law allows, we are not liable for indirect losses, or for losses caused by AI output you chose to use.</p>
      </section>
      <section>
        <h2>Changes</h2>
        <p className="mt-3">We may update these terms. We will change the date at the top, and important changes will be announced in the app.</p>
      </section>
    </LegalPage>
  );
}
