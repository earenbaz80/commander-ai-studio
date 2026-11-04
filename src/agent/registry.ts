import type { ToolDefinition } from './types';
import { fsReadTool, fsWriteTool, fsEditTool, fsGlobTool, fsListTool, fsGrepTool, fsProposeWriteTool, fsProposeEditTool } from './tools/fs';
import { shellRunTool, shellJobTool, shellPtyTool } from './tools/shell';
import { browserTool, previewTool } from './tools/browser';
import { readDiagnosticsTool } from './tools/diagnostics';
import { codeAnalyzeTool, codeRefactorTool, codeFixTool } from './tools/code';
import { taskTool } from './tools/task';
import { spawnAgentsTool } from './tools/spawnAgents';
import { skillTool } from './tools/skill';
import { askUserTool } from './tools/askUser';
import { webFetchTool, webSearchTool, codeRunTool } from './tools/web';
import { runFileChangeHooksTool } from './tools/hooks';
import { worktreeCreateTool } from './tools/worktreeCreate';
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
  [fsListTool.id]: fsListTool,
  [fsGrepTool.id]: fsGrepTool,
  [fsProposeWriteTool.id]: fsProposeWriteTool,
  [fsProposeEditTool.id]: fsProposeEditTool,
  [shellRunTool.id]: shellRunTool,
  [shellJobTool.id]: shellJobTool,
  [shellPtyTool.id]: shellPtyTool,
  [browserTool.id]: browserTool,
  [previewTool.id]: previewTool,
  [readDiagnosticsTool.id]: readDiagnosticsTool,
  [codeAnalyzeTool.id]: codeAnalyzeTool,
  [codeRefactorTool.id]: codeRefactorTool,
  [codeFixTool.id]: codeFixTool,
  [taskTool.id]: taskTool,
  [spawnAgentsTool.id]: spawnAgentsTool,
  [skillTool.id]: skillTool,
  [askUserTool.id]: askUserTool,
  [webFetchTool.id]: webFetchTool,
  [webSearchTool.id]: webSearchTool,
  [codeRunTool.id]: codeRunTool,
  [runFileChangeHooksTool.id]: runFileChangeHooksTool,
  [worktreeCreateTool.id]: worktreeCreateTool,
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