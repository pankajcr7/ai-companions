import { expect, test } from "vitest";
import { isMobileDesign, MOBILE_CHANGES, MOBILE_GUIDE, MOBILE_PLAN } from "../src/goals/mobile.js";
import { planInstructions, taskInstructions } from "../src/goals/prompts.js";
import { reviewPrompt } from "../src/goals/quality.js";

const agent = { name: "Lina", role: "Designer", workingStyle: "Clear." };

test("mobile design goals need a mobile app and a design word; web apps never count; the Mobile App page always counts", () => {
  for (const text of [
    "Design a mobile app for a hiking club",
    "iPhone app screens for a quiz",
    "Android app UI for a gym",
    "Redesign our iOS app",
    "Wireframes for our phone app",
    "Mobile design for our shop",
    "mobile screens for a quiz",
    "mobile-app design for a cafe",
    "Smartphone application mockups",
    "Design a mobile app: a companion to our web app",
    "Mobile app design changes: bigger title on the Home screen",
  ]) {
    expect(isMobileDesign(text), text).toBe(true);
  }
  for (const text of [
    "Build a landing page for my bakery",
    "Write app store copy for our iPhone app",
    "Write a press release for our new iOS app",
    "Build a landing page for our phone app",
    "Research mobile app competitors",
    "Make a marketing plan for our Android app launch",
    "Build a web app design for my SaaS",
    "Redesign the web app UI",
    "Improve our app UI",
    "Make an iOS app for my bakery",
  ]) {
    expect(isMobileDesign(text), text).toBe(false);
  }
});

test("planning, tasks and review get the mobile texts only for mobile goals", () => {
  expect(MOBILE_PLAN.startsWith("MOBILE APP DESIGN:")).toBe(true);
  expect(planInstructions("Co", true, false, "design")).toContain(MOBILE_PLAN);
  // A follow-up ("Ask for changes") changes the named screens; it isn't planned as a new app.
  expect(MOBILE_CHANGES.startsWith("MOBILE APP CHANGES:")).toBe(true);
  expect(planInstructions("Co", false, false, "changes")).toContain(MOBILE_CHANGES);
  expect(planInstructions("Co", false, false, "changes")).not.toContain("MOBILE APP DESIGN:");
  expect(planInstructions("Co", true, false)).not.toContain("MOBILE APP DESIGN:");
  expect(taskInstructions(agent, "Co", null, true, true, true)).toContain(MOBILE_GUIDE);
  expect(taskInstructions(agent, "Co", null, true, true)).not.toContain("MOBILE SCREEN GUIDE");
  const review = (mobile?: boolean) => reviewPrompt({ goal: "g", task: { title: "t", instructions: "i", deliverable: "d", criteria: ["c"] }, brief: null, guide: true, mobile, result: "r", files: [] });
  expect(review(true)).toContain(MOBILE_GUIDE);
  expect(review()).not.toContain("MOBILE SCREEN GUIDE");
});

test("the screen guide names the phone size, Tailwind, the look file and tap targets, and stays short", () => {
  expect(MOBILE_GUIDE.startsWith("MOBILE SCREEN GUIDE")).toBe(true);
  for (const part of ["390×844", "https://cdn.tailwindcss.com", "design/identity.md", "design/screens.md", "44 px", "screens/NN-name.html"]) expect(MOBILE_GUIDE).toContain(part);
  expect(MOBILE_GUIDE.length).toBeLessThan(2000);
});
