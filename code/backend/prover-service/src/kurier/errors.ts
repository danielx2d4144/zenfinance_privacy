export class KurierError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = "KurierError";
  }
}

export class KurierRateLimited extends KurierError {
  constructor(readonly retryAfterMs: number, body?: unknown) {
    super(`Kurier rate-limited; retry after ${retryAfterMs}ms`, 429, body);
    this.name = "KurierRateLimited";
  }
}

export class KurierVkNotRegistered extends KurierError {
  constructor(body?: unknown) {
    super("Kurier rejected proof: vk not registered", 400, body);
    this.name = "KurierVkNotRegistered";
  }
}

export class KurierJobFailed extends Error {
  constructor(
    readonly jobId: string,
    readonly status: string,
    readonly serverError?: string,
  ) {
    super(
      `Kurier job ${jobId} failed with status=${status}${serverError ? `: ${serverError}` : ""}`,
    );
    this.name = "KurierJobFailed";
  }
}

export class KurierResponseShapeError extends Error {
  constructor(
    readonly endpoint: string,
    readonly issues: string,
    readonly body: unknown,
  ) {
    super(`Kurier ${endpoint} returned unexpected shape:\n${issues}`);
    this.name = "KurierResponseShapeError";
  }
}
