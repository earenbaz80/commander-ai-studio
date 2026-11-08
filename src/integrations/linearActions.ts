/**
 * Acciones de la tool `linear`. Se ejecutan en el servidor: el access token
 * nunca viaja al modelo ni al navegador.
 */
import { IntegrationError, getAccessToken } from './oauth';
import { linearGraphql } from './linear';

export type LinearAction = 'whoami' | 'list_teams' | 'list_issues' | 'create_issue';

export interface LinearActionInput {
  action?: string;
  teamId?: string;
  title?: string;
  description?: string;
  limit?: number;
}

export interface LinearActionResult {
  ok: boolean;
  data?: any;
  error?: string;
  status?: number;
}

const ACTIONS = new Set<LinearAction>(['whoami', 'list_teams', 'list_issues', 'create_issue']);

function text(value: unknown, max: number): string {
  return String(value ?? '').trim().slice(0, max);
}

function limitOf(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 20;
  return Math.max(1, Math.min(50, Math.trunc(n)));
}

const ISSUE_FIELDS = `
  nodes {
    id
    identifier
    title
    url
    updatedAt
    state { name }
    team { id key name }
    assignee { id name }
  }
`;

export async function executeLinearAction(input: LinearActionInput): Promise<LinearActionResult> {
  const action = text(input?.action, 40).toLowerCase() as LinearAction;
  if (!ACTIONS.has(action)) {
    return {
      ok: false,
      error: 'action inválida. Usa whoami, list_teams, list_issues o create_issue.',
      status: 400,
    };
  }

  const teamId = text(input?.teamId, 200);
  const title = text(input?.title, 300);
  const description = text(input?.description, 10_000);
  if (action === 'create_issue' && (!teamId || !title)) {
    return { ok: false, error: 'create_issue requiere teamId y title.', status: 400 };
  }

  try {
    const accessToken = await getAccessToken('linear');

    if (action === 'whoami') {
      const data = await linearGraphql<{ viewer?: unknown }>(
        accessToken,
        'query CommanderViewer { viewer { id name email } }',
      );
      return { ok: true, data: { viewer: data?.viewer ?? null } };
    }

    if (action === 'list_teams') {
      const data = await linearGraphql<{ teams?: { nodes?: unknown[] } }>(
        accessToken,
        'query CommanderTeams { teams(first: 50) { nodes { id key name } } }',
      );
      const teams = data?.teams?.nodes ?? [];
      return { ok: true, data: { teams, count: teams.length } };
    }

    if (action === 'list_issues') {
      const first = limitOf(input?.limit);
      const query = teamId
        ? `query CommanderIssues($first: Int!, $teamId: ID!) {
            issues(first: $first, filter: { team: { id: { eq: $teamId } } }) { ${ISSUE_FIELDS} }
          }`
        : `query CommanderIssues($first: Int!) {
            issues(first: $first) { ${ISSUE_FIELDS} }
          }`;
      const data = await linearGraphql<{ issues?: { nodes?: unknown[] } }>(
        accessToken,
        query,
        teamId ? { first, teamId } : { first },
      );
      const issues = data?.issues?.nodes ?? [];
      return {
        ok: true,
        data: { issues, count: issues.length, ...(teamId ? { teamId } : {}) },
      };
    }

    const data = await linearGraphql<{
      issueCreate?: { success?: boolean; issue?: unknown };
    }>(
      accessToken,
      `mutation CommanderIssueCreate($teamId: String!, $title: String!, $description: String) {
        issueCreate(input: { teamId: $teamId, title: $title, description: $description }) {
          success
          issue { id identifier title url }
        }
      }`,
      { teamId, title, description: description || null },
    );

    if (!data?.issueCreate?.success) {
      return { ok: false, error: 'Linear no confirmó la creación del issue.', status: 502 };
    }
    return { ok: true, data: { issue: data.issueCreate.issue ?? null } };
  } catch (error: any) {
    const status = error instanceof IntegrationError ? error.status : 502;
    return {
      ok: false,
      error: String(error?.message || 'Linear falló').slice(0, 800),
      status,
    };
  }
}
