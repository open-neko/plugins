export const MAX_RECIPIENTS_PER_FIELD = 50;

const ADDRESS = /^[^@\s<>,]+@[^@\s<>,]+\.[^@\s<>,]+$/;

export class RecipientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RecipientError";
  }
}

function bareAddress(value: string): string {
  const bracketed = /<([^>]*)>/.exec(value);
  return (bracketed ? bracketed[1]! : value).trim();
}

/** Recipients from a payload field: a string, a comma-separated string, or an array. */
export function recipientList(value: unknown, field: string): string[] {
  if (value === undefined || value === null) return [];
  const items = Array.isArray(value) ? value : [value];
  const out: string[] = [];
  for (const item of items) {
    if (typeof item !== "string") {
      throw new RecipientError(`${field} must be an email address or a list of them`);
    }
    for (const part of item.split(",")) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      if (!ADDRESS.test(bareAddress(trimmed))) {
        throw new RecipientError(`${field} has an address that is not valid: ${trimmed}`);
      }
      out.push(trimmed);
    }
  }
  if (out.length > MAX_RECIPIENTS_PER_FIELD) {
    throw new RecipientError(`${field} has ${out.length} addresses; Resend accepts ${MAX_RECIPIENTS_PER_FIELD}`);
  }
  return out;
}

export function recipientDomain(address: string): string {
  const bare = bareAddress(address).toLowerCase();
  return bare.slice(bare.lastIndexOf("@") + 1).replace(/\.$/, "");
}

function domainMatches(domain: string, pattern: string): boolean {
  return pattern.startsWith("*.") ? domain.endsWith(pattern.slice(1)) : domain === pattern;
}

/** Refuses any recipient outside RESEND_ALLOWED_RECIPIENTS, when that setting is present. */
export function checkAllowedRecipients(addresses: readonly string[], allowed: string | undefined): void {
  const patterns = (allowed ?? "")
    .split(",")
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean);
  if (patterns.length === 0) return;
  const refused = addresses.filter((a) => !patterns.some((p) => domainMatches(recipientDomain(a), p)));
  if (refused.length > 0) {
    throw new RecipientError(
      `RESEND_ALLOWED_RECIPIENTS does not include: ${refused.join(", ")}. Ask an admin to add the domain, or remove these recipients.`,
    );
  }
}
