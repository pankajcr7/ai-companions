"use client";

import { useEffect } from "react";

/** Nudges the server awake while the visitor reads the page, so signing in afterwards is quick. Shows nothing. */
export function WakeServer() {
  useEffect(() => {
    fetch("/api/auth-config", { cache: "no-store" }).catch(() => {});
  }, []);
  return null;
}
