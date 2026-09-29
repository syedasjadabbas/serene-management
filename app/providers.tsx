"use client";

import { useState, type ReactNode } from "react";
import { Provider } from "react-redux";
import { config as zodConfig } from "zod";
import { ServiceWorkerRegistration } from "@/components/offline/ServiceWorkerRegistration";
import { makeStore } from "@/lib/api/store";

// Zod v4 probes `new Function("")` once to decide whether it may compile
// faster object parsers. The production CSP (no 'unsafe-eval', proxy.ts)
// blocks that probe; Zod catches it and falls back, but the browser still
// records a CSP violation. In the browser we tell Zod not to probe: the
// same schemas give the same results through its interpreter. The server
// (API validation) keeps the compiled path; the CSP does not apply there.
if (typeof window !== "undefined") zodConfig({ jitless: true });

export function Providers({ children }: { children: ReactNode }) {
  const [store] = useState(makeStore);
  return (
    <Provider store={store}>
      <ServiceWorkerRegistration />
      {children}
    </Provider>
  );
}
