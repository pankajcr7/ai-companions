import { Closing, Footer } from "@/components/landing/Closing";
import { Header } from "@/components/landing/Header";
import { Hero } from "@/components/landing/Hero";
import { MeetingShowcase } from "@/components/landing/MeetingShowcase";
import { Process } from "@/components/landing/Process";
import { Story } from "@/components/landing/Story";
import { Team } from "@/components/landing/Team";
import { UseCases } from "@/components/landing/UseCases";

export default function Home() {
  return (
    <div id="top" className="mx-auto w-full max-w-[1440px] overflow-x-clip border-x border-line">
      <Header />
      <main>
        <Hero />
        <Story />
        <Process />
        <Team />
        <UseCases />
        <MeetingShowcase />
        <Closing />
      </main>
      <Footer />
    </div>
  );
}
