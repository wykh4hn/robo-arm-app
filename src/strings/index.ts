import { useStore } from '../state/store';
import type { Lang } from '../state/types';
import { en } from './en';
import { vi, type Strings } from './vi';

export type { Strings };

export const STRINGS: Record<Lang, Strings> = { vi, en };

/** Current UI strings. */
export function useT(): Strings {
  return STRINGS[useStore((s) => s.lang)];
}

/** Replaces {name} placeholders. */
export function fmt(template: string, params: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m));
}
