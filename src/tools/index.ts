export interface ToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
}

export interface ToolRegistry {
  readonly definitions: readonly ToolDefinition[];
}

export const FOUNDATION_TOOL_REGISTRY: ToolRegistry = Object.freeze({
  definitions: [],
});
