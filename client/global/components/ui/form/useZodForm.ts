import { zodResolver } from "@hookform/resolvers/zod";
import { type DefaultValues, type FieldValues, type UseFormReturn, useForm } from "react-hook-form";
import type { z } from "zod";

/**
 * React Hook Form wired to a Zod schema (shared contract or a route-local
 * form schema). Validates on submit, then re-validates on every change, and
 * focuses the first invalid field. `handleSubmit` receives the schema OUTPUT.
 */
export function useZodForm<TSchema extends z.ZodType<FieldValues, FieldValues>>(
  schema: TSchema,
  defaultValues: DefaultValues<z.input<TSchema>>,
): UseFormReturn<z.input<TSchema>, unknown, z.output<TSchema>> {
  return useForm<z.input<TSchema>, unknown, z.output<TSchema>>({
    // zod 4 types are structurally checked by the resolver overloads.
    resolver: zodResolver(schema as never) as never,
    defaultValues,
    mode: "onSubmit",
    reValidateMode: "onChange",
    shouldFocusError: true,
  });
}
