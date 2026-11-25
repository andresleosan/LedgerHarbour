import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// getCurrentIdentity swallows the cookies() bailout during the build, so without this
// flag Next prerenders the signed-out redirect to /login and serves it to everyone.
describe("protected layouts", () => {
  it.each(["src/app/(platform)/layout.tsx", "src/app/(app)/layout.tsx"])("%s renders per request", (file) => {
    expect(readFileSync(file, "utf8")).toContain('export const dynamic = "force-dynamic";');
  });
});
