export type CurrentImageFetchStatus =
  | "not_present"
  | "available"
  | "unavailable"
  | "rejected"
  | "download_failed";

export interface AgentCapabilityManifest {
  readonly canSearchOwnFiles: boolean;
  readonly canSearchSharedFiles: boolean;
  readonly canUseOfficialLumaKnowledge: boolean;
  readonly canRequestAgent: boolean;
  readonly canRequestHuman: boolean;
  readonly canCreateFiles: boolean;
  readonly canCreateDiagram: boolean;
  readonly visionModelSupported: boolean;
  readonly currentImagePresent: boolean;
  readonly currentImageFetchStatus: CurrentImageFetchStatus;
  readonly currentImageDeliveredToModel: boolean;
  readonly currentImageCount: number;
}

export interface AgentGroupStateSnapshot {
  readonly activeNormalAgents: readonly string[];
  readonly currentInteractionMode: string;
  readonly invokedAgents: readonly string[];
  readonly respondedAgents: readonly string[];
  readonly pendingAgents: readonly string[];
  readonly lastRollCallTargetedAgents?: readonly string[];
  readonly lastRollCallRespondedAgents?: readonly string[];
  readonly lastRollCallFailedAgents?: readonly string[];
}

export interface CapabilityGuardResult {
  readonly content: string;
  readonly guarded: boolean;
  readonly reason?: string;
}

function normalize(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[يى]/gu, "ی")
    .replace(/[ك]/gu, "ک")
    .replace(/[\u200c\u200d\u200e\u200f]/gu, "")
    .replace(/\s+/gu, " ")
    .trim()
    .toLocaleLowerCase();
}

export function isImageInspectionQuestion(value: string): boolean {
  const text = normalize(value);
  if (!text) return false;
  const image = /(?:عکس|تصویر|photo|image|picture|attachment)/u.test(text);
  const inspection = /(?:می.?بین|ببین|دید|چی(?:ه|ست)|چیه|بررسی|inspect|see|view|open|received|رسید)/iu.test(text);
  return image && inspection;
}

function hasPositiveVisionClaim(value: string): boolean {
  const text = normalize(value);
  if (/(?:نمی.?توانم|نمی.?تونم|نمی.?بینم|دسترسی ندارم|cannot|can't|do not have|unable)/iu.test(text)) return false;
  return /(?:بله|آره|اره|حتما|می.?تونم|می.?توانم|می.?بینم|می.?بینیش|مشاهده می.?کنم|بررسی می.?کنم|تحلیل می.?کنم|بررسی کردم|بفرست|ارسال کن|yes|sure|i can|i see|send (?:it|the image))/iu.test(text);
}

export function enforceVisionCapabilityTruth(input: {
  readonly content: string;
  readonly humanQuery: string;
  readonly capabilities: AgentCapabilityManifest;
}): CapabilityGuardResult {
  if (!isImageInspectionQuestion(input.humanQuery) || input.capabilities.currentImageDeliveredToModel) {
    return { content: input.content, guarded: false };
  }
  if (!hasPositiveVisionClaim(input.content)) {
    return { content: input.content, guarded: false };
  }
  const content = input.capabilities.currentImagePresent
    ? "این تصویر به این نوبت مدل نرسیده؛ نمی‌توانم درباره محتوایش ادعا کنم."
    : "در این نوبت تصویری به من نرسیده؛ بنابراین نمی‌توانم محتوای تصویری را بررسی کنم.";
  return {
    content,
    guarded: true,
    reason: input.capabilities.currentImagePresent ? "image_not_delivered" : "image_not_present",
  };
}

export function capabilityManifestText(manifest: AgentCapabilityManifest): string {
  return [
    "CURRENT CAPABILITIES (runtime truth for this exact turn)",
    `can_search_own_files=${manifest.canSearchOwnFiles}; can_search_shared_files=${manifest.canSearchSharedFiles}; can_use_official_luma_knowledge=${manifest.canUseOfficialLumaKnowledge}`,
    `can_request_agent=${manifest.canRequestAgent}; can_request_human=${manifest.canRequestHuman}; can_create_files=${manifest.canCreateFiles}; can_create_diagram=${manifest.canCreateDiagram}`,
    `vision_model_supported=${manifest.visionModelSupported}; current_image_present=${manifest.currentImagePresent}; current_image_fetch_status=${manifest.currentImageFetchStatus}; current_image_delivered_to_model=${manifest.currentImageDeliveredToModel}; current_image_count=${manifest.currentImageCount}`,
    "Never claim to perceive, inspect, open, hear, browse, access, or use something unless this manifest explicitly confirms it for this turn. Image metadata or global model support is not image delivery.",
  ].join("\n");
}

export function groupStateSnapshotText(snapshot: AgentGroupStateSnapshot): string {
  return [
    "SHARED GROUP STATE (runtime facts, not speculation)",
    `active_normal_agents=${snapshot.activeNormalAgents.join(", ") || "none"}`,
    `current_interaction_mode=${snapshot.currentInteractionMode}; invoked_agents=${snapshot.invokedAgents.join(", ") || "none"}; responded_agents=${snapshot.respondedAgents.join(", ") || "none"}; pending_agents=${snapshot.pendingAgents.join(", ") || "none"}`,
    snapshot.lastRollCallTargetedAgents
      ? `last_roll_call_targeted=${snapshot.lastRollCallTargetedAgents.join(", ") || "none"}; last_roll_call_responded=${snapshot.lastRollCallRespondedAgents?.join(", ") || "none"}; last_roll_call_failed=${snapshot.lastRollCallFailedAgents?.join(", ") || "none"}`
      : "last_roll_call_targeted=none",
    "A message in the shared workspace is not proof that every Agent actively processed it. Absence of a response is not proof that an Agent is offline. Describe invocation only from these runtime facts.",
  ].join("\n");
}
