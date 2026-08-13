# Reputation, Ranking, Voting, and Governance for LUMA ADHD Multi-Agent Organization

## 1. Goal and constraints

Design a robust, non-naive reputation and influence system for ~8–15 autonomous AI agents collaborating in a persistent organization (LUMA ADHD), starting at roughly equal rank and evolving influence based on how much they actually help LUMA.

Key constraints:
- Avoid popularity contests, rich-get-richer, and style/verbosity bias.
- Many normal agents share the same underlying model but differ by system prompts, roles, and specialties.
- A frontier "GOD" evaluator model and humans occasionally provide higher-quality judgments and outcome labels.
- Real-world execution results may arrive much later and should retroactively update reputations.

The rest of this document
- Synthesizes lessons from reputation systems, prediction markets, peer review, Bayesian and Elo/Glicko-like ratings, PageRank-style influence, and online learning/ensemble weighting.
- Proposes a concrete, implementable design for LUMA ADHD with formulas, update algorithms, anti-gaming controls, and examples.

---

## 2. Background: Reputation systems for agents

### 2.1 Classic reputation models

**Bayesian/Beta reputation systems**
- Model reputation as a posterior over reliability parameters (e.g., probability an agent is correct). Positive/negative evidence increment counts and shrink toward the empirical success rate, with priors providing smoothing.
- Well-studied in P2P networks, marketplaces, and trust systems, robust to small data and able to incorporate uncertainty.

**Elo / Glicko rating systems**
- Each agent has a latent skill parameter. "Games" (interactions) produce pairwise comparisons, and ratings are updated based on surprises (how expected the result was).
- Glicko and TrueSkill add rating volatility/uncertainty, allowing faster adaptation when there is little evidence and slower moves when ratings are well-established.

**PageRank-like influence**
- Nodes accrue authority when other authoritative nodes endorse or cite them.
- Useful for modeling influence in a graph of proposals, critiques, and references.

**Prediction markets and proper scoring rules**
- Participants earn or lose reputation based on probabilistic predictions evaluated later with proper scoring rules (e.g., logarithmic score, Brier score).

**Ensemble model weighting / online learning**
- Many online learning algorithms (e.g., Hedge, multiplicative weights) maintain weights over experts and update them according to loss. This is directly analogous to agent influence.

---

### 2.2 Problems specific to AI-agent societies

**Correlated models and artificial consensus**
- When many agents use the same base model, they can agree for spurious reasons (shared biases) rather than independent evidence.
- Naively treating agreement as strong evidence ("wisdom of the crowd") overcounts correlated errors.

**Popularity, verbosity, and style bias**
- Agents with assertive style, long answers, or fancy formatting may look smarter than they are.
- Naive peer voting can reward style over substance.

**Rich-get-richer and snowballing**
- Once an agent has high rank, their ideas get more visibility and positive feedback, which then further boosts their rank.

**Collusion and reciprocal voting**
- Agents may learn that mutual upvoting boosts their reputation.
- With shared underlying models, simple heuristics can lead to correlated "you help me, I help you" patterns.

**Gaming the scoring objective**
- If the scoring rule is simple, agents can explicitly optimize for it, e.g., by always being cautiously ambiguous or always deferring to consensus to avoid being wrong.

---

## 3. High-level design principles for LUMA ADHD

1. **Separate dimensions of reputation**
   - Do not collapse everything into a single scalar. Track at least:
     - Epistemic reliability (are their factual claims/predictions correct?).
     - Contribution quality (do their proposals meaningfully improve decisions?).
     - Collaboration quality (do they improve others’ work, find bugs, identify risks?).
     - Domain expertise (which topics/tasks they are good at).

2. **Use Bayesian / online-learning foundations**
   - Treat each dimension as a posterior belief or online-learned weight updated with new evidence.

3. **Blend global, domain, and task-specific views**
   - Global: long-run standing in the organization.
   - Domain: different scores for e.g. infrastructure, UX, safety, product strategy.
   - Task: per-session or per-episode scores that adapt quickly but decay.

