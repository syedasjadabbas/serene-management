/** Types used by the guests endpoints (re-exported from the shared contracts). */
export type {
  CreateGuestInput,
  CreateGuestNoteInput,
  GuestPreferencesInput,
  UpdateGuestInput,
} from "@serene/shared/modules/guests/guests.schema";
export type {
  GuestHistoryRow,
  GuestOptions,
  GuestProfileView,
  GuestSummaryView,
} from "@serene/shared/modules/guests/guests.types";
export type { EnrollInput } from "@serene/shared/modules/loyalty/loyalty.schema";

import type { CursorPageMeta } from "./common";

/** Meta of the guest history page: the cursor plus the properties the stays belong to. */
export type GuestHistoryMeta = CursorPageMeta & {
  properties: { id: string; code: string; name: string }[];
};
