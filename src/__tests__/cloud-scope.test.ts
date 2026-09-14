import { describe, expect, it } from "vitest";
import { cloudScopeKey } from "../auth/cloudScope";

describe("cloud session scope", () => {
  it("changes when the authenticated user changes, even for the same household", () => {
    expect(cloudScopeKey("user-a", "household-1")).not.toBe(cloudScopeKey("user-b", "household-1"));
  });

  it("changes when the active household changes", () => {
    expect(cloudScopeKey("user-a", "household-1")).not.toBe(cloudScopeKey("user-a", "household-2"));
  });

  it("keeps signed-out and authenticated loading scopes separate", () => {
    expect(cloudScopeKey(null, null)).toBe("signed-out:no-household");
    expect(cloudScopeKey("user-a", null)).toBe("user-a:no-household");
    expect(cloudScopeKey(null, null)).not.toBe(cloudScopeKey("user-a", null));
  });
});
