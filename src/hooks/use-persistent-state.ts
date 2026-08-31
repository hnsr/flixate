import { useEffect, useState } from "react";

export function usePersistentState<T>(
  key: string,
  fallback: T,
  validate: (value: unknown) => T,
): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [state, setState] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(key);
      return stored ? validate(JSON.parse(stored)) : fallback;
    } catch {
      return fallback;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(state));
    } catch {
      // Keep the current session usable if browser storage is unavailable.
    }
  }, [key, state]);

  return [state, setState];
}
