import { describe, expect, it } from 'vitest';
import { fromRow, PROFILES_FALLBACK } from './profiles';

describe('profiles', () => {
  it('the fallback has 9 profiles, only the three FP16 ones enabled, none board-verified', () => {
    expect(PROFILES_FALLBACK).toHaveLength(9);
    expect(PROFILES_FALLBACK.filter((p) => p.enabled).map((p) => p.id)).toEqual([
      'smolvla-fp16',
      'pi0-fp16',
      'xvla-fp16',
    ]);
    expect(PROFILES_FALLBACK.some((p) => p.boardVerified)).toBe(false);
    expect(PROFILES_FALLBACK.filter((p) => !p.enabled).every((p) => !!p.reason)).toBe(true);
  });

  it('maps a BE row; a blocked profile keeps its reason', () => {
    expect(
      fromRow({
        profile_id: 'pi0-int8',
        ai_id: 'pi0/int8_mixed',
        model: 'Pi0',
        precision: 'INT8',
        status: 'blocked',
        blocked_reason: 'error 0.128 > 0.02',
        board_verified: false,
      }),
    ).toEqual({
      id: 'pi0-int8',
      aiId: 'pi0/int8_mixed',
      model: 'Pi0',
      precision: 'INT8',
      enabled: false,
      reason: 'error 0.128 > 0.02',
      boardVerified: false,
    });
    expect(fromRow({ profile_id: 'x', status: 'attempted' })?.enabled).toBe(true);
  });
});
