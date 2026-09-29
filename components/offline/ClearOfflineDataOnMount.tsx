"use client";

import { useEffect } from "react";
import { clearOfflineData } from "@/lib/offline/db";

/**
 * Rendered on the sign-in page: whoever signs in next starts with no
 * offline data in this browser (covers expired sessions and sign-outs that
 * never reached SignOutButton, e.g. a closed tab after a revoked session).
 */
export function ClearOfflineDataOnMount() {
  useEffect(() => {
    void clearOfflineData();
  }, []);
  return null;
}
