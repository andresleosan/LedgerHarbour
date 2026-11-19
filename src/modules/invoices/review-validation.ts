import { z } from "zod";

export const MAX_REVIEW_PATCH_BYTES = 64 * 1024;

/** The payment answer in an approval or payment-change request; the service checks the values. */
export const paymentSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("paid"), accountId: z.string().min(1).max(200), paidOn: z.string().max(10), amountDebited: z.string().max(20) }).strict(),
  z.object({ status: z.literal("unpaid") }).strict(),
  z.object({ status: z.literal("paid_privately") }).strict(),
]);