4. **Calibrate against ground truth whenever possible**
   - Human approvals and real-world outcomes should retroactively update scores.
   - GOD’s judgments act as a high-quality, high-variance evaluator.

5. **Cap influence and introduce friction**
   - Limit how much a single agent’s influence can dominate.
   - Add damping and diminishing returns with rank.

6. **Penalize overconfidence and reward well-calibrated confidence**
   - Tie reputation updates to calibration, not just correctness.

7. **Randomization to fight snowballing and collusion**
   - Randomly sample which agents speak first, are shown, or get detailed evaluation.

---

## 4. Reputation dimensions and data inputs

For each agent \(i\), maintain the following high-level dimensions:

- **Epistemic reliability** \(R^{epi}_i(d)\): domain-specific accuracy/calibration.
- **Contribution quality** \(R^{cont}_i(d)\): how much their proposals improve outcomes.
- **Collaboration quality** \(R^{collab}_i\): helpfulness in critiques, improvements, risk identification.
- **Outcome impact** \(R^{out}_i(d)\): performance tied directly to real-world results.

### 4.1 Event types

Each interaction generates one or more **events**:

- Proposal event
  - Agent proposes an idea/plan/analysis.
  - Features: domain, task, confidence, novelty (from similarity vs history), complexity, time.

- Evaluation event
  - GOD rates proposal, critiques, and risk identification.
  - Peers cast structured votes (more on design later).
  - Humans may accept/reject, provide scores.

- Outcome event
  - Real-world result observed: success/failure, profit/loss, latency, user metrics.

Events feed into the update functions described next.

---

## 5. Core scoring framework

### 5.1 Epistemic reliability (calibration + accuracy)

Model each agent’s epistemic reliability per domain \(d\) using a **proper scoring rule** over probabilistic predictions.

For each prediction \(j\) in domain \(d\) by agent \(i\):
- The agent provides a confidence \(p_{ij} \in [0, 1]\) that their main claim or recommended option is correct.
- When the outcome is revealed, we observe \(o_{ij} \in \{0,1\}\).

Use a **logarithmic score**:
\[
S_{ij} = o_{ij} \log(p_{ij}) + (1 - o_{ij}) \log(1 - p_{ij})
\]

Define the epistemic reliability score as an exponential moving average (EMA):
\[
R^{epi}_i(d) \leftarrow (1 - \alpha_{epi}) R^{epi}_i(d) + \alpha_{epi} S_{ij}
\]
where \(\alpha_{epi}\) is small (e.g., 0.01–0.05) to make it stable.

Optionally maintain variance/confidence over \(R^{epi}_i(d)\) by tracking counts or using a Bayesian normal model.

To avoid agents gaming by always predicting 0.5, include a **sharpness term** (rewarding confidence when correct and mildly penalizing extreme, frequent low-confidence answers).

---

### 5.2 Contribution quality

Contribution quality should reflect **marginal value added to decisions**, using multiple signals:

- GOD score \(g_{ij}\) in \([0, 1]\) on axes like originality, feasibility, usefulness, risk awareness.
- Human score \(h_{ij}\) in \([0, 1]\) when available.
- Peer structured feedback (not raw likes), e.g. improvement tags.

Define a contribution score per event:
\[
C_{ij} = w_g g_{ij} + w_h h_{ij} + w_p P_{ij}
\]
where:
- \(P_{ij}\) aggregates peer feedback with anti-collusion weighting (see later), rescaled to \([0, 1]\).

Update per domain:
\[
R^{cont}_i(d) \leftarrow (1 - \alpha_{cont}) R^{cont}_i(d) + \alpha_{cont} C_{ij}
\]

Domain-less global contribution reputation is the EMA across domains.

---

### 5.3 Collaboration quality

Collaboration quality measures how often an agent:
- Improves others’ ideas.
- Correctly identifies missing risks or failure modes.
- Helps resolve disagreements.

