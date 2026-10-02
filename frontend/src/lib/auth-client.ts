import { createAuthClient } from "better-auth/react";

// Same origin: Next.js proxies /api/auth/* to the backend.
export const authClient = createAuthClient();
