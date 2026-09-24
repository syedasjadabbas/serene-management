import { create } from "zustand";

/**
 * Client-only UI state. Never put server records here: server data belongs to
 * RTK Query (docs/ARCHITECTURE.md §State).
 */
interface UiState {
  sidebarCollapsed: boolean;
  commandMenuOpen: boolean;
  toggleSidebar: () => void;
  setCommandMenuOpen: (open: boolean) => void;
}

export const useUiStore = create<UiState>()((set) => ({
  sidebarCollapsed: false,
  commandMenuOpen: false,
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  setCommandMenuOpen: (commandMenuOpen) => set({ commandMenuOpen }),
}));
