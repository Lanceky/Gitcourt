import { z } from "zod";

import type { Actor } from "@/lib/domain/types";

export const demoIdentityInputSchema = z.object({
  displayName: z.string().trim().min(2).max(80),
  email: z.string().trim().email().max(254),
});

export type DemoIdentityInput = z.infer<typeof demoIdentityInputSchema>;

export function createDemoActor(input: DemoIdentityInput): Actor {
  const email = input.email.trim().toLowerCase();

  return {
    id: `demo-${email.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`,
    displayName: input.displayName.trim(),
    email,
    role: "student",
  };
}
