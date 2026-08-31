import type { TitleKey } from "./catalog.js";

export const USER_STATE_KEY = "flixate:user-state:v1";

export type TitleState = {
  seen: boolean;
  updatedAt: string;
};

export type UserStateV1 = {
  version: 1;
  titles: Partial<Record<TitleKey, TitleState>>;
};

type UserStateV0 = {
  version: 0;
  seen: TitleKey[];
};

export function emptyUserState(): UserStateV1 {
  return { version: 1, titles: {} };
}

function isTitleKey(value: unknown): value is TitleKey {
  return typeof value === "string" && /^(movie|tv):\d+$/.test(value);
}

function isTitleState(value: unknown): value is TitleState {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<TitleState>;
  return typeof candidate.seen === "boolean" && typeof candidate.updatedAt === "string";
}

export function migrateUserState(value: unknown, now = new Date().toISOString()): UserStateV1 {
  if (!value || typeof value !== "object") return emptyUserState();
  const candidate = value as {
    version?: unknown;
    seen?: unknown;
    titles?: unknown;
  };

  if (candidate.version === 0 && Array.isArray(candidate.seen)) {
    const titles: UserStateV1["titles"] = {};
    for (const key of candidate.seen) {
      if (isTitleKey(key)) titles[key] = { seen: true, updatedAt: now };
    }
    return { version: 1, titles };
  }

  if (candidate.version === 1 && candidate.titles && typeof candidate.titles === "object") {
    const titles: UserStateV1["titles"] = {};
    for (const [key, state] of Object.entries(candidate.titles)) {
      if (isTitleKey(key) && isTitleState(state)) titles[key] = state;
    }
    return { version: 1, titles };
  }

  return emptyUserState();
}

export function loadUserState(storage: Pick<Storage, "getItem">): UserStateV1 {
  try {
    const raw = storage.getItem(USER_STATE_KEY);
    if (!raw) return emptyUserState();
    return migrateUserState(JSON.parse(raw));
  } catch {
    return emptyUserState();
  }
}

export function toggleSeen(
  state: UserStateV1,
  key: TitleKey,
  now = new Date().toISOString(),
): UserStateV1 {
  return {
    version: 1,
    titles: {
      ...state.titles,
      [key]: { seen: !(state.titles[key]?.seen ?? false), updatedAt: now },
    },
  };
}

export function seenTitleKeys(state: UserStateV1): Set<TitleKey> {
  return new Set(
    Object.entries(state.titles)
      .filter(([, value]) => value?.seen)
      .map(([key]) => key as TitleKey),
  );
}

export function mergeUserStates(local: UserStateV1, incoming: UserStateV1): UserStateV1 {
  const titles = { ...local.titles };
  for (const [key, incomingState] of Object.entries(incoming.titles)) {
    if (!isTitleKey(key) || !incomingState) continue;
    const localState = titles[key];
    if (!localState || incomingState.updatedAt > localState.updatedAt) {
      titles[key] = incomingState;
    }
  }
  return { version: 1, titles };
}
