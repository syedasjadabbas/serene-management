import { createGuestSchema } from "@serene/shared/modules/guests/guests.schema";
import type { CreateGuestInput } from "@serene/shared/modules/guests/guests.schema";

/** The create-guest form validates with the shared contract. */
export const newGuestFormSchema = createGuestSchema;

/** Dialog defaults (every field a string so inputs stay controlled). */
export const newGuestDialogDefaults = {
  title: "",
  firstName: "",
  lastName: "",
  preferredName: "",
  email: "",
  phone: "",
  nationalityCode: "",
};

/** Booking-flow form defaults: the typed search text prefills the name. */
export function newGuestInlineDefaults(initialName: string) {
  const [first, ...rest] = initialName.trim().split(/\s+/);
  return {
    title: "",
    firstName: first ?? "",
    lastName: rest.join(" "),
    email: "",
    phone: "",
    nationalityCode: "",
  };
}

/** Parsed form values plus the duplicate decision the user has made. */
export function guestPayload(values: CreateGuestInput, allowDuplicate: boolean): CreateGuestInput {
  return { ...values, allowDuplicate };
}
