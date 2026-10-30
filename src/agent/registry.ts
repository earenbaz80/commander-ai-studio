import type { ToolDefinition } from './types';
import { fsReadTool, fsWriteTool, fsEditTool, fsGlobTool, fsGrepTool, fsProposeWriteTool, fsProposeEditTool } from './tools/fs';
import { shellRunTool, shellJobTool } from './tools/shell';
import { browserTool, previewTool } from './tools/browser';
import { readDiagnosticsTool } from './tools/diagnostics';
import { taskTool } from './tools/task';
import { webFetchTool, webSearchTool, codeRunTool } from './tools/web';
import { mcpCallToolDef, mcpListToolDef } from './tools/mcp';
import {
  gitStatusTool,
  gitDiffTool,
  gitLogTool,
  gitCommitTool,
  gitWorktreeTool,
  gitRebaseTool,
  gitConflictTool,
} from './tools/git';

export const TOOL_REGISTRY: Record<string, ToolDefinition<any, any>> = {
  [fsReadTool.id]: fsReadTool,
  [fsWriteTool.id]: fsWriteTool,
  [fsEditTool.id]: fsEditTool,
  [fsGlobTool.id]: fsGlobTool,
  [fsGrepTool.id]: fsGrepTool,
  [fsProposeWriteTool.id]: fsProposeWriteTool,
  [fsProposeEditTool.id]: fsProposeEditTool,
  [shellRunTool.id]: shellRunTool,
  [shellJobTool.id]: shellJobTool,
  [browserTool.id]: browserTool,
  [previewTool.id]: previewTool,
  [readDiagnosticsTool.id]: readDiagnosticsTool,
  [taskTool.id]: taskTool,
  [webFetchTool.id]: webFetchTool,
  [webSearchTool.id]: webSearchTool,
  [codeRunTool.id]: codeRunTool,
  ['mcp.call']: mcpCallToolDef,
  ['mcp.list']: mcpListToolDef,
  [gitStatusTool.id]: gitStatusTool,
  [gitDiffTool.id]: gitDiffTool,
  [gitLogTool.id]: gitLogTool,
  [gitCommitTool.id]: gitCommitTool,
  [gitWorktreeTool.id]: gitWorktreeTool,
  [gitRebaseTool.id]: gitRebaseTool,
  [gitConflictTool.id]: gitConflictTool,
};

export function getTool(id: string): ToolDefinition<any, any> | undefined {
  return TOOL_REGISTRY[id];
}

export function listTools(): ToolDefinition<any, any>[] {
  return Object.values(TOOL_REGISTRY);
}