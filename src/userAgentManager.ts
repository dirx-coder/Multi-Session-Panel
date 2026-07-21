import crypto from "node:crypto";
import userAgents from "./userAgents.json";

export interface UserAgentAssignment {
  readonly sessionKey: string;
  readonly sessionNumber: number;
  readonly userAgent: string;
  readonly assignedAt: string;
}

const DESKTOP_CHROME_UA_PATTERN =
  /^Mozilla\/5\.0 \((Windows NT|Macintosh; Intel Mac OS X|X11; Linux x86_64)[^)]*\) AppleWebKit\/537\.36 \(KHTML, like Gecko\) Chrome\/\d+\.\d+\.\d+\.\d+ Safari\/537\.36$/;
const MOBILE_UA_PATTERN = /\b(Android|iPhone|iPad|Mobile|CriOS|FxiOS)\b/i;

export class UserAgentManager {
  private readonly pool: readonly string[];
  private readonly assignments = new Map<string, UserAgentAssignment>();
  private sessionSequence = 0;

  constructor(pool: readonly string[] = userAgents) {
    this.pool = validateUserAgents(pool);
  }

  acquire(sessionKey: string, preferredUserAgent?: string): UserAgentAssignment {
    const existing = this.assignments.get(sessionKey);
    if (existing) return existing;

    const userAgent = this.pickUserAgent(preferredUserAgent);
    const assignment: UserAgentAssignment = {
      sessionKey,
      sessionNumber: ++this.sessionSequence,
      userAgent,
      assignedAt: new Date().toISOString()
    };

    this.assignments.set(sessionKey, assignment);
    return assignment;
  }

  release(sessionKey: string): void {
    this.assignments.delete(sessionKey);
  }

  get(sessionKey: string): UserAgentAssignment | undefined {
    return this.assignments.get(sessionKey);
  }

  private activeUserAgents(): Set<string> {
    return new Set([...this.assignments.values()].map((assignment) => assignment.userAgent));
  }

  private pickUserAgent(preferredUserAgent?: string): string {
    const active = this.activeUserAgents();

    if (preferredUserAgent && this.pool.includes(preferredUserAgent) && !active.has(preferredUserAgent)) {
      return preferredUserAgent;
    }

    const available = this.pool.filter((userAgent) => !active.has(userAgent));
    const candidates = available.length > 0 ? available : this.pool;
    return candidates[crypto.randomInt(candidates.length)];
  }
}

export function validateUserAgents(pool: readonly string[]): readonly string[] {
  if (!Array.isArray(pool) || pool.length < 100) {
    throw new Error("User-Agent pool must contain at least 100 entries.");
  }

  const seen = new Set<string>();
  for (const userAgent of pool) {
    if (typeof userAgent !== "string" || !DESKTOP_CHROME_UA_PATTERN.test(userAgent) || MOBILE_UA_PATTERN.test(userAgent)) {
      throw new Error(`Invalid desktop Chrome User-Agent: ${userAgent}`);
    }

    if (seen.has(userAgent)) {
      throw new Error(`Duplicate User-Agent in pool: ${userAgent}`);
    }
    seen.add(userAgent);
  }

  return Object.freeze([...pool]);
}
