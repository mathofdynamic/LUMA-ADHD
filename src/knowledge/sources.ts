import type { KnowledgeSourceDefinition } from "../memory/types";

export const OFFICIAL_LUMA_SOURCES: readonly KnowledgeSourceDefinition[] = [
  { key: "luma", canonicalKey: "official:luma", slug: "luma", title: "LUMA Internal Master Document", url: "https://luma-knowledge.pages.dev/k/luma.md" },
  { key: "workflow", canonicalKey: "official:workflow", slug: "workflow", title: "LUMA Workflow Guide", url: "https://luma-knowledge.pages.dev/k/workflow.md" },
  { key: "faq", canonicalKey: "official:faq", slug: "faq", title: "LUMA FAQ", url: "https://luma-knowledge.pages.dev/k/faq.md" },
  { key: "umaq", canonicalKey: "official:umaq", slug: "umaq", title: "LUMA User Response Guide", url: "https://luma-knowledge.pages.dev/k/umaq.md" },
  { key: "subscription-plan", canonicalKey: "official:subscription-plan", slug: "subscription-plan", title: "Approved Subscription Plans", url: "https://luma-knowledge.pages.dev/k/subscription-plan.md" },
  { key: "pricing", canonicalKey: "official:pricing", slug: "pricing", title: "LUMA Detailed Pricing", url: "https://luma-knowledge.pages.dev/k/pricing.md" },
  { key: "terms-of-use", canonicalKey: "official:terms-of-use", slug: "terms-of-use", title: "LUMA User Rights and Obligations", url: "https://luma-knowledge.pages.dev/k/terms-of-use.md" },
  { key: "terms-policies", canonicalKey: "official:terms-policies", slug: "terms-policies", title: "LUMA Service Terms", url: "https://luma-knowledge.pages.dev/k/terms-policies.md" },
  { key: "growth-strategy", canonicalKey: "official:growth-strategy", slug: "growth-strategy", title: "LUMA Growth Strategy", url: "https://luma-knowledge.pages.dev/k/growth-strategy.md" },
  { key: "international-budget-plan", canonicalKey: "official:international-budget-plan", slug: "international-budget-plan", title: "LUMA International Budget Plan", url: "https://luma-knowledge.pages.dev/k/international-budget-plan.md" },
  { key: "international-budget-plan-fa", canonicalKey: "official:international-budget-plan-fa", slug: "international-budget-plan-fa", title: "LUMA International Budget Plan — Persian", url: "https://luma-knowledge.pages.dev/k/international-budget-plan-fa.md" },
  { key: "marketing-contract", canonicalKey: "official:marketing-contract", slug: "marketing-contract", title: "LUMA Marketing Contract", url: "https://luma-knowledge.pages.dev/k/marketing-contract.md" },
];

const SOURCE_BY_KEY = new Map(OFFICIAL_LUMA_SOURCES.map((source) => [source.key, source]));

export function officialSourceByKey(key: string): KnowledgeSourceDefinition | null {
  return SOURCE_BY_KEY.get(key) ?? null;
}

export function isOfficialLumaUrl(url: string): boolean {
  return OFFICIAL_LUMA_SOURCES.some((source) => source.url === url);
}
