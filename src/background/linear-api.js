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
 * All active (non-completed) projects visible to the key, with their teams.
 * A team-scoped key simply sees fewer projects, which is the desired
 * behaviour.
 * @returns {Promise<import('../lib/types.js').Project[]>}
 */
export async function fetchProjects() {
  const data = await graphql(`
    query Projects {
      projects(first: 250, filter: { state: { neq: "completed" } }) {
        nodes {
          id
          name
          teams { nodes { id key name } }
        }
      }
    }
  `);
  return data.projects.nodes
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
 * @param {{title: string, description: string, teamId: string, projectId: string}} input
 * @returns {Promise<{identifier: string, url: string}>}
 */
export async function createIssue({ title, description, teamId, projectId }) {
  const data = await graphql(
    `
      mutation CreateIssue($input: IssueCreateInput!) {
        issueCreate(input: $input) {
          success
          issue { id identifier url }
        }
      }
    `,
    { input: { title, description, teamId, projectId } }
  );

  if (!data.issueCreate?.success || !data.issueCreate.issue) {
    throw new LinearError('Linear did not create the issue.', 'GRAPHQL');
  }
  return {
    identifier: data.issueCreate.issue.identifier,
    url: data.issueCreate.issue.url,
  };
}
