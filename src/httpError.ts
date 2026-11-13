/** Error with an HTTP status, thrown by controllers/services and answered by app.ts. */
export class HttpError extends Error {
  readonly status: number;
  /** Extra detail (e.g. one message per invalid line of an imported list). */
  readonly details: string[] | undefined;

  constructor(status: number, message: string, details?: string[]) {
    super(message);
    this.status = status;
    this.details = details;
  }
}
