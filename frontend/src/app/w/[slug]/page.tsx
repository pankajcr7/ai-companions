import { Suspense } from "react";
import { ChatHome } from "@/components/app/home/ChatHome";

export default function HomePage() {
  return (
    <Suspense fallback={null}>
      <ChatHome />
    </Suspense>
  );
}
