import { jsonResponse, methodNotAllowed } from "./http";

export function versionResponse(request: Request): Response {
  if (request.method !== "GET") {
    return methodNotAllowed();
  }

  return jsonResponse({
    name: "luma-adhd",
    version: "0.1.0",
    phase: "03-agent-runtime",
  });
}
