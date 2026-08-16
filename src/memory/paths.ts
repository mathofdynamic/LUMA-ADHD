import { ValidationError } from "../database/errors";

export const MAX_LOGICAL_PATH_LENGTH = 512;
export const MAX_LOGICAL_SEGMENT_LENGTH = 160;

function assertSegment(segment: string): void {
  if (segment === "." || segment === "..") {
    throw new ValidationError("logical path traversal is not allowed");
  }
  if (segment.length === 0 || Array.from(segment).length > MAX_LOGICAL_SEGMENT_LENGTH) {
    throw new ValidationError("logical path contains an empty or oversized segment");
  }
  if (/\p{Cc}/u.test(segment) || segment.includes("\\")) {
    throw new ValidationError("logical path contains an invalid control or slash character");
  }
  if (segment.trim() !== segment) {
    throw new ValidationError("logical path segments cannot begin or end with whitespace");
  }
}

export function canonicalizeLogicalPath(input: string): string {
  if (typeof input !== "string") {
    throw new ValidationError("logical path must be a string");
  }

  const normalized = input.normalize("NFC");
  if (!normalized.startsWith("/")) {
    throw new ValidationError("logical path must be absolute");
  }
  if (normalized.includes("\\") || normalized.includes("\0") || /[?#]/u.test(normalized)) {
    throw new ValidationError("logical path contains an unsupported character");
  }

  const collapsed = normalized.replace(/\/+/gu, "/");
  const withoutTrailingSlash = collapsed.length > 1 ? collapsed.replace(/\/+$/u, "") : collapsed;
  if (withoutTrailingSlash === "/") {
    throw new ValidationError("logical path must identify a document, not a workspace root");
  }

  const segments = withoutTrailingSlash.slice(1).split("/");
  segments.forEach(assertSegment);
  const result = `/${segments.join("/")}`;
  if (Array.from(result).length > MAX_LOGICAL_PATH_LENGTH) {
    throw new ValidationError(`logical path must not exceed ${MAX_LOGICAL_PATH_LENGTH} characters`);
  }
  if (!/\.md$/iu.test(result)) {
    throw new ValidationError("logical document paths must end with .md");
  }
  return result;
}

export function pathSegments(path: string): readonly string[] {
  return canonicalizeLogicalPath(path).slice(1).split("/");
}

export function pathBelongsToAgent(path: string, agentSlug: string): boolean {
  const segments = pathSegments(path);
  return segments.length >= 3 && segments[0] === "agents" && segments[1] === agentSlug;
}

export function pathScope(path: string): "shared" | "agent" | "god" | "other" {
  const segments = pathSegments(path);
  if (segments[0] === "shared") return "shared";
  if (segments[0] === "agents") return "agent";
  if (segments[0] === "god") return "god";
  return "other";
}
