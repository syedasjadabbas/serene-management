"use client";

import { type Control, type FieldPath, type FieldValues, useController } from "react-hook-form";
import { TextField, type TextFieldProps } from "@/global/components/ui/TextField";

/** Numeric text box bound to a form field; input is reduced to digits (at most `maxLength`). */
export function DigitsField<T extends FieldValues>({
  control,
  name,
  maxLength,
  ...props
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  control: Control<T, any, any>;
  name: FieldPath<T>;
  maxLength?: number;
} & Omit<TextFieldProps, "value" | "name" | "errors" | "onChange" | "maxLength">) {
  const {
    field: { ref, name: fieldName, value, onChange, onBlur },
    fieldState,
  } = useController({ control, name });
  return (
    <TextField
      {...props}
      ref={ref}
      name={fieldName}
      inputMode="numeric"
      value={(value as string | undefined) ?? ""}
      onChange={(e) => {
        const next = e.target.value.replace(/\D/g, "");
        onChange(maxLength ? next.slice(0, maxLength) : next);
      }}
      onBlur={onBlur}
      errors={fieldState.error?.message ? [fieldState.error.message] : undefined}
    />
  );
}
