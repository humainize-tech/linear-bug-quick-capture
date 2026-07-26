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
 * @property {CapturedImage[]} images
 * @property {number} updatedAt  Epoch ms, used for LRU eviction.
 */

/**
 * @typedef {Object} CreatePayload
 * @property {string} title
 * @property {string} description
 * @property {string} pageUrl
 * @property {string} projectId
 * @property {string} teamId
 * @property {CapturedImage[]} images
 */

export {};
