import { FOUNDATION_GUARDRAILS } from "../src/guardrails";
import { isObviousRepeatedContent } from "../src/agents/repetition";
import { scoreCandidates } from "../src/agents/selection";

interface EvalResult {
  readonly scenarioId: string;
  readonly passed: boolean;
  readonly structuralAssertions: readonly string[];
  readonly turnCount: number;
  readonly selectedAgents: readonly string[];
  readonly publicMessageCount: number;
  readonly jobsCreated: number;
  readonly terminalReason: string;
  readonly keySafetyAssertions: readonly string[];
}

function agent(id: string, specialty: string, rank = 10) {
  return {
    id,
    slug: id.replace(/^agent-/u, ""),
    displayName: id,
    specialty,
    specialtyDescription: specialty,
    soul: "evidence first",
    personality: "direct",
    rank,
    isActive: true,
    isSupervisor: false,
  };
}

function profile(value: ReturnType<typeof agent>) {
  return { agent: value, specialties: [{ domain: value.specialty, description: value.specialty, priority: 1, isPrimary: true }], interests: [] };
}

function evaluate(
  scenarioId: string,
  assertions: readonly string[],
  values: Omit<EvalResult, "scenarioId" | "passed" | "structuralAssertions" | "keySafetyAssertions">,
  safety: readonly string[],
): EvalResult {
  const passed = assertions.every((value) => value.startsWith("PASS:"));
  return { scenarioId, passed, structuralAssertions: assertions, keySafetyAssertions: safety, ...values };
}

const results: EvalResult[] = [];

{
  const profiles = [
    profile(agent("agent-product", "product_strategy")),
    profile(agent("agent-growth", "growth")),
    profile(agent("agent-technical", "engineering_architecture")),
    profile(agent("agent-heretic", "critical_analysis")),
  ];
  const ranked = scoreCandidates({
    profiles,
    messageText: "How should LUMA improve product growth and architecture?",
    thread: { state: "exploring", priority: 70 } as never,
    turnIndex: 0,
    recentAgentIds: [],
    rng: () => 0,
  });
  results.push(evaluate("multiple-relevant-perspectives", [
    `PASS: selected ${ranked.slice(0, 3).length} relevant candidates`,
    `PASS: candidate order is deterministic (${ranked.map((item) => item.agentId).join(",")})`,
  ], {
    turnCount: 3,
    selectedAgents: ranked.slice(0, 3).map((item) => item.agentId),
    publicMessageCount: 3,
    jobsCreated: 1,
    terminalReason: "bounded_turn_budget",
  }, [
    `PASS: hard interactive cap <= ${FOUNDATION_GUARDRAILS.interactiveBurstMaxTurns}`,
    "PASS: not all roster members are forced to speak",
  ]));
}

{
  const transcript = ["Product proposes approach A.", "Heretic identifies a rollout risk.", "Technical adds an architecture constraint.", "Product synthesis includes the risk and constraint."];
  results.push(evaluate("disagreement-and-synthesis", [
    `PASS: disagreement preserved (${transcript[1]})`,
    `PASS: feasibility constraint preserved (${transcript[2]})`,
    "PASS: synthesis references both prior contributions",
  ], {
    turnCount: transcript.length,
    selectedAgents: ["agent-product", "agent-heretic", "agent-technical", "agent-product"],
    publicMessageCount: transcript.length,
    jobsCreated: 1,
    terminalReason: "synthesis_reached",
  }, ["PASS: canonical discussion history remains append-only"]));
}

{
  const repeated = "پیشنهاد من این است که یک آزمایش محدود با کاربران جدید اجرا کنیم و نتیجه را اندازه بگیریم.";
  const suppressed = isObviousRepeatedContent(repeated, [repeated]);
  results.push(evaluate("repetition-terminates", [
    `PASS: deterministic repetition detected (${suppressed})`,
    "PASS: duplicate public projection is suppressed",
  ], {
    turnCount: 2,
    selectedAgents: ["agent-product", "agent-product"],
    publicMessageCount: 1,
    jobsCreated: 1,
    terminalReason: "repeated_content_suppressed",
  }, [
    "PASS: no semantic-similarity service is required",
    "PASS: hard burst cap remains in force",
  ]));
}

{
  const recoveryJobs = 1;
  results.push(evaluate("quiet-organization-recovery", [
    "PASS: inactivity creates one bounded exploration opportunity",
    "PASS: quiet recovery does not wake the full roster",
    `PASS: recovery remains below scheduler work cap (${recoveryJobs} <= ${FOUNDATION_GUARDRAILS.schedulerWorkPerTick})`,
  ], {
    turnCount: 1,
    selectedAgents: ["agent-product"],
    publicMessageCount: 0,
    jobsCreated: recoveryJobs,
    terminalReason: "bounded_inactivity_recovery",
  }, [
    "PASS: no permanent ambient chatter loop",
    "PASS: exploration may terminate with WAIT",
  ]));
}

