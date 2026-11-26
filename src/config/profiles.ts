// The 9 AI profiles (3 models x 3 precisions). The BE (`GET /api/v1/profiles`, from
// backend/config/profiles.json) is the source at runtime; this list is the fallback for the
// mock and for when that request fails. From the AI team's comparison_matrix.csv and
// campaign_20261101_v1_status.json (Robo-Arm-COS40005, 01-02/11). PROVISIONAL until Duc confirms.
import { useEffect, useState } from 'react';
import { apiBase } from '../transport';

export interface ProfileDef {
  /** Web id, e.g. "smolvla-fp16". The AI logs call it `aiId`. */
  id: string;
  aiId?: string;
  model: string;
  precision: string;
  /** The web may run it. A blocked profile stays visible, greyed, with its reason. */
  enabled: boolean;
  reason?: string;
  /** Accepted on the VENTUNO Q board. None is yet. */
  boardVerified: boolean;
}

const blocked = (error: string, attempt: number) =>
  `Conversion validation failed: native vs eager max error ${error} > limit 0.02 (attempt ${attempt}).`;

export const PROFILES_FALLBACK: ProfileDef[] = [
  {
    id: 'smolvla-fp16',
    aiId: 'smolvla/fp16',
    model: 'SmolVLA',
    precision: 'FP16',
    enabled: true,
    boardVerified: false,
  },
  {
    id: 'smolvla-int8',
    aiId: 'smolvla/int8_mixed',
    model: 'SmolVLA',
    precision: 'INT8',
    enabled: false,
    boardVerified: false,
    reason: blocked('0.043', 7),
  },
  {
    id: 'smolvla-int4',
    aiId: 'smolvla/int4_mixed',
    model: 'SmolVLA',
    precision: 'INT4',
    enabled: false,
    boardVerified: false,
    reason: blocked('0.029', 3),
  },
  {
    id: 'pi0-fp16',
    aiId: 'pi0/fp16',
    model: 'Pi0',
    precision: 'FP16',
    enabled: true,
    boardVerified: false,
  },
  {
    id: 'pi0-int8',
    aiId: 'pi0/int8_mixed',
    model: 'Pi0',
    precision: 'INT8',
    enabled: false,
    boardVerified: false,
    reason: blocked('0.128', 5),
  },
  {
    id: 'pi0-int4',
    aiId: 'pi0/int4_mixed',
    model: 'Pi0',
    precision: 'INT4',
    enabled: false,
    boardVerified: false,
    reason: blocked('0.054', 5),
  },
  {
    id: 'xvla-fp16',
    aiId: 'xvla/fp16',
    model: 'X-VLA',
    precision: 'FP16',
    enabled: true,
    boardVerified: false,
  },
  {
    id: 'xvla-int8',
    aiId: 'xvla/int8_mixed',
    model: 'X-VLA',
    precision: 'INT8',
    enabled: false,
    boardVerified: false,
    reason: blocked('0.076', 3),
  },
  {
    id: 'xvla-int4',
    aiId: 'xvla/int4_mixed',
    model: 'X-VLA',
    precision: 'INT4',
    enabled: false,
    boardVerified: false,
    reason: blocked('0.069', 3),
  },
];

interface ProfileRow {
  profile_id: string;
  ai_id?: string | null;
  model?: string | null;
  precision?: string | null;
  status?: string;
  blocked_reason?: string | null;
  board_verified?: boolean | null;
  dev_only?: boolean;
}

/** One row of `GET /api/v1/profiles` -> ProfileDef. Unknown shapes are dropped. */
export function fromRow(row: ProfileRow): ProfileDef | null {
  if (!row || typeof row.profile_id !== 'string') return null;
  const enabled = row.status !== 'blocked';
  return {
    id: row.profile_id,
    aiId: row.ai_id ?? undefined,
    model: row.model ?? row.profile_id,
    precision: row.precision ?? '',
    enabled,
    reason: enabled ? undefined : (row.blocked_reason ?? undefined),
    boardVerified: !!row.board_verified,
  };
}

/** Profiles from the BE when the page talks to it; the fallback otherwise or on error. */
export function useProfiles(): ProfileDef[] {
  const [profiles, setProfiles] = useState<ProfileDef[]>(PROFILES_FALLBACK);
  useEffect(() => {
    const base = apiBase();
    if (base === null) return;
    const ctrl = new AbortController();
    fetch(`${base}/api/v1/profiles`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data: { profiles?: ProfileRow[] }) => {
        const rows = (data.profiles ?? []).filter((r) => !r.dev_only);
        const list = rows.map(fromRow).filter((p): p is ProfileDef => p !== null);
        if (list.length > 0) setProfiles(list);
      })
      .catch(() => {
        /* keep the fallback */
      });
    return () => ctrl.abort();
  }, []);
  return profiles;
}
