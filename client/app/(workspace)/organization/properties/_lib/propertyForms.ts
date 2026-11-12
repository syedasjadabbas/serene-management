import { z } from "zod";
import {
  confirmationPrefixSchema,
  createPropertySchema,
} from "@serene/shared/modules/properties/properties.schema";

const { code, name, timezone, reason } = createPropertySchema.shape;

/** New-property form: the shared field rules on the raw text the user types. */
export const createPropertyFormSchema = z.object({
  code,
  name,
  timezone,
  currencyCode: z
    .string()
    .trim()
    .toUpperCase()
    .pipe(z.string().regex(/^[A-Z]{3}$/, "Three letters, e.g. PKR")),
  countryCode: z
    .string()
    .trim()
    .toUpperCase()
    .pipe(z.string().regex(/^[A-Z]{2}$/, "Two letters, e.g. PK")),
  // Empty means "default to the code" and is left out of the request.
  confirmationPrefix: z
    .string()
    .trim()
    .toUpperCase()
    .refine(
      (value) => value === "" || confirmationPrefixSchema.safeParse(value).success,
      "2–10 letters or digits, starting with a letter",
    )
    .transform((value) => value || undefined),
  reason,
});

export const createPropertyDefaults = {
  code: "",
  name: "",
  timezone: "",
  currencyCode: "",
  countryCode: "",
  confirmationPrefix: "",
  reason: "",
};

/** Output to request body: the prefix is sent only when entered. */
export function toCreatePropertyBody(values: z.output<typeof createPropertyFormSchema>) {
  const { confirmationPrefix: prefix, ...rest } = values;
  return { ...rest, ...(prefix ? { confirmationPrefix: prefix } : {}) };
}

export const copySetupFormSchema = z.object({
  sourceId: z.string().min(1, "Choose a property to copy from"),
  reason,
});

export function copySetupDefaults(sourceId: string) {
  return { sourceId, reason: "" };
}
