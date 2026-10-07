import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { calibrateTerminalQuoteClock, getTerminalQuoteFreshness, ingestTerminalQuote, readQuoteFreshnessMetadata,
  recordTerminalQuoteSourcePolicy, resetTerminalQuoteFreshness } from './terminalQuoteFreshness';

const epoch = 1_800_000_000_000;
const policy = (revision = 37, patch: Record<string, unknown> = {}, serverTime = epoch) => ({ server_time: serverTime,
  live_price_source: { revision, active_mode: 'off', desired_mode: 'off', phase: 'active', ...patch } });
const quote = (revision: number) => ({ bid: 100, ask: 101, provider_timestamp: epoch - 50,
  source: 'cserver', source_revision: revision, sequence: '12', stale: false, tradable: true, source_mismatch: false });

describe('source policy explanations preserve quote eligibility', () => {
  beforeEach(() => { vi.spyOn(performance, 'now').mockReturnValue(1000); vi.spyOn(Date, 'now').mockReturnValue(epoch); resetTerminalQuoteFreshness();
    calibrateTerminalQuoteClock(epoch, 1000, epoch, 1000, epoch); });
  afterEach(() => { resetTerminalQuoteFreshness(); vi.restoreAllMocks(); });
  it('explains current Off with no quote without inventing a price or time-sync error', () => {
    recordTerminalQuoteSourcePolicy(policy());
    expect(getTerminalQuoteFreshness('BTCUSD')).toMatchObject({ live: false, reason: 'unavailable', sourcePolicyReason: 'source-off' });
  });
  it('higher revision Off supersedes the label for retained old-source quotes, not their time evidence', () => {
    ingestTerminalQuote('BTCUSD', quote(36)); const before = getTerminalQuoteFreshness('BTCUSD');
    recordTerminalQuoteSourcePolicy(policy()); const after = getTerminalQuoteFreshness('BTCUSD');
    expect(after).toMatchObject({ live: before.live, reason: before.reason, ageMinMs: before.ageMinMs, sourcePolicyReason: 'source-off' });
  });
  it.each([37, 38])('does not let an old health snapshot obscure a fresh revision %i quote', revision => {
    ingestTerminalQuote('BTCUSD', quote(revision));
    recordTerminalQuoteSourcePolicy(policy(37, { active_mode: 'feed_token', desired_mode: 'feed_token', phase: 'failed' }));
    expect(getTerminalQuoteFreshness('BTCUSD').sourcePolicyReason).toBeUndefined();
  });
  it('rejects older policy revisions and older observations within a revision', () => {
    recordTerminalQuoteSourcePolicy(policy());
    recordTerminalQuoteSourcePolicy(policy(36, { phase: 'applying' }, epoch + 1));
    recordTerminalQuoteSourcePolicy(policy(37, { phase: 'applying' }, epoch - 1));
    expect(getTerminalQuoteFreshness('BTCUSD').sourcePolicyReason).toBe('source-off');
    recordTerminalQuoteSourcePolicy(policy(38, { active_mode: 'feed_token', desired_mode: 'receiver', phase: 'applying' }, epoch + 1));
    expect(getTerminalQuoteFreshness('BTCUSD').sourcePolicyReason).toBe('source-switching');
  });
  it('explains old-source evidence and clears policy on session reset', () => {
    ingestTerminalQuote('BTCUSD', quote(36));
    recordTerminalQuoteSourcePolicy(policy(37, { active_mode: 'receiver', desired_mode: 'receiver' }));
    expect(getTerminalQuoteFreshness('BTCUSD').sourcePolicyReason).toBe('source-mismatch');
    resetTerminalQuoteFreshness(); expect(getTerminalQuoteFreshness('BTCUSD').sourcePolicyReason).toBeUndefined();
  });
  it('retains validated source revision through normalization and ignores incomplete policy', () => {
    expect(readQuoteFreshnessMetadata({ source_revision: 37 })).toMatchObject({ source_revision: 37 });
    expect(readQuoteFreshnessMetadata({ source_revision: -1 }).source_revision).toBeUndefined();
    recordTerminalQuoteSourcePolicy({ live_price_source: policy().live_price_source });
    expect(getTerminalQuoteFreshness('BTCUSD').sourcePolicyReason).toBeUndefined();
  });
});
