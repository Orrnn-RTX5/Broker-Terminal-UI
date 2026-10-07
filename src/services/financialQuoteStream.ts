import { compareSequence, getTerminalQuoteSession, getVerifiedQuoteProviderTime, isTerminalQuoteClockVerified,
  quoteEvidenceFailure, readQuoteFreshnessMetadata, type TerminalQuoteEvidence, type TerminalQuoteMetadata } from './terminalQuoteFreshness';
import { compareQuoteSourceRevision } from '../utils/quoteSourceEpoch';

/** Only a newer explicit broker source revision can begin another sequence epoch. */
export class FinancialQuoteStream {
  private generation = getTerminalQuoteSession();
  private watermarks = new Map<string, TerminalQuoteMetadata>();

  reset(): void { this.generation = getTerminalQuoteSession(); this.watermarks.clear(); }
  forget(symbol: string): void { this.watermarks.delete(symbol); }

  decide(symbol: string, tick: TerminalQuoteEvidence, executionAccepted: boolean): 'accepted' | 'defer' | 'rejected' {
    if (this.generation !== getTerminalQuoteSession()) this.reset();
    const metadata = readQuoteFreshnessMetadata(tick);
    if (quoteEvidenceFailure(tick, metadata) || metadata.source_mismatch === true) return 'rejected';
    const previous = this.watermarks.get(symbol);
    const epoch = compareQuoteSourceRevision(metadata.source_revision, previous?.source_revision);
    if (epoch === -1) return 'rejected';
    // When current execution evidence rejected this event and clock calibration
    // is unavailable, only an event no later than previously verified evidence
    // can bypass that rejection. A future sequence must not poison this owner.
    if (!executionAccepted && !isTerminalQuoteClockVerified()) {
      const ceiling = getVerifiedQuoteProviderTime(symbol);
      if (ceiling === undefined || metadata.provider_timestamp! > ceiling) return 'defer';
    }
    if (previous) {
      if (metadata.provider_timestamp! < previous.provider_timestamp!) return 'rejected';
      if (epoch !== 1 && metadata.sequence !== undefined && previous.sequence !== undefined) {
        const order = compareSequence(metadata.sequence, previous.sequence);
        if (order !== undefined && order <= 0) return 'rejected';
      } else if (epoch !== 1 && metadata.provider_timestamp === previous.provider_timestamp) return 'rejected';
    }
    // Missing metadata retains known ordering; only a higher explicit revision
    // clears the prior sequence, matching execution's persistent watermarks.
    this.watermarks.set(symbol, { ...metadata,
      source_revision: metadata.source_revision ?? previous?.source_revision,
      sequence: metadata.sequence ?? (epoch === 1 ? undefined : previous?.sequence) });
    return 'accepted';
  }
}

export const financialQuoteEventIdentity = (tick: TerminalQuoteMetadata): string | undefined =>
  tick.sequence === undefined || tick.provider_timestamp === undefined || !tick.source ? undefined
    : JSON.stringify([tick.source, tick.provider_timestamp, String(tick.sequence), tick.source_revision ?? null]);
