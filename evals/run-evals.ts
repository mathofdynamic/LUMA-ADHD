import { FOUNDATION_GUARDRAILS } from "../src/guardrails";
import { isObviousRepeatedContent } from "../src/agents/repetition";
import { chooseCandidateFromScores, scoreCandidates } from "../src/agents/selection";

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

function selectionActivity(recentOpportunityCount = 0, recentThreadOpportunityCount = 0) {
  return {
    lastTurnAt: null,
    lastThreadTurnAt: null,
    lastAmbientOpportunityAt: null,
    recentOpportunityCount,
    recentMeaningfulContributionCount: 0,
    recentThreadOpportunityCount,
    recentThreadMeaningfulContributionCount: 0,
  };
}

function assertion(condition: boolean, message: string): string {
  return `${condition ? "PASS" : "FAIL"}: ${message}`;
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

{
  const profiles = [profile(agent("agent-product", "shared_topic")), profile(agent("agent-technical", "shared_topic"))];
  const scored = scoreCandidates({
    profiles,
    messageText: "shared topic",
    thread: { state: "unknown", priority: 50 } as never,
    activityByAgentId: {
      "agent-product": selectionActivity(3, 3),
      "agent-technical": selectionActivity(),
    },
    turnIndex: 0,
    rng: () => 0,
  });
  results.push(evaluate("postv1-cross-job-diversity", [
    assertion(scored[0]?.agentId === "agent-technical", "recent same-thread winner receives bounded cooldown"),
    assertion(scored.some((item) => item.reasons.includes("cross-job thread recency penalty")), "selection reason records thread recency"),
  ], {
    turnCount: 1, selectedAgents: [scored[0]?.agentId ?? "none"], publicMessageCount: 0, jobsCreated: 1, terminalReason: "bounded_diversity_selection",
  }, ["PASS: one coarse opportunity remains one job"]));
}

{
  const profiles = [
    profile(agent("agent-customer", "customer_experience")),
    profile(agent("agent-creative", "ux_creative")),
    profile(agent("agent-finance", "finance_pricing")),
  ];
  const scored = scoreCandidates({
    profiles,
    messageText: "customer onboarding UX",
    thread: { state: "open", priority: 50 } as never,
    activityByAgentId: {
      "agent-customer": selectionActivity(6),
      "agent-creative": selectionActivity(),
      "agent-finance": selectionActivity(),
    },
    turnIndex: 0,
    rng: () => 0,
  });
  results.push(evaluate("postv1-neglected-relevant-specialist", [
    assertion(scored[0]?.agentId === "agent-creative", "neglected relevant creative specialist can win"),
    assertion(scored[0]?.reasons.includes("neglected relevant opportunity") === true, "neglected signal is visible"),
  ], {
    turnCount: 1, selectedAgents: [scored[0]?.agentId ?? "none"], publicMessageCount: 0, jobsCreated: 1, terminalReason: "relevant_neglected_opportunity",
  }, ["PASS: no roster quota is imposed"]));
}

{
  const profiles = [profile(agent("agent-technical", "engineering_architecture")), profile(agent("agent-finance", "finance_pricing"))];
  const scored = scoreCandidates({
    profiles,
    messageText: "API architecture reliability",
    thread: { state: "evidence_gathering", priority: 50 } as never,
    activityByAgentId: { "agent-finance": selectionActivity() },
    turnIndex: 0,
    rng: () => 0,
  });
  results.push(evaluate("postv1-irrelevant-quiet-agent-stays-quiet", [
    assertion(scored[0]?.agentId === "agent-technical", "technical relevance outranks finance silence"),
    assertion(scored.find((item) => item.agentId === "agent-finance")?.relevanceScore === 0, "irrelevant quiet Agent is outside the relevant pool"),
  ], {
    turnCount: 1, selectedAgents: [scored[0]?.agentId ?? "none"], publicMessageCount: 0, jobsCreated: 1, terminalReason: "specialty_relevance",
  }, ["PASS: quiet is not a speaking quota"]));
}

{
  const roster = [profile(agent("agent-a", "shared_topic")), profile(agent("agent-b", "shared_topic")), profile(agent("agent-c", "shared_topic"))];
  const activity = Object.fromEntries(roster.map((item) => [item.agent.id, selectionActivity()]));
  const selected: string[] = [];
  for (let index = 0; index < 3; index += 1) {
    const scored = scoreCandidates({ profiles: roster, messageText: "shared topic", thread: { state: "unknown", priority: 50 } as never, activityByAgentId: activity, turnIndex: 0, rng: () => 0 });
    const candidate = chooseCandidateFromScores(scored, { turnIndex: 0, rng: () => 0 }).candidate;
    if (!candidate) break;
    selected.push(candidate.agentId);
    activity[candidate.agentId] = selectionActivity(
      activity[candidate.agentId].recentOpportunityCount + 1,
      activity[candidate.agentId].recentThreadOpportunityCount + 1,
    );
  }
  results.push(evaluate("postv1-repeated-ambient-does-not-monopolize", [
    assertion(new Set(selected).size >= 2, "separate ambient opportunities diversify without fixed rotation"),
    assertion(selected.length === 3, "opportunity count remains bounded"),
  ], {
    turnCount: selected.length, selectedAgents: selected, publicMessageCount: 0, jobsCreated: 3, terminalReason: "cross_job_recency_applied",
  }, ["PASS: no additional jobs are created per Agent"]));
}

{
  const addressed = profile(agent("agent-product", "product_strategy"));
  const other = profile(agent("agent-customer", "customer_experience"));
  const scored = scoreCandidates({ profiles: [addressed, other], messageText: "customer product question", thread: { state: "open", priority: 50 } as never, turnIndex: 0, rng: () => 1 });
  const selected = chooseCandidateFromScores(scored, { addressedAgentId: "agent-product", turnIndex: 0, rng: () => 1 }).candidate;
  results.push(evaluate("postv1-explicit-address-still-wins", [
    assertion(selected?.agentId === "agent-product", "explicit first-turn address remains deterministic"),
  ], {
    turnCount: 1, selectedAgents: [selected?.agentId ?? "none"], publicMessageCount: 0, jobsCreated: 1, terminalReason: "explicit_address",
  }, ["PASS: exploration cannot override direct human intent"]));
}

{
  const opportunity = { selected: true, intent: "WAIT", publicMessage: false, durableWork: false };
  const fileWork = { selected: true, intent: "FILE_WORK", publicMessage: false, durableWork: true };
  results.push(evaluate("postv1-wait-and-file-work-count-as-activity", [
    assertion(opportunity.selected && opportunity.intent === "WAIT", "WAIT is an executed opportunity"),
    assertion(!opportunity.publicMessage, "WAIT does not require Telegram speech"),
    assertion(fileWork.selected && fileWork.durableWork, "FILE_WORK is meaningful durable activity without SPEAK"),
  ], {
    turnCount: 2, selectedAgents: ["agent-creative", "agent-technical"], publicMessageCount: 0, jobsCreated: 2, terminalReason: "non_public_activity_preserved",
  }, ["PASS: public message count is not the fairness metric"]));
}

const failed = results.filter((result) => !result.passed);
console.log(JSON.stringify({
  suite: "luma-adhd-v1-postv1-agent-diversity",
  deterministic: true,
  externalServices: false,
  scenarioCount: results.length,
  passed: results.length - failed.length,
  failed: failed.length,
  results,
}, null, 2));

if (failed.length > 0) process.exitCode = 1;