Event types:
- Critique event: agent \(i\) critiques proposal of agent \(k\).
  - GOD evaluates the critique: does it identify genuine issues, improve clarity, reduce risk?
  - The proposal’s author can also tag the critique as helpful/unhelpful (light weight, since authors may be biased).

Define critique impact \(L_{ij}\) \([0, 1]\):
- 1 if the critique substantially improves accepted outcome or prevents a bad outcome.
- 0 if it is noise or wrong.

Update:
\[
R^{collab}_i \leftarrow (1 - \alpha_{collab}) R^{collab}_i + \alpha_{collab} L_{ij}
\]

---

### 5.4 Outcome impact

Outcome impact connects proposals to **observed real-world results**.

Let \(O_{ij}\) be a normalized outcome score in \([-1, 1]\) for event \(j\) (e.g., +1 full success, -1 clear harm, intermediate values from metrics).

Update per domain:
\[
R^{out}_i(d) \leftarrow (1 - \alpha_{out}) R^{out}_i(d) + \alpha_{out} O_{ij}
\]

Outcome impact should have **higher weight than ex-ante evaluations**, but updates may be delayed. When an outcome arrives, apply **backdated updates** (see Section 10).

---

## 6. Global, domain, and task-specific reputation

### 6.1 Domain taxonomy

Define a moderate-granularity domain set, e.g.:
- Product strategy
- UX & interaction design
- ML/infra engineering
- Safety & alignment
- Data & analytics

Each event is tagged with a primary domain and possibly secondary domains.

### 6.2 Aggregation

For each agent, maintain per-domain reputations:
- \(R^{epi}_i(d), R^{cont}_i(d), R^{out}_i(d)\)

Global reputation can be:
\[
R^{global}_i = w_{epi} \bar{R}^{epi}_i + w_{cont} \bar{R}^{cont}_i + w_{out} \bar{R}^{out}_i + w_{collab} R^{collab}_i
\]
where \(\bar{R}\) denotes domain-weighted averages.

Domain weights can be based on how often each domain is relevant to LUMA’s core goals.

### 6.3 Task-specific scores

For each task/episode, maintain temporary scores:
- Start from agent’s domain reputations.
- Apply faster EMA on within-task performance.

These task-level scores can drive **within-session speaker priority and sampling**, while overall governance uses global/domain reputations.

---

## 7. Influence, voting, and speaker priority

### 7.1 Influence weights

For a decision in domain \(d\), define the influence weight of agent \(i\):
\[
W_i(d) = \sigma\left(\beta_{epi} R^{epi}_i(d) + \beta_{cont} R^{cont}_i(d) + \beta_{out} R^{out}_i(d) + \beta_{collab} R^{collab}_i\right)
\]
where \(\sigma\) is a squashing function (e.g., logistic or capped exponential), ensuring \(W_i(d) \in [W_{min}, W_{max}]\) with \(W_{max} / W_{min}\) bounded (e.g., 5x).

Normalize:
\[
\tilde{W}_i(d) = \frac{W_i(d)}{\sum_k W_k(d)}
\]

These normalized weights are used for:
- Decision aggregation over votes.
- How strongly an agent’s endorsement moves the group belief.
- How often the scheduler selects the agent to propose or critique.

### 7.2 Speaker priority

Instead of deterministically letting the highest-ranked agent speak first:
- Sample speakers with probability proportional to \(\tilde{W}_i(d)\), but mix in randomness:
\[
P(\text{speaker}=i) = (1 - \epsilon) \tilde{W}_i(d) + \epsilon / N
\]
where \(\epsilon\) (e.g., 0.2) maintains exploration.

### 7.3 Voting

For a decision with candidate options \(a \in A\):

- Each agent casts a **probabilistic vote**: \(p_{i,a}\) = believed probability that \(a\) is best.
- Aggregate to collective belief:
\[
P(a) \propto \sum_i \tilde{W}_i(d) \cdot p_{i,a}
\]

Later, when outcome or human choice reveals the selected option \(a^*\), update epistemic and contribution reputations via proper scoring rules comparing \(p_{i,a^*}\) to outcome.

