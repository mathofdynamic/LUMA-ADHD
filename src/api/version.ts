import { jsonResponse, methodNotAllowed } from "./http";

export function versionResponse(request: Request, environment?: { readonly LUMA_PHASE?: string }): Response {
  if (request.method !== "GET") {
    return methodNotAllowed();
  }

  return jsonResponse({
    name: "luma-adhd",
    version: "0.1.0",
    phase: environment?.LUMA_PHASE ?? "unknown",
  });
}
