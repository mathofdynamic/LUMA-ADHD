import { ValidationError } from "../database/errors";
import { DIAGRAM_TYPES, type DiagramEdge, type DiagramGroup, type DiagramNode, type DiagramSpec } from "./types";

const MAX_NODES = 40;
const MAX_EDGES = 80;
const MAX_GROUPS = 20;
const MAX_NOTES = 20;
const MAX_LABEL = 240;
const MAX_SOURCE_CHARACTERS = 32_000;

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function string(value: unknown, field: string, max: number, required = true): string {
  if (typeof value !== "string" || (required && value.trim().length === 0) || value.length > max) {
    throw new ValidationError(`${field} must be a ${required ? "non-empty " : ""}string of at most ${max} characters`);
  }
  return value.trim();
}

function list(value: unknown, field: string, max: number): readonly unknown[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > max) throw new ValidationError(`${field} must contain at most ${max} items`);
  return value;
}

export function validateDiagramSpec(value: unknown): DiagramSpec {
  const input = record(value);
  const diagramType = input.diagram_type ?? input.diagramType;
  if (typeof diagramType !== "string" || !(DIAGRAM_TYPES as readonly string[]).includes(diagramType)) {
    throw new ValidationError(`diagram_type must be one of ${DIAGRAM_TYPES.join(", ")}`);
  }
  const direction = input.direction;
  if (direction !== "rtl" && direction !== "ltr") throw new ValidationError("diagram direction must be rtl or ltr");
  const title = string(input.title, "diagram.title", MAX_LABEL);
  const nodes: DiagramNode[] = [];
  const nodeIds = new Set<string>();
  for (const [index, item] of list(input.nodes, "diagram.nodes", MAX_NODES).entries()) {
    const node = record(item);
    const id = string(node.id, `diagram.nodes[${index}].id`, 80);
    if (nodeIds.has(id)) throw new ValidationError(`diagram node id '${id}' is duplicated`);
    nodeIds.add(id);
    nodes.push({
      id,
      label: string(node.label, `diagram.nodes[${index}].label`, MAX_LABEL),
      kind: node.kind === undefined ? undefined : string(node.kind, `diagram.nodes[${index}].kind`, 80),
      groupId: node.group_id === null || node.groupId === null || node.group_id === undefined && node.groupId === undefined
        ? null
        : string(node.group_id ?? node.groupId, `diagram.nodes[${index}].groupId`, 80),
    });
  }
  const edges: DiagramEdge[] = [];
  for (const [index, item] of list(input.edges, "diagram.edges", MAX_EDGES).entries()) {
    const edge = record(item);
    const from = string(edge.from, `diagram.edges[${index}].from`, 80);
    const to = string(edge.to, `diagram.edges[${index}].to`, 80);
    if (!nodeIds.has(from) || !nodeIds.has(to)) throw new ValidationError(`diagram edge ${from}->${to} references an unknown node`);
    edges.push({
      from,
      to,
      label: edge.label === undefined ? undefined : string(edge.label, `diagram.edges[${index}].label`, MAX_LABEL, false),
      relation: edge.relation === undefined ? undefined : string(edge.relation, `diagram.edges[${index}].relation`, 80, false),
    });
  }
  const groups: DiagramGroup[] = [];
  const groupIds = new Set<string>();
  for (const [index, item] of list(input.groups, "diagram.groups", MAX_GROUPS).entries()) {
    const group = record(item);
    const id = string(group.id, `diagram.groups[${index}].id`, 80);
    if (groupIds.has(id)) throw new ValidationError(`diagram group id '${id}' is duplicated`);
    groupIds.add(id);
    const nodeIdsValue = group.node_ids ?? group.nodeIds;
    const groupNodeIds = nodeIdsValue === undefined ? [] : list(nodeIdsValue, `diagram.groups[${index}].nodeIds`, MAX_NODES).map((nodeId, nodeIndex) => string(nodeId, `diagram.groups[${index}].nodeIds[${nodeIndex}]`, 80));
    for (const nodeId of groupNodeIds) if (!nodeIds.has(nodeId)) throw new ValidationError(`diagram group references unknown node '${nodeId}'`);
    groups.push({ id, label: string(group.label, `diagram.groups[${index}].label`, MAX_LABEL), nodeIds: groupNodeIds });
  }
  const notes = list(input.notes, "diagram.notes", MAX_NOTES).map((note, index) => string(note, `diagram.notes[${index}]`, MAX_LABEL));
  const spec: DiagramSpec = { diagramType: diagramType as DiagramSpec["diagramType"], title, direction, nodes, edges, groups, notes };
  if (JSON.stringify(spec).length > MAX_SOURCE_CHARACTERS) throw new ValidationError("diagram specification is too large");
  return spec;
}

export const DIAGRAM_SPEC_SCHEMA = `{
  "diagram_type": "architecture | flow | process | comparison | decision_tree",
  "title": "short title",
  "direction": "rtl | ltr",
  "nodes": [{"id":"stable-id","label":"short label","kind":"optional"}],
  "edges": [{"from":"node-id","to":"node-id","label":"optional"}],
  "groups": [{"id":"group-id","label":"optional group","node_ids":["node-id"]}],
  "notes": ["optional short note"]
}`;

export const DIAGRAM_LIMITS = { MAX_NODES, MAX_EDGES, MAX_GROUPS, MAX_NOTES, MAX_LABEL, MAX_SOURCE_CHARACTERS } as const;
