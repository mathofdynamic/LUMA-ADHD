export type DatabaseErrorCode =
  | "constraint"
  | "not_found"
  | "invalid_transition"
  | "validation";

export class DatabaseError extends Error {
  readonly code: DatabaseErrorCode;

  constructor(code: DatabaseErrorCode, message: string) {
    super(message);
    this.name = "DatabaseError";
    this.code = code;
  }
}

export class NotFoundError extends DatabaseError {
  constructor(entity: string, id: string) {
    super("not_found", `${entity} '${id}' was not found`);
    this.name = "NotFoundError";
  }
}

export class ConstraintError extends DatabaseError {
  constructor(message: string) {
    super("constraint", message);
    this.name = "ConstraintError";
  }
}

export class ValidationError extends DatabaseError {
  constructor(message: string) {
    super("validation", message);
    this.name = "ValidationError";
  }
}

export class InvalidTransitionError extends DatabaseError {
  readonly from: string;
  readonly to: string;

  constructor(from: string, to: string) {
    super("invalid_transition", `Thread transition '${from}' -> '${to}' is not allowed`);
    this.name = "InvalidTransitionError";
    this.from = from;
    this.to = to;
  }
}
