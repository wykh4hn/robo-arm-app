import { useMemo } from 'react';
import { deriveStatus, type DerivedStatus } from './deriveStatus';
import { useStore } from './store';

/** Derived status for the current store snapshot. */
export function useDerived(): DerivedStatus {
  const state = useStore();
  return useMemo(() => deriveStatus(state), [state]);
}
