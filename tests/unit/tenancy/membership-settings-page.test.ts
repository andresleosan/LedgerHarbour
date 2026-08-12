import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const pagePath = new URL(
  "../../../src/app/(app)/business/[businessId]/settings/members/page.tsx",
  import.meta.url,
);

describe("membership settings member identifiers", () => {
  it("uses membershipId for mutation routes and ownership transfer targets", () => {
    const source = readFileSync(pagePath, "utf8");

    expect(source).toContain("membershipId: string");
    expect(source).toContain("encodeURIComponent(member.membershipId)");
    expect(source).toContain("setSelectedTarget(member.membershipId)");
    expect(source).not.toContain("encodeURIComponent(member.userId)");
    expect(source).not.toContain("setSelectedTarget(member.userId)");
  });
});
