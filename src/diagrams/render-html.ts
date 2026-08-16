import type { DiagramSpec } from "./types";

function escape(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

export function renderDiagramHtml(spec: DiagramSpec): string {
  const nodeMap = new Map(spec.nodes.map((node) => [node.id, node]));
  const groups = spec.groups.map((group) => `<section class="diagram-group"><h2>${escape(group.label)}</h2><div class="diagram-group-nodes">${(group.nodeIds ?? []).map((id) => {
    const node = nodeMap.get(id);
    return node ? `<div class="diagram-node" data-kind="${escape(node.kind ?? "default")}"><strong>${escape(node.label)}</strong><small>${escape(node.id)}</small></div>` : "";
  }).join("")}</div></section>`).join("");
  const groupedIds = new Set(spec.groups.flatMap((group) => group.nodeIds ?? []));
  const ungrouped = spec.nodes.filter((node) => !groupedIds.has(node.id)).map((node) => `<div class="diagram-node" data-kind="${escape(node.kind ?? "default")}"><strong>${escape(node.label)}</strong><small>${escape(node.id)}</small></div>`).join("");
  const edges = spec.edges.map((edge) => `<li><span>${escape(nodeMap.get(edge.from)?.label ?? edge.from)}</span><b aria-hidden="true">→</b><span>${escape(nodeMap.get(edge.to)?.label ?? edge.to)}</span>${edge.label ? `<small>${escape(edge.label)}</small>` : ""}</li>`).join("");
  const notes = spec.notes.length === 0 ? "" : `<aside class="diagram-notes"><h2>Notes</h2><ul>${spec.notes.map((note) => `<li>${escape(note)}</li>`).join("")}</ul></aside>`;
  return `<!doctype html><html lang="en" dir="${spec.direction}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src 'none'; font-src 'none'; connect-src 'none'; script-src 'none'; frame-src 'none';"><style>
:root{color-scheme:dark;font-family:Inter,ui-sans-serif,system-ui,sans-serif;background:#0a0d16;color:#f5f3fa}*{box-sizing:border-box}body{margin:0;padding:32px;background:#0a0d16}.diagram{max-width:1120px;margin:auto}.eyebrow{color:#a58cff;font-size:11px;letter-spacing:.16em;text-transform:uppercase}.diagram h1{font-size:clamp(22px,4vw,42px);line-height:1.1;margin:8px 0 28px}.diagram-groups{display:grid;gap:16px}.diagram-group,.diagram-notes{padding:18px;border:1px solid #28263b;border-radius:14px;background:#111526}.diagram-group h2,.diagram-notes h2{font-size:13px;color:#c0b4ff;margin:0 0 14px}.diagram-group-nodes{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}.diagram-node{min-height:70px;padding:13px;border:1px solid #4b3f79;border-radius:10px;background:#171b31;display:grid;align-content:center;gap:6px}.diagram-node[data-kind="risk"]{border-color:#9a5c68}.diagram-node small{color:#858aa1;font-size:10px}.diagram-ungrouped{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-top:16px}.diagram-edges{margin:20px 0;padding:0;list-style:none;display:grid;gap:8px}.diagram-edges li{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:11px 13px;border-left:2px solid #8b6cff;background:#111526;border-radius:8px;color:#d8d5e5}.diagram-edges b{color:#e05bc4}.diagram-edges small{width:100%;color:#858aa1;font-size:11px}.diagram-notes{margin-top:16px}.diagram-notes ul{margin:0;padding-inline-start:20px;color:#b6b5c7;line-height:1.7}@media(max-width:600px){body{padding:18px}.diagram-node{min-height:58px}}
</style></head><body><main class="diagram"><div class="eyebrow">LUMA ADHD / ${escape(spec.diagramType)}</div><h1>${escape(spec.title)}</h1><div class="diagram-groups">${groups}</div>${ungrouped ? `<div class="diagram-ungrouped">${ungrouped}</div>` : ""}${edges ? `<ul class="diagram-edges" aria-label="Connections">${edges}</ul>` : ""}${notes}</main></body></html>`;
}
