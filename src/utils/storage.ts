// localStorage can throw (private mode, blocked storage); never let that break the UI.
const PREFIX = 'robo-arm.';

export const storage = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(PREFIX + key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string): void {
    try {
      localStorage.setItem(PREFIX + key, value);
    } catch {
      /* ignore */
    }
  },
  clear(): void {
    try {
      Object.keys(localStorage)
        .filter((k) => k.startsWith(PREFIX))
        .forEach((k) => localStorage.removeItem(k));
    } catch {
      /* ignore */
    }
  },
};

const TUTORIAL_KEY = 'tutorialSeen';

export function tutorialSeen(): boolean {
  return storage.get(TUTORIAL_KEY) === '1';
}

export function markTutorialSeen(): void {
  storage.set(TUTORIAL_KEY, '1');
}
