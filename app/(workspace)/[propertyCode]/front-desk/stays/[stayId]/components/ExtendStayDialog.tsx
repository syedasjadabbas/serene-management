"use client";

import { useState } from "react";
import { FormDialog } from "@/components/ui/FormDialog";
import { TextArea } from "@/components/ui/TextArea";
import { TextField } from "@/components/ui/TextField";
import { usePermissions } from "@/hooks/usePermissions";
import { useProperty } from "@/hooks/useProperty";
import { useExtendStayMutation } from "@/lib/api/endpoints/front-desk.api";
import { toClientApiError } from "@/lib/api/errors";
import { formatDate } from "@/lib/utils/format";
import { addDays } from "@/modules/business-date/business-date.policy";
import type { StayDetail } from "@/modules/front-desk/front-desk.types";

/**
 * In-house extension to a later departure. The added nights are priced by
 * the server and take availability; the guest keeps the same room, which
 * must be free for them. Night audit will not close a date while a guest
 * due out has neither left nor been extended.
 */
export function ExtendStayDialog({ stay, onClose }: { stay: StayDetail; onClose: () => void }) {
  const property = useProperty();
  const { can } = usePermissions(property.id);
  const [departure, setDeparture] = useState(addDays(stay.departure, 1));
  const [override, setOverride] = useState(false);
  const [reason, setReason] = useState("");
  const [extend, { isLoading, error }] = useExtendStayMutation();
  const apiError = toClientApiError(error);
  const canOverride = can("reservations:override_availability");
  const invalid = departure <= stay.departure || (override && reason.trim().length < 3);

  async function submit() {
    const result = await extend({
      propertyId: property.id,
      stayId: stay.id,
      body: {
        version: stay.version,
        departure,
        ...(override ? { override: true, reason: reason.trim() } : {}),
      },
    });
    if ("data" in result) onClose();
  }

  return (
    <FormDialog
      title="Extend stay"
      description={`${stay.guest.name} · room ${stay.room.number} · booked until ${formatDate(stay.departure)}`}
      onClose={onClose}
      onSubmit={() => void submit()}
      submitLabel="Extend stay"
      disabled={invalid}
      pending={isLoading}
      error={apiError}
    >
      <TextField
        label="New departure"
        type="date"
        value={departure}
        min={addDays(stay.departure, 1)}
        onChange={(event) => setDeparture(event.target.value)}
        hint="The added nights are priced at the stay's rate plan and charged by night audit."
      />
      {canOverride ? (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={override}
            onChange={(event) => setOverride(event.target.checked)}
          />
          Extend even if the room type is sold out
        </label>
      ) : null}
      {override ? (
        <TextArea
          label="Reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          rows={2}
          required
        />
      ) : null}
    </FormDialog>
  );
}
