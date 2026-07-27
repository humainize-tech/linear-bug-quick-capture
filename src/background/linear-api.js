/**
 * Linear GraphQL client. Runs only in the service worker.
 * @module linear-api
 */

import { getApiKey } from '../lib/storage.js';

const ENDPOINT = 'https://api.linear.app/graphql';

/** Categorised failure, so callers can map to user-facing copy. */
export class LinearError extends Error {
  /**
   * @param {string} message
   * @param {'AUTH'|'NETWORK'|'GRAPHQL'|'UPLOAD'} code
   */
  constructor(message, code) {
    super(message);
    this.name = 'LinearError';
    this.code = code;
  }
}

/**
 * Execute a GraphQL document against Linear.
 * @param {string} query
 * @param {object} [variables]
 * @returns {Promise<any>} The `data` payload.
 */
export async function graphql(query, variables = {}) {
  const key = await getApiKey();
  if (!key) throw new LinearError('No API key set.', 'AUTH');

  let res;
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        // Linear personal API keys are sent bare, with no "Bearer " prefix.
        Authorization: key,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, variables }),
    });
  } catch {
    throw new LinearError('Could not reach Linear. Check your connection.', 'NETWORK');
  }

  if (res.status === 401 || res.status === 403) {
    // The options page recommends a *scoped* key, so a 403 is more often a
    // missing "Create issues" permission than a bad key. Naming only the key
    // sends the user off to regenerate one that was fine. The 'AUTH' code is
    // load-bearing — app.js keys its "Open settings" toast action off it.
    throw new LinearError(
      'Linear rejected the API key — it may be invalid, or missing the "Create issues" permission.',
      'AUTH'
    );
  }

  /** @type {any} */
  let body;
  try {
    body = await res.json();
  } catch {
    throw new LinearError(`Linear returned HTTP ${res.status}.`, 'GRAPHQL');
  }

  if (body.errors?.length) {
    throw new LinearError(body.errors[0].message, 'GRAPHQL');
  }
  if (!res.ok) {
    throw new LinearError(`Linear returned HTTP ${res.status}.`, 'GRAPHQL');
  }
  return body.data;
}

/**
 * @returns {Promise<{id: string, name: string, email: string, organizationName: string}>}
 */
export async function fetchViewer() {
  const data = await graphql(`
    query Viewer {
      viewer { id name email organization { name } }
    }
  `);
  return {
    id: data.viewer.id,
    name: data.viewer.name,
    email: data.viewer.email,
    organizationName: data.viewer.organization.name,
  };
}

/**
 * Linear groups workflow states by type, then orders within a group by
 * `position`. The categories themselves are fixed — a team can reorder states
 * within a category but not the categories — so this list is the whole story.
 * `duplicate` is a reserved category Linear applies automatically; it is last
 * in Linear's own ordering.
 *
 * `WorkflowState.type` is a bare `String` in the schema, not an enum, so an
 * unrecognised value sorts last rather than being dropped. A future category
 * still reaches the dropdown instead of silently vanishing from it.
 */
const STATE_TYPE_ORDER = [
  'triage',
  'backlog',
  'unstarted',
  'started',
  'completed',
  'canceled',
  'duplicate',
];

/** @param {string} type */
function stateTypeRank(type) {
  const i = STATE_TYPE_ORDER.indexOf(type);
  return i === -1 ? STATE_TYPE_ORDER.length : i;
}

/**
 * Everything the overlay needs to render its form: all active (non-completed)
 * projects with their teams, and every team's workflow states. A team-scoped
 * key simply sees fewer of both, which is the desired behaviour.
 *
 * One document rather than two requests: the two root fields are independent,
 * and the modal cannot render until it has both.
 * @returns {Promise<import('../lib/types.js').Workspace>}
 */
