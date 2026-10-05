import { compareSequence, getTerminalQuoteSession, getVerifiedQuoteProviderTime, isTerminalQuoteClockVerified,
  quoteEvidenceFailure, readQuoteFreshnessMetadata, type TerminalQuoteEvidence, type TerminalQuoteMetadata } from './terminalQuoteFreshness';

/** Source text can change in-band; the hub sequence must never reset because of it. */
export class FinancialQuoteStream {
  private generation = getTerminalQuoteSession();
  private watermarks = new Map<string, TerminalQuoteMetadata>();

  reset(): void { this.generation = getTerminalQuoteSession(); this.watermarks.clear(); }
  forget(symbol: string): void { this.watermarks.delete(symbol); }

  decide(symbol: string, tick: TerminalQuoteEvidence, executionAccepted: boolean): 'accepted' | 'defer' | 'rejected' {
    if (this.generation !== getTerminalQuoteSession()) this.reset();
    const metadata = readQuoteFreshnessMetadata(tick);
    if (quoteEvidenceFailure(tick, metadata) || metadata.source_mismatch === true) return 'rejected';
    // When current execution evidence rejected this event and clock calibration
    // is unavailable, only an event no later than previously verified evidence
    // can bypass that rejection. A future sequence must not poison this owner.
    if (!executionAccepted && !isTerminalQuoteClockVerified()) {
      const ceiling = getVerifiedQuoteProviderTime(symbol);
      if (ceiling === undefined || metadata.provider_timestamp! > ceiling) return 'defer';
    }
    const previous = this.watermarks.get(symbol);
    if (previous) {
      if (metadata.provider_timestamp! < previous.provider_timestamp!) return 'rejected';
      if (metadata.sequence !== undefined && previous.sequence !== undefined) {
        const order = compareSequence(metadata.sequence, previous.sequence);
        if (order !== undefined && order <= 0) return 'rejected';
      } else if (metadata.provider_timestamp === previous.provider_timestamp) return 'rejected';
    }
    // An unsequenced event can advance time without erasing the last exact
    // sequence, matching execution's separate persistent sequence watermark.
    this.watermarks.set(symbol, { ...metadata, sequence: metadata.sequence ?? previous?.sequence });
    return 'accepted';
  }
}

export const financialQuoteEventIdentity = (tick: TerminalQuoteMetadata): string | undefined =>
  tick.sequence === undefined || tick.provider_timestamp === undefined || !tick.source ? undefined
    : JSON.stringify([tick.source, tick.provider_timestamp, String(tick.sequence)]);
