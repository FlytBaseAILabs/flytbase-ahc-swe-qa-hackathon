import { describe, expect, it } from 'vitest';
import { parseTopic, topic } from '../src/index';

describe('topic', () => {
  it('round-trips', () => {
    const t = topic('flytbase', 'drone-1', 'battery');
    expect(t).toBe('flytbase/drone-1/telemetry/battery');
    expect(parseTopic(t)).toEqual({ orgId: 'flytbase', deviceId: 'drone-1', attribute: 'battery' });
  });
  it('rejects malformed topics', () => {
    expect(parseTopic('a/b/c')).toBeNull();
    expect(parseTopic('a/b/other/c')).toBeNull();
  });
});
