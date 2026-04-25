// Typed errors so callers can react meaningfully.
// Most surface back to the creator as "reconnect Skool" prompts.

export class SkoolError extends Error {
  readonly status?: number;
  readonly path?: string;
  constructor(message: string, opts: { status?: number; path?: string; cause?: unknown } = {}) {
    super(message);
    this.name = "SkoolError";
    this.status = opts.status;
    this.path = opts.path;
    if (opts.cause) {
      (this as { cause?: unknown }).cause = opts.cause;
    }
  }
}

/** 401/403 from Skool. Creator's session has expired or is invalid. */
export class SkoolAuthError extends SkoolError {
  constructor(path: string, status: number) {
    super(`Skool auth failed (${status}). Creator must reconnect.`, { status, path });
    this.name = "SkoolAuthError";
  }
}

/** 404 / dead endpoint. We hit a path that doesn't exist (or no longer does). */
export class SkoolNotFoundError extends SkoolError {
  constructor(path: string) {
    super(`Skool endpoint not found: ${path}`, { status: 404, path });
    this.name = "SkoolNotFoundError";
  }
}

/** Async analytics poll never produced data within the allowed window. */
export class SkoolPollTimeoutError extends SkoolError {
  constructor(token: string) {
    super(`Skool analytics poll timed out (token=${token.slice(0, 8)}…).`);
    this.name = "SkoolPollTimeoutError";
  }
}

/** Anything else we couldn't classify (network failure, unexpected payload). */
export class SkoolUpstreamError extends SkoolError {
  constructor(message: string, opts: { status?: number; path?: string; cause?: unknown } = {}) {
    super(message, opts);
    this.name = "SkoolUpstreamError";
  }
}
