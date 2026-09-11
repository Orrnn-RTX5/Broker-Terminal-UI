import { translateUi } from '../hooks/useUiTranslation';

export type UiMessagePart = { label: string } | { value: string | number };
export type UiMessage = string | UiMessagePart[];

export const feedbackLabel = (label: string): UiMessagePart => ({ label });
export const feedbackValue = (value: string | number): UiMessagePart => ({ value });
export const feedbackSymbol = (symbol: string): UiMessagePart => symbol
  ? feedbackValue(symbol)
  : feedbackLabel('Selected symbol');

/** Preserve presentation labels until render time and leave broker data intact. */
export const formatUiMessage = (
  message: UiMessage,
  translate: (source: string) => string = translateUi,
): string => typeof message === 'string'
  ? translate(message)
  : message.map(part => 'label' in part ? translate(part.label) : String(part.value)).join('');
