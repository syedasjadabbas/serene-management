"use client";

import { CompanyPicker } from "@/global/components/accounts/CompanyPicker";
import { FormDialog } from "@/global/components/ui/FormDialog";
import {
  FormSelect,
  FormTextArea,
  applyServerError,
  useZodForm,
} from "@/global/components/ui/form";
import { useProperty } from "@/global/hooks/useProperty";
import { useAccountQuery } from "@/global/api/endpoints/accountsApi";
import { useSetReservationCompanyMutation } from "@/global/api/endpoints/reservationsApi";
import { toClientApiError } from "@/global/api/errors";
import type { ReservationDetail } from "@serene/shared/modules/reservations/reservations.types";
import { type CompanyFormValues, companyFormSchema, companyPayload } from "../_lib/companyForm";

/**
 * Sets, changes or clears the company of a reservation and its booking
 * contact (a contact of that company). The server refuses the change while a
 * room is on a rate negotiated for another company.
 */
export function CompanyDialog({
  reservation,
  onClose,
}: {
  reservation: ReservationDetail;
  onClose: () => void;
}) {
  const property = useProperty();
  const [save, state] = useSetReservationCompanyMutation();
  const form = useZodForm(companyFormSchema, {
    company: reservation.company
      ? {
          id: reservation.company.id,
          label: `${reservation.company.name}${reservation.company.code ? ` (${reservation.company.code})` : ""}`,
        }
      : null,
    booker: reservation.company ? (reservation.booker?.id ?? "") : "",
    reason: "",
  });
  const { control, handleSubmit, setError, setValue, watch, formState } = form;
  const company = watch("company");
  const account = useAccountQuery(company?.id ?? "", { skip: !company });
  const contacts = account.data?.contacts ?? [];

  async function submit(values: CompanyFormValues) {
    const result = await save({
      propertyId: property.id,
      reservationId: reservation.id,
      body: {
        version: reservation.version,
        ...companyPayload(
          values,
          contacts.map((c) => c.guest.id),
        ),
      },
    });
    if ("data" in result) onClose();
    else applyServerError(setError, toClientApiError(result.error));
  }

  return (
    <FormDialog
      title="Company"
      description="Negotiated rates follow the company: change a room's rate first if it uses one."
      onClose={onClose}
      onSubmit={handleSubmit(submit)}
      submitLabel={company ? "Save company" : "Remove company"}
      pending={state.isLoading || formState.isSubmitting}
      error={toClientApiError(state.error)}
    >
      <CompanyPicker
        value={company}
        onChange={(c) => {
          setValue("company", c);
          setValue("booker", "");
        }}
        label="Company"
      />
      {company ? (
        <FormSelect
          control={control}
          name="booker"
          label="Booked by (company contact)"
          placeholder="Not a company contact"
          options={contacts.map((c) => ({
            value: c.guest.id,
            label: `${c.guest.fullName}${c.role ? ` · ${c.role}` : ""}`,
          }))}
        />
      ) : null}
      <FormTextArea control={control} name="reason" label="Reason (optional)" maxLength={1000} />
    </FormDialog>
  );
}