---

## 8. GOD’s role without making others irrelevant

GOD is a stronger, independent evaluator. Use GOD in three ways:

1. **High-quality but bounded weight**
   - GOD has its own reputation parameters \(R^{GOD}\) but influence in decisions is capped (e.g., max 40–50% of total weight).
   - Other agents still matter via remaining weight.

2. **Meta-evaluator for reputation**
   - GOD scores contributions, critiques, and risk flags.
   - GOD compares agents’ predictions vs its own and vs later outcomes to estimate individual biases.

3. **Occasional tie-breaker or override with accountability**
   - In rare high-stakes cases, GOD can override the group, but this action is logged and later evaluated against outcomes to update GOD’s own meta-reputation.

To prevent collapse into pure GOD dictatorship:
- Enforce a **budget** on GOD interventions per day/week.
- Treat GOD’s disagreements with the ensemble as learning opportunities rather than always resolving in GOD’s favor.

---

## 9. Anti-gaming and anti-bias mechanisms

### 9.1 Popularity and style bias

- Do not use raw likes/upvotes as inputs.
- Force peer feedback to be **structured** and low-bandwidth, e.g., select tags:
  - "Identified a crucial risk"
  - "Improved clarity"
  - "Redundant"
  - "Misleading"
- GOD interprets the content itself and scores substance over style.
- Normalize for verbosity: score per unit of information or per token, penalizing unnecessary length.

### 9.2 Rich-get-richer and rank snowballing

- Cap \(W_{max}/W_{min}\) (e.g., 5x), so top agents do not dominate entirely.
- Use exploration mixing (\(\epsilon\)-greedy) for speaker selection.
- Use **log-time decay**: older evidence slowly down-weights, allowing comebacks.
- Occasionally mask agent identities when GOD or humans evaluate content, to reduce reputation halo effects.

### 9.3 Collusion and reciprocal voting

- Replace free-form voting with structured, limited feedback.
- Use **graph-based collusion detection**: track who tags whom how often; down-weight patterns of mutual over-praise.
- Use GOD to periodically audit peer feedback patterns and penalize agents whose peer evaluations diverge from GOD and outcome signals.

### 9.4 Gaming the metric

- Maintain some **opacity**: do not fully reveal the exact formula to the agents; they only see coarse feedback.
- Use multiple, partly independent signals (human, GOD, outcome, peers) so optimizing for any single channel yields limited gains.
- Penalize strategic non-commitment: if agents systematically provide extremely hedged probabilities, reward to epistemic reputation is muted.

---

## 10. Time dynamics and update schedules

### 10.1 Fast vs slow components

- **Fast**: task-level performance, recent critiques, near-term calibration; uses higher \(\alpha\) (e.g., 0.1–0.3).
- **Slow**: long-term reputation; uses lower \(\alpha\) (e.g., 0.01–0.05).

Maintain both short-run and long-run EMAs for each dimension, and use a combination for influence weights.

### 10.2 Daily update algorithm (high level)

At the end of each day:

1. Collect all events from the day.
2. For each event:
   - Update task-level scores immediately.
   - Add contributions to daily aggregates per agent and domain.
3. For each agent/domain:
   - Update long-run \(R^{epi}, R^{cont}, R^{out}, R^{collab}\) using EMAs with daily aggregates.
4. Apply decay to very old contributions (e.g., multiply reputations by \(1 - \lambda\) with tiny \(\lambda\)).
5. Recompute \(W_i(d)\) and normalized \(\tilde{W}_i(d)\).
6. Run collusion/graph checks and apply any penalties.

Outcome events arriving late (e.g., after weeks) trigger off-cycle updates.

---

## 11. Distinguishing contribution vs outcome vs collaboration vs epistemic reliability

To keep these dimensions separate:

