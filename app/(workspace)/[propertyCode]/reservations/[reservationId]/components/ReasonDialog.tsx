"use client";

import { useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Select } from "@/components/ui/Select";
import { TextArea } from "@/components/ui/TextArea";
import { useProperty } from "@/hooks/useProperty";
import {
  useBookingOptionsQuery,
  useCancelReservationMutation,
  useMarkNoShowMutation,
  useReinstateNoShowMutation,
  useReinstateReservationMutation,
} from "@/lib/api/endpoints/reservations.api";
import { toClientApiError } from "@/lib/api/errors";
import type { ReservationRoomDetail } from "@/modules/reservations/reservations.types";

const COPY = {
  cancel: {
    title: "Cancel reservation",
    description: "Releases the inventory and any assigned room. A cancellation number is issued.",
    confirm: "Cancel reservation",
  },
  noShow: {
    title: "Mark as no-show",
    description: "The guest did not arrive. Releases the inventory and any assigned room.",
    confirm: "Mark no-show",
  },
  reinstate: {
    title: "Reinstate reservation",
    description: "Restores the cancelled reservation if rooms are still available.",
    confirm: "Reinstate",
  },
  reinstateNoShow: {
    title: "Reinstate no-show",
    description:
      "The guest arrived after all: the stay starts on today's business date if rooms are available. A no-show fee already posted stays on the folio until adjusted.",
    confirm: "Reinstate",
  },
} as const;

/** High-risk actions: a written reason (and a reason code for cancel / no-show) is required and audited. */
export function ReasonDialog({
  open,
  onClose,
  room,
  action,
}: {
  open: boolean;
  onClose: () => void;
  room: ReservationRoomDetail;
  action: keyof typeof COPY;
}) {
  const property = useProperty();
  const options = useBookingOptionsQuery(property.id, { skip: !open });
  const [reasonCodeId, setReasonCodeId] = useState("");
  const [reason, setReason] = useState("");
  const [cancel, cancelState] = useCancelReservationMutation();
  const [noShow, noShowState] = useMarkNoShowMutation();
  const [reinstate, reinstateState] = useReinstateReservationMutation();
  const [reinstateNoShow, reinstateNoShowState] = useReinstateNoShowMutation();
  const state =
    action === "cancel"
      ? cancelState
      : action === "noShow"
        ? noShowState
        : action === "reinstateNoShow"
          ? reinstateNoShowState
          : reinstateState;
  const error = toClientApiError(state.error);
  const codes =
    action === "cancel" ? options.data?.reasonCodes.cancellation : options.data?.reasonCodes.noShow;
  const needsCode = action === "cancel" || action === "noShow";
  const copy = COPY[action];

  async function submit() {
    const base = { propertyId: property.id, reservationRoomId: room.id };
    const result =
      action === "cancel"
        ? await cancel({ ...base, body: { version: room.version, reasonCodeId, reason } })
        : action === "noShow"
          ? await noShow({ ...base, body: { version: room.version, reasonCodeId, reason } })
          : action === "reinstateNoShow"
            ? await reinstateNoShow({ ...base, body: { version: room.version, reason } })
            : await reinstate({ ...base, body: { version: room.version, reason } });
    if ("data" in result) {
      setReason("");
      setReasonCodeId("");
      onClose();
    }
  }

  const valid = reason.trim().length >= 3 && (!needsCode || reasonCodeId);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={copy.title}
      description={`${room.displayConfirmation}. ${copy.description}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button
            variant={needsCode ? "danger" : "primary"}
            pending={state.isLoading}
            disabled={!valid}
            onClick={() => void submit()}
          >
            {copy.confirm}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {error ? <Alert tone="danger">{error.message}</Alert> : null}
        {needsCode ? (
          <Select
            label="Reason code"
            placeholder="Select a reason"
            options={(codes ?? []).map((c) => ({ value: c.id, label: `${c.code} · ${c.name}` }))}
            value={reasonCodeId}
            onChange={(e) => setReasonCodeId(e.target.value)}
          />
        ) : null}
        <TextArea
          label="Reason (recorded in the audit trail)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={1000}
        />
      </div>
    </Dialog>
  );
}
