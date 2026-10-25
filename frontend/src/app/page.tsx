import { Control, Faq, FinalCta, Footer } from "@/components/landing/Closing";
import { Header } from "@/components/landing/Header";
import { Hero, Models } from "@/components/landing/Hero";
import { NetworkField } from "@/components/landing/NetworkField";
import { Process } from "@/components/landing/Process";
import { TeamAtWork } from "@/components/landing/TeamAtWork";
import { Story } from "@/components/landing/Story";
import { Team } from "@/components/landing/Team";
import { UseCases } from "@/components/landing/UseCases";

export default function Home() {
  return (
    <div className="on-dark bg-night text-cream">
      <div id="top" className="mx-auto w-full max-w-[1440px] overflow-x-clip border-x border-cream/10">
        {/* The header and hero share one night scene, with the team network behind both. */}
        <div className="dusk relative isolate overflow-hidden">
          <div className="absolute inset-0 -z-10">
            <NetworkField />
          </div>
          <Header />
          <Hero />
        </div>
        <main>
          <Models />
          <TeamAtWork />
          <Story />
          <Process />
          <UseCases />
          <Team />
          <Control />
          <Faq />
          <FinalCta />
        </main>
        <Footer />
      </div>
    </div>
  );
}
