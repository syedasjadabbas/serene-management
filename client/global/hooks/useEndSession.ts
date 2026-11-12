"use client";

import { useCallback } from "react";
import { useDispatch } from "react-redux";
import { baseApi } from "@/global/api/baseApi";
import { clearOfflineData } from "@/global/lib/offline/db";
import { useAuthStore } from "@/global/stores/auth.store";

/**
 * Ends the session in this browser: drops the access token, every cached
 * server response and the offline copy. The workspace guard then returns to
 * the sign-in page.
 */
export function useEndSession() {
  const dispatch = useDispatch();
  return useCallback(async () => {
    useAuthStore.getState().clear(null, { deliberate: true });
    dispatch(baseApi.util.resetApiState());
    await clearOfflineData();
  }, [dispatch]);
}
