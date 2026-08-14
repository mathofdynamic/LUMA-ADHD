import { ValidationError } from "./errors";
import { decodeJson, type JsonObject } from "./validation";

export function toBoolean(value: unknown): boolean {
  return value === true || value === 1 || value === "1";
}

export function toNumber(value: unknown, fieldName: string): number {
  const result = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(result)) {
    throw new ValidationError(`${fieldName} is not a finite number`);
  }

  return result;
}

export function toJsonObject(value: unknown, fieldName: string): JsonObject {
  if (typeof value !== "string") {
    throw new ValidationError(`${fieldName} is not a JSON string`);
  }

  const parsed = decodeJson<JsonObject>(value, fieldName);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new ValidationError(`${fieldName} must contain a JSON object`);
  }

  return parsed;
}

export function toNullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}
