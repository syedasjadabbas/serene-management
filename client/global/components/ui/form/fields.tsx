"use client";

import { type ReactNode, useCallback } from "react";
import { type Control, type FieldPath, type FieldValues, useController } from "react-hook-form";
import { WeekdayPicker } from "../FormDialog";
import { PasswordField, type PasswordFieldProps } from "../PasswordField";
import { SearchableSelect, type SearchableSelectProps } from "../SearchableSelect";
import { Select, type SelectProps } from "../Select";
import { TextArea, type TextAreaProps } from "../TextArea";
import { TextField, type TextFieldProps } from "../TextField";
import { ToggleGroup, type ToggleOption } from "../ToggleGroup";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Ctl<T extends FieldValues> = Control<T, any, any>;

interface Bound<T extends FieldValues> {
  control: Ctl<T>;
  name: FieldPath<T>;
}

type Omitted = "value" | "defaultValue" | "name" | "errors";

function messages(error: { message?: string } | undefined): string[] | undefined {
  return error?.message ? [error.message] : undefined;
}

/** Text input bound to a form field; markup, hint and error wiring come from TextField. */
export function FormTextField<T extends FieldValues>({
  control,
  name,
  onChange,
  onBlur,
  ...props
}: Bound<T> & Omit<TextFieldProps, Omitted>) {
  const {
    field: { ref, name: fieldName, value, onChange: setValue, onBlur: setTouched },
    fieldState,
  } = useController({ control, name });
  return (
    <TextField
      {...props}
      ref={ref}
      name={fieldName}
      value={(value as string | undefined) ?? ""}
      onChange={(event) => {
        setValue(event.target.value);
        onChange?.(event);
      }}
      onBlur={(event) => {
        setTouched();
        onBlur?.(event);
      }}
      errors={messages(fieldState.error)}
    />
  );
}

export function FormTextArea<T extends FieldValues>({
  control,
  name,
  ...props
}: Bound<T> & Omit<TextAreaProps, Omitted>) {
  const {
    field: { ref, name: fieldName, value, onChange: setValue, onBlur: setTouched },
    fieldState,
  } = useController({ control, name });
  return (
    <TextArea
      {...props}
      ref={ref}
      name={fieldName}
      value={(value as string | undefined) ?? ""}
      onChange={(event) => setValue(event.target.value)}
      onBlur={setTouched}
      errors={messages(fieldState.error)}
    />
  );
}

export function FormPasswordField<T extends FieldValues>({
  control,
  name,
  ...props
}: Bound<T> & Omit<PasswordFieldProps, Omitted>) {
  const {
    field: { ref, name: fieldName, value, onChange: setValue, onBlur: setTouched },
    fieldState,
  } = useController({ control, name });
  return (
    <PasswordField
      {...props}
      ref={ref}
      name={fieldName}
      value={(value as string | undefined) ?? ""}
      onChange={(event) => setValue(event.target.value)}
      onBlur={setTouched}
      errors={messages(fieldState.error)}
    />
  );
}

/**
 * Registers a focus handle for controls that cannot take a ref (the listbox
 * selects): React Hook Form focuses the first invalid field through it. The
 * wrapper is `display: contents`, so layout and styles are unchanged.
 */
function FocusableWrapper({
  fieldRef,
  children,
}: {
  fieldRef: (instance: unknown) => void;
  children: ReactNode;
}) {
  const setRef = useCallback(
    (element: HTMLDivElement | null) => {
      fieldRef(
        element
          ? {
              focus: () =>
                element
                  .querySelector<HTMLElement>("button:not([disabled]),input,textarea")
                  ?.focus(),
            }
          : null,
      );
    },
    [fieldRef],
  );
  return (
    <div ref={setRef} className="contents">
      {children}
    </div>
  );
}

/** The SERENE Select (options/value/onChange(e)) bound to a form field. */
export function FormSelect<T extends FieldValues>({
  control,
  name,
  onChange,
  ...props
}: Bound<T> & Omit<SelectProps, "value" | "errors">) {
  const {
    field: { ref, value, onChange: setValue },
    fieldState,
  } = useController({ control, name });
  return (
    <FocusableWrapper fieldRef={ref}>
      <Select
        {...props}
        value={(value as string | undefined) ?? ""}
        onChange={(event) => {
          setValue(event.target.value);
          onChange?.(event);
        }}
        errors={messages(fieldState.error)}
      />
    </FocusableWrapper>
  );
}

export function FormSearchableSelect<T extends FieldValues>({
  control,
  name,
  onChange,
  ...props
}: Bound<T> &
  Omit<SearchableSelectProps, "value" | "errors" | "onChange"> & {
    onChange?: SearchableSelectProps["onChange"];
  }) {
  const {
    field: { ref, value, onChange: setValue },
    fieldState,
  } = useController({ control, name });
  return (
    <FocusableWrapper fieldRef={ref}>
      <SearchableSelect
        {...props}
        value={(value as string | null | undefined) ?? ""}
        onChange={(value, item) => {
          setValue(value);
          onChange?.(value, item);
        }}
        errors={messages(fieldState.error)}
      />
    </FocusableWrapper>
  );
}

export function FormToggleGroup<T extends FieldValues, V extends string>({
  control,
  name,
  label,
  options,
  className,
}: Bound<T> & { label: string; options: readonly ToggleOption<V>[]; className?: string }) {
  const {
    field: { value, onChange: setValue },
  } = useController({ control, name });
  return (
    <ToggleGroup
      label={label}
      options={options}
      value={value as V}
      onChange={(value) => setValue(value)}
      className={className}
    />
  );
}

/** Mon=1 … Sun=64 weekday mask bound to a numeric form field. */
export function FormWeekdayPicker<T extends FieldValues>({
  control,
  name,
  label,
}: Bound<T> & { label?: string }) {
  const {
    field: { value, onChange: setValue },
  } = useController({ control, name });
  return (
    <WeekdayPicker
      value={(value as number | undefined) ?? 0}
      onChange={(mask) => setValue(mask)}
      label={label}
    />
  );
}

/** Checkbox with the label markup the dialogs have always used. */
export function FormCheckbox<T extends FieldValues>({
  control,
  name,
  label,
  className = "flex items-center gap-2 text-sm",
  disabled,
}: Bound<T> & { label: ReactNode; className?: string; disabled?: boolean }) {
  const {
    field: { ref, name: fieldName, value, onChange: setValue, onBlur: setTouched },
    fieldState,
  } = useController({ control, name });
  return (
    <div className="flex flex-col gap-1">
      <label className={className}>
        <input
          type="checkbox"
          ref={ref}
          name={fieldName}
          checked={Boolean(value)}
          disabled={disabled}
          aria-invalid={fieldState.error ? true : undefined}
          onChange={(event) => setValue(event.target.checked)}
          onBlur={setTouched}
        />
        {label}
      </label>
      {fieldState.error?.message ? (
        <p className="text-xs text-danger">{fieldState.error.message}</p>
      ) : null}
    </div>
  );
}