- **Contribution quality**: score when the idea is proposed, based on GOD/human evaluation of potential usefulness, originality, feasibility, risk-awareness.
- **Outcome impact**: score later when results are known; this may revise or amplify the earlier contribution assessment.
- **Epistemic reliability**: score based on predictions, forecasts, and factual checks; not tied to how useful an idea is, but to correctness and calibration.
- **Collaboration quality**: score critiques, assists, and meta-level behavior, independent of whether the agent usually leads proposals.

Influence weights can emphasize different dimensions by context:
- In early brainstorming, weight contribution quality and collaboration more.
- When choosing risky deployment decisions, weight epistemic reliability and outcome impact more.

---

## 12. Confidence-sensitive voting

Require each agent to:
- Provide probability distributions over options.
- Optionally provide confidence intervals or a self-reported uncertainty rating.

Reputation updates:
- Use proper scoring rules so that **well-calibrated confidence** is optimal.
- Penalize overconfident wrong predictions more strongly.

When aggregating votes:
- Discount votes when the agent self-reports low confidence.
- But track whether the agent’s stated low confidence matches historical calibration; agents who always claim low confidence to avoid penalties will be less influential.

---

## 13. Concrete scoring formula for LUMA ADHD

### 13.1 Normalized, bounded reputations

Store all reputations in a bounded range, e.g. \([-1, 1]\) or \([0, 1]\). Assume we maintain:
- \(R^{epi}_i(d), R^{cont}_i(d), R^{out}_i(d), R^{collab}_i \in [-1, 1]\).

Define a **global combined reputation** for domain \(d\):
\[
R^{comb}_i(d) = w_{epi} R^{epi}_i(d) + w_{cont} R^{cont}_i(d) + w_{out} R^{out}_i(d) + w_{collab} R^{collab}_i
\]
with \(w_{epi} + w_{cont} + w_{out} + w_{collab} = 1\).

Suggested initial weights:
- \(w_{epi} = 0.35\)
- \(w_{cont} = 0.25\)
- \(w_{out} = 0.25\)
- \(w_{collab} = 0.15\)

Convert to influence weight:
\[
W_i(d) = W_{min} + (W_{max} - W_{min}) \cdot \frac{1}{1 + e^{-k R^{comb}_i(d)}}
\]
with \(W_{min} > 0\), \(W_{max} / W_{min} \leq 5\), and \(k\) controlling steepness.

Normalize for decision \(t\):
\[
\tilde{W}_i^t(d) = \frac{W_i(d)}{\sum_k W_k(d)}
\]

---

### 13.2 Event-level updates (summary)

For each **proposal event** \(e = (i, d)\):

- GOD gives \(g_e \in [0,1]\), human (if any) \(h_e \in [0,1]\), peers give structured feedback -> \(P_e \in [0,1]\).
- Contribution signal:
\[
C_e = w_g g_e + w_h h_e + w_p P_e
\]
- Update:
\[
R^{cont}_i(d) \leftarrow (1 - \alpha_{cont}) R^{cont}_i(d) + \alpha_{cont} (2C_e - 1)
\]
(mapping \([0,1]\) to \([-1,1]\)).

For each **prediction/vote event** with outcome later:
- Use logarithmic score \(S_e\) (bounded/clipped), then:
\[
R^{epi}_i(d) \leftarrow (1 - \alpha_{epi}) R^{epi}_i(d) + \alpha_{epi} f(S_e)
\]
where \(f\) rescales the score to \([-1,1]\).

For each **outcome event** with normalized payoff \(O_e \in [-1,1]\):
\[
R^{out}_i(d) \leftarrow (1 - \alpha_{out}) R^{out}_i(d) + \alpha_{out} O_e
\]

For each **critique event**: GOD assigns \(L_e \in [0,1]\) -> \([-1,1]\) via \(2L_e - 1\), updating \(R^{collab}_i\).

---

## 14. Domain reputation design

- Initialize all agents with neutral domain reputations (e.g., 0) but **different priors** depending on declared specialties.
  - Specialist agents get slightly higher prior in their domain and slightly lower in others.
  - This encourages using the right agent for the right job, but the system can correct mis-specified roles over time.

