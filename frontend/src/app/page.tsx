import { Closing, Footer } from "@/components/landing/Closing";
import { Header } from "@/components/landing/Header";
import { DuskField } from "@/components/landing/DuskField";
import { Hero, Models } from "@/components/landing/Hero";
import { MeetingShowcase } from "@/components/landing/MeetingShowcase";
import { Process } from "@/components/landing/Process";
import { Story } from "@/components/landing/Story";
import { Team } from "@/components/landing/Team";
import { UseCases } from "@/components/landing/UseCases";

export default function Home() {
  return (
    <div className="bg-night text-cream">
      <div id="top" className="mx-auto w-full max-w-[1440px] overflow-x-clip border-x border-cream/10">
        {/* The header and hero share one dusk scene, with the pillar field behind both. */}
        <div className="dusk relative isolate overflow-hidden">
          <div className="absolute inset-0 -z-10">
            <DuskField />
          </div>
          <Header />
          <Hero />
        </div>
        <main>
          <Models />
          <Story />
          <Process />
          <Team />
          <UseCases />
          <MeetingShowcase />
          <Closing />
        </main>
        <Footer />
      </div>
    </div>
  );
}