export async function fetchWorkspace() {
  // Every nested connection MUST carry an explicit `first`. Linear costs a
  // query by multiplying connection page sizes, and an unbounded nested
  // connection is charged at its maximum (50) — so `projects(first: 250)`
  // with a bare `teams { nodes { … } }` bills 250 × 50 = 12,500 nodes and
  // comes back "Query too complex". Bounding teams to 10 brings that half to
  // 2,500. A project spanning more than 10 teams would be truncated here,
  // which no real workspace does.
  //
  // `teams` is a second root field, not a nesting under `projects`: nesting
  // states inside the projects query would bill 250 × 10 × 50 = 125,000 and
  // fail outright. Side by side the two halves add rather than multiply —
  // 2,500 + 2,500 = 5,000.
  const data = await graphql(`
    query Workspace {
      projects(first: 250, filter: { state: { neq: "completed" } }) {
        nodes {
          id
          name
          teams(first: 10) { nodes { id key name } }
        }
      }
      teams(first: 50) {
        nodes {
          id
          defaultIssueState { id }
          states(first: 50) { nodes { id name type position } }
        }
      }
    }
  `);

  const projects = data.projects.nodes
    .map((/** @type {any} */ p) => ({
      id: p.id,
      name: p.name,
      teams: p.teams.nodes.map((/** @type {any} */ t) => ({
        id: t.id,
        key: t.key,
        name: t.name,
      })),
    }))
    .sort((/** @type {any} */ a, /** @type {any} */ b) =>
      a.name.localeCompare(b.name)
    );

  /** @type {Record<string, import('../lib/types.js').TeamStates>} */
  const statusesByTeam = {};
  for (const team of data.teams.nodes) {
    statusesByTeam[team.id] = {
      defaultStateId: team.defaultIssueState?.id ?? null,
      states: team.states.nodes
        .map((/** @type {any} */ s) => ({
          id: s.id,
          name: s.name,
          type: s.type,
          position: s.position,
        }))
        .sort(
          (
            /** @type {import('../lib/types.js').WorkflowState} */ a,
            /** @type {import('../lib/types.js').WorkflowState} */ b
          ) =>
            stateTypeRank(a.type) - stateTypeRank(b.type) ||
            a.position - b.position
        ),
    };
  }

  return { projects, statusesByTeam };
}

/**
 * Upload one image to Linear's asset storage and return its permanent
 * asset URL.
 *
 * The signed URL expires 60 seconds after `fileUpload` returns, and every
 * header Linear hands back is part of the signature — omitting or
 * re-casing any of them yields HTTP 403. So: prepare, then immediately PUT
 * the raw bytes with those exact headers. Callers must never prepare a
 * second upload before this one resolves.
 *
 * @param {string} dataUrl  "data:image/png;base64,..."
 * @param {string} filename
 * @returns {Promise<string>} assetUrl
 */
export async function uploadImage(dataUrl, filename) {
  // fetch() on a data: URL is the cheapest way to raw bytes in a worker.
  const blob = await (await fetch(dataUrl)).blob();
  const contentType = blob.type || 'image/png';

  const data = await graphql(
    `
      mutation FileUpload($contentType: String!, $filename: String!, $size: Int!) {
        fileUpload(contentType: $contentType, filename: $filename, size: $size) {
          success
          uploadFile {
            uploadUrl
            assetUrl
            headers { key value }
          }
        }
      }
    `,
    { contentType, filename, size: blob.size }
  );

  const payload = data.fileUpload;
  if (!payload?.success || !payload.uploadFile) {
    throw new LinearError('Linear refused to prepare the upload.', 'UPLOAD');
  }

  const { uploadUrl, assetUrl, headers } = payload.uploadFile;

  /** @type {Record<string, string>} */
  const signed = {};
  for (const h of headers ?? []) signed[h.key] = h.value;

  let res;
  try {
    res = await fetch(uploadUrl, { method: 'PUT', headers: signed, body: blob });
  } catch {
    throw new LinearError('Could not reach Linear to upload the screenshot.', 'NETWORK');
  }

  if (!res.ok) {
    const hint =
      res.status === 403
        ? ' The signed URL may have expired, or a required header was altered.'
        : '';
    throw new LinearError(`Screenshot upload failed (HTTP ${res.status}).${hint}`, 'UPLOAD');
  }

  return assetUrl;
}

/**
 * @param {{title: string, description: string, teamId: string, projectId: string, stateId?: string|null}} input
 * @returns {Promise<{identifier: string, url: string}>}
 */
export async function createIssue({
  title,
  description,
  teamId,
  projectId,
  stateId,
}) {
  const data = await graphql(
    `
      mutation CreateIssue($input: IssueCreateInput!) {
        issueCreate(input: $input) {
          success
          issue { id identifier url }
        }
      }
    `,
    {
      // Omitted rather than sent as null when the overlay could not resolve a
      // status — Linear then applies the team's own default, which is the
      // behaviour this extension had before the Status field existed.
      input: { title, description, teamId, projectId, ...(stateId ? { stateId } : {}) },
    }
  );

  if (!data.issueCreate?.success || !data.issueCreate.issue) {
    throw new LinearError('Linear did not create the issue.', 'GRAPHQL');
  }
  return {
    identifier: data.issueCreate.issue.identifier,
    url: data.issueCreate.issue.url,
  };
}