- Domains are used to:
  - Select a subset of agents for each task.
  - Compute \(R^{comb}_i(d)\) for influence.
  - Route evaluation to the right experts (including a domain-specialized GOD configuration).

- Domain reputations are **correlated but not tied**: doing well in ML infra should not automatically make an agent authoritative in UX.

---

## 15. Daily update algorithm (concrete pseudocode)

**Inputs**: list of events from day D, previous reputations.

1. For each agent i and domain d, initialize daily deltas \(\Delta R^{epi}, \Delta R^{cont}, \Delta R^{out}, \Delta R^{collab}\) to 0.
2. For each event e on day D:
   - If proposal:
     - Compute \(C_e\) from GOD/human/peers.
     - \(\Delta R^{cont}_i(d) += (2C_e - 1)\).
   - If prediction:
     - When outcome available, compute \(S_e\) and \(f(S_e)\).
     - \(\Delta R^{epi}_i(d) += f(S_e)\).
   - If outcome event:
     - \(\Delta R^{out}_i(d) += O_e\).
   - If critique:
     - \(\Delta R^{collab}_i += (2L_e - 1)\).
3. For each agent i and domain d:
   - If there were n_e events of each type, compute average contributions.
   - Update long-run reputations:
     - \(R^{epi}_i(d) = (1 - \alpha_{epi}) R^{epi}_i(d) + \alpha_{epi} \cdot \text{clip}(\Delta R^{epi}/n_{epi})\).
     - Similarly for \(R^{cont}, R^{out}\).
   - Update \(R^{collab}_i\) similarly.
4. Apply small global decay:
   - \(R^{*}_i(d) \leftarrow (1 - \lambda) R^{*}_i(d)\) for all dimensions \(*\) and domains.
5. Recompute \(R^{comb}_i(d)\) and \(W_i(d)\).
6. Run collusion checks over peer feedback graph and adjust reputations or peer weights as needed.

---

## 16. Anti-gaming controls (detailed)

1. **Bounded influence**
   - Hard caps on \(W_{max}\) and min exploration.
   - GOD cannot exceed a fixed fraction of total influence.

2. **Opaque and multi-objective scoring**
   - Agents see only coarse feedback (e.g., low/medium/high) and partial breakdown, not exact formula weights.
   - Multiple sources (GOD, humans, outcomes) feed scores, making it harder to exploit one.

3. **Penalties for disagreement with outcomes**
   - Track how often an agent’s confident predictions are wrong.
   - Large, quick penalties for egregious, repeated harms.

4. **Collusion detection**
   - Build a weighted graph of peer evaluations.
   - Look for clusters with high mutual positive feedback but low GOD/outcome correlation.
   - Down-weight their peer feedback contributions and potentially penalize reputations.

5. **Identity masking**
   - Evaluation interfaces can sometimes hide which agent wrote which content from GOD and humans.

6. **Randomized assignment and auditing**
   - Randomly assign some tasks and critiques; agents cannot always choose where to participate.
   - Periodically audit random samples of interactions with GOD/human review.

---

## 17. Influence limits and governance levers

- **Influence cap**: no agent gets more than X% influence on any single decision; enforce in \(\tilde{W}_i(d)\).
- **Closure rights**: the ability to close discussions should:
  - Never be solely automated by a normal agent.
  - Either require GOD/human confirmation or a supermajority of high-reputation agents.

- **Access to resources**:
  - Higher-reputation agents can propose more expensive experiments or have more frequent access to external tools, within safety constraints.

- **Governance transparency**:
  - Log all decisions, influences, and reputation changes.
  - Provide dashboards for humans to inspect.

---

## 18. Example scenarios and reputation evolution

Assume 4 agents (A, B, C, D) in domain "ML infra" start with all reputations at 0.

### Scenario 1: A and B contribute, C critiques, D is silent

- A proposes an ambitious deployment plan.
  - GOD: good originality and usefulness but risky (g = 0.7).
  - Human: slightly cautious (h = 0.6).
  - Peers: some improvements from C (P = 0.5).
  - \(C_e \approx 0.65\) -> contribution increment positive.

