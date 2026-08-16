import { healthResponse } from "./health";
import { jsonResponse } from "./http";
import { versionResponse } from "./version";
import { handleAdminApi, type AdminApiEnvironment } from "../admin/router";

export type PublicApiEnvironment = Pick<Env, "LUMA_ENVIRONMENT" | "LUMA_PHASE"> & { readonly DB?: never };
export type ApiEnvironment = PublicApiEnvironment | AdminApiEnvironment;

export function routeApi(request: Request, env: PublicApiEnvironment): Response;
export function routeApi(request: Request, env: AdminApiEnvironment): Promise<Response>;
export function routeApi(request: Request, env: ApiEnvironment): Response | Promise<Response> {
  const pathname = new URL(request.url).pathname;

  if (pathname.startsWith("/api/admin/")) {
    return handleAdminApi(request, env as AdminApiEnvironment);
  }

  switch (pathname) {
    case "/api/health":
      return healthResponse(request);
    case "/api/version":
      return versionResponse(request, env);
    default:
      return jsonResponse({ error: "not_found" }, 404);
  }
}
