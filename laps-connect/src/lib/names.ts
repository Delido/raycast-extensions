/** Windows computer names (NetBIOS) have at most 15 characters. */
export const MAX_COMPUTER_NAME = 15;

/** "m-mustermann" + "-LAP" → "M-MUSTERMAN-LAP": the name is shortened so the suffix still fits. */
export function computerName(wireGuardName: string, suffix: string): string {
  const room = Math.max(0, MAX_COMPUTER_NAME - suffix.length);
  return `${wireGuardName.slice(0, room)}${suffix}`.toUpperCase();
}
