import { jsonResponse, methodNotAllowed } from "./http";

export function healthResponse(request: Request): Response {
  if (request.method !== "GET") {
    return methodNotAllowed();
  }

  // Keep this response limited to readiness/status information. Detailed
  // diagnostics belong behind authenticated operational endpoints later.
  return jsonResponse({ status: "ok", ready: true });
}
