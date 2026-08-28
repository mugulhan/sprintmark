# Sprintmark collaboration architecture

Sprintmark 0.10 uses Google OpenID Connect for identity and a file-backed authorization model. The browser receives only an opaque `HttpOnly`, `SameSite=Lax` session cookie; Google access and refresh tokens are not stored. OAuth attempts use state, nonce and PKCE and are consumed once. All write APIs derive the actor from the server session and reject client-supplied identities.

## Ownership and access

Every project has exactly one owner. Explicit project roles are manager, member and viewer. System administrators can administer the workspace. Global teams contain leaders and members and can be linked to projects; linked team members inherit member access. Team leaders can assign work within their own team but cannot change project settings.

Work items preserve an immutable reporter and can have one assignee, one reviewer, one team and multiple followers. Project owners manage ownership, team links and explicit memberships. Managers plan and assign work. Members create and comment on work and execute work assigned to them. Viewers have read-only access.

## Workflow and review

The standard workflow is `backlog`, `planned`, `in_progress`, `review`, `waiting`, and `done`. Starting work requires an assignee. A configured reviewer makes review mandatory and only that reviewer can approve completion. Rejection, waiting, reopening and active handoff require an explanatory note. Backlog promotion preserves the work-item key and canonical URL.

## Audit and notifications

Activity events store the actor's immutable user ID, a display-name snapshot and a UTC ISO 8601 timestamp. Supported events cover creation, comments, changes, assignment, handoff, review, attachments and ownership. Collection APIs omit activity arrays; detail APIs provide the complete append-only history.

Assignments, mentions, review requests and ownership transfers create deduplicated in-app notifications. Notification state is stored per recipient and never grants access to a project by itself.

## Storage and migration

`work-items/collaboration.yml` contains users, invitations and global teams. Projects and work items use schema version 2 and 3 respectively. Sessions, OAuth attempts and per-user notifications live under `data/work-tracker/`.

The collaboration migration is dry-run by default. Apply mode copies the complete `work-items` tree to a timestamped backup before writing, maps legacy statuses and team codes, assigns the bootstrap administrator as owner/reporter, converts legacy actors without guessing a person's identity, and is idempotent.
