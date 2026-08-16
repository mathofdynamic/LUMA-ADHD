import type { JsonObject } from "../database/validation";
import { createId, nowIso } from "../database/ids";
import { ValidationError } from "../database/errors";
import type { createRepositories } from "../database/repositories";
import { ArtifactRepository } from "../database/repositories/artifacts";
import { renderDiagramHtml } from "./render-html";
import { validateDiagramSpec } from "./schema";
import { UnavailableDiagramRenderer } from "./renderer";
import type { DiagramActor, DiagramCreateInput, DiagramRenderer, DiagramSpec } from "./types";

type Repositories = ReturnType<typeof createRepositories>;

async function sha256(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function actorPayload(actor: DiagramActor): { readonly createdByAgentId?: string; readonly createdByUserId?: string } {
  if (actor.agentId && actor.userId) throw new ValidationError("diagram actor must be an agent or user, not both");
  if (!actor.agentId && !actor.userId) throw new ValidationError("diagram actor is required");
  return actor.agentId ? { createdByAgentId: actor.agentId } : { createdByUserId: actor.userId };
}

export class DiagramService {
  private readonly artifacts: ArtifactRepository;
  private readonly renderer: DiagramRenderer;

  constructor(
    private readonly repositories: Repositories,
    options: { readonly renderer?: DiagramRenderer } = {},
  ) {
    this.artifacts = repositories.artifacts;
    this.renderer = options.renderer ?? new UnavailableDiagramRenderer();
  }

  async create(input: DiagramCreateInput): Promise<{ readonly artifact: import("../database/types").ArtifactRecord; readonly spec: DiagramSpec }> {
    const spec = validateDiagramSpec(input.spec);
    const sourceText = renderDiagramHtml(spec);
    const sourceHash = await sha256(sourceText);
    const actor = actorPayload(input.actor);
    const artifact = await this.artifacts.create({
      idempotencyKey: input.idempotencyKey,
      title: spec.title,
      sourceText,
      spec: spec as unknown as JsonObject,
      sourceHash,
      threadId: input.threadId,
      messageId: input.messageId,
      metadata: { ...(input.metadata ?? {}), idempotencyKey: input.idempotencyKey, diagramType: spec.diagramType, direction: spec.direction },
      ...actor,
    });
    await this.repositories.events.append({
      eventType: "diagram.artifact_created",
      aggregateType: "artifact",
      aggregateId: artifact.id,
      threadId: input.threadId,
      actor: input.actor.agentId ? { type: "agent", agentId: input.actor.agentId } : { type: "human", userId: actor.createdByUserId },
      idempotencyKey: `diagram-created:${artifact.id}`,
      payload: { title: artifact.title, diagramType: spec.diagramType, sourceHash },
    });
    return { artifact, spec };
  }

  async revise(input: { readonly artifactId: string; readonly spec: unknown; readonly actor: DiagramActor; readonly changeSummary?: string }): Promise<import("../database/types").ArtifactRecord> {
    const artifact = await this.artifacts.getById(input.artifactId);
    const spec = validateDiagramSpec(input.spec);
    const sourceText = renderDiagramHtml(spec);
    const sourceHash = await sha256(sourceText);
    const actor = actorPayload(input.actor);
    const revision = await this.artifacts.createRevision({
      artifactId: artifact.id,
      sourceText,
      metadata: { changeSummary: input.changeSummary ?? "diagram revised", specHash: sourceHash, spec: spec as unknown as JsonObject },
      ...actor,
    });
    await this.repositories.database.prepare(
      `UPDATE artifacts SET title = ?, source_text = ?, spec_json = ?, source_hash = ?, status = 'ready',
         render_status = 'not_requested', delivery_status = 'not_requested', render_error = NULL, delivery_error = NULL,
         updated_at = ? WHERE id = ? AND deleted_at IS NULL`,
    ).bind(spec.title, sourceText, JSON.stringify(spec), sourceHash, nowIso(), artifact.id).run();
    await this.repositories.events.append({
      eventType: "diagram.artifact_revised",
      aggregateType: "artifact",
      aggregateId: artifact.id,
      threadId: artifact.threadId ?? undefined,
      actor: input.actor.agentId ? { type: "agent", agentId: input.actor.agentId } : { type: "human", userId: actor.createdByUserId },
      idempotencyKey: `diagram-revised:${artifact.id}:${revision.revisionNumber}`,
      payload: { revision: revision.revisionNumber, changeSummary: input.changeSummary ?? "diagram revised", sourceHash },
    });
    return this.artifacts.getById(artifact.id);
  }

  async render(artifactId: string): Promise<import("../database/types").ArtifactRecord> {
    const artifact = await this.artifacts.getById(artifactId);
    if (!artifact.sourceText) throw new ValidationError("diagram has no trusted source");
    const result = await this.renderer.render({ artifactId, title: artifact.title, html: artifact.sourceText });
    const status = result.status;
    const updated = await this.artifacts.updateRender({ id: artifactId, status, error: status === "rendered" ? undefined : result.reason, incrementAttempt: true });
    await this.repositories.events.append({
      eventType: status === "rendered" ? "diagram.rendered" : "diagram.render_fallback",
      aggregateType: "artifact",
      aggregateId: artifactId,
      idempotencyKey: `diagram-render:${artifactId}:${updated.renderAttemptCount}`,
      payload: { status, reason: "reason" in result ? result.reason : null },
    });
    if (status === "rendered" && result.telegramFileId) {
      await this.artifacts.updateDelivery({ id: artifactId, status: "sent", telegramFileId: result.telegramFileId });
    } else if (status !== "rendered") {
      await this.artifacts.updateDelivery({ id: artifactId, status: "not_available", error: "source-only artifact retained" });
    }
    return this.artifacts.getById(artifactId);
  }

  async list(input?: { readonly limit?: number; readonly includeDeleted?: boolean }) {
    return this.artifacts.list(input);
  }

  async detail(id: string) {
    const artifact = await this.artifacts.getById(id);
    return { artifact, revisions: await this.artifacts.listRevisions(id, 100) };
  }

  async archive(id: string) {
    return this.artifacts.archive(id);
  }

  async restore(id: string) {
    return this.artifacts.restore(id);
  }
}
