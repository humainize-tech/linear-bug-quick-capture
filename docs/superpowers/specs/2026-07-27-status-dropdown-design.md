# Status dropdown in the bug capture form

## Goal

Add a **Status** dropdown to the overlay so a bug can be filed directly into a
chosen workflow state, and make that choice sticky across consecutive captures.

## Why statuses are team-scoped

Linear attaches workflow states to **teams**, not projects. Each team defines
its own set — the defaults are Triage / Backlog / Todo / In Progress / In
Review / Done / Canceled / Duplicate, but a team can rename, reorder, add, and
remove them. A project may span several teams and has no states of its own.

The overlay already resolves exactly one team per issue (implicitly when the
project has one team, via the Team select when it has several), so the Status
options are driven by that resolved team. Changing project therefore changes
the available statuses whenever it changes the resolved team.

## Data layer

### `linear-api.js`

`fetchProjects()` becomes `fetchWorkspace()`, issuing one document with two
root fields:

```graphql
query Workspace {
  projects(first: 250, filter: { state: { neq: "completed" } }) {
    nodes { id name teams(first: 10) { nodes { id key name } } }
  }
  teams(first: 50) {
    nodes {
      id
      defaultIssueState { id }
      states(first: 50) { nodes { id name type position } }
    }
  }
}
```

Returns `{ projects, statusesByTeam }`, where `statusesByTeam` maps a team id
to `{ defaultStateId: string|null, states: WorkflowState[] }`.

`color` is deliberately not fetched: a native `<select>` cannot render
per-option colour portably, so it would be dead weight on every request.

**Ordering.** Linear groups states by category and orders within a category by
`position`. Teams can reorder states within a category but the categories
themselves are fixed, so sorting by

```js
['triage', 'backlog', 'unstarted', 'started', 'completed', 'canceled', 'duplicate']
```

then by `position` ascending reproduces the order shown in Linear. `duplicate`
is a reserved category Linear applies automatically when an issue is marked as
a duplicate.

`WorkflowState.type` is a bare `String` in the schema rather than an enum, so a
state whose type is not in the list sorts last rather than being dropped — an
unfamiliar future category still reaches the dropdown.

**Schema verification.** All field names were checked against Linear's own
published schema (`linear/linear`, `packages/sdk/src/schema.graphql`):
`Team.defaultIssueState: WorkflowState` (nullable), `Team.states(first: Int)`
(with `includeArchived` defaulting to false), `WorkflowState { id name type
position }`, and `IssueCreateInput.stateId: String` (optional). This matters
more than usual: both halves share one document, so a wrong field name in the
teams half would break project loading too.

**Query complexity.** 250 x 10 = 2,500 for projects, 50 x 50 = 2,500 for teams,
5,000 total — the same order as today's query and well under the ceiling. Both
nested connections carry an explicit `first`, per the existing comment in
`linear-api.js` explaining why an unbounded nested connection is billed at its
maximum and returns "Query too complex".

### `storage.js`

`get/set/clearCachedProjects` become `get/set/clearCachedWorkspace`, storing
`{ fetchedAt, projects, statusesByTeam }` under the existing `projectsCache`
key. Same 5-minute TTL, same invalidation on any API-key change.

One added guard: **an entry lacking `statusesByTeam` is treated as stale.**
That is the shape an in-place extension upgrade leaves behind in session
storage; without the guard the Status dropdown would come up empty until the
TTL expired.

`stickyPrefs` gains `lastStatusName`. `getStickyPrefs()` normalises
field-by-field rather than returning the stored object wholesale, so a pref
object written by the current version does not yield `undefined` for the new
field. `setStickyPrefs(projectId, teamId, statusName)`.

A **name**, not an id: the sticky value has to survive being carried to a
different team, where a state id from another team is meaningless.

### `types.js`

```js
/**
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
```

`Draft` gains `statusId: string|null`. `CreatePayload` gains
`stateId: string|null` and `statusName: string|null`.

## UI

`createModal(handlers, workspace, prefs)` — the second argument becomes
`{ projects, statusesByTeam }` rather than growing a fourth positional
parameter, matching the shape `fetchWorkspace()` returns.

A `Status` label and `<select>` are appended after Project and Team, before the
screenshot button. **No new CSS**: the existing `select` rule covers it.

`getValues()`'s inline team resolution is extracted into a `resolvedTeamId()`
helper, because `syncStatusSelect()` needs the same answer.
`syncStatusSelect()` runs at the tail of `syncTeamSelect()` (so a project
change re-populates it) and on Team change.

### Which status is preselected

In order:

1. `preferredStatusName`, matched case-insensitively against the team's states
2. the team's `defaultStateId`
3. the first state in display order

`preferredStatusName` is seeded from `prefs.lastStatusName` and **reassigned
whenever the user changes the Status dropdown**. So manually picking "In
Progress" and then switching project carries "In Progress" over, instead of
snapping back to whatever was last created. That is what stickiness should mean
mid-session.

### Empty states

When no project is selected yet, or a scoped key cannot see the resolved team's
states, the select stays **visible but disabled**, holding a single placeholder
option — "Select a project first" or "No statuses available" respectively.

Deliberately not hidden. Team hides because it is genuinely irrelevant for
single-team projects; Status always applies, and a field that appears and
disappears makes the panel jump.

### Draft and clear

- `setValues(draft)` selects `draft.statusId` after `syncStatusSelect()`, if it
  is among the current options — the same guarded pattern `teamId` uses.
- `getValues()` returns `statusId` and `statusName` alongside the rest.
- `clear()` (Discard draft) leaves Status alone, exactly as it already leaves
  Project and Team alone.
- Changing Status calls `handlers.onChange()`, so it is captured by the
  debounced draft save.

### Validation

**No new blocking error.** When a status is resolvable there is always a value;
when it is not, `stateId` is omitted from the mutation and Linear applies the
team default — precisely today's behaviour. The degenerate case cannot block a
save.

## Save path

`app.js` sends `stateId` and `statusName` in the `CREATE_ISSUE` payload and
`statusId` in the `SAVE_DRAFT` payload.

The service worker passes `stateId` to `createIssue()`, which spreads it into
`IssueCreateInput` **only when truthy**, and hands `statusName` to
`setStickyPrefs()` after a successful create.

Carrying the name in the payload rather than looking it up worker-side means an
expired or evicted cache cannot silently drop the sticky value.

## Verification

`npm run typecheck` must pass.

New items in `docs/qa-checklist.md`, under "Project and team selection":

- Status lists the resolved team's statuses, in the order Linear shows them.
- Switching to a project on a **different** team re-populates Status and keeps
  the same status *name* when that team has one.
- Switching to a team that lacks that name falls back to that team's default
  status.
- With no project selected, Status is disabled and reads "Select a project
  first".
- The last-created status is preselected when the overlay is reopened.
- A restored draft restores its status.
- The created issue lands in the chosen status in Linear.

## Out of scope

- Per-team sticky memory (a map of team id to last status). Name-matching
  covers the common case, where teams share names like Backlog and Triage.
- Colour swatches on the options; a native `<select>` cannot render them
  portably.
- Filtering completed and canceled states out of the list. All of the team's
  states are offered, in Linear's order.
