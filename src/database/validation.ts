import { ValidationError } from "./errors";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | readonly JsonValue[];
export interface JsonObject {
  readonly [key: string]: JsonValue;
}

export function encodeJson(value: JsonValue, fieldName: string): string {
  let encoded: string;

  try {
    encoded = JSON.stringify(value);
  } catch (error: unknown) {
    throw new ValidationError(`${fieldName} is not JSON serializable: ${String(error)}`);
  }

  if (encoded === undefined) {
    throw new ValidationError(`${fieldName} must be JSON serializable`);
  }

  return encoded;
}

export function encodeObject(value: JsonObject | undefined, fieldName: string): string {
  return encodeJson(value ?? {}, fieldName);
}

export function decodeJson<T extends JsonValue>(value: string, fieldName: string): T {
  try {
    return JSON.parse(value) as T;
  } catch (error: unknown) {
    throw new ValidationError(`${fieldName} contains invalid JSON: ${String(error)}`);
  }
}

export function requireNonEmpty(value: string, fieldName: string): string {
  if (value.trim().length === 0) {
    throw new ValidationError(`${fieldName} must not be empty`);
  }

  return value;
}

export function requireLimit(value: number, fieldName: string, max = 100): number {
  if (!Number.isInteger(value) || value < 1 || value > max) {
    throw new ValidationError(`${fieldName} must be an integer between 1 and ${max}`);
  }

  return value;
}
