import { z } from "zod";

/** Company dialog values: the picked company (or none), its booking contact and a note. */
export const companyFormSchema = z.object({
  company: z.object({ id: z.string(), label: z.string() }).nullable(),
  booker: z.string(),
  reason: z.string().max(1000, "At most 1000 characters"),
});

export type CompanyFormValues = z.input<typeof companyFormSchema>;

/** Request body fields: the booker only counts while a company is set and the contact belongs to it. */
export function companyPayload(values: CompanyFormValues, contactGuestIds: readonly string[]) {
  const booker = contactGuestIds.includes(values.booker) ? values.booker : "";
  const reason = values.reason.trim();
  return {
    companyId: values.company?.id ?? null,
    bookerGuestId: values.company && booker ? booker : null,
    ...(reason ? { reason } : {}),
  };
}
