import { create } from "zustand";

/**
 * Multi-step booking draft (UI state only, docs/ARCHITECTURE.md §7.3).
 * Holds the user's selections as ids plus the labels shown back to them —
 * never server records; availability, prices and guests are always re-read
 * from the API, and the server re-validates everything on create.
 */
export interface BookingDraft {
  /** "walk-in": arrival today, one specific room, checked in on creation. */
  mode: "booking" | "walk-in";
  step: 1 | 2 | 3 | 4;
  stay: {
    arrival: string;
    departure: string;
    adults: number;
    children: number;
    rooms: number;
  } | null;
  selection: {
    roomTypeId: string;
    roomTypeLabel: string;
    ratePlanId: string;
    ratePlanLabel: string;
    total: string | null;
    currencyCode: string;
    waitlist: boolean;
  } | null;
  guest: { id: string; label: string } | null;
  /** Company the booking is for: its negotiated rates are quoted (Phase 7). */
  company: { id: string; label: string } | null;
  details: {
    reservationTypeId: string;
    marketCodeId: string;
    sourceCodeId: string;
    channelId: string;
    roomId: string;
    eta: string;
    specialRequests: string;
    /** Company contact who booked (empty: the guest). */
    bookerGuestId: string;
  };
}

const EMPTY_DETAILS: BookingDraft["details"] = {
  reservationTypeId: "",
  marketCodeId: "",
  sourceCodeId: "",
  channelId: "",
  roomId: "",
  eta: "",
  specialRequests: "",
  bookerGuestId: "",
};

interface BookingDraftStore extends BookingDraft {
  setMode: (mode: BookingDraft["mode"]) => void;
  setStep: (step: BookingDraft["step"]) => void;
  setStay: (stay: NonNullable<BookingDraft["stay"]>) => void;
  select: (selection: NonNullable<BookingDraft["selection"]>) => void;
  setGuest: (guest: BookingDraft["guest"]) => void;
  setCompany: (company: BookingDraft["company"]) => void;
  setDetails: (details: Partial<BookingDraft["details"]>) => void;
  reset: () => void;
}

export const useBookingDraft = create<BookingDraftStore>()((set) => ({
  mode: "booking",
  step: 1,
  stay: null,
  selection: null,
  guest: null,
  company: null,
  details: EMPTY_DETAILS,
  setMode: (mode) => set({ mode }),
  setStep: (step) => set({ step }),
  // Changing the stay invalidates the selected room type / rate and room.
  setStay: (stay) => set((s) => ({ stay, selection: null, details: { ...s.details, roomId: "" } })),
  select: (selection) =>
    set((s) => ({ selection, step: 2, details: { ...s.details, roomId: "" } })),
  setGuest: (guest) => set({ guest }),
  // Another company quotes other (negotiated) rates: the selection and booker are cleared.
  setCompany: (company) =>
    set((s) => ({
      company,
      selection: null,
      step: 1,
      details: { ...s.details, bookerGuestId: "" },
    })),
  setDetails: (details) => set((s) => ({ details: { ...s.details, ...details } })),
  reset: () =>
    set({
      mode: "booking",
      step: 1,
      stay: null,
      selection: null,
      guest: null,
      company: null,
      details: EMPTY_DETAILS,
    }),
}));
