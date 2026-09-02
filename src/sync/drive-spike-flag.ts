export const DRIVE_SPIKE_FLAG_KEY = "flixate:drive-spike-enabled";

type FlagStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function driveSpikeEnabled(
  clientId: string | undefined,
  development: boolean,
  search: string,
  storage: FlagStorage,
): boolean {
  if (!clientId) return false;
  if (development) return true;

  const requested = new URLSearchParams(search).get("drive-spike");
  try {
    if (requested === "1") storage.setItem(DRIVE_SPIKE_FLAG_KEY, "1");
    if (requested === "0") storage.removeItem(DRIVE_SPIKE_FLAG_KEY);
    return requested === "1"
      || (requested !== "0" && storage.getItem(DRIVE_SPIKE_FLAG_KEY) === "1");
  } catch {
    return requested === "1";
  }
}
