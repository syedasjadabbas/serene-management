import { z } from "zod";
import { updateProfileSchema } from "@serene/shared/modules/identity/identity.schema";

/** Profile form values: the display name follows the shared profile rule. */
export const profileFormSchema = z.object({
  displayName: updateProfileSchema.shape.displayName,
});
