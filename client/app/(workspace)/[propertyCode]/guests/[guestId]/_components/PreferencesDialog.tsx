"use client";

import { useFieldArray } from "react-hook-form";
import { FormDialog } from "@/global/components/ui/FormDialog";
import {
  FormSelect,
  FormTextField,
  applyServerError,
  useZodForm,
} from "@/global/components/ui/form";
import { useProperty } from "@/global/hooks/useProperty";
import {
  useGuestOptionsQuery,
  useSetGuestPreferencesMutation,
} from "@/global/api/endpoints/guestsApi";
import { toClientApiError } from "@/global/api/errors";
import type { GuestProfileView } from "@serene/shared/modules/guests/guests.types";
import {
  type PreferencesValues,
  preferencesFormSchema,
  preferencesPayload,
} from "../_lib/guestDialogForms";

const label = (value: string) => value.charAt(0) + value.slice(1).toLowerCase().replace("_", " ");

export function PreferencesDialog({
  guest,
  onClose,
}: {
  guest: GuestProfileView;
  onClose: () => void;
}) {
  const property = useProperty();
  const options = useGuestOptionsQuery();
  const [save, state] = useSetGuestPreferencesMutation();
  // Preferences the caller manages: global and this property's.
  const { control, handleSubmit, setError, watch, formState } = useZodForm(preferencesFormSchema, {
    rows: guest.preferences
      .filter((p) => p.property === null || p.property.id === property.id)
      .map((p) => ({
        preferenceCodeId: p.preferenceCode.id,
        propertyId: p.property?.id ?? null,
        note: p.note ?? "",
      })),
  });
  const { append, remove } = useFieldArray({ control, name: "rows" });
  const rows = watch("rows");
  // Preferences for every property need an organization-level grant (D3);
  // without it they are shown read-only and sent back unchanged.
  const manageGlobal = guest.access.manageGlobalPreferences;
  const codes = options.data?.preferenceCodes ?? [];
  const groups = [...new Set(codes.map((c) => c.groupCode))];
  const indexOf = (id: string) => rows.findIndex((r) => r.preferenceCodeId === id);

  async function submit(values: PreferencesValues) {
    const result = await save({
      guestId: guest.id,
      body: { version: guest.version, preferences: preferencesPayload(values) },
    });
    if ("data" in result) onClose();
    else applyServerError(setError, toClientApiError(result.error));
  }

  return (
    <FormDialog
      title="Preferences"
      description={
        manageGlobal
          ? `Apply to every property or only ${property.code}. Changes are audited.`
          : `Set preferences for ${property.code}. Preferences for every property are managed at organization level. Changes are audited.`
      }
      onClose={onClose}
      onSubmit={handleSubmit(submit)}
      submitLabel="Save preferences"
      pending={state.isLoading || formState.isSubmitting}
      error={toClientApiError(state.error)}
      size="lg"
    >
      {groups.map((group) => (
        <fieldset key={group} className="flex flex-col gap-1">
          <legend className="text-xs font-medium text-fg-secondary">{label(group)}</legend>
          {codes
            .filter((c) => c.groupCode === group)
            .map((code) => {
              const i = indexOf(code.id);
              const row = i >= 0 ? rows[i] : undefined;
              const locked = !manageGlobal && row?.propertyId === null;
              return (
                <div key={code.id} className="flex flex-wrap items-center gap-2">
                  <label className="flex min-h-11 min-w-44 items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={!!row}
                      disabled={locked}
                      onChange={(e) =>
                        e.target.checked
                          ? append({
                              preferenceCodeId: code.id,
                              propertyId: manageGlobal ? null : property.id,
                              note: "",
                            })
                          : remove(indexOf(code.id))
                      }
                    />
                    {code.name}
                  </label>
                  {row && locked ? (
                    <span className="text-xs text-fg-muted">
                      Every property{row.note ? ` · ${row.note}` : ""}
                    </span>
                  ) : row ? (
                    <>
                      <FormSelect
                        control={control}
                        name={`rows.${i}.propertyId`}
                        label="Applies to"
                        options={[
                          ...(manageGlobal ? [{ value: "", label: "Every property" }] : []),
                          { value: property.id, label: `Only ${property.code}` },
                        ]}
                      />
                      <FormTextField
                        control={control}
                        name={`rows.${i}.note`}
                        label="Note"
                        maxLength={500}
                        className="min-w-0 flex-1 basis-40"
                      />
                    </>
                  ) : null}
                </div>
              );
            })}
        </fieldset>
      ))}
      {codes.length === 0 ? (
        <p className="text-sm text-fg-secondary">No preference catalog configured.</p>
      ) : null}
    </FormDialog>
  );
}
