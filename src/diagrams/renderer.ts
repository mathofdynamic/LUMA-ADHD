import type { DiagramRenderer, DiagramRenderInput, DiagramRenderResult } from "./types";

/**
 * Phase 07 deliberately keeps rendering source-first. A Browser Rendering
 * binding can implement this interface later without changing artifact state.
 */
export class UnavailableDiagramRenderer implements DiagramRenderer {
  async render(_input: DiagramRenderInput): Promise<DiagramRenderResult> {
    return { status: "unavailable", reason: "no optional Browser Rendering binding is configured" };
  }
}
