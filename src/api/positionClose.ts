const POSITIVE_DECIMAL_TICKET_PATTERN = /^\d+$/;

export const requirePositionCloseTicket = (ticket: string | number, context: string): string => {
  if (typeof ticket === 'number') {
    if (Number.isSafeInteger(ticket) && ticket > 0) return String(ticket);
  } else if (POSITIVE_DECIMAL_TICKET_PATTERN.test(ticket) && /[1-9]/.test(ticket)) {
    return ticket;
  }

  throw new Error(`Invalid ticket for ${context}`);
};
