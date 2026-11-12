"use client";

import { useEffect } from "react";
import { bootAuth } from "@/global/api/session";

/** Runs the one boot refresh (refresh cookie → access token, or anonymous). Renders nothing. */
export function AuthBoot() {
  useEffect(() => {
    void bootAuth();
  }, []);
  return null;
}
