"use client";

import type { LucideIcon } from "lucide-react";
import { SearchableSelect } from "./SearchableSelect";

export interface SelectOption {
  value: string;
  label: string;
  /** One line under the label in the list. */
  description?: string;
  /** Options with the same group are listed under one heading. */
  group?: string;
  icon?: LucideIcon;
  disabled?: boolean;
}

/** The change event Select emits (the shape handlers read: `e.target.value`). */
export interface SelectChangeEvent {
  target: { value: string };
  currentTarget: { value: string };
}

export interface SelectProps {
  label: string;
  options: readonly SelectOption[];
  value?: string;
  onChange?: (event: SelectChangeEvent) => void;
  /**
   * First, empty choice ("All floors", "Select"): shown when nothing is
   * selected and selectable to go back to nothing, as with a native select.
   */
  placeholder?: string;
  errors?: string[];
  hint?: string;
  disabled?: boolean;
  className?: string;
  /** Search field in the list; by default when there are more than 7 options. */
  searchable?: boolean;
}

/**
 * Form and filter dropdown with label, hint and error: the SERENE
 * SearchableSelect (branded listbox, search on longer lists, full keyboard
 * support) behind the simple `options` / `value` / `onChange(e)` API every
 * screen uses.
 */
export function Select({
  label,
  options,
  value = "",
  onChange,
  placeholder,
  errors,
  hint,
  disabled,
  className,
  searchable,
}: SelectProps) {
  const items =
    placeholder !== undefined
      ? [{ value: "", label: placeholder }, ...options.filter((o) => o.value !== "")]
      : options;
  return (
    <SearchableSelect
      label={label}
      items={items}
      value={value}
      onChange={(next) => onChange?.({ target: { value: next }, currentTarget: { value: next } })}
      placeholder={placeholder ?? "Select"}
      searchable={searchable}
      disabled={disabled}
      errors={errors}
      hint={hint}
      className={className}
    />
  );
}
