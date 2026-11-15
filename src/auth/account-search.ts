import { z } from "zod";

/** Read the same account entry parameters on the server and in the browser. */
export const accountSearchSchema = z.object({
  invitation: z.string().optional().catch(undefined),
  auth: z.enum(["email-verification", "password-reset"]).optional().catch(undefined),
  token: z.string().optional().catch(undefined),
  error: z.string().optional().catch(undefined),
});

export type AccountSearch = z.infer<typeof accountSearchSchema>;
