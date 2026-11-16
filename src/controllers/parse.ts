// Small readers for request data: they only check types (400 if wrong); the rules live in
// the services.
import type { Request } from 'express';
import { HttpError } from '../httpError.ts';

export function body(request: Request): Record<string, unknown> {
  const value = request.body as unknown;
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

export function intParam(request: Request, name: string): number {
  const raw = request.params[name];
  const value = Number(raw);
  if (typeof raw !== 'string' || !Number.isInteger(value)) {
    throw new HttpError(400, `«${name}» debe ser un número entero.`);
  }
  return value;
}

export function textParam(request: Request, name: string): string {
  const raw = request.params[name];
  if (typeof raw !== 'string') throw new HttpError(400, `Falta «${name}».`);
  return raw;
}

export function str(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new HttpError(400, `«${field}» debe ser texto.`);
  return value;
}

export function optionalStr(value: unknown, field: string): string {
  return value === undefined || value === null ? '' : str(value, field);
}

export function int(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new HttpError(400, `«${field}» debe ser un número entero.`);
  }
  return value;
}

export function intOrNull(value: unknown, field: string): number | null {
  return value === undefined || value === null ? null : int(value, field);
}

export function bool(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') throw new HttpError(400, `«${field}» debe ser true o false.`);
  return value;
}

export function strList(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new HttpError(400, `«${field}» debe ser una lista de textos.`);
  }
  return value;
}

export function strOrNull(value: unknown, field: string): string | null {
  return value === undefined || value === null ? null : str(value, field);
}

export function side(value: unknown, field: string): 0 | 1 {
  if (value !== 0 && value !== 1) throw new HttpError(400, `«${field}» debe ser 0 o 1.`);
  return value;
}
