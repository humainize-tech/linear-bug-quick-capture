/**
 * Shared JSDoc typedefs. This module intentionally exports nothing at runtime.
 * @module types
 */

/**
 * @typedef {Object} Team
 * @property {string} id
 * @property {string} key   Short team key, e.g. "ENG".
 * @property {string} name
 */

/**
 * @typedef {Object} Project
 * @property {string} id
 * @property {string} name
 * @property {Team[]} teams
 */

/**
 * One of a team's workflow states. Linear scopes these to teams, never to
 * projects — a project spanning two teams offers two different sets.
 * @typedef {Object} WorkflowState
 * @property {string} id
 * @property {string} name
 * @property {string} type      'triage'|'backlog'|'unstarted'|'started'|'completed'|'canceled'
 * @property {number} position
 */

/**
 * @typedef {Object} TeamStates
 * @property {string|null} defaultStateId
 * @property {WorkflowState[]} states   Ordered as Linear orders them.
 */

/**
 * @typedef {Object} Workspace
 * @property {Project[]} projects
 * @property {Record<string, TeamStates>} statusesByTeam  Keyed by team id.
 */

/**
 * A cropped region screenshot.
 * @typedef {Object} CapturedImage
 * @property {string} dataUrl  PNG as "data:image/png;base64,..."
 * @property {number} width    Device pixels.
 * @property {number} height   Device pixels.
 */

/**
 * @typedef {Object} Draft
 * @property {string} title
 * @property {string} description
 * @property {string|null} projectId
 * @property {string|null} teamId
 * @property {string|null} statusId
 * @property {CapturedImage[]} images
 * @property {number} updatedAt  Epoch ms, used for LRU eviction.
 */

/**
 * `statusName` rides along beside `stateId` so the worker can write the sticky
 * preference without re-reading the workspace cache, which may have expired or
 * been evicted while the save was in flight.
 * @typedef {Object} CreatePayload
 * @property {string} title
 * @property {string} description
 * @property {string} pageUrl
 * @property {string} projectId
 * @property {string} teamId
 * @property {string|null} stateId
 * @property {string|null} statusName
 * @property {CapturedImage[]} images
 */

export {};
