/**
 * Builds the markdown body sent to Linear. Pure — no I/O, no chrome APIs.
 * @module description
 */

/**
 * @param {{description: string, pageUrl: string, assetUrls: string[]}} input
 * @returns {string}
 */
export function buildDescription({ description, pageUrl, assetUrls }) {
  /** @type {string[]} */
  const blocks = [];

  const body = (description ?? '').trim();
  if (body) blocks.push(body);

  blocks.push('---');
  blocks.push(`**Page:** ${pageUrl}`);

  if (assetUrls.length) {
    blocks.push(
      assetUrls.map((u, i) => `![screenshot-${i + 1}](${u})`).join('\n')
    );
  }

  return blocks.join('\n\n');
}
