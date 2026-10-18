import { expect, test } from "vitest";
import { isMobileDesign, MOBILE_GUIDE, MOBILE_PLAN } from "../src/goals/mobile.js";
import { planInstructions, taskInstructions } from "../src/goals/prompts.js";
import { reviewPrompt } from "../src/goals/quality.js";

const agent = { name: "Lina", role: "Designer", workingStyle: "Clear." };

test("mobile design goals are recognised from their words", () => {
  for (const text of ["Design a mobile app for a hiking club", "Make an iOS app for my bakery", "android app for a gym", "iPhone app screens", "phone app for runners", "App UI for a budget tracker", "app mockups please", "Mobile design for our shop", "mobile screens for a quiz"]) {
    expect(isMobileDesign(text), text).toBe(true);
  }
  for (const text of ["Build a landing page for my bakery", "Write app store copy", "Research three competitors"]) {
    expect(isMobileDesign(text), text).toBe(false);
  }
});

test("planning, tasks and review get the mobile texts only for mobile goals", () => {
  expect(MOBILE_PLAN.startsWith("MOBILE APP DESIGN:")).toBe(true);
  expect(planInstructions("Co", true, false, true)).toContain(MOBILE_PLAN);
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
