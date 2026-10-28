/**
 * The allow-list secret maps Telegram user IDs to tenant IDs
 * (architecture 11.3: "Allow-list per tenant; the bot maps Telegram user ID →
 * tenant"). It is a secret: parsed once at start-up, never logged, and a
 * malformed value fails fast instead of locking everyone out silently.
 */

export const allowListError = 'AllowListError';

export class AllowListError extends Error {
  constructor(message: string) {
    super(message);
    this.name = allowListError;
  }
}

export type TenantLookup = (telegramUserId: number) => string | undefined;

/** The allow-list as a map; the cron needs the inverse (tenant → authors). */
export type AllowList = ReadonlyMap<number, string>;

const telegramUserIdPattern = /^\d+$/;
const tenantIdPattern = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Parses the TELEGRAM_ALLOWED_USER_IDS secret into a lookup function. */
export function createTenantLookup(serialized: string): TenantLookup {
  const map = parseAllowList(serialized);
  return (telegramUserId) => map.get(telegramUserId);
}

/** Parses and validates the secret; used directly by the cron, which needs
 * the raw map to group authors by tenant (its lookup direction is inverted). */
export function parseAllowList(serialized: string): AllowList {
  if (!serialized) {
    throw new AllowListError(
      'TELEGRAM_ALLOWED_USER_IDS is not set; ' +
        'expected an object mapping Telegram user IDs to tenant IDs, ' +
        'e.g. {"123456789":"faden-und-stimmung"}',
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new AllowListError(
      'TELEGRAM_ALLOWED_USER_IDS is not valid JSON; ' +
        'expected an object mapping Telegram user IDs to tenant IDs, ' +
        'e.g. {"123456789":"faden-und-stimmung"}',
    );
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new AllowListError(
      'TELEGRAM_ALLOWED_USER_IDS must be a JSON object of user ID to tenant ID',
    );
  }

  const map = new Map<number, string>();
  for (const [key, value] of Object.entries(parsed)) {
    // Error messages name the field only, never the offending entry:
    // the whole allow-list is a secret and must not reach logs (A9).
    if (!telegramUserIdPattern.test(key)) {
      throw new AllowListError(
        'TELEGRAM_ALLOWED_USER_IDS contains an entry with an invalid Telegram user ID',
      );
    }
    if (typeof value !== 'string' || !tenantIdPattern.test(value)) {
      throw new AllowListError(
        'TELEGRAM_ALLOWED_USER_IDS contains an entry with an invalid tenant ID',
      );
    }
    map.set(Number(key), value);
  }

  return map;
}
