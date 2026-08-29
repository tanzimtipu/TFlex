export interface ResultError<E extends string = string> {
  code: E;
  message: string;
}

export type Result<T, E extends string = string> =
  | { ok: true; value: T }
  | { ok: false; error: ResultError<E> };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E extends string>(code: E, message?: string): Result<never, E> {
  return { ok: false, error: { code, message: message ?? code } };
}
