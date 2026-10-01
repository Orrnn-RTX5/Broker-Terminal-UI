/** Signals carry no authorization: consumers refetch their authenticated account catalogue. */
export const INSTRUMENT_CATALOGUE_CHANGED_EVENT = 'rtx:instrument-catalogue-changed';
export const INSTRUMENT_CATALOGUE_REFRESHED_EVENT = 'rtx:instrument-catalogue-refreshed';

export function notifyInstrumentCatalogueChanged(revision?: string): void {
  window.dispatchEvent(new CustomEvent(INSTRUMENT_CATALOGUE_CHANGED_EVENT, {
    detail: { revision },
  }));
}
