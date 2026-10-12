export type TradingAccountType = 'demo' | 'real' | 'contest';

type AccountMetadata = Record<string, unknown>;

const TYPE_FIELDS = ['account_type', 'accountType', 'account_kind', 'accountKind', 'type', 'kind', 'mode'] as const;
const ACCOUNT_TRADE_MODE_FIELDS = ['account_trade_mode', 'accountTradeMode', 'ACCOUNT_TRADE_MODE'] as const;
const DEMO_FIELDS = ['is_demo', 'isDemo', 'demo'] as const;
const CONTEST_FIELDS = ['is_contest', 'isContest', 'contest'] as const;
const GROUP_FIELDS = ['group', 'Group', 'account_group', 'accountGroup'] as const;

const asRecord = (value: unknown): AccountMetadata | undefined => (
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as AccountMetadata
    : undefined
);

const recordsFrom = (source: unknown): AccountMetadata[] => {
  const root = asRecord(source);
  if (!root) return [];
  const data = asRecord(root.data);
  const records = [root, asRecord(root.account), asRecord(root.user), asRecord(asRecord(root.user)?.account)];
  if (data) records.push(data, asRecord(data.account), asRecord(data.user), asRecord(asRecord(data.user)?.account));
  return records.filter((record): record is AccountMetadata => Boolean(record));
};

const readTypeText = (value: unknown): TradingAccountType | undefined => {
  if (typeof value !== 'string') return undefined;
  const tokens = value.trim().toLowerCase().split(/[^a-z0-9]+/);
  // A contest may use a demo environment, so its more specific designation wins.
  if (tokens.some(token => ['contest', 'competition', 'tournament'].includes(token))) return 'contest';
  if (tokens.includes('demo')) return 'demo';
  if (tokens.includes('real') || tokens.includes('live')) return 'real';
  return undefined;
};

const readGroupType = (value: unknown): TradingAccountType | undefined => {
  if (typeof value !== 'string') return undefined;
  // Broker groups can be prefixed by an organization path. The nearest
  // classified group segment is more specific than a broker-named parent.
  for (const segment of value.split(/[\\/]/).reverse()) {
    const accountType = readTypeText(segment);
    if (accountType) return accountType;
  }
  return undefined;
};

const readFields = (
  records: AccountMetadata[],
  fields: readonly string[],
  read: (value: unknown) => TradingAccountType | undefined,
): TradingAccountType | undefined => {
  for (const record of records) {
    for (const field of fields) {
      const result = read(record[field]);
      if (result) return result;
    }
  }
  return undefined;
};

const readAccountTradeMode = (value: unknown): TradingAccountType | undefined => {
  // MT5 ENUM_ACCOUNT_TRADE_MODE: 0 Demo, 1 Contest, 2 Real.
  // Only account-specific keys use this enum. A symbol's trade_mode is unrelated.
  // https://www.mql5.com/en/book/automation/account/account_real_demo_contest
  // Values also match MetaQuotes' MetaTrader5 package constants on PyPI.
  if (value === 0 || value === '0') return 'demo';
  if (value === 1 || value === '1') return 'contest';
  if (value === 2 || value === '2') return 'real';
  return readTypeText(value);
};

/**
 * Classifies backend account metadata independently of broker branding.
 * Sources are ordered from current response to optional fallbacks. Within one
 * response, explicit account types precede flags and broker account groups.
 * Display names, broker/server labels, lot types and legacy isLive are ignored.
 */
export const resolveTradingAccountType = (...sources: unknown[]): TradingAccountType | undefined => {
  for (const source of sources) {
    const records = recordsFrom(source);
    const direct = readFields(records, TYPE_FIELDS, readTypeText)
      ?? readFields(records, ACCOUNT_TRADE_MODE_FIELDS, readAccountTradeMode);
    if (direct) return direct;

    const contest = readFields(records, CONTEST_FIELDS, value => value === true ? 'contest' : undefined);
    if (contest) return contest;
    const group = readFields(records, GROUP_FIELDS, readGroupType);
    // A contest group is more specific than its underlying demo environment.
    if (group === 'contest') return group;
    const demo = readFields(records, DEMO_FIELDS, value => value === true ? 'demo' : undefined);
    if (demo) return demo;

    if (group) return group;
    // false alone is weaker than positive Contest or a classified group.
    const real = readFields(records, DEMO_FIELDS, value => value === false ? 'real' : undefined);
    if (real) return real;
  }
  return undefined;
};
