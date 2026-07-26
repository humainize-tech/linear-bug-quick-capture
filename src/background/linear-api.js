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
    throw new LinearError('Linear rejected the API key.', 'AUTH');
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
