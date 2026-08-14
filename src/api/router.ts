import { healthResponse } from "./health";
import { jsonResponse } from "./http";
import { versionResponse } from "./version";

export type ApiEnvironment = Pick<Env, "LUMA_ENVIRONMENT" | "LUMA_PHASE">;

export function routeApi(
  request: Request,
  _env: ApiEnvironment,
): Response {
  const pathname = new URL(request.url).pathname;

  switch (pathname) {
    case "/api/health":
      return healthResponse(request);
    case "/api/version":
      return versionResponse(request);
    default:
      return jsonResponse({ error: "not_found" }, 404);
  }
}
