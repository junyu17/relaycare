export function cloudScopeKey(userId: string | null | undefined, householdId: string | null | undefined): string {
  return `${userId ?? "signed-out"}:${householdId ?? "no-household"}`;
}
