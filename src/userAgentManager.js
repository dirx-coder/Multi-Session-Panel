const crypto = require("crypto");
const userAgents = require("./userAgents.json");

const DESKTOP_CHROME_UA_PATTERN = /^Mozilla\/5\.0 \((Windows NT|Macintosh; Intel Mac OS X|X11; Linux x86_64)[^)]*\) AppleWebKit\/537\.36 \(KHTML, like Gecko\) Chrome\/\d+\.\d+\.\d+\.\d+ Safari\/537\.36$/;
const MOBILE_UA_PATTERN = /\b(Android|iPhone|iPad|Mobile|CriOS|FxiOS)\b/i;

class UserAgentManager {
  constructor(pool = userAgents) {
    this.pool = validateUserAgents(pool);
    this.assignments = new Map();
    this.sessionSequence = 0;
  }

  acquire(sessionKey, preferredUserAgent) {
    const existing = this.assignments.get(sessionKey);
    if (existing) return existing;

    const userAgent = this.pickUserAgent(preferredUserAgent);
    const assignment = {
      sessionKey,
      sessionNumber: ++this.sessionSequence,
      userAgent,
      assignedAt: new Date().toISOString()
    };

    this.assignments.set(sessionKey, assignment);
    return assignment;
  }

  release(sessionKey) {
    this.assignments.delete(sessionKey);
  }

  get(sessionKey) {
    return this.assignments.get(sessionKey);
  }

  activeUserAgents() {
    return new Set([...this.assignments.values()].map((assignment) => assignment.userAgent));
  }

  pickUserAgent(preferredUserAgent) {
    const active = this.activeUserAgents();

    if (preferredUserAgent && this.pool.includes(preferredUserAgent) && !active.has(preferredUserAgent)) {
      return preferredUserAgent;
    }

    const available = this.pool.filter((userAgent) => !active.has(userAgent));
    const candidates = available.length > 0 ? available : this.pool;
    return candidates[crypto.randomInt(candidates.length)];
  }
}

function validateUserAgents(pool) {
  if (!Array.isArray(pool) || pool.length < 100) {
    throw new Error("User-Agent pool must contain at least 100 entries.");
  }

  const seen = new Set();
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

module.exports = {
  UserAgentManager,
  validateUserAgents
};