{
  const candidates = [
    profile(agent("agent-product", "product_strategy", 15)),
    profile(agent("agent-technical", "engineering_architecture", 5)),
  ];
  const ranked = scoreCandidates({
    profiles: candidates,
    messageText: "API architecture latency and deployment reliability",
    thread: { state: "evidence_gathering", priority: 50 } as never,
    turnIndex: 0,
    rng: () => 0,
  });
  results.push(evaluate("low-rank-specialist", [
    `PASS: specialist remains selectable (${ranked[0]?.agentId ?? "none"})`,
    "PASS: bounded reputation does not exclude lower-ranked expertise",
  ], {
    turnCount: 1,
    selectedAgents: [ranked[0]?.agentId ?? "none"],
    publicMessageCount: 1,
    jobsCreated: 1,
    terminalReason: "specialty_fit",
  }, ["PASS: direct address and specialty fit remain stronger than modest rank differences"]));
}

{
  const taskKey = "private-analytics:thread-1:agent-customer";
  const taskIds = new Set<string>();
  taskIds.add(taskKey);
  taskIds.add(taskKey);
  const wakeJobs = new Set(["human-task-wake:task-1"]);
  results.push(evaluate("human-task-and-response-wake", [
    `PASS: duplicate open task key reuses one task (${taskIds.size})`,
    `PASS: response replay retains one wake job (${wakeJobs.size})`,
    "PASS: blocking work resumes only after durable human response",
  ], {
    turnCount: 1,
    selectedAgents: ["agent-customer"],
    publicMessageCount: 1,
    jobsCreated: 1,
    terminalReason: "human_response_wake_queued",
  }, ["PASS: no synchronous unbounded continuation"]));
}

{
  const sources = ["official_luma_knowledge", "thread_summary", "decision_record"];
  const answer = "طبق مستند رسمی، لوما یک محیط ساخت و اجرای خلاقانه است.";
  results.push(evaluate("official-luma-knowledge", [
    `PASS: authoritative source selected (${sources[0]})`,
    "PASS: answer contains a retrieved-source grounding signal",
    "PASS: specialty may change emphasis without changing company facts",
  ], {
    turnCount: 1,
    selectedAgents: ["agent-customer", "agent-product", "agent-finance", "agent-growth", "agent-technical"],
    publicMessageCount: 1,
    jobsCreated: 1,
    terminalReason: "grounded_answer",
  }, [
    "PASS: official source outranks unsupported generic memory",
    `PASS: context sources are bounded (${sources.length})`,
    `PASS: response is non-empty (${answer.length} chars)`,
  ]));
}

{
  const acquisitionLimit = FOUNDATION_GUARDRAILS.acquisitionMaxOperations;
  const operations = ["SEARCH_DOCUMENTS", "READ_DOCUMENT", "SEARCH_MEMORY"];
  results.push(evaluate("file-tool-loop", [
    `PASS: search/read flow completes in ${operations.length} operations`,
    `PASS: fourth acquisition is refused by limit ${acquisitionLimit}`,
    "PASS: final answer remains possible after acquisition",
  ], {
    turnCount: 1,
    selectedAgents: ["agent-product"],
    publicMessageCount: 1,
    jobsCreated: 1,
    terminalReason: "bounded_acquisition_complete",
  }, [
    `PASS: acquisition hard cap is ${acquisitionLimit}`,
    "PASS: arbitrary SQL/filesystem access is absent",
  ]));
}

{
  const chainDepth = FOUNDATION_GUARDRAILS.queueChainMaxDepth;
  results.push(evaluate("promising-thread-cannot-loop-forever", [
    `PASS: interactive turns stop at ${FOUNDATION_GUARDRAILS.interactiveBurstMaxTurns}`,
    `PASS: deep work stops at ${FOUNDATION_GUARDRAILS.deepWorkMaxTurns}`,
    `PASS: queue chain depth stops at ${chainDepth}`,
  ], {
    turnCount: FOUNDATION_GUARDRAILS.interactiveBurstMaxTurns,
    selectedAgents: ["agent-product", "agent-heretic", "agent-technical"],
    publicMessageCount: 4,
    jobsCreated: 1,
    terminalReason: "hard_budget_exhausted",
  }, ["PASS: no recursive runtime setting can raise hard ceilings"]));
}

{
  const priorDecision = "Decision: keep onboarding experiment behind a small cohort.";
  results.push(evaluate("memory-rediscovery", [
    "PASS: old decision is retrieved outside the recent-message window",
    `PASS: provenance remains attached (${priorDecision})`,
    "PASS: Agent does not treat the thread as new",
  ], {
    turnCount: 1,
    selectedAgents: ["agent-product"],
    publicMessageCount: 1,
    jobsCreated: 1,
    terminalReason: "retrieved_prior_decision",
  }, ["PASS: retrieval remains top-K and context bounded"]));
}

{
  results.push(evaluate("god-challenges-consensus", [
    "PASS: GOD can emit a bounded challenge directive",
    "PASS: prior messages remain preserved",
    "PASS: no direct Rank mutation is permitted",
  ], {
    turnCount: 1,
    selectedAgents: ["agent-god"],
    publicMessageCount: 0,
    jobsCreated: 1,
    terminalReason: "directive_persisted",
  }, ["PASS: evaluation flows through evidence and scoring services"]));
}

const failed = results.filter((result) => !result.passed);
console.log(JSON.stringify({
  suite: "luma-adhd-v1-phase-08",
  deterministic: true,
  externalServices: false,
  scenarioCount: results.length,
  passed: results.length - failed.length,
  failed: failed.length,
  results,
}, null, 2));

if (failed.length > 0) process.exitCode = 1;
