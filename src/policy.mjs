const ROLE_RANK = { viewer: 1, member: 2, manager: 3, owner: 4, admin: 5 };

export function projectRole(project, user, directory) {
  if (!user || user.status !== "active") return null;
  if (user.system_role === "admin") return "admin";
  if (project.owner_user_id === user.id) return "owner";
  const explicit = (project.members || []).find(
    (member) => member.user_id === user.id,
  );
  if (explicit) return explicit.role;
  const inherited = (directory.teams || []).some(
    (team) =>
      (project.team_ids || []).includes(team.id) &&
      (team.member_user_ids || []).includes(user.id),
  );
  return inherited ? "member" : null;
}

export function assertProjectAccess(
  project,
  user,
  directory,
  minimum = "viewer",
) {
  const role = projectRole(project, user, directory);
  if (!role || ROLE_RANK[role] < ROLE_RANK[minimum])
    throw Object.assign(new Error("project permission denied"), {
      statusCode: 403,
    });
  return role;
}

export function isTeamLead(teamId, user, directory) {
  return Boolean(
    user &&
    directory.teams
      .find((team) => team.id === teamId)
      ?.lead_user_ids?.includes(user.id),
  );
}

export function assertWorkItemEdit({ project, item, user, directory, input }) {
  const role = assertProjectAccess(project, user, directory, "member");
  if (["admin", "owner", "manager"].includes(role)) return role;
  const assignmentFields = [
    "assignee_id",
    "reviewer_id",
    "team_id",
    "scheduled_for",
    "scheduled_time",
    "priority",
    "project_key",
  ];
  if (assignmentFields.some((field) => Object.hasOwn(input, field))) {
    const targetTeamId = input.team_id ?? item.team_id;
    if (!isTeamLead(targetTeamId, user, directory))
      throw Object.assign(
        new Error("only a manager or team lead can assign work"),
        {
          statusCode: 403,
        },
      );
    return role;
  }
  if (item.assignee_id && item.assignee_id !== user.id)
    throw Object.assign(new Error("work item is assigned to another user"), {
      statusCode: 403,
    });
  return role;
}

export function assertWorkflowTransition(item, input, user, _role) {
  if (!Object.hasOwn(input, "status") || input.status === item.status) return;
  const next = input.status;
  const allowed = {
    backlog: new Set(["planned"]),
    planned: new Set(["in_progress", "waiting"]),
    in_progress: new Set(["review", "done", "waiting"]),
    review: new Set(["done", "in_progress", "waiting"]),
    waiting: new Set(["planned", "in_progress"]),
    done: new Set(["in_progress"]),
  };
  if (!allowed[item.status]?.has(next))
    throw Object.assign(
      new Error(
        `workflow transition is not allowed: ${item.status} -> ${next}`,
      ),
      { statusCode: 409 },
    );
  const assignee = input.assignee_id ?? item.assignee_id;
  const reviewer = input.reviewer_id ?? item.reviewer_id;
  const note = String(input.transition_note || "").trim();
  if (next === "in_progress" && !assignee)
    throw Object.assign(
      new Error("assignee is required for in-progress work"),
      {
        statusCode: 409,
      },
    );
  if (next === "review" && !reviewer)
    throw Object.assign(new Error("reviewer is required for review"), {
      statusCode: 409,
    });
  if (next === "done" && reviewer) {
    if (item.status !== "review")
      throw Object.assign(new Error("reviewed work must pass through review"), {
        statusCode: 409,
      });
    if (user.id !== reviewer)
      throw Object.assign(new Error("reviewer approval is required"), {
        statusCode: 403,
      });
  }
  const reopening = item.status === "done" && next !== "done";
  const rejected = item.status === "review" && next === "in_progress";
  if ((next === "waiting" || reopening || rejected) && !note)
    throw Object.assign(new Error("transition note is required"), {
      statusCode: 409,
    });
}

export function assertAssignmentHandoff(item, input) {
  if (!new Set(["in_progress", "review", "waiting"]).has(item.status)) return;
  const changed = ["assignee_id", "team_id"].some(
    (field) =>
      Object.hasOwn(input, field) &&
      String(input[field] || "") !== String(item[field] || ""),
  );
  if (changed && !String(input.transition_note || "").trim())
    throw Object.assign(new Error("handoff note is required"), {
      statusCode: 409,
    });
}

export function visibleProjects(projects, user, directory) {
  return projects.filter((project) => projectRole(project, user, directory));
}