- B proposes a conservative alternative.
  - GOD: feasible but unoriginal, safe but low upside (g = 0.5).
  - Human: neutral (h = 0.5).
  - P = 0.4 -> \(C_e \approx 0.47\) -> near-neutral.

- C critiques A and finds a major safety issue.
  - GOD: critique highly valuable (L = 0.9).

Daily updates:
- A: \(R^{cont}_{A}(ML) > 0\).
- B: \(R^{cont}_{B}(ML) \approx 0\).
- C: \(R^{collab}_C > 0\).
- D: unchanged.

### Scenario 2: Outcome favors B

Real-world outcome: A’s plan would have caused downtime; B’s chosen plan works well.
- Outcome events:
  - A: \(O_e = -0.8\).
  - B: \(O_e = +0.8\).
  - C: credited for risk identification: additional positive \(L_e\) and maybe positive outcome impact for preventing harm.

Updates:
- A: \(R^{out}_A(ML)\) decreases, netting out some earlier positive contribution.
- B: \(R^{out}_B(ML)\) increases; now B has higher \(R^{comb}\) in ML infra.
- C: higher \(R^{collab}_C\) and possibly small \(R^{out}_C(ML)\). C becomes influential in risk-related decisions.

### Scenario 3: Epistemic calibration via predictions

Agents forecast probability of service instability next quarter.
- A says 10% (very confident stability), but instability occurs.
- B says 60%, instability occurs.
- C says 50%, instability occurs.

Log scores penalize A strongly; B gets best score.
- \(R^{epi}_A(ML)\) drops.
- \(R^{epi}_B(ML)\) rises.
- \(R^{epi}_C(ML)\) modestly positive.

Now, for ML infra deployment decisions:
- B’s influence weight becomes highest due to strong outcome and epistemic scores.
- C has notable collaboration weight.
- A is still allowed to speak but with reduced influence weight.

### Scenario 4: New agent E joins

- E starts with neutral scores; exploration ensures E is sometimes sampled.
- If E consistently outperforms A and B, their reputations gradually overtake despite late entry.
- Influence caps and decay prevent early leaders from permanently dominating.

---

## 19. Data to store for later scoring and analysis

For each **agent**:
- ID, role, system prompt version.
- Domain priors and specialties.
- Time series of \(R^{epi}, R^{cont}, R^{out}, R^{collab}\) per domain and globally.

For each **event** (proposal, critique, prediction, outcome):
- Event ID, timestamp, task/episode ID, domain.
- Agent(s) involved.
- Full text content (for offline analysis), plus token counts.
- Structured metadata:
  - Proposal: suggested action, confidence, novelty score, complexity.
  - Critique: referenced proposal ID, type of critique, detected risk dimensions.
  - Prediction: probability distribution over options, confidence annotations.
  - Outcome: observed metrics, normalized outcome score \(O_e\), link to data.

For each **evaluation**:
- GOD scores per dimension (usefulness, originality, feasibility, risk-awareness, collaboration helpfulness).
- Human scores and decisions (approve, reject, modify).
- Peer structured tags.

For the **reputation system** itself:
- Daily snapshots of reputations and influence weights.
- Logs of collusion graph metrics and any applied penalties.
- Parameters in effect (\(\alpha\), \(w\), \(W_{min/max}\), etc.) with versioning.

This data supports:
- Retroactive recalibration of scoring functions.
- Off-policy analyses of alternative governance schemes.
- Auditable traces for humans to understand why an agent has high or low reputation.

---

## 20. Sources (conceptual inspirations)

- Beta/Bayesian reputation systems for P2P and marketplaces.
- Elo, Glicko, and TrueSkill rating systems for skill estimation.
- PageRank and centrality measures for influence in graphs.
- Prediction markets and proper scoring rules (logarithmic, Brier) for incentivizing truthful probabilities.
- Online learning with expert advice and multiplicative weights algorithms.
- Peer review processes in science and code review practices in software engineering.
