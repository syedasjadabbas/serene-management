"use client";

import { useState } from "react";
import { type PickedCompany, CompanyPicker } from "@/components/accounts/CompanyPicker";
import { FormDialog } from "@/components/ui/FormDialog";
import { Select } from "@/components/ui/Select";
import { TextArea } from "@/components/ui/TextArea";
import { useProperty } from "@/hooks/useProperty";
import { useAccountQuery } from "@/lib/api/endpoints/accounts.api";
import { useSetReservationCompanyMutation } from "@/lib/api/endpoints/reservations.api";
import { toClientApiError } from "@/lib/api/errors";
import type { ReservationDetail } from "@/modules/reservations/reservations.types";

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
  const [company, setCompany] = useState<PickedCompany | null>(
    reservation.company
      ? {
          id: reservation.company.id,
          label: `${reservation.company.name}${reservation.company.code ? ` (${reservation.company.code})` : ""}`,
        }
      : null,
  );
  const account = useAccountQuery(company?.id ?? "", { skip: !company });
  const contacts = account.data?.contacts ?? [];
  // The current booker counts only if they are one of the company's contacts.
  const [booker, setBooker] = useState(reservation.company ? (reservation.booker?.id ?? "") : "");
  const bookerContact = contacts.some((c) => c.guest.id === booker) ? booker : "";
  const [reason, setReason] = useState("");
  return (
    <FormDialog
      title="Company"
      description="Negotiated rates follow the company: change a room's rate first if it uses one."
      onClose={onClose}
      onSubmit={async () => {
        const result = await save({
          propertyId: property.id,
          reservationId: reservation.id,
          body: {
            version: reservation.version,
            companyId: company?.id ?? null,
            bookerGuestId: company && bookerContact ? bookerContact : null,
            ...(reason.trim() ? { reason: reason.trim() } : {}),
          },
        });
        if ("data" in result) onClose();
      }}
      submitLabel={company ? "Save company" : "Remove company"}
      pending={state.isLoading}
      error={toClientApiError(state.error)}
    >
      <CompanyPicker
        value={company}
        onChange={(c) => {
          setCompany(c);
          setBooker("");
        }}
        label="Company"
      />
      {company ? (
        <Select
          label="Booked by (company contact)"
          placeholder="Not a company contact"
          options={contacts.map((c) => ({
            value: c.guest.id,
            label: `${c.guest.fullName}${c.role ? ` · ${c.role}` : ""}`,
          }))}
          value={bookerContact}
          onChange={(e) => setBooker(e.target.value)}
        />
      ) : null}
      <TextArea
        label="Reason (optional)"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        maxLength={1000}
      />
    </FormDialog>
  );
}
