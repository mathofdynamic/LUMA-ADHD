import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const remote = process.argv.slice(2).includes("--remote");
const localWrangler = resolve("node_modules", "wrangler", "bin", "wrangler.js");
const sql = `
WITH turns AS (
  SELECT at.agent_id,
    SUM(CASE WHEN at.created_at >= datetime('now','-1 day') THEN 1 ELSE 0 END) AS opportunities_24h,
    SUM(CASE WHEN at.created_at >= datetime('now','-7 day') THEN 1 ELSE 0 END) AS opportunities_7d,
    SUM(CASE WHEN at.created_at >= datetime('now','-7 day') AND json_extract(at.metadata_json,'$.intent') = 'SPEAK' THEN 1 ELSE 0 END) AS speak_7d,
    SUM(CASE WHEN at.created_at >= datetime('now','-7 day') AND json_extract(at.metadata_json,'$.intent') = 'WAIT' THEN 1 ELSE 0 END) AS wait_7d,
    SUM(CASE WHEN at.created_at >= datetime('now','-7 day') AND at.status = 'failed' THEN 1 ELSE 0 END) AS failed_7d,
    SUM(CASE WHEN at.created_at >= datetime('now','-7 day') AND j.job_type = 'telegram.interactive_message' THEN 1 ELSE 0 END) AS interactive_7d,
    SUM(CASE WHEN at.created_at >= datetime('now','-7 day') AND j.job_type = 'agent.ambient' THEN 1 ELSE 0 END) AS ambient_7d,
    SUM(CASE WHEN at.created_at >= datetime('now','-7 day') AND j.job_type = 'agent.deep_work' THEN 1 ELSE 0 END) AS deep_work_7d,
    SUM(CASE WHEN at.created_at >= datetime('now','-7 day') AND j.job_type = 'human_task.wake' THEN 1 ELSE 0 END) AS human_wake_7d,
    MAX(at.created_at) AS last_opportunity_at
  FROM agent_turns at
  LEFT JOIN jobs j ON j.id = at.job_id
  GROUP BY at.agent_id
), durable AS (
  SELECT actor_agent_id AS agent_id,
    SUM(CASE WHEN occurred_at >= datetime('now','-7 day') THEN 1 ELSE 0 END) AS durable_work_7d,
    MAX(occurred_at) AS last_durable_work_at
  FROM events
  WHERE actor_agent_id IS NOT NULL AND event_type IN ('runtime.file_work_completed','runtime.memory_note_created','runtime.decision_recorded')
  GROUP BY actor_agent_id
), requests AS (
  SELECT requested_by_agent_id AS agent_id, COUNT(*) AS requests_7d
  FROM agent_requests
  WHERE created_at >= datetime('now','-7 day')
  GROUP BY requested_by_agent_id
), public_messages AS (
  SELECT author_agent_id AS agent_id, MAX(created_at) AS last_public_message_at
  FROM messages
  WHERE author_type = 'agent' AND visibility = 'public' AND deleted_at IS NULL
  GROUP BY author_agent_id
)
SELECT a.id, a.display_name,
  COALESCE(t.opportunities_24h,0) AS opportunities_24h,
  COALESCE(t.opportunities_7d,0) AS opportunities_7d,
  COALESCE(t.speak_7d,0) AS speak_7d,
  COALESCE(t.wait_7d,0) AS wait_7d,
  COALESCE(t.failed_7d,0) AS failed_7d,
  COALESCE(t.interactive_7d,0) AS interactive_7d,
  COALESCE(t.ambient_7d,0) AS ambient_7d,
  COALESCE(t.deep_work_7d,0) AS deep_work_7d,
  COALESCE(t.human_wake_7d,0) AS human_wake_7d,
  COALESCE(r.requests_7d,0) AS requests_7d,
  COALESCE(d.durable_work_7d,0) AS durable_work_7d,
  t.last_opportunity_at,
  d.last_durable_work_at,
  p.last_public_message_at
FROM agents a
LEFT JOIN turns t ON t.agent_id = a.id
LEFT JOIN durable d ON d.agent_id = a.id
LEFT JOIN requests r ON r.agent_id = a.id
LEFT JOIN public_messages p ON p.agent_id = a.id
WHERE a.deleted_at IS NULL AND a.is_supervisor = 0
ORDER BY a.display_name ASC
LIMIT 8;`;

const env = { ...process.env };
for (const key of ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"]) delete env[key];

try {
  const args = [
    "d1", "execute", "luma-adhd",
    remote ? "--remote" : "--local", "-y", "--json", "--command", sql,
  ];
  const output = existsSync(localWrangler)
    ? execFileSync(process.execPath, [localWrangler, ...args], { encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] })
    : execFileSync(process.platform === "win32" ? "npx.cmd" : "npx", ["--no-install", "wrangler", ...args], { encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"], shell: process.platform === "win32" });
  const parsed = JSON.parse(output);
  const rows = Array.isArray(parsed) ? parsed.flatMap((item) => Array.isArray(item?.results) ? item.results : []) : [];
  console.log(`AGENT_ACTIVITY_MODE=${remote ? "remote" : "local"}`);
  console.log("Agent\tOpp24h\tOpp7d\tSPEAK\tWAIT\tFAIL\tInteractive\tAmbient\tDeepWork\tHumanWake\tRequests\tDurable\tLastOpportunity\tLastDurableWork\tLastPublicMessage");
  for (const row of rows) {
    console.log([
      row.display_name ?? row.id ?? "unknown",
      row.opportunities_24h ?? 0,
      row.opportunities_7d ?? 0,
      row.speak_7d ?? 0,
      row.wait_7d ?? 0,
      row.failed_7d ?? 0,
      row.interactive_7d ?? 0,
      row.ambient_7d ?? 0,
      row.deep_work_7d ?? 0,
      row.human_wake_7d ?? 0,
      row.requests_7d ?? 0,
      row.durable_work_7d ?? 0,
      row.last_opportunity_at ?? "—",
      row.last_durable_work_at ?? "—",
      row.last_public_message_at ?? "—",
    ].join("\t"));
  }
  if (rows.length === 0) console.log("No normal Agent activity rows found.");
} catch (error) {
  const message = error instanceof Error ? error.message.split("\n")[0] : "diagnostic failed";
  console.error(`AGENT_ACTIVITY_DIAGNOSTIC_FAILED=${message}`);
  process.exitCode = 1;
}
