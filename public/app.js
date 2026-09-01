import { locale, t, tp, translateDocument } from "./i18n.js";
import {
  matchWorkItemCommand,
  searchWorkItemReferences,
  WORK_ITEM_KEY_PATTERN,
  workItemKeyFromHref,
  workItemReferenceHref,
} from "./work-item-references.js";
import { formatEffort, formatElapsed, parseEffort } from "./durations.js";

const initialView = location.pathname.startsWith("/projects")
  ? "projects"
  : location.pathname.startsWith("/backlog")
    ? "backlog"
    : "calendar";
const state = {
  session: null,
  authMode: null,
  setup: null,
  users: [],
  collaboratorsByProject: {},
  teams: [],
  notifications: [],
  notificationEtag: null,
  projects: [],
  selectedProject: null,
  projectIndex:
    location.pathname === "/projects" || location.pathname === "/projects/",
  projectSection: "overview",
  projectDocuments: [],
  activeProjectDocument: null,
  documentSections: [],
  activeDocumentSection: 0,
  items: [],
  sprints: [],
  view: initialView,
  month: new Date(),
  selected: null,
  fileReferences: [],
  draggingUid: null,
  suppressCardClick: false,
  createOpening: false,
  itemOpenRequest: 0,
  expandedDays: new Set(),
  sprintSelection: { active: false, start: null },
  detailEditor: null,
  detailViewer: null,
  activityEditor: null,
  activityViewers: [],
  documentPreviewViewer: null,
  createEditor: null,
  createDraftId: null,
  editDraftId: null,
  createContext: null,
  meta: null,
  editingWorkItem: false,
  detailDirty: false,
  returnPath: "/",
  itemTrail: [],
  suppressDetailHistory: false,
  editFollowerIds: new Set(),
  projectInsights: null,
  insightProjectKey: null,
  insightFilter: "all",
  insightSort: "updated",
  insightPage: 1,
  insightsExpanded: false,
  referencePreviewTimer: null,
};
const $ = (id) => document.getElementById(id);
const nativeFetch = window.fetch.bind(window);
async function apiFetch(input, init = {}) {
  const options = { ...init, headers: new window.Headers(init.headers || {}) };
  if (
    state.session?.csrf_token &&
    !["GET", "HEAD", "OPTIONS"].includes(
      String(options.method || "GET").toUpperCase(),
    )
  )
    options.headers.set("X-CSRF-Token", state.session.csrf_token);
  const response = await nativeFetch(input, options);
  if (response.status === 401 && !String(input).includes("/api/v1/session"))
    renderLogin();
  return response;
}
function renderLogin(authMode = state.authMode || "google") {
  state.session = null;
  state.authMode = authMode;
  const local = authMode === "local";
  renderAccessView(
    `
    <div class="access-panel access-login">
      <div class="access-story">
        <span class="access-kicker">${t("auth.workspaceKicker")}</span>
        <h2>${t("auth.workspaceTitle")}</h2>
        <p>${t("auth.workspaceDescription")}</p>
        <ul class="access-benefits">
          <li><strong>${t("auth.benefitPlanTitle")}</strong><span>${t("auth.benefitPlanText")}</span></li>
          <li><strong>${t("auth.benefitHistoryTitle")}</strong><span>${t("auth.benefitHistoryText")}</span></li>
          <li><strong>${t("auth.benefitDocsTitle")}</strong><span>${t("auth.benefitDocsText")}</span></li>
        </ul>
      </div>
      <div class="access-action">
        ${accessLocaleControl()}
        <img src="/sprintmark-mark.svg" alt="" width="58" height="58" />
        <span class="access-kicker">${local ? t("auth.localMode") : t("auth.googleMode")}</span>
        <h1>${t("auth.welcome")}</h1>
        <p>${t(local ? "auth.localDescription" : "auth.googleDescription")}</p>
        <a class="primary button-link access-primary" href="${local ? "/auth/local/start" : "/auth/google/start"}">${t(local ? "auth.continueLocal" : "auth.continueGoogle")}</a>
        <small class="access-security">${t(local ? "auth.localSecurity" : "auth.googleSecurity")}</small>
      </div>
    </div>`,
    "login",
  );
}

function accessLocaleControl() {
  return `<label class="access-locale"><span>${t("locale.label")}</span><select data-access-locale><option value="tr"${locale() === "tr" ? " selected" : ""}>TR</option><option value="en"${locale() === "en" ? " selected" : ""}>EN</option></select></label>`;
}

function renderAccessView(content, kind) {
  document.body.classList.add("auth-required-view");
  document.body.dataset.access = kind;
  $("accountMenu").hidden = true;
  $("notificationPanel").hidden = true;
  for (const id of ["calendarView", "backlogView", "projectsView"])
    $(id).hidden = true;
  const access = $("accessView");
  access.innerHTML = content;
  access.hidden = false;
  access
    .querySelector("[data-access-locale]")
    ?.addEventListener("change", (event) => {
      window.localStorage.setItem("sprintmark-locale", event.target.value);
      document.documentElement.lang = event.target.value;
      if (state.setup) renderSetup(state.setup);
      else renderLogin(state.authMode);
    });
  document.documentElement.classList.add("i18n-ready");
  document.body.classList.remove("app-loading");
}

function renderSetup(metadata) {
  state.setup = metadata;
  const redirectUri = escapeHtml(metadata.redirect_uri);
  const defaults = metadata.defaults || {};
  renderAccessView(
    `
    <div class="access-panel setup-wizard">
      <div class="access-story setup-story">
        <span class="access-kicker">${t("setup.firstRun")}</span>
        <h2>${t("setup.storyTitle")}</h2>
        <p>${t("setup.storyDescription")}</p>
        <ol class="setup-steps" aria-label="${t("setup.stepsLabel")}">
          <li class="active"><span>1</span><div><strong>${t("setup.stepMode")}</strong><small>${t("setup.stepModeText")}</small></div></li>
          <li><span>2</span><div><strong>${t("setup.stepIdentity")}</strong><small>${t("setup.stepIdentityText")}</small></div></li>
          <li><span>3</span><div><strong>${t("setup.stepReady")}</strong><small>${t("setup.stepReadyText")}</small></div></li>
        </ol>
        <div class="setup-safe"><strong>${t("setup.safeTitle")}</strong><p>${t("setup.safeText")}</p></div>
      </div>
      <div class="access-action setup-action">
        ${accessLocaleControl()}
        <div class="setup-heading"><span class="access-kicker">${t("setup.configure")}</span><h1>${t("setup.title")}</h1><p>${t("setup.description")}</p></div>
        <form id="setupForm" class="setup-form">
          <fieldset class="mode-picker">
            <legend>${t("setup.modeLegend")}</legend>
            <label class="mode-option"><input type="radio" name="mode" value="local" checked /><span><strong>${t("setup.localTitle")}</strong><small>${t("setup.localText")}</small><em>${t("setup.recommended")}</em></span></label>
            <label class="mode-option"><input type="radio" name="mode" value="google" /><span><strong>${t("setup.googleTitle")}</strong><small>${t("setup.googleText")}</small></span></label>
          </fieldset>
          <div data-setup-panel="local" class="setup-fields">
            <label><span>${t("setup.localName")}</span><input name="local_name" autocomplete="name" required value="${escapeHtml(defaults.local_name || "Local user")}" /></label>
            <label><span>${t("setup.localEmail")}</span><input name="local_email" type="email" autocomplete="email" required value="${escapeHtml(defaults.local_email || "local@sprintmark.invalid")}" /></label>
            <p class="field-help">${t("setup.localHelp")}</p>
          </div>
          <div data-setup-panel="google" class="setup-fields" hidden>
            <a class="setup-console-link" href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener noreferrer">${t("setup.openGoogleConsole")} <span aria-hidden="true">↗</span></a>
            <label><span>${t("setup.clientId")}</span><input name="client_id" autocomplete="off" placeholder="123…apps.googleusercontent.com" /></label>
            <label><span>${t("setup.clientSecret")}</span><span class="secret-field"><input name="client_secret" type="password" autocomplete="new-password" /><button type="button" data-toggle-secret aria-label="${t("setup.toggleSecret")}">${t("setup.show")}</button></span></label>
            <label><span>${t("setup.adminEmails")}</span><input name="admin_emails" autocomplete="email" placeholder="owner@example.com" /></label>
            <div class="redirect-callout"><span>${t("setup.redirectUri")}</span><code>${redirectUri}</code><button type="button" data-copy-redirect>${t("setup.copy")}</button></div>
            <p class="field-help">${t("setup.googleHelp")}</p>
          </div>
          <input type="hidden" name="timezone" value="${escapeHtml(defaults.timezone || "Europe/Istanbul")}" />
          <input type="hidden" name="locale" value="${locale()}" />
          <div id="setupMessage" class="setup-message" role="status" aria-live="polite"></div>
          <button class="primary setup-submit" type="submit">${t("setup.save")}</button>
          <small class="setup-persist">${t("setup.persist")}</small>
        </form>
      </div>
    </div>`,
    "setup",
  );
  const form = $("setupForm");
  const updateMode = () => {
    const mode = new FormData(form).get("mode");
    form.querySelectorAll("[data-setup-panel]").forEach((panel) => {
      panel.hidden = panel.dataset.setupPanel !== mode;
      panel.querySelectorAll("input").forEach((input) => {
        input.required =
          (mode === "google" &&
            ["client_id", "client_secret", "admin_emails"].includes(
              input.name,
            )) ||
          (mode === "local" &&
            ["local_name", "local_email"].includes(input.name));
      });
    });
  };
  form
    .querySelectorAll('input[name="mode"]')
    .forEach((input) => input.addEventListener("change", updateMode));
  form
    .querySelector("[data-toggle-secret]")
    .addEventListener("click", (event) => {
      const input = form.elements.client_secret;
      input.type = input.type === "password" ? "text" : "password";
      event.currentTarget.textContent =
        input.type === "password" ? t("setup.show") : t("setup.hide");
    });
  form
    .querySelector("[data-copy-redirect]")
    .addEventListener("click", async () => {
      await navigator.clipboard.writeText(metadata.redirect_uri);
      $("setupMessage").textContent = t("setup.copied");
    });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = form.querySelector('[type="submit"]');
    const message = $("setupMessage");
    submit.disabled = true;
    submit.textContent = t("setup.saving");
    message.className = "setup-message";
    message.textContent = "";
    const values = Object.fromEntries(new FormData(form));
    try {
      const response = await nativeFetch("/api/v1/setup", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Setup-Token": metadata.setup_token,
        },
        body: JSON.stringify(values),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || t("setup.failed"));
      message.className = "setup-message success";
      message.textContent = t("setup.complete");
      window.setTimeout(() => location.assign(result.login_url), 350);
    } catch (error) {
      message.className = "setup-message error";
      message.textContent = error.message;
      submit.disabled = false;
      submit.textContent = t("setup.save");
    }
  });
  updateMode();
}
function renderAccount() {
  if (!state.session?.user) return;
  document.body.classList.remove("auth-required-view");
  delete document.body.dataset.access;
  state.setup = null;
  $("accessView").hidden = true;
  applyViewShell(state.view);
  document.documentElement.classList.add("i18n-ready");
  $("accountMenu").hidden = false;
  $("accountName").textContent = state.session.user.display_name;
  $("notificationCount").textContent = String(
    state.notifications.filter((item) => !item.read_at).length,
  );
  $("notificationPanel").innerHTML = state.notifications.length
    ? state.notifications
        .map(
          (item) =>
            `<a href="${escapeHtml(item.url)}" data-notification-id="${escapeHtml(item.id)}"><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(localDateTime(item.created_at))} · ${escapeHtml(relativeElapsed(item.created_at))}</small></a>`,
        )
        .join("")
    : "<p>No notifications.</p>";
}
function applyViewShell(view) {
  document.body.dataset.view = view;
  $("calendarView").hidden = view !== "calendar";
  $("backlogView").hidden = view !== "backlog";
  $("projectsView").hidden = view !== "projects";
  document
    .querySelectorAll(".nav")
    .forEach((nav) =>
      nav.classList.toggle("active", nav.dataset.view === view),
    );
}
applyViewShell(state.view);
translateDocument();
const escapeHtml = (v) =>
  String(v ?? "").replace(
    /[&<>\"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );
const teamName = (value) =>
  state.teams.find((team) => team.id === value || team.code === value)?.name ||
  t(
    value === "web-development" || value === "team-web-development"
      ? "team.webDevelopment"
      : "team.contentTechnical",
  );
const statusName = (value) =>
  t(
    {
      open: "status.open",
      done: "status.done",
      triage: "status.triage",
      software: "status.software",
      waiting: "status.waiting",
      planned: "status.planned",
      backlog: "status.triage",
      in_progress: "status.inProgress",
      review: "status.review",
      active: "status.active",
      completed: "status.done",
    }[value] || value,
  );
const sprintStatusName = statusName;
const priorityName = (value) =>
  t(
    {
      critical: "priority.critical",
      high: "priority.high",
      medium: "priority.medium",
      low: "priority.low",
    }[value] || "priority.unspecified",
  );
const priorityRank = (v) =>
  ({ critical: 0, high: 1, medium: 2, low: 3, null: 4 })[v ?? "null"] ?? 4;
const localDateTime = (value) =>
  value
    ? new Intl.DateTimeFormat(document.documentElement.lang || "tr", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: state.meta?.timezone,
      }).format(new Date(value))
    : "—";
const relativeElapsed = (value) => {
  if (!value) return "";
  const elapsedSeconds = Math.round((Date.now() - Date.parse(value)) / 1000);
  const units = [
    ["year", 31536000],
    ["month", 2592000],
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
    ["second", 1],
  ];
  const [unit, seconds] =
    units.find(([, threshold]) => Math.abs(elapsedSeconds) >= threshold) ||
    units.at(-1);
  return new Intl.RelativeTimeFormat(document.documentElement.lang || "tr", {
    numeric: "auto",
  }).format(-Math.round(elapsedSeconds / seconds), unit);
};
const language = () => document.documentElement.lang || "en";
const initials = (name) =>
  String(name || "?")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toLocaleUpperCase(language()) || "")
    .join("");
function avatar(user, size = "small") {
  const name = user?.display_name || t("activity.actorUser");
  const content = user?.avatar_url
    ? `<img src="${escapeHtml(user.avatar_url)}" alt="" loading="lazy">`
    : `<span aria-hidden="true">${escapeHtml(initials(name))}</span>`;
  return `<span class="user-avatar avatar-${size}" title="${escapeHtml(name)}">${content}</span>`;
}
function projectCollaborators(projectKey = state.selectedProject) {
  return (
    state.collaboratorsByProject[projectKey] ||
    [state.session?.user, ...state.users].filter(
      (user, index, items) =>
        user &&
        items.findIndex((candidate) => candidate?.id === user.id) === index,
    )
  );
}
function userById(id, projectKey = state.selectedProject) {
  return (
    projectCollaborators(projectKey).find((user) => user.id === id) || null
  );
}
function durationFromItem(item) {
  if (!item?.started_at) return null;
  const end = item.completed_at ? Date.parse(item.completed_at) : Date.now();
  const start = Date.parse(item.started_at);
  return end >= start ? Math.round((end - start) / 60000) : null;
}
const workItemStatuses = (item) => [
  ...new Set([
    item.status,
    ...({
      backlog: ["planned"],
      planned: ["in_progress", "waiting"],
      in_progress: ["review", "done", "waiting"],
      review: ["done", "in_progress", "waiting"],
      waiting: ["planned", "in_progress"],
      done: ["in_progress"],
    }[item.status] || []),
  ]),
];
const canonical = (item) => `/work-items/${item.key}/${item.slug}`;
const projectCanonical = (project) =>
  `/projects/${project.key}/${project.slug}`;
const viewCanonical = (view, project = currentProject()) => {
  if (view === "projects")
    return state.projectIndex || !project
      ? "/projects/"
      : projectCanonical(project);
  const projectQuery = project
    ? `?project=${encodeURIComponent(project.key)}`
    : "";
  return `/${view === "backlog" ? "backlog" : "calendar"}${projectQuery}`;
};
const currentProject = () =>
  state.projects.find((project) => project.key === state.selectedProject);
const projectSprints = () =>
  state.sprints.filter(
    (sprint) => sprint.project_key === state.selectedProject,
  );
function returnPathContext() {
  if (!state.returnPath || state.returnPath === "/") return null;
  const path = new URL(state.returnPath, location.origin);
  if (path.pathname.startsWith("/backlog"))
    return { label: t("breadcrumb.backlog"), href: viewCanonical("backlog") };
  if (path.pathname.startsWith("/calendar"))
    return {
      label: t("breadcrumb.calendar"),
      href: viewCanonical("calendar"),
    };
  if (path.pathname.startsWith("/projects/")) {
    const documents = path.searchParams.get("tab") === "documents";
    return {
      label: t(documents ? "breadcrumb.documents" : "breadcrumb.overview"),
      href: `${projectCanonical(currentProject())}${documents ? "?tab=documents" : ""}`,
    };
  }
  return null;
}
function renderDetailBack() {
  const key = state.itemTrail.at(-1);
  const button = $("detailBack");
  button.hidden = !key;
  if (!key) {
    $("detailBackLabel").textContent = "";
    return;
  }
  $("detailBackLabel").textContent = key;
  button.setAttribute("aria-label", t("reference.backTo", { key }));
  button.title = t("reference.backTo", { key });
}
function breadcrumbItems() {
  const project = currentProject();
  const items = [
    {
      label: t("breadcrumb.projects"),
      href: "/projects/",
      current: state.projectIndex && !state.selected,
    },
  ];
  if (!project || items[0].current) return items;
  items.push({ label: project.name, href: projectCanonical(project) });
  const itemOpen =
    Boolean(state.selected) && location.pathname.startsWith("/work-items/");
  if (itemOpen) {
    const context = returnPathContext();
    if (context) items.push(context);
    items.push({ label: state.selected.key, current: true });
    return items;
  }
  items.push({
    label: t(
      state.view === "calendar"
        ? "breadcrumb.calendar"
        : state.view === "backlog"
          ? "breadcrumb.backlog"
          : state.projectSection === "documents"
            ? "breadcrumb.documents"
            : state.projectSection === "people"
              ? "breadcrumb.people"
              : "breadcrumb.overview",
    ),
    current: true,
  });
  return items;
}
function renderBreadcrumb() {
  const breadcrumb = $("breadcrumb");
  breadcrumb.setAttribute("aria-label", t("breadcrumb.label"));
  breadcrumb.innerHTML = breadcrumbItems()
    .map((item) => {
      const label = escapeHtml(item.label);
      return item.current
        ? `<span class="breadcrumb-current" aria-current="page" title="${label}">${label}</span>`
        : `<a href="${escapeHtml(item.href)}" title="${label}">${label}</a>`;
    })
    .join('<span class="breadcrumb-separator" aria-hidden="true">/</span>');
}
function updateDocumentTitle(item = null) {
  if (item) {
    document.title = `${item.title} · ${item.key} · Sprintmark`;
    return;
  }
  document.title = `${currentProject()?.name || t("breadcrumb.projects")} · Sprintmark`;
}
function renderStatusOptions() {
  const selected = $("statusFilter").value;
  const statuses = [...new Set(state.items.map((item) => item.status))];
  $("statusFilter").innerHTML =
    `<option value="">${t("filters.allStatuses")}</option>` +
    statuses
      .map(
        (status) => `<option value="${status}">${statusName(status)}</option>`,
      )
      .join("");
  $("statusFilter").value = selected;
  const selectedTeam = $("teamFilter").value;
  $("teamFilter").innerHTML =
    `<option value="">${t("filters.allTeams")}</option>` +
    state.teams
      .map(
        (team) =>
          `<option value="${escapeHtml(team.id)}">${escapeHtml(team.name)}</option>`,
      )
      .join("");
  $("teamFilter").value = selectedTeam;
}
function renderBuildMeta() {
  if (!state.meta) return;
  $("buildMeta").textContent = `v${state.meta.version}`;
  $("buildMeta").setAttribute(
    "aria-label",
    t("app.versionLabel", { version: state.meta.version }),
  );
  $("buildMeta").dataset.branch = state.meta.branch;
  $("buildMeta").dataset.commit = state.meta.sha;
  $("buildMeta").dataset.dirty = String(Boolean(state.meta.dirty));
}

const editorToolbar = [
  ["heading", "bold", "italic", "strike"],
  ["quote", "ul", "ol"],
  ["table", "link", "image"],
  ["code", "codeblock"],
];
const activityEditorToolbar = [
  ["heading", "bold", "italic", "strike"],
  ["quote", "ul", "ol"],
  ["table", "link"],
  ["code", "codeblock"],
];
let referencePickerId = 0;

function editorContentElement(element) {
  return (
    element.querySelector(".toastui-editor-ww-container .ProseMirror") ||
    element.querySelector('.ProseMirror[contenteditable="true"]')
  );
}

function editorCommandBeforeCursor(element) {
  const content = editorContentElement(element);
  const selection = window.getSelection();
  if (!content || !selection?.rangeCount || !selection.isCollapsed) return null;
  const anchor = selection.anchorNode;
  if (!anchor || !content.contains(anchor)) return null;
  const parent =
    anchor.nodeType === window.Node.ELEMENT_NODE
      ? anchor
      : anchor.parentElement;
  if (parent?.closest("a, code, pre")) return null;
  const block =
    parent?.closest("p, li, h1, h2, h3, h4, h5, h6, blockquote") || content;
  const range = document.createRange();
  range.selectNodeContents(block);
  try {
    range.setEnd(anchor, selection.anchorOffset);
  } catch {
    return null;
  }
  return matchWorkItemCommand(range.toString());
}

function attachWorkItemReferencePicker(editor, element) {
  const picker = document.createElement("div");
  const pickerId = `workReferencePicker${++referencePickerId}`;
  picker.id = pickerId;
  picker.className = "work-reference-picker";
  picker.setAttribute("role", "listbox");
  picker.setAttribute("aria-label", t("reference.results"));
  picker.hidden = true;
  element.classList.add("reference-editor-host");
  element.append(picker);
  const content = editorContentElement(element);
  if (!content) return { destroy() {} };
  content.setAttribute("aria-autocomplete", "list");
  content.setAttribute("aria-controls", pickerId);
  content.setAttribute("aria-expanded", "false");
  let results = [];
  let activeIndex = 0;
  let commandRange = null;

  const hide = () => {
    picker.hidden = true;
    picker.innerHTML = "";
    content.setAttribute("aria-expanded", "false");
    content.removeAttribute("aria-activedescendant");
    results = [];
    commandRange = null;
  };
  const render = () => {
    picker.innerHTML = results.length
      ? results
          .map((item, index) => {
            const project =
              state.projects.find(
                (candidate) => candidate.key === item.project_key,
              )?.name || item.project_key;
            return `<button type="button" role="option" id="${pickerId}Option${index}" data-reference-result="${escapeHtml(item.key)}" aria-selected="${index === activeIndex}"><strong>${escapeHtml(item.key)}</strong><span>${escapeHtml(item.title)}</span><small>${escapeHtml(project)} · ${escapeHtml(statusName(item.status))}</small></button>`;
          })
          .join("")
      : `<p class="work-reference-empty">${escapeHtml(t("reference.noResults"))}</p>`;
    content.setAttribute("aria-expanded", "true");
    if (results.length)
      content.setAttribute(
        "aria-activedescendant",
        `${pickerId}Option${activeIndex}`,
      );
    else content.removeAttribute("aria-activedescendant");
    picker.hidden = false;
    const selection = window.getSelection();
    if (selection?.rangeCount) {
      const caret = selection.getRangeAt(0).getBoundingClientRect();
      const host = element.getBoundingClientRect();
      const pickerBounds = picker.getBoundingClientRect();
      picker.style.left = `${Math.max(8, Math.min(caret.left - host.left, host.width - pickerBounds.width - 8))}px`;
      const below = caret.bottom - host.top + 8;
      picker.style.top = `${below + pickerBounds.height <= host.height ? below : Math.max(8, caret.top - host.top - pickerBounds.height - 8)}px`;
    }
  };
  const update = () => {
    const command = editorCommandBeforeCursor(element);
    const selection = editor.getSelection();
    if (!command || !Array.isArray(selection)) return hide();
    const end = selection[1];
    commandRange = { start: end - command.command.length, end };
    results = searchWorkItemReferences(
      state.items,
      state.projects,
      command.query,
      {
        excludeKey: state.editingWorkItem ? state.selected?.key : null,
      },
    );
    activeIndex = Math.min(activeIndex, Math.max(0, results.length - 1));
    render();
  };
  const selectResult = (item) => {
    if (!item || !commandRange) return;
    const start = commandRange.start;
    editor.replaceSelection(item.key, start, commandRange.end);
    editor.setSelection(start, start + item.key.length);
    editor.exec("addLink", { linkUrl: workItemReferenceHref(item.key) });
    editor.setSelection(start + item.key.length);
    hide();
    editor.focus();
  };
  const onInput = () => window.requestAnimationFrame(update);
  const onKeydown = (event) => {
    if (picker.hidden) {
      if (event.key === "Escape") hide();
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (!results.length) return;
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      activeIndex = (activeIndex + direction + results.length) % results.length;
      render();
      picker
        .querySelector(`[data-reference-result="${results[activeIndex].key}"]`)
        ?.scrollIntoView({ block: "nearest" });
      return;
    }
    if (event.key === "Enter" && results.length) {
      event.preventDefault();
      event.stopPropagation();
      selectResult(results[activeIndex]);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      hide();
    }
  };
  const onPointerdown = (event) => {
    const option = event.target.closest("[data-reference-result]");
    if (!option) return;
    event.preventDefault();
    selectResult(
      results.find((item) => item.key === option.dataset.referenceResult),
    );
  };
  content.addEventListener("input", onInput);
  content.addEventListener("keyup", onInput);
  content.addEventListener("compositionend", onInput);
  content.addEventListener("keydown", onKeydown, true);
  picker.addEventListener("pointerdown", onPointerdown);
  editor.on("change", onInput);
  return {
    destroy() {
      content.removeEventListener("input", onInput);
      content.removeEventListener("keyup", onInput);
      content.removeEventListener("compositionend", onInput);
      content.removeEventListener("keydown", onKeydown, true);
      picker.removeEventListener("pointerdown", onPointerdown);
      picker.remove();
      element.classList.remove("reference-editor-host");
    },
  };
}

function sanitizeEditorHtml(html) {
  return window.DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
}
function makeEditor(
  element,
  initialValue = "",
  height = "430px",
  onChange = null,
  imageUploader = null,
  toolbarItems = editorToolbar,
  placeholder = "",
) {
  const editor = new window.toastui.Editor({
    el: element,
    height,
    initialEditType: "wysiwyg",
    previewStyle: "vertical",
    hideModeSwitch: true,
    usageStatistics: false,
    autofocus: false,
    initialValue,
    placeholder,
    toolbarItems,
    customHTMLSanitizer: sanitizeEditorHtml,
    hooks: imageUploader
      ? {
          addImageBlobHook: async (blob, callback) => {
            try {
              const result = await imageUploader(blob, "body");
              callback(
                result.attachment.url,
                result.attachment.alt || blob.name || "Image",
              );
            } catch (error) {
              alert(error.message);
            }
          },
        }
      : undefined,
  });
  const referencePicker = attachWorkItemReferencePicker(editor, element);
  const hidePopup = () => {
    editor.eventEmitter.emit("closePopup");
    element
      .querySelectorAll(".toastui-editor-popup")
      .forEach((popup) => (popup.style.display = "none"));
  };
  const closePopup = (event) => {
    if (event.type === "keydown" && event.key !== "Escape") return;
    if (
      event.type !== "keydown" &&
      event.target.closest(".toastui-editor-popup, .toastui-editor-toolbar")
    )
      return;
    if (event.type !== "keydown") window.requestAnimationFrame(hidePopup);
    else hidePopup();
  };
  element.addEventListener("pointerdown", closePopup, true);
  element.addEventListener("click", closePopup, true);
  element.addEventListener("keydown", closePopup, true);
  const destroy = editor.destroy.bind(editor);
  editor.destroy = () => {
    referencePicker.destroy();
    element.removeEventListener("pointerdown", closePopup, true);
    element.removeEventListener("click", closePopup, true);
    element.removeEventListener("keydown", closePopup, true);
    destroy();
  };
  editor.on("focus", hidePopup);
  if (onChange) editor.on("change", onChange);
  return editor;
}
function openLinksInNewTab(root) {
  for (const link of root.querySelectorAll("a")) {
    if (workItemKeyFromHref(link.href, location.origin)) {
      link.removeAttribute("target");
      link.removeAttribute("rel");
      continue;
    }
    link.target = "_blank";
    link.rel = "noopener noreferrer";
  }
}

function workItemReferenceLink(item, key = item?.key) {
  const link = document.createElement("a");
  link.href = workItemReferenceHref(key);
  link.className = "work-item-reference";
  link.dataset.workItemKey = key;
  const keyPart = document.createElement("strong");
  keyPart.textContent = key;
  link.append(keyPart);
  if (item) {
    const title = document.createElement("span");
    title.textContent = `· ${item.title}`;
    link.append(title);
    link.setAttribute(
      "aria-label",
      t("reference.openNamed", { key: item.key, title: item.title }),
    );
  } else {
    link.classList.add("is-unavailable");
    link.setAttribute("aria-label", t("reference.unavailableNamed", { key }));
  }
  return link;
}

function decorateWorkItemReferences(root) {
  const items = new Map(state.items.map((item) => [item.key, item]));
  const textNodes = [];
  const walker = document.createTreeWalker(root, window.NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.textContent?.match(WORK_ITEM_KEY_PATTERN))
        return window.NodeFilter.FILTER_REJECT;
      if (
        node.parentElement?.closest(
          "a, code, pre, script, style, textarea, input, button",
        )
      )
        return window.NodeFilter.FILTER_REJECT;
      return window.NodeFilter.FILTER_ACCEPT;
    },
  });
  while (walker.nextNode()) textNodes.push(walker.currentNode);
  for (const node of textNodes) {
    const text = node.textContent;
    const matcher = new RegExp(WORK_ITEM_KEY_PATTERN.source, "gi");
    let cursor = 0;
    let matched = false;
    const fragment = document.createDocumentFragment();
    for (const match of text.matchAll(matcher)) {
      const key = match[1].toUpperCase();
      const item = items.get(key);
      if (!item) continue;
      matched = true;
      fragment.append(text.slice(cursor, match.index));
      fragment.append(workItemReferenceLink(item));
      cursor = match.index + match[0].length;
    }
    if (!matched) continue;
    fragment.append(text.slice(cursor));
    node.replaceWith(fragment);
  }
  for (const link of root.querySelectorAll("a")) {
    const key = workItemKeyFromHref(link.href, location.origin);
    if (!key || link.classList.contains("work-item-reference")) continue;
    link.replaceWith(workItemReferenceLink(items.get(key), key));
  }
}

function referencePreview() {
  let preview = $("workReferencePreview");
  if (preview) return preview;
  preview = document.createElement("div");
  preview.id = "workReferencePreview";
  preview.className = "work-reference-preview";
  preview.setAttribute("role", "tooltip");
  preview.hidden = true;
  document.body.append(preview);
  return preview;
}

function hideReferencePreview() {
  window.clearTimeout(state.referencePreviewTimer);
  state.referencePreviewTimer = null;
  const preview = $("workReferencePreview");
  if (preview) preview.hidden = true;
}

function showReferencePreview(link) {
  hideReferencePreview();
  const item = state.items.find(
    (candidate) => candidate.key === link.dataset.workItemKey,
  );
  if (!item) return;
  state.referencePreviewTimer = window.setTimeout(() => {
    const preview = referencePreview();
    const project =
      state.projects.find((candidate) => candidate.key === item.project_key)
        ?.name || item.project_key;
    preview.innerHTML = `<strong>${escapeHtml(item.key)}</strong><span>${escapeHtml(item.title)}</span><small>${escapeHtml(project)} · ${escapeHtml(statusName(item.status))} · ${escapeHtml(priorityName(item.priority))} · ${escapeHtml(teamName(item.team_id || item.team))}</small>`;
    preview.hidden = false;
    const bounds = link.getBoundingClientRect();
    const previewBounds = preview.getBoundingClientRect();
    const left = Math.min(
      window.innerWidth - previewBounds.width - 12,
      Math.max(12, bounds.left),
    );
    const below = bounds.bottom + 8;
    const top =
      below + previewBounds.height < window.innerHeight - 12
        ? below
        : Math.max(12, bounds.top - previewBounds.height - 8);
    preview.style.left = `${left}px`;
    preview.style.top = `${top}px`;
  }, 240);
}
function linkWorkspaceReferences(root) {
  const references = new Map(
    state.fileReferences.map((reference) => [reference.path, reference]),
  );
  for (const code of root.querySelectorAll("code")) {
    if (code.closest("pre, a")) continue;
    const reference = references.get(code.textContent.trim());
    if (!reference) continue;
    if (!reference.exists) {
      code.classList.add("missing-file-reference");
      code.title = t("documents.missing");
      continue;
    }
    const link = document.createElement("a");
    link.href = reference.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.className = "workspace-file-link";
    link.title = t("documents.openNamed", { name: reference.name });
    code.replaceWith(link);
    link.append(code);
  }
}
function renderWorkItemViewer(markdown) {
  state.detailViewer?.destroy();
  $("detailBody").innerHTML = "";
  state.detailViewer = window.toastui.Editor.factory({
    el: $("detailBody"),
    viewer: true,
    initialValue: markdown || "",
    usageStatistics: false,
    customHTMLSanitizer: sanitizeEditorHtml,
  });
  linkWorkspaceReferences($("detailBody"));
  decorateWorkItemReferences($("detailBody"));
  openLinksInNewTab($("detailBody"));
}
function hasUnsavedWorkItem() {
  return state.editingWorkItem && state.detailDirty;
}
function hasUnsavedNewItem() {
  return (
    $("createDialog").open &&
    state.createEditor &&
    state.createEditor.getMarkdown().trim().length > 0
  );
}

function filtered() {
  const q = $("search").value.toLocaleLowerCase("tr-TR"),
    team = $("teamFilter").value,
    status = $("statusFilter").value,
    priority = $("priorityFilter").value;
  return state.items.filter(
    (i) =>
      i.project_key === state.selectedProject &&
      (!team || i.team_id === team || i.team === team) &&
      (!status || i.status === status) &&
      (!priority ||
        (priority === "none" ? !i.priority : i.priority === priority)) &&
      (!q ||
        `${i.key} ${i.title} ${i.body}`.toLocaleLowerCase("tr-TR").includes(q)),
  );
}
function card(item) {
  const project = state.projects.find(
    (candidate) => candidate.key === item.project_key,
  );
  const time = item.scheduled_time
    ? `<span class="card-time">${item.scheduled_time}</span>`
    : "";
  const priority = item.priority
    ? `<span class="priority ${item.priority}">${priorityName(item.priority)}</span>`
    : "";
  const completed = item.completed_at
    ? `<time class="card-completed" datetime="${escapeHtml(item.completed_at)}" title="${escapeHtml(localDateTime(item.completed_at))}">✓ ${escapeHtml(relativeElapsed(item.completed_at))}</time>`
    : "";
  return `<button class="card ${item.status}" draggable="${item.kind === "task"}" data-key="${item.key}" data-uid="${item.uid}"><span class="card-meta"><span class="card-key">${item.key.replace(`${project?.code || "WORK"}-`, "")}</span>${time}${priority}</span>${escapeHtml(item.title)}<span class="card-team">${teamName(item.team)}</span>${completed}</button>`;
}
function renderSprintStrip() {
  const sprints = projectSprints();
  $("sprintStrip").hidden = !sprints.length;
  $("sprintStrip").innerHTML = sprints
    .map(
      (sprint) =>
        `<div class="sprint-chip" title="${escapeHtml(sprint.name)}"><strong>${sprint.key}</strong><span>${escapeHtml(sprint.name)}</span><small>${sprint.start_date} → ${sprint.end_date} · ${sprintStatusName(sprint.status)}</small></div>`,
    )
    .join("");
}
function renderCalendar() {
  const year = state.month.getFullYear(),
    month = state.month.getMonth();
  $("monthLabel").textContent = new Intl.DateTimeFormat(locale(), {
    month: "long",
    year: "numeric",
  }).format(state.month);
  const start = new Date(year, month, 1);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  let html = "";
  const items = filtered().filter((i) => i.kind === "task");
  for (let d = 0; d < 42; d++) {
    const date = new Date(start);
    date.setDate(start.getDate() + d);
    const iso = [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getDate()).padStart(2, "0"),
    ].join("-");
    const dayItems = items
      .filter((i) => i.scheduled_for === iso)
      .sort(
        (a, b) =>
          String(a.scheduled_time || "99:99").localeCompare(
            String(b.scheduled_time || "99:99"),
          ) || priorityRank(a.priority) - priorityRank(b.priority),
      );
    const daySprints = projectSprints().filter(
      (sprint) => sprint.start_date <= iso && sprint.end_date >= iso,
    );
    const outside = date.getMonth() !== month ? " outside" : "";
    const today =
      iso === new Date().toLocaleDateString("sv-SE") ? " today" : "";
    const sprintClass = daySprints.length ? " in-sprint" : "";
    const pickClass =
      state.sprintSelection.active && state.sprintSelection.start === iso
        ? " sprint-pick"
        : "";
    const markers = daySprints
      .slice(0, 3)
      .map(
        (sprint) =>
          `<span class="sprint-dot" title="${escapeHtml(sprint.name)}"></span>`,
      )
      .join("");
    const expanded = state.expandedDays.has(iso);
    const visibleItems = expanded ? dayItems : dayItems.slice(0, 4);
    const moreButton =
      dayItems.length > 4
        ? `<button class="more" data-day="${iso}" aria-expanded="${expanded}">${expanded ? t("calendar.showLess") : t("calendar.showMore", { count: dayItems.length - 4 })}</button>`
        : "";
    const fullDate = new Intl.DateTimeFormat(locale(), {
      dateStyle: "long",
    }).format(date);
    const createLabel = t("calendar.addToDate", { date: fullDate });
    html += `<div class="day${outside}${today}${sprintClass}${pickClass}" data-drop-date="${iso}"><button type="button" class="day-create-surface" data-create-date="${iso}" aria-label="${escapeHtml(createLabel)}" title="${escapeHtml(createLabel)}"><span>${t("calendar.quickAdd")}</span></button><div class="date"><span>${date.getDate()}</span><span class="count">${dayItems.length ? tp("calendar.itemCount", dayItems.length) : ""}</span></div><div class="sprint-markers">${markers}</div>${visibleItems.map(card).join("")}${moreButton}</div>`;
  }
  $("calendar").innerHTML = html;
  const undated = items.filter((i) => !i.scheduled_for);
  $("undated").innerHTML =
    undated.map(card).join("") || `<span>${t("calendar.empty")}</span>`;
  $("undatedCount").textContent = tp("calendar.itemCount", undated.length);
}
function renderBacklog() {
  const items = filtered().filter((i) => i.kind === "backlog"),
    statuses = ["backlog", "planned", "in_progress", "waiting", "done"];
  $("board").innerHTML = statuses
    .map(
      (s) =>
        `<section class="column"><h2>${statusName(s)} <span>${items.filter((i) => i.status === s).length}</span></h2>${items
          .filter((i) => i.status === s)
          .map(card)
          .join("")}</section>`,
    )
    .join("");
}
function renderProjectList() {
  const ordered = [...state.projects].sort(
    (a, b) =>
      Number(a.status === "archived") - Number(b.status === "archived") ||
      a.name.localeCompare(b.name, "tr"),
  );
  $("projectList").innerHTML = ordered
    .map((project) => {
      const items = state.items.filter(
        (item) => item.project_key === project.key,
      );
      const taskCount = items.filter((item) => item.kind === "task").length;
      const backlogCount = items.filter(
        (item) => item.kind === "backlog",
      ).length;
      const chronology = project.created_at
        ? `<time datetime="${escapeHtml(project.created_at)}" title="${escapeHtml(localDateTime(project.created_at))}">${escapeHtml(projectDurationLabel(project))}</time>`
        : `<span>${t("project.dateUnknown")}</span>`;
      return `<button class="project-list-card${!state.projectIndex && project.key === state.selectedProject ? " active" : ""}" data-project-key="${project.key}"><span><strong>${escapeHtml(project.name)}</strong><small>${project.key} · ${project.code}</small></span><span class="project-status ${project.status}">${t(project.status === "active" ? "project.status.active" : "project.status.archived")}</span><small>${tp("count.task", taskCount)} · ${tp("count.backlog", backlogCount)}</small><small class="project-age">${chronology}</small></button>`;
    })
    .join("");
}
function projectDurationLabel(project) {
  if (!project.created_at) return t("project.dateUnknown");
  const end = project.archived_at
    ? Date.parse(project.archived_at)
    : Date.now();
  const minutes = Math.max(
    0,
    Math.round((end - Date.parse(project.created_at)) / 60000),
  );
  return t(
    project.status === "archived" ? "project.lastedFor" : "project.activeFor",
    { duration: formatElapsed(minutes, language()) },
  );
}

function renderDeliveryInsights() {
  if (
    !state.projectInsights ||
    state.insightProjectKey !== state.selectedProject
  )
    return `<section class="dashboard-section delivery-insights is-loading"><div class="section-head"><div><h3>${t("insights.title")}</h3><p>${t("insights.loading")}</p></div></div></section>`;
  if (state.projectInsights.error)
    return `<section class="dashboard-section delivery-insights"><div class="section-head"><div><h3>${t("insights.title")}</h3><p>${t("insights.error")}</p></div></div></section>`;
  const { summary, items, pagination } = state.projectInsights;
  const estimatedPercent = summary.total
    ? Math.round((summary.estimated_count / summary.total) * 100)
    : 0;
  const totalEstimate = summary.total_estimate_minutes || 0;
  const statusBars = Object.entries(summary.status_estimate_minutes || {})
    .sort(([left], [right]) =>
      statusName(left).localeCompare(statusName(right)),
    )
    .map(
      ([status, minutes]) =>
        `<span class="delivery-status ${escapeHtml(status)}" style="--share:${totalEstimate ? (minutes / totalEstimate) * 100 : 0}%" title="${escapeHtml(`${statusName(status)} · ${formatEffort(minutes, language())}`)}"><i></i><small>${escapeHtml(statusName(status))}</small></span>`,
    )
    .join("");
  const maximum = Math.max(
    1,
    ...items.flatMap((item) => [
      item.estimate_minutes || 0,
      item.cycle_minutes || 0,
    ]),
  );
  const rows = items
    .map((item) => {
      const estimate = item.estimate_minutes;
      const actual = item.cycle_minutes;
      return `<tr><td><button class="insight-item-link" data-key="${escapeHtml(item.key)}"><strong>${escapeHtml(item.key)}</strong><span>${escapeHtml(item.title)}</span></button></td><td>${escapeHtml(statusName(item.status))}</td><td><span class="duration-value">${escapeHtml(formatEffort(estimate, language()))}</span><span class="duration-bar estimate" style="--duration:${estimate ? (estimate / maximum) * 100 : 0}%"><i></i></span></td><td><span class="duration-value">${escapeHtml(formatElapsed(actual, language()))}</span><span class="duration-bar actual" style="--duration:${actual !== null ? (actual / maximum) * 100 : 0}%"><i></i></span></td></tr>`;
    })
    .join("");
  const table = state.insightsExpanded
    ? `<div class="insight-controls"><label>${t("insights.filter")}<select data-insight-filter><option value="all">${t("insights.all")}</option><option value="open">${t("insights.open")}</option><option value="done">${t("insights.done")}</option><option value="unestimated">${t("insights.unestimated")}</option></select></label><label>${t("insights.sort")}<select data-insight-sort><option value="updated">${t("insights.sortUpdated")}</option><option value="estimate">${t("insights.sortEstimate")}</option><option value="actual">${t("insights.sortActual")}</option><option value="status">${t("insights.sortStatus")}</option></select></label></div><div class="insight-table-wrap"><table class="insight-table"><thead><tr><th>${t("insights.item")}</th><th>${t("work.status")}</th><th>${t("insights.estimate")}</th><th>${t("insights.actual")}</th></tr></thead><tbody>${rows || `<tr><td colspan="4">${t("insights.empty")}</td></tr>`}</tbody></table></div><div class="insight-pagination"><button data-insight-page="${pagination.page - 1}" ${pagination.page <= 1 ? "disabled" : ""}>←</button><span>${t("insights.page", { page: pagination.page, pages: pagination.page_count })}</span><button data-insight-page="${pagination.page + 1}" ${pagination.page >= pagination.page_count ? "disabled" : ""}>→</button></div>`
    : "";
  window.requestAnimationFrame(() => {
    const filter = document.querySelector("[data-insight-filter]");
    const sort = document.querySelector("[data-insight-sort]");
    if (filter) filter.value = state.insightFilter;
    if (sort) sort.value = state.insightSort;
  });
  return `<section class="dashboard-section delivery-insights"><div class="section-head"><div><h3>${t("insights.title")}</h3><p>${t("insights.subtitle")}</p></div><button data-insights-toggle aria-expanded="${state.insightsExpanded}">${t(state.insightsExpanded ? "insights.collapse" : "insights.expand")}</button></div><div class="delivery-kpis"><article><span>${t("insights.coverage")}</span><strong>%${estimatedPercent}</strong><small>${summary.estimated_count}/${summary.total}</small></article><article><span>${t("insights.totalEffort")}</span><strong>${escapeHtml(formatEffort(summary.total_estimate_minutes, language()))}</strong><small>${t("insights.estimatedOnly")}</small></article><article><span>${t("insights.remainingEffort")}</span><strong>${escapeHtml(formatEffort(summary.remaining_estimate_minutes, language()))}</strong><small>${t("insights.openWork")}</small></article><article><span>${t("insights.medianCycle")}</span><strong>${escapeHtml(formatElapsed(summary.median_cycle_minutes, language()))}</strong><small>${t("insights.measured", { count: summary.measured_completed_count })}</small></article></div><div class="delivery-distribution" aria-label="${escapeHtml(t("insights.distribution"))}">${statusBars || `<span>${t("insights.noEstimates")}</span>`}</div>${table}</section>`;
}
function canPreviewDocument(document) {
  const type = String(document.type || "");
  return (
    type.startsWith("image/") ||
    type === "application/pdf" ||
    type.startsWith("text/") ||
    type.startsWith("application/json")
  );
}
function renderProjectDocumentCard(document) {
  const name = escapeHtml(
    document.original_name || document.name || document.path,
  );
  if (!document.exists)
    return `<article class="project-document-card missing"><div class="document-symbol">!</div><div><strong>${name}</strong><span>${t("documents.missing")}</span></div><button data-project-document-remove="${document.index}">${t("documents.remove")}</button></article>`;
  const openInReader = canPreviewDocument(document)
    ? `<button data-project-document-preview="${document.index}">${t("documents.open")}</button>`
    : "";
  return `<article class="project-document-card"><div class="document-symbol">${escapeHtml(fileExtension(document.original_name || document.name))}</div><div class="document-summary"><strong title="${name}">${name}</strong><span>${escapeHtml(document.source === "workspace" ? document.path : t("documents.uploadedFile"))}</span><small>${escapeHtml(fileExtension(document.original_name || document.name))} · ${escapeHtml(formatFileSize(document.size))}</small></div><div class="document-actions">${openInReader}<a href="${escapeHtml(document.url)}" target="_blank" rel="noopener noreferrer">${t("documents.preview")}</a><a href="${escapeHtml(document.download_url)}" target="_blank" rel="noopener noreferrer">${t("documents.download")}</a><button data-project-document-remove="${document.index}">${t("documents.remove")}</button></div></article>`;
}
function renderProjectDocuments(project) {
  const documentCount = project.documents?.length || 0;
  return `<section class="dashboard-section project-documents-section"><div class="section-head"><div><h3>${t("documents.title")}</h3><p>${t("documents.subtitle")}</p></div><button data-project-document-upload>${t("documents.upload")}</button></div><input id="projectDocumentUpload" class="visually-hidden" type="file" accept=".png,.jpg,.jpeg,.webp,.gif,.pdf,.csv,.json,.txt,.md,.xlsx,.docx" multiple><form id="projectDocumentReferenceForm" class="document-reference-form"><label>${t("documents.linkWorkspace")}<input name="path" required placeholder="${t("documents.workspacePlaceholder")}"></label><button type="submit">${t("documents.link")}</button></form><div class="project-document-list">${state.projectDocuments.length ? state.projectDocuments.map(renderProjectDocumentCard).join("") : `<div class="empty-documents"><strong>${t("documents.empty")}</strong><span>${t("documents.emptyCaption")}</span></div>`}</div><small class="document-limit">${documentCount}/50 · ${tp("count.document", documentCount)}</small></section>`;
}

function updateProjectInState(project) {
  state.projects = state.projects.map((candidate) =>
    candidate.uid === project.uid ? project : candidate,
  );
}

async function loadProjectDocuments() {
  const project = currentProject();
  if (!project) return;
  const response = await apiFetch(`/api/v1/projects/${project.uid}/documents`);
  if (!response.ok)
    throw new Error((await response.json()).error || t("error.documentsLoad"));
  state.projectDocuments = (await response.json()).items;
}

async function loadProjectCollaborators(projectKey = state.selectedProject) {
  if (!projectKey) return [];
  const response = await apiFetch(
    `/api/v1/projects/${encodeURIComponent(projectKey)}/collaborators`,
  );
  if (!response.ok) return projectCollaborators(projectKey);
  const result = await response.json();
  state.collaboratorsByProject[projectKey] = result.items || [];
  return state.collaboratorsByProject[projectKey];
}

async function loadProjectInsights({ renderAfter = true } = {}) {
  const project = currentProject();
  if (!project) return;
  const projectKey = project.key;
  const query = new window.URLSearchParams({
    filter: state.insightFilter,
    sort: state.insightSort,
    page: String(state.insightPage),
    page_size: "20",
  });
  state.insightProjectKey = projectKey;
  const response = await apiFetch(
    `/api/v1/projects/${projectKey}/insights?${query}`,
  );
  if (!response.ok) {
    state.projectInsights = { error: true };
  } else if (state.insightProjectKey === projectKey) {
    state.projectInsights = await response.json();
  }
  if (
    renderAfter &&
    state.view === "projects" &&
    currentProject()?.key === projectKey
  )
    renderProjectDashboard();
}

function invalidateProjectInsights() {
  state.projectInsights = null;
  state.insightProjectKey = state.selectedProject;
  void loadProjectInsights();
}

async function setProjectSection(section, updateAddress = true) {
  if (!["overview", "documents", "people"].includes(section)) return;
  state.projectSection = section;
  if (section === "documents") {
    try {
      await loadProjectDocuments();
    } catch (error) {
      alert(error.message);
    }
  }
  if (section === "people") {
    const project = currentProject();
    const response = await apiFetch(`/api/v1/projects/${project.key}`);
    if (response.ok) updateProjectInState(await response.json());
  }
  if (updateAddress && state.view === "projects") {
    const project = currentProject();
    const suffix = section === "overview" ? "" : `?tab=${section}`;
    if (project)
      history.replaceState({}, "", `${projectCanonical(project)}${suffix}`);
  }
  renderProjectDashboard();
  renderBreadcrumb();
  translateDocument();
}

function renderProjectPeople(project) {
  const owner = state.users.find((user) => user.id === project.owner_user_id);
  const ownerOptions = state.users
    .map(
      (user) =>
        `<option value="${escapeHtml(user.id)}" ${user.id === project.owner_user_id ? "selected" : ""}>${escapeHtml(user.display_name)}</option>`,
    )
    .join("");
  const teamOptions = state.teams
    .map(
      (team) =>
        `<label><input type="checkbox" name="team_ids" value="${escapeHtml(team.id)}" ${(project.team_ids || []).includes(team.id) ? "checked" : ""}>${escapeHtml(team.name)}</label>`,
    )
    .join("");
  const memberRows = state.users
    .filter((user) => user.id !== project.owner_user_id)
    .map((user) => {
      const role = project.members?.find(
        (member) => member.user_id === user.id,
      )?.role;
      return `<label>${escapeHtml(user.display_name)}<select name="member-${escapeHtml(user.id)}"><option value="">—</option>${["manager", "member", "viewer"].map((value) => `<option value="${value}" ${role === value ? "selected" : ""}>${t(`project.role.${value}`)}</option>`).join("")}</select></label>`;
    })
    .join("");
  const activity = [...(project.activities || [])]
    .reverse()
    .map(
      (entry) =>
        `<li><strong>${escapeHtml(entry.actor?.display_name || "Sprintmark")}</strong><span>${escapeHtml(localDateTime(entry.created_at))} · ${escapeHtml(relativeElapsed(entry.created_at))}</span></li>`,
    )
    .join("");
  return `<section class="dashboard-section project-people"><div class="section-head"><div><h3>${t("project.people")}</h3><p>${t("project.peopleCaption")}</p></div></div><p><strong>${t("project.owner")}:</strong> ${escapeHtml(owner?.display_name || project.owner_user_id)}</p><form id="projectPeopleForm"><label>${t("project.owner")}<select name="owner_user_id">${ownerOptions}</select></label><fieldset><legend>${t("project.teams")}</legend>${teamOptions}</fieldset><fieldset><legend>${t("project.members")}</legend>${memberRows}</fieldset><button class="primary" type="submit">${t("work.update")}</button></form><h4>${t("activity.title")}</h4><ol class="activity-list">${activity || `<li>${t("activity.empty")}</li>`}</ol></section>`;
}

function plainHeadingLabel(value) {
  return String(value || "")
    .replace(/\s+#+\s*$/, "")
    .replace(/[`*_~\[\]]/g, "")
    .replace(/\(([^)]+)\)/g, "")
    .trim();
}

function splitMarkdownSections(markdown) {
  const lines = String(markdown || "").split(/\r?\n/);
  const headings = [];
  let fence = null;
  lines.forEach((line, lineIndex) => {
    const fenceMatch = line.match(/^\s*(`{3,}|~{3,})/);
    if (fenceMatch) {
      const marker = fenceMatch[1][0];
      fence = fence === marker ? null : fence || marker;
      return;
    }
    if (fence) return;
    const heading = line.match(/^(#{1,4})\s+(.+?)\s*$/);
    if (!heading) return;
    headings.push({
      level: heading[1].length,
      title: plainHeadingLabel(heading[2]),
      start: lineIndex,
    });
  });
  if (!headings.length)
    return [
      { level: 1, title: t("documents.generic"), content: lines.join("\n") },
    ];
  return headings.map((heading, index) => ({
    ...heading,
    content: lines
      .slice(heading.start, headings[index + 1]?.start ?? lines.length)
      .join("\n")
      .trim(),
  }));
}

function renderDocumentOutline() {
  const outline = $("documentOutline");
  outline.hidden = false;
  outline.innerHTML = `<div class="document-outline-title">${t("documents.contents")}</div>${state.documentSections
    .map(
      (section, index) =>
        `<button type="button" class="outline-level-${section.level}${index === state.activeDocumentSection ? " active" : ""}" data-document-section="${index}" title="${escapeHtml(section.title)}">${escapeHtml(section.title)}</button>`,
    )
    .join("")}`;
}

function renderDocumentSection(index) {
  const section = state.documentSections[index];
  if (!section) return;
  state.activeDocumentSection = index;
  renderDocumentOutline();
  state.documentPreviewViewer?.destroy();
  state.documentPreviewViewer = null;
  $("documentPreviewBody").innerHTML = "";
  state.documentPreviewViewer = window.toastui.Editor.factory({
    el: $("documentPreviewBody"),
    viewer: true,
    initialValue: section.content,
    usageStatistics: false,
    customHTMLSanitizer: sanitizeEditorHtml,
  });
  openLinksInNewTab($("documentPreviewBody"));
  $("documentPreviewBody").scrollTop = 0;
}

async function openProjectDocumentPreview(index) {
  const projectDocument = state.projectDocuments.find(
    (candidate) => candidate.index === Number(index),
  );
  if (!projectDocument?.exists || !projectDocument.url) return;
  state.activeProjectDocument = projectDocument;
  state.documentSections = [];
  state.activeDocumentSection = 0;
  state.documentPreviewViewer?.destroy();
  state.documentPreviewViewer = null;
  const name =
    projectDocument.original_name ||
    projectDocument.name ||
    projectDocument.path;
  $("documentPreviewProject").textContent = currentProject()?.name || "";
  $("documentPreviewTitle").textContent = name;
  $("documentPreviewOpen").href = projectDocument.url;
  $("documentPreviewDownload").href = projectDocument.download_url;
  $("documentOutline").hidden = true;
  $("documentOutline").innerHTML = "";
  $("documentPreviewBody").innerHTML =
    `<div class="document-loading">${t("documents.preparing")}</div>`;
  $("documentPreviewDialog").showModal();
  document.title = `${name} · ${currentProject()?.name || "Sprintmark"}`;
  const type = String(projectDocument.type || "");
  if (type.startsWith("image/")) {
    $("documentPreviewBody").innerHTML =
      `<img class="document-image-preview" src="${escapeHtml(projectDocument.url)}" alt="${escapeHtml(name)}">`;
    return;
  }
  if (type === "application/pdf") {
    $("documentPreviewBody").innerHTML =
      `<iframe class="document-pdf-preview" src="${escapeHtml(projectDocument.url)}" title="${escapeHtml(name)}"></iframe>`;
    return;
  }
  const response = await apiFetch(projectDocument.url);
  if (!response.ok) {
    $("documentPreviewBody").textContent = t("documents.loadError");
    return;
  }
  const content = await response.text();
  if (type.startsWith("text/markdown")) {
    state.documentSections = splitMarkdownSections(content);
    renderDocumentSection(0);
    return;
  }
  if (type.startsWith("application/json")) {
    try {
      $("documentPreviewBody").innerHTML = "";
      const pre = document.createElement("pre");
      pre.textContent = JSON.stringify(
        JSON.parse(content.replace(/^\uFEFF/, "")),
        null,
        2,
      );
      $("documentPreviewBody").append(pre);
    } catch {
      $("documentPreviewBody").textContent = content;
    }
    return;
  }
  $("documentPreviewBody").innerHTML = "";
  const pre = document.createElement("pre");
  pre.textContent = content;
  $("documentPreviewBody").append(pre);
}

async function uploadProjectDocuments(files) {
  let project = currentProject();
  if (!project) return;
  for (const file of files) {
    const data = new FormData();
    data.append("file", file, file.name);
    const response = await apiFetch(
      `/api/v1/projects/${project.uid}/documents`,
      {
        method: "POST",
        headers: { "If-Match": project._etag },
        body: data,
      },
    );
    if (!response.ok)
      throw new Error(
        (await response.json()).error || t("error.documentUpload"),
      );
    project = (await response.json()).project;
    updateProjectInState(project);
  }
  await loadProjectDocuments();
  renderProjectDashboard();
}
function renderProjectDashboard() {
  const project = currentProject();
  if (!project) {
    $("projectDashboard").innerHTML = "";
    return;
  }
  const items = state.items.filter((item) => item.project_key === project.key);
  const tasks = items.filter((item) => item.kind === "task");
  const done = tasks.filter((item) => item.status === "done").length;
  const open = tasks.length - done;
  const backlog = items.filter((item) => item.kind === "backlog").length;
  const undated = tasks.filter((item) => !item.scheduled_for).length;
  const progress = tasks.length ? Math.round((done / tasks.length) * 100) : 0;
  const sprints = projectSprints();
  const recent = [...items]
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    .slice(0, 6);
  const sprintSection = sprints.length
    ? `<section class="dashboard-section"><div class="section-head"><div><h3>${t("dashboard.sprints")}</h3><p>${t("dashboard.sprintsCaption")}</p></div><button data-project-action="sprint">${t("sprint.create")}</button></div><div class="dashboard-sprints">${sprints
        .map((sprint) => {
          const count = tasks.filter(
            (item) =>
              item.scheduled_for >= sprint.start_date &&
              item.scheduled_for <= sprint.end_date,
          ).length;
          return `<article><strong>${escapeHtml(sprint.name)}</strong><span>${sprint.start_date} → ${sprint.end_date}</span><small>${sprintStatusName(sprint.status)} · ${tp("count.task", count)}</small></article>`;
        })
        .join("")}</div></section>`
    : "";
  const overview = `<section class="project-metrics"><article><span>${t("dashboard.completed")}</span><strong>%${progress}</strong><small>${tp("dashboard.completedCaption", tasks.length, { done, total: tasks.length })}</small></article><article><span>${t("dashboard.open")}</span><strong>${open}</strong><small>${t("dashboard.openCaption")}</small></article><article><span>${t("dashboard.backlog")}</span><strong>${backlog}</strong><small>${t("dashboard.backlogCaption")}</small></article><article><span>${t("dashboard.unscheduled")}</span><strong>${undated}</strong><small>${t("dashboard.unscheduledCaption")}</small></article></section>${renderDeliveryInsights()}${sprintSection}<section class="dashboard-section"><div class="section-head"><div><h3>${t("dashboard.recent")}</h3><p>${t("dashboard.recentCaption")}</p></div></div><div class="recent-items">${recent
    .map(
      (item) =>
        `<button data-key="${item.key}"><span><strong>${item.key}</strong>${escapeHtml(item.title)}</span><small>${item.completed_at ? `✓ ${escapeHtml(relativeElapsed(item.completed_at))} · ` : ""}${item.updated_at.slice(0, 10)} · ${statusName(item.status)}</small></button>`,
    )
    .join("")}</div></section>`;
  const sectionContent =
    state.projectSection === "documents"
      ? renderProjectDocuments(project)
      : state.projectSection === "people"
        ? renderProjectPeople(project)
        : overview;
  $("projectDashboard").innerHTML =
    `<section class="project-hero"><div><span class="eyebrow">${project.key} · ${project.code}</span><h2>${escapeHtml(project.name)}</h2><p>${escapeHtml(project.description || "")}</p>${project.created_at ? `<p class="project-chronology"><time datetime="${escapeHtml(project.created_at)}">${escapeHtml(localDateTime(project.created_at))}</time><span>${escapeHtml(projectDurationLabel(project))}</span></p>` : `<p class="project-chronology">${t("project.dateUnknown")}</p>`}</div><div class="project-actions"><button data-project-action="calendar">${t("project.goCalendar")}</button><button data-project-action="new-item" ${project.status === "archived" ? "disabled" : ""}>${t("project.createItem")}</button><button data-project-action="sprint" ${project.status === "archived" ? "disabled" : ""}>${t("sprint.create")}</button><button data-project-action="edit">${t("project.edit")}</button></div></section><nav class="project-tabs" aria-label="${t("project.sectionsLabel")}"><button data-project-tab="overview" class="${state.projectSection === "overview" ? "active" : ""}" aria-selected="${state.projectSection === "overview"}">${t("breadcrumb.overview")}</button><button data-project-tab="documents" class="${state.projectSection === "documents" ? "active" : ""}" aria-selected="${state.projectSection === "documents"}">${t("breadcrumb.documents")} <span>${project.documents?.length || 0}</span></button><button data-project-tab="people" class="${state.projectSection === "people" ? "active" : ""}" aria-selected="${state.projectSection === "people"}">${t("breadcrumb.people")}</button></nav>${sectionContent}`;
}
function renderProjects() {
  renderProjectList();
  $("projectsView").classList.toggle("project-index", state.projectIndex);
  $("projectDashboard").hidden = state.projectIndex;
  if (state.projectIndex) return;
  renderProjectDashboard();
}
function render() {
  renderSprintStrip();
  renderCalendar();
  renderBacklog();
  renderProjects();
  applyViewShell(state.view);
  renderBreadcrumb();
  const projectItems = state.items.filter(
    (item) => item.project_key === state.selectedProject,
  );
  const activeProjects = state.projects.filter(
    (project) => project.status === "active",
  ).length;
  const archivedProjects = state.projects.filter(
    (project) => project.status === "archived",
  ).length;
  const taskCount = projectItems.filter((item) => item.kind === "task").length;
  const backlogCount = projectItems.filter(
    (item) => item.kind === "backlog",
  ).length;
  $("summary").textContent =
    state.view === "projects"
      ? `${tp("summary.activeProjects", activeProjects)} · ${tp("summary.archivedProjects", archivedProjects)}`
      : `${tp("summary.calendarItems", taskCount)} · ${tp("summary.backlogItems", backlogCount)}`;
  const activeProject = currentProject();
  $("newItem").disabled = activeProject?.status !== "active";
  $("sprintButton").disabled = activeProject?.status !== "active";
  document.body.dataset.view = state.view;
  updateDocumentTitle($("detail").open ? state.selected : null);
  translateDocument();
}
function setView(view, updateAddress = true) {
  state.view = view;
  document
    .querySelectorAll(".nav")
    .forEach((nav) =>
      nav.classList.toggle("active", nav.dataset.view === view),
    );
  if (updateAddress) {
    const project = currentProject();
    const target = viewCanonical(view, project);
    history.pushState({ view }, "", target);
  }
  render();
}
function activityFieldName(field) {
  return (
    {
      title: t("activity.field.title"),
      status: t("activity.field.status"),
      team: t("activity.field.team"),
      scheduled_for: t("activity.field.scheduledDate"),
      scheduled_time: t("activity.field.scheduledTime"),
      priority: t("activity.field.priority"),
      estimate_minutes: t("activity.field.estimate"),
      page_url: t("activity.field.pageUrl"),
      body: t("activity.field.description"),
      project_key: t("activity.field.project"),
    }[field] || field
  );
}
function activityValue(field, value) {
  if (value === null || value === undefined || value === "")
    return t("activity.emptyValue");
  if (field === "status") return statusName(value);
  if (field === "team") return teamName(value);
  if (field === "priority") return priorityName(value);
  if (field === "estimate_minutes")
    return formatEffort(Number(value), language());
  return String(value);
}
function activityDescription(activity) {
  if (activity.type === "created") return t("activity.created");
  if (activity.type === "comment")
    return `<div class="activity-comment markdown" data-activity-comment="${escapeHtml(activity.id)}"></div>`;
  if (activity.type === "attachment_added")
    return t("activity.attachmentAdded", {
      name: escapeHtml(activity.details?.name || t("file.generic")),
    });
  if (activity.type === "attachment_removed")
    return t("activity.attachmentRemoved", {
      name: escapeHtml(activity.details?.name || t("file.generic")),
    });
  if (
    ["changed", "assignment", "handoff", "ownership"].includes(activity.type)
  ) {
    const changes = (activity.changes || [])
      .map((change) => {
        const field = escapeHtml(activityFieldName(change.field));
        if (change.field === "body")
          return `<li>${t("activity.descriptionUpdated")}</li>`;
        return `<li>${t("activity.changedFromTo", {
          field,
          from: escapeHtml(activityValue(change.field, change.from)),
          to: escapeHtml(activityValue(change.field, change.to)),
        })}</li>`;
      })
      .join("");
    return `<ul class="activity-changes">${changes}</ul>`;
  }
  return t("activity.updated");
}
function renderActivity(item) {
  for (const viewer of state.activityViewers) viewer.destroy();
  state.activityViewers = [];
  const activities = [...(item.activities || [])].sort((a, b) =>
    String(b.created_at).localeCompare(String(a.created_at)),
  );
  $("activityCount").textContent = tp("activity.count", activities.length);
  $("activityList").innerHTML = activities.length
    ? activities
        .map(
          (activity) =>
            `<li class="activity-entry activity-${escapeHtml(activity.type)}"><span class="activity-marker" aria-hidden="true"></span><div class="activity-entry-content"><header><span class="activity-actor">${avatar(typeof activity.actor === "object" ? activity.actor : null)}<strong>${escapeHtml(
              typeof activity.actor === "object"
                ? activity.actor.display_name
                : activity.actor === "user"
                  ? t("activity.actorUser")
                  : t("activity.actorSystem"),
            )}</strong></span><time datetime="${escapeHtml(activity.created_at)}">${escapeHtml(localDateTime(activity.created_at))} · ${escapeHtml(relativeElapsed(activity.created_at))}</time></header><div>${activityDescription(activity)}</div></div></li>`,
        )
        .join("")
    : `<li class="activity-empty">${t("activity.empty")}</li>`;
  const comments = new Map(
    activities
      .filter((activity) => activity.type === "comment")
      .map((activity) => [String(activity.id), activity]),
  );
  for (const element of $("activityList").querySelectorAll(
    "[data-activity-comment]",
  )) {
    const activity = comments.get(element.dataset.activityComment);
    if (!activity) continue;
    const viewer = window.toastui.Editor.factory({
      el: element,
      viewer: true,
      initialValue: activity.body || "",
      usageStatistics: false,
      customHTMLSanitizer: sanitizeEditorHtml,
    });
    state.activityViewers.push(viewer);
    decorateWorkItemReferences(element);
    openLinksInNewTab(element);
  }
}
function resetActivityEditor() {
  state.activityEditor?.destroy();
  state.activityEditor = null;
  $("activityEditor").innerHTML = "";
  const actor = state.session?.user;
  $("activityActor").innerHTML =
    `${avatar(actor)}<strong>${escapeHtml(actor?.display_name || t("activity.actorUser"))}</strong>`;
  state.activityEditor = makeEditor(
    $("activityEditor"),
    "",
    "220px",
    null,
    null,
    activityEditorToolbar,
    t("activity.placeholder"),
  );
}
function setEstimateControls(select, custom, value) {
  const presets = new Set([30, 60, 120, 240, 480, 960]);
  if (value === null || value === undefined) {
    select.value = "";
    custom.value = "";
    custom.hidden = true;
  } else if (presets.has(Number(value))) {
    select.value = String(value);
    custom.value = "";
    custom.hidden = true;
  } else {
    select.value = "custom";
    custom.value = formatEffort(Number(value), language()).replace(/\s/g, "");
    custom.hidden = false;
  }
}
function estimateFromControls(select, custom) {
  const parsed = parseEffort(
    select.value === "custom" ? custom.value : select.value,
  );
  if (
    Number.isNaN(parsed) ||
    (parsed !== null &&
      (!Number.isInteger(parsed) || parsed < 1 || parsed > 525600))
  )
    throw new Error(t("validation.estimate"));
  return parsed;
}
function updateEstimateCustom(select, custom) {
  custom.hidden = select.value !== "custom";
  if (!custom.hidden) custom.focus();
}
function renderFollowerControls(item) {
  state.editFollowerIds = new Set(item.follower_ids || []);
  refreshFollowerControls();
}
function refreshFollowerControls() {
  const item = state.selected;
  if (!item) return;
  const users = projectCollaborators(item.project_key);
  const currentUserId = state.session?.user?.id;
  const following = state.editFollowerIds.has(currentUserId);
  $("toggleFollowing").textContent = t(
    following ? "work.unfollow" : "work.follow",
  );
  $("toggleFollowing").classList.toggle("active", following);
  const followers = users.filter((user) => state.editFollowerIds.has(user.id));
  $("followerAvatars").innerHTML = `${followers
    .slice(0, 4)
    .map((user) => avatar(user))
    .join(
      "",
    )}${followers.length > 4 ? `<span class="avatar-overflow">+${followers.length - 4}</span>` : ""}`;
  renderFollowerOptions();
}
function renderFollowerOptions(query = "") {
  const item = state.selected;
  if (!item) return;
  const normalized = query.trim().toLocaleLowerCase(language());
  $("followerOptions").innerHTML = projectCollaborators(item.project_key)
    .filter((user) =>
      String(user.display_name)
        .toLocaleLowerCase(language())
        .includes(normalized),
    )
    .map(
      (user) =>
        `<label>${avatar(user)}<span>${escapeHtml(user.display_name)}</span><input type="checkbox" data-follower-id="${escapeHtml(user.id)}" ${state.editFollowerIds.has(user.id) ? "checked" : ""}></label>`,
    )
    .join("");
}
function renderWorkItemChrome(item, { deferActivity = false } = {}) {
  renderDetailBack();
  $("detailTitle").textContent = item.title;
  $("detailKey").textContent = item.key;
  $("detailUid").textContent = `UUID ${item.uid.slice(0, 8)}`;
  $("detailStatus").textContent = statusName(item.status);
  $("detailPriority").textContent = priorityName(item.priority);
  $("detailTeam").textContent = teamName(item.team_id || item.team);
  $("editStatus").innerHTML = workItemStatuses(item)
    .map((status) => `<option value="${status}">${statusName(status)}</option>`)
    .join("");
  $("editStatus").value = item.status;
  $("editTeam").innerHTML = [
    '<option value="">—</option>',
    ...state.teams.map(
      (team) =>
        `<option value="${escapeHtml(team.id)}">${escapeHtml(team.name)}</option>`,
    ),
  ].join("");
  $("editTeam").value = item.team_id || "";
  const peopleOptions = [
    '<option value="">—</option>',
    ...projectCollaborators(item.project_key).map(
      (user) =>
        `<option value="${escapeHtml(user.id)}">${escapeHtml(user.display_name)}</option>`,
    ),
  ].join("");
  $("editAssignee").innerHTML = peopleOptions;
  $("editReviewer").innerHTML = peopleOptions;
  $("editAssignee").value = item.assignee_id || "";
  $("editReviewer").value = item.reviewer_id || "";
  renderFollowerControls(item);
  $("editTransitionNote").value = "";
  $("editPriority").value = item.priority || "";
  $("editDate").value = item.scheduled_for || "";
  $("editTime").value = item.scheduled_time || "";
  setEstimateControls(
    $("editEstimate"),
    $("editEstimateCustom"),
    item.estimate_minutes,
  );
  $("toggleDone").textContent = t(
    item.status === "done"
      ? "work.reopen"
      : item.status === "backlog"
        ? "work.plan"
        : item.status === "planned"
          ? "work.start"
          : item.status === "review"
            ? "work.approve"
            : item.status === "waiting"
              ? "work.resume"
              : item.reviewer_id
                ? "work.requestReview"
                : "work.markDone",
  );
  $("toggleDone").classList.toggle("reopen", item.status === "done");
  const completionFact = item.completed_at
    ? `<dt>${t("work.completedAt")}</dt><dd class="completion-time"><time datetime="${escapeHtml(item.completed_at)}">${localDateTime(item.completed_at)}</time><small>${escapeHtml(relativeElapsed(item.completed_at))}</small></dd>`
    : "";
  const cycle = durationFromItem(item);
  const timingFacts = `<dt>${t("work.estimate")}</dt><dd>${escapeHtml(formatEffort(item.estimate_minutes, language()))}</dd><dt>${t(item.completed_at ? "work.cycleTime" : "work.elapsedCycle")}</dt><dd>${cycle === null ? t("work.durationUnavailable") : escapeHtml(formatElapsed(cycle, language()))}</dd>`;
  const creator = userById(item.creator_id, item.project_key);
  const reporter = userById(item.reporter_id, item.project_key);
  const creatorFact = `<dt>${t("work.creator")}</dt><dd class="person-fact">${avatar(creator)}<span>${escapeHtml(creator?.display_name || item.creator_id || "—")}</span></dd>`;
  const reporterFact =
    item.reporter_id && item.reporter_id !== item.creator_id
      ? `<dt>${t("work.reporter")}</dt><dd class="person-fact">${avatar(reporter)}<span>${escapeHtml(reporter?.display_name || item.reporter_id)}</span></dd>`
      : "";
  $("facts").innerHTML =
    `${creatorFact}${reporterFact}<dt>${t("work.project")}</dt><dd>${escapeHtml(state.projects.find((project) => project.key === item.project_key)?.name || item.project_key)}</dd><dt>${t("work.calendar")}</dt><dd>${item.scheduled_for ? `${item.scheduled_for}${item.scheduled_time ? ` · ${item.scheduled_time}` : ""}` : "—"}</dd><dt>${t("work.priority")}</dt><dd>${priorityName(item.priority)}</dd>${timingFacts}${completionFact}<dt>${t("work.created")}</dt><dd>${localDateTime(item.created_at)}</dd><dt>${t("work.updated")}</dt><dd>${localDateTime(item.updated_at)}</dd><dt>${t("work.legacyId")}</dt><dd>${item.legacy_ids.join(", ") || "—"}</dd>`;
  $("facts").insertAdjacentHTML(
    "afterbegin",
    `<dt>${t("work.assignee")}</dt><dd>${escapeHtml(userById(item.assignee_id, item.project_key)?.display_name || "—")}</dd><dt>${t("work.reviewer")}</dt><dd>${escapeHtml(userById(item.reviewer_id, item.project_key)?.display_name || "—")}</dd>`,
  );
  renderEvidence(item);
  if (!deferActivity) renderActivity(item);
  translateDocument();
}
function renderWorkItemLoading(item) {
  renderDetailBack();
  $("detailTitle").textContent = item?.title || t("work.loading");
  $("detailKey").textContent = item?.key || "";
  $("detailUid").textContent = item?.uid ? `UUID ${item.uid.slice(0, 8)}` : "";
  $("detailStatus").textContent = item ? statusName(item.status) : "";
  $("detailPriority").textContent = item ? priorityName(item.priority) : "";
  $("detailTeam").textContent = item ? teamName(item.team_id || item.team) : "";
  $("detailLoading").classList.remove("is-error");
  $("detailLoadingMessage").textContent = t("work.loading");
  $("detailGrid").hidden = true;
  $("detailLoading").hidden = false;
  $("detail").setAttribute("aria-busy", "true");
  if (!$("detail").open) $("detail").showModal();
}
async function openItem(key, push = true) {
  key = String(key).toUpperCase();
  if ($("detail").open && state.selected?.key === key) return;
  const requestId = ++state.itemOpenRequest;
  const sourceKey = $("detail").open ? state.selected?.key : null;
  if (push) {
    if (sourceKey) state.itemTrail = [...state.itemTrail, sourceKey];
    else {
      state.returnPath = `${location.pathname}${location.search}`;
      state.itemTrail = [];
    }
  }
  const summary = state.items.find((item) => item.key === key) || null;
  state.selected = summary;
  renderWorkItemLoading(summary);
  if (push && summary) {
    history.pushState(
      {
        sprintmarkView: "work-item",
        key: summary.key,
        returnPath: state.returnPath,
        trail: state.itemTrail,
        originInHistory: sourceKey
          ? history.state?.originInHistory !== false
          : true,
      },
      "",
      canonical(summary),
    );
    renderBreadcrumb();
    updateDocumentTitle(summary);
  }
  let referencesPromise = summary?.uid
    ? apiFetch(`/api/v1/work-items/${summary.uid}/file-references`)
    : null;
  let collaboratorsPromise = summary?.project_key
    ? loadProjectCollaborators(summary.project_key)
    : null;
  let response;
  try {
    response = await apiFetch(`/api/v1/work-items/${key}`);
  } catch {
    if (requestId === state.itemOpenRequest && $("detail").open) {
      $("detailLoading").classList.add("is-error");
      $("detailLoadingMessage").textContent = t("error.itemLoad");
      $("detail").setAttribute("aria-busy", "false");
    }
    return;
  }
  if (requestId !== state.itemOpenRequest || !$("detail").open) return;
  if (!response.ok) {
    $("detailLoading").classList.add("is-error");
    $("detailLoadingMessage").classList.remove("visually-hidden");
    $("detailLoadingMessage").textContent = t("reference.unavailable");
    $("detail").setAttribute("aria-busy", "false");
    return;
  }
  const item = await response.json();
  collaboratorsPromise ||= loadProjectCollaborators(item.project_key);
  await collaboratorsPromise;
  referencesPromise ||= apiFetch(
    `/api/v1/work-items/${item.uid}/file-references`,
  );
  state.fileReferences = [];
  state.detailEditor?.destroy();
  state.detailEditor = null;
  state.editingWorkItem = false;
  state.detailDirty = false;
  state.selected = item;
  if (state.selectedProject !== item.project_key) {
    state.selectedProject = item.project_key;
    window.localStorage.setItem("work-tracker-project", item.project_key);
    render();
    invalidateProjectInsights();
  }
  renderWorkItemChrome(item, { deferActivity: true });
  $("detailLoading").hidden = true;
  $("detailGrid").hidden = false;
  $("detail").setAttribute("aria-busy", "false");
  $("detailBody").hidden = false;
  $("detailEditor").hidden = true;
  $("editorActions").hidden = true;
  $("editConflict").hidden = true;
  $("editWorkItem").hidden = false;
  if (push && !summary) {
    history.pushState(
      {
        sprintmarkView: "work-item",
        key: item.key,
        returnPath: state.returnPath,
        trail: state.itemTrail,
        originInHistory: sourceKey
          ? history.state?.originInHistory !== false
          : true,
      },
      "",
      canonical(item),
    );
  }
  renderBreadcrumb();
  updateDocumentTitle(item);
  window.requestAnimationFrame(() => {
    if (requestId !== state.itemOpenRequest || !$("detail").open) return;
    renderWorkItemViewer(item.body);
    renderActivity(item);
    resetActivityEditor();
  });
  void referencesPromise
    .then(async (referencesResponse) => {
      if (
        requestId !== state.itemOpenRequest ||
        state.selected?.uid !== item.uid ||
        !$("detail").open
      )
        return;
      state.fileReferences = referencesResponse.ok
        ? (await referencesResponse.json()).items
        : [];
      renderEvidence(item);
      linkWorkspaceReferences($("detailBody"));
    })
    .catch(() => {});
}
async function createDraft() {
  const response = await apiFetch("/api/v1/drafts", { method: "POST" });
  if (!response.ok)
    throw new Error((await response.json()).error || t("error.draftCreate"));
  return response.json();
}
async function deleteDraft(id) {
  if (!id) return;
  await apiFetch(`/api/v1/drafts/${id}`, { method: "DELETE" }).catch(() => {});
}
async function uploadDraftFile(draftId, file, placement = "evidence") {
  if (!draftId) throw new Error(t("error.draftMissing"));
  const data = new FormData();
  data.append("file", file, file.name || `clipboard-${Date.now()}.png`);
  data.append("placement", placement);
  data.append("alt", file.name || "Clipboard image");
  const response = await apiFetch(`/api/v1/drafts/${draftId}/attachments`, {
    method: "POST",
    body: data,
  });
  if (!response.ok)
    throw new Error((await response.json()).error || t("error.fileUpload"));
  return response.json();
}
async function uploadWorkItemFile(file, placement = "evidence") {
  if (!state.selected) throw new Error(t("error.itemMissing"));
  const data = new FormData();
  data.append("file", file, file.name || `clipboard-${Date.now()}.png`);
  data.append("placement", placement);
  data.append("alt", file.name || "Clipboard image");
  const response = await apiFetch(
    `/api/v1/work-items/${state.selected.uid}/attachments`,
    { method: "POST", body: data },
  );
  if (!response.ok)
    throw new Error((await response.json()).error || t("error.fileUpload"));
  const result = await response.json();
  state.selected = result.record;
  state.items = state.items.map((item) =>
    item.uid === result.record.uid ? result.record : item,
  );
  return result;
}

function formatFileSize(size) {
  if (!Number.isFinite(size)) return t("file.unknownSize");
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
function fileExtension(name) {
  return String(name || t("file.generic"))
    .split(".")
    .pop()
    .toLocaleUpperCase("tr-TR");
}
function renderFileCard(file, { removable = false } = {}) {
  const name = escapeHtml(
    file.original_name || file.name || file.path || t("file.generic"),
  );
  const type = String(file.type || "");
  const image = type.startsWith("image/");
  if (!file.exists && file.exists !== undefined)
    return `<article class="file-card missing"><div class="file-symbol" aria-hidden="true">!</div><div class="file-details"><strong title="${name}">${name}</strong><span>${t("documents.missing")}</span></div></article>`;
  const url = escapeHtml(file.url || "");
  const downloadUrl = escapeHtml(
    file.download_url ||
      `${file.url}${file.url?.includes("?") ? "&" : "?"}download=1`,
  );
  const visual = image
    ? `<button class="evidence-preview" type="button" data-lightbox-url="${url}" data-lightbox-alt="${name}" aria-label="${t("file.enlarge", { name })}"><img src="${url}" alt="${name}"></button>`
    : `<div class="file-symbol" aria-hidden="true">${escapeHtml(fileExtension(file.original_name || file.name))}</div>`;
  const remove = removable
    ? `<button class="evidence-remove" type="button" data-attachment-name="${escapeHtml(file.name)}" aria-label="${t("file.removeNamed", { name })}">${t("documents.remove")}</button>`
    : "";
  return `<article class="file-card${image ? " image-file" : ""}">${visual}<div class="file-details"><strong title="${name}">${name}</strong><span>${escapeHtml(fileExtension(file.original_name || file.name))} · ${escapeHtml(formatFileSize(file.size))}</span><div class="file-actions"><a href="${url}" target="_blank" rel="noopener noreferrer">${t("documents.open")}</a><a href="${downloadUrl}" target="_blank" rel="noopener noreferrer">${t("documents.download")}</a>${remove}</div></div></article>`;
}
function renderEvidence(item) {
  const managed = item.attachments
    .filter(
      (attachment) =>
        typeof attachment !== "string" && attachment?.placement !== "body",
    )
    .map((attachment) => renderFileCard(attachment, { removable: true }));
  const references = state.fileReferences.map((reference) =>
    renderFileCard(reference),
  );
  $("attachments").innerHTML = [...managed, ...references].join("");
  $("attachments").classList.toggle(
    "is-empty",
    !$("attachments").children.length,
  );
}
async function startWorkItemEdit() {
  if (!state.selected || state.editingWorkItem) return;
  const draft = await createDraft();
  state.editDraftId = draft.id;
  state.detailViewer?.destroy();
  state.detailViewer = null;
  $("detailBody").hidden = true;
  $("detailEditor").hidden = false;
  $("editorActions").hidden = false;
  $("editWorkItem").hidden = true;
  $("editConflict").hidden = true;
  [...$("editMetadata").elements, $("toggleDone")].forEach(
    (control) => (control.disabled = true),
  );
  state.editingWorkItem = true;
  state.detailDirty = false;
  state.detailEditor = makeEditor(
    $("detailEditor"),
    state.selected.body || "",
    "calc(88vh - 190px)",
    () => {
      state.detailDirty = true;
    },
    (file, placement) => uploadDraftFile(state.editDraftId, file, placement),
  );
}
function finishWorkItemEdit(item = state.selected) {
  state.detailEditor?.destroy();
  state.detailEditor = null;
  state.editingWorkItem = false;
  state.detailDirty = false;
  $("detailEditor").innerHTML = "";
  $("detailEditor").hidden = true;
  $("editorActions").hidden = true;
  $("editConflict").hidden = true;
  $("editWorkItem").hidden = false;
  [...$("editMetadata").elements, $("toggleDone")].forEach(
    (control) => (control.disabled = false),
  );
  $("detailBody").hidden = false;
  window.requestAnimationFrame(() => renderWorkItemViewer(item?.body || ""));
}
function cancelWorkItemEdit() {
  if (hasUnsavedWorkItem() && !window.confirm(t("validation.unsavedChanges")))
    return false;
  deleteDraft(state.editDraftId);
  state.editDraftId = null;
  finishWorkItemEdit();
  return true;
}
async function saveWorkItemBody() {
  if (!state.detailEditor || !state.selected) return;
  const body = state.detailEditor.getMarkdown();
  const patch = {
    body,
    draft_id: state.editDraftId,
  };
  if (body.trim() === String(state.selected.body || "").trim()) {
    await deleteDraft(state.editDraftId);
    state.editDraftId = null;
    finishWorkItemEdit();
    return;
  }
  $("saveWorkItem").disabled = true;
  const response = await apiFetch(`/api/v1/work-items/${state.selected.uid}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "If-Match": state.selected._etag,
    },
    body: JSON.stringify(patch),
  });
  $("saveWorkItem").disabled = false;
  if (response.status === 409) {
    $("editConflict").hidden = false;
    return;
  }
  if (!response.ok)
    return alert((await response.json()).error || t("error.contentSave"));
  const updated = await response.json();
  state.editDraftId = null;
  state.selected = updated;
  state.items = state.items.map((item) =>
    item.uid === updated.uid ? updated : item,
  );
  render();
  finishWorkItemEdit(updated);
}
async function patchSelectedWorkItem(patch) {
  if (!state.selected) return null;
  const response = await apiFetch(`/api/v1/work-items/${state.selected.uid}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "If-Match": state.selected._etag,
    },
    body: JSON.stringify(patch),
  });
  if (response.status === 409) {
    alert(t("work.conflictReload"));
    await openItem(state.selected.key, false);
    return null;
  }
  if (!response.ok) {
    alert((await response.json()).error || t("error.metadataUpdate"));
    return null;
  }
  const updated = await response.json();
  state.selected = updated;
  state.items = state.items.map((item) =>
    item.uid === updated.uid ? updated : item,
  );
  invalidateProjectInsights();
  render();
  await openItem(updated.key, false);
  return updated;
}
async function openCreateDialog(context = null) {
  if (
    currentProject()?.status !== "active" ||
    state.createOpening ||
    $("createDialog").open
  )
    return;
  state.createOpening = true;
  const invoker = context?.invoker;
  invoker?.setAttribute("aria-busy", "true");
  try {
    state.createContext = context;
    const draft = await createDraft();
    state.createDraftId = draft.id;
    const form = $("createForm");
    form.reset();
    setEstimateControls($("createEstimate"), $("createEstimateCustom"), null);
    $("createTeam").innerHTML = state.teams
      .map(
        (team) =>
          `<option value="${escapeHtml(team.id)}">${escapeHtml(team.name)}</option>`,
      )
      .join("");
    if (context?.scheduledFor) {
      const now = new Date();
      form.elements.scheduled_for.value = context.scheduledFor;
      form.elements.scheduled_time.value = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
      const [year, month, day] = context.scheduledFor.split("-").map(Number);
      const formattedDate = new Intl.DateTimeFormat(locale(), {
        dateStyle: "full",
      }).format(new Date(year, month - 1, day));
      $("createDialogContext").textContent =
        `${formattedDate} · ${form.elements.scheduled_time.value}`;
      $("createDialogContext").hidden = false;
    } else {
      $("createDialogContext").textContent = "";
      $("createDialogContext").hidden = true;
    }
    $("createDialog").showModal();
    window.requestAnimationFrame(() => {
      if (!state.createEditor)
        state.createEditor = makeEditor(
          $("createEditor"),
          "",
          "330px",
          null,
          (file, placement) =>
            uploadDraftFile(state.createDraftId, file, placement),
        );
      window.requestAnimationFrame(() =>
        form.elements.title.focus({ preventScroll: true }),
      );
    });
  } catch (error) {
    alert(error.message || t("error.draftCreate"));
  } finally {
    invoker?.removeAttribute("aria-busy");
    state.createOpening = false;
  }
}
async function load() {
  const sessionResponse = await apiFetch("/api/v1/session");
  if (!sessionResponse.ok) {
    const error = await sessionResponse.json().catch(() => ({}));
    if (sessionResponse.status === 428 && error.error === "setup_required") {
      const setupResponse = await nativeFetch(
        error.setup_url || "/api/v1/setup",
      );
      if (!setupResponse.ok) throw new Error(t("setup.unavailable"));
      renderSetup(await setupResponse.json());
      return;
    }
    renderLogin(error.auth_mode || "google");
    return;
  }
  state.session = await sessionResponse.json();
  state.authMode = state.session.auth_mode;
  const [projects, records, sprints, meta, users, teams, notifications] =
    await Promise.all([
      apiFetch("/api/v1/projects").then((r) => r.json()),
      apiFetch("/api/v1/work-items").then((r) => r.json()),
      apiFetch("/api/v1/sprints").then((r) => r.json()),
      apiFetch("/api/v1/meta").then((r) => r.json()),
      apiFetch("/api/v1/users").then((r) => r.json()),
      apiFetch("/api/v1/teams").then((r) => r.json()),
      apiFetch("/api/v1/notifications").then(async (r) => {
        state.notificationEtag = r.headers.get("etag");
        return r.json();
      }),
    ]);
  state.projects = projects.items;
  state.items = records.items;
  state.sprints = sprints.items;
  state.meta = meta;
  state.users = users.items || [];
  state.teams = teams.items || [];
  state.notifications = notifications.items || [];
  renderAccount();
  document.documentElement.lang =
    window.localStorage.getItem("sprintmark-locale") ||
    meta.default_locale ||
    "en";
  $("localeSelect").value = document.documentElement.lang;
  const projectRoute = location.pathname.match(/^\/projects\/(PRJ-\d{3})/i);
  const requestedProject =
    projectRoute?.[1]?.toUpperCase() ||
    new window.URLSearchParams(location.search).get("project");
  const rememberedProject = window.localStorage.getItem("work-tracker-project");
  state.selectedProject =
    state.projects.find((project) => project.key === requestedProject)?.key ||
    state.projects.find((project) => project.key === rememberedProject)?.key ||
    state.projects.find((project) => project.status === "active")?.key ||
    state.projects[0]?.key;
  const requestedSection = new window.URLSearchParams(location.search).get(
    "tab",
  );
  state.projectSection =
    state.view === "projects" &&
    ["documents", "people"].includes(requestedSection)
      ? requestedSection
      : "overview";
  if (state.projectSection === "documents") await loadProjectDocuments();
  if (state.projectSection === "people") {
    const project = currentProject();
    const detail = await apiFetch(`/api/v1/projects/${project.key}`);
    if (detail.ok) updateProjectInState(await detail.json());
  }
  await Promise.all([
    loadProjectCollaborators(state.selectedProject),
    loadProjectInsights({ renderAfter: false }),
  ]);
  renderBuildMeta();
  renderStatusOptions();
  const dates = filtered()
    .map((i) => i.scheduled_for)
    .filter(Boolean)
    .sort();
  if (dates.length) state.month = new Date(`${dates.at(-1)}T12:00:00`);
  render();
  translateDocument();
  document.body.classList.remove("app-loading");
  const route = location.pathname.match(
    /^\/work-items\/([A-Z][A-Z0-9]{1,7}-(?:\d{4}[A-Z]?|BL-\d{3}))/i,
  );
  if (route) {
    state.returnPath = history.state?.returnPath || "/";
    state.itemTrail = Array.isArray(history.state?.trail)
      ? history.state.trail
      : [];
    history.replaceState(
      {
        sprintmarkView: "work-item",
        key: route[1].toUpperCase(),
        returnPath: state.returnPath,
        trail: state.itemTrail,
        originInHistory: history.state?.originInHistory === true,
      },
      "",
      location.href,
    );
    await openItem(route[1], false);
  }
}
document.addEventListener("click", async (e) => {
  const workReference = e.target.closest(".work-item-reference");
  if (workReference) {
    e.preventDefault();
    hideReferencePreview();
    if (workReference.classList.contains("is-unavailable")) {
      alert(t("reference.unavailable"));
      return;
    }
    await openItem(workReference.dataset.workItemKey);
    return;
  }
  const projectTab = e.target.closest("[data-project-tab]");
  if (projectTab) {
    await setProjectSection(projectTab.dataset.projectTab);
    return;
  }
  const insightsToggle = e.target.closest("[data-insights-toggle]");
  if (insightsToggle) {
    state.insightsExpanded = !state.insightsExpanded;
    renderProjectDashboard();
    return;
  }
  const insightPage = e.target.closest("[data-insight-page]");
  if (insightPage && !insightPage.disabled) {
    state.insightPage = Number(insightPage.dataset.insightPage);
    state.projectInsights = null;
    renderProjectDashboard();
    await loadProjectInsights();
    return;
  }
  const projectDocumentUpload = e.target.closest(
    "[data-project-document-upload]",
  );
  if (projectDocumentUpload) {
    $("projectDocumentUpload")?.click();
    return;
  }
  const projectDocumentPreview = e.target.closest(
    "[data-project-document-preview]",
  );
  if (projectDocumentPreview) {
    await openProjectDocumentPreview(
      projectDocumentPreview.dataset.projectDocumentPreview,
    );
    return;
  }
  const documentSection = e.target.closest("[data-document-section]");
  if (documentSection) {
    renderDocumentSection(Number(documentSection.dataset.documentSection));
    return;
  }
  const projectDocumentRemove = e.target.closest(
    "[data-project-document-remove]",
  );
  if (projectDocumentRemove) {
    const project = currentProject();
    if (!project || !globalThis.confirm(t("validation.removeDocument"))) return;
    projectDocumentRemove.disabled = true;
    const response = await apiFetch(
      `/api/v1/projects/${project.uid}/documents/${projectDocumentRemove.dataset.projectDocumentRemove}`,
      { method: "DELETE", headers: { "If-Match": project._etag } },
    );
    if (!response.ok) {
      projectDocumentRemove.disabled = false;
      return alert((await response.json()).error || t("error.documentRemove"));
    }
    updateProjectInState(await response.json());
    await loadProjectDocuments();
    renderProjectDashboard();
    return;
  }
  const moreButton = e.target.closest(".more[data-day]");
  if (moreButton) {
    e.stopPropagation();
    const day = moreButton.dataset.day;
    if (state.expandedDays.has(day)) state.expandedDays.delete(day);
    else state.expandedDays.add(day);
    renderCalendar();
    return;
  }
  const createForDate = e.target.closest("[data-create-date]");
  if (createForDate) {
    e.stopPropagation();
    if (state.suppressCardClick) return;
    if (state.sprintSelection.active) {
      selectSprintDay(createForDate.dataset.createDate);
      return;
    }
    openCreateDialog({
      scheduledFor: createForDate.dataset.createDate,
      invoker: createForDate,
    });
    return;
  }
  const cardButton = e.target.closest("[data-key]");
  if (cardButton && !state.suppressCardClick) {
    openItem(cardButton.dataset.key);
    return;
  }
  const day = e.target.closest(".day[data-drop-date]");
  if (
    day &&
    state.sprintSelection.active &&
    !e.target.closest(".card, .more")
  ) {
    selectSprintDay(day.dataset.dropDate);
  }
  const closeButton = e.target.closest(".close");
  if (closeButton) {
    const dialog = closeButton.closest("dialog");
    if (
      dialog === $("detail") &&
      state.editingWorkItem &&
      !cancelWorkItemEdit()
    )
      return;
    if (
      dialog === $("createDialog") &&
      hasUnsavedNewItem() &&
      !window.confirm(t("validation.unsavedItem"))
    )
      return;
    if (dialog === $("createDialog")) {
      deleteDraft(state.createDraftId);
      state.createDraftId = null;
      state.createEditor?.setMarkdown("");
      $("createForm").reset();
    }
    dialog?.close();
  }
  const nav = e.target.closest(".nav");
  if (nav) {
    setView(nav.dataset.view);
  }
  const projectCard = e.target.closest("[data-project-key]");
  if (projectCard) {
    state.projectIndex = false;
    selectProject(projectCard.dataset.projectKey, false);
    setView("projects");
  }
  const projectAction = e.target.closest("[data-project-action]");
  if (projectAction) handleProjectAction(projectAction.dataset.projectAction);
});
document.addEventListener("pointerover", (event) => {
  const link = event.target.closest?.(
    ".work-item-reference:not(.is-unavailable)",
  );
  if (link && !link.contains(event.relatedTarget)) showReferencePreview(link);
});
document.addEventListener("pointerout", (event) => {
  const link = event.target.closest?.(".work-item-reference");
  if (link && !link.contains(event.relatedTarget)) hideReferencePreview();
});
document.addEventListener("focusin", (event) => {
  const link = event.target.closest?.(
    ".work-item-reference:not(.is-unavailable)",
  );
  if (link) showReferencePreview(link);
});
document.addEventListener("focusout", (event) => {
  if (event.target.closest?.(".work-item-reference")) hideReferencePreview();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") hideReferencePreview();
});
window.addEventListener("scroll", hideReferencePreview, true);
document.addEventListener("submit", async (event) => {
  if (event.target.id !== "projectPeopleForm") return;
  event.preventDefault();
  const project = currentProject();
  const data = new FormData(event.target);
  const members = state.users.flatMap((user) => {
    const role = data.get(`member-${user.id}`);
    return role ? [{ user_id: user.id, role }] : [];
  });
  const response = await apiFetch(`/api/v1/projects/${project.uid}/members`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "If-Match": project._etag,
    },
    body: JSON.stringify({
      owner_user_id: data.get("owner_user_id"),
      team_ids: data.getAll("team_ids"),
      members,
    }),
  });
  if (!response.ok) return alert((await response.json()).error);
  updateProjectInState(await response.json());
  renderProjectDashboard();
});
document.addEventListener("change", async (event) => {
  if (event.target.matches("[data-insight-filter]")) {
    state.insightFilter = event.target.value;
    state.insightPage = 1;
  } else if (event.target.matches("[data-insight-sort]")) {
    state.insightSort = event.target.value;
    state.insightPage = 1;
  } else return;
  state.projectInsights = null;
  renderProjectDashboard();
  await loadProjectInsights();
});
async function scheduleItem(uid, scheduledFor) {
  const item = state.items.find((candidate) => candidate.uid === uid);
  if (!item || item.kind !== "task" || item.scheduled_for === scheduledFor)
    return;
  const response = await apiFetch(`/api/v1/work-items/${uid}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "If-Match": item._etag },
    body: JSON.stringify({ scheduled_for: scheduledFor }),
  });
  if (!response.ok) {
    const failure = await response.json();
    alert(failure.error || t("error.dateUpdate"));
    await load();
    return;
  }
  const updated = await response.json();
  state.items = state.items.map((candidate) =>
    candidate.uid === uid ? updated : candidate,
  );
  render();
}
document.addEventListener("dragstart", (e) => {
  const cardElement = e.target.closest(".card[data-uid]");
  if (!cardElement) return;
  state.draggingUid = cardElement.dataset.uid;
  state.suppressCardClick = true;
  cardElement.classList.add("dragging");
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData("text/work-item-uid", state.draggingUid);
});
document.addEventListener("dragover", (e) => {
  const target = e.target.closest("[data-drop-date]");
  if (!target || !state.draggingUid) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = "move";
  document
    .querySelectorAll(".drop-target")
    .forEach((element) => element.classList.remove("drop-target"));
  target.classList.add("drop-target");
});
document.addEventListener("drop", async (e) => {
  const target = e.target.closest("[data-drop-date]");
  if (!target) return;
  e.preventDefault();
  const uid = e.dataTransfer.getData("text/work-item-uid") || state.draggingUid;
  target.classList.remove("drop-target");
  await scheduleItem(uid, target.dataset.dropDate || null);
});
document.addEventListener("dragend", (e) => {
  e.target.closest(".card")?.classList.remove("dragging");
  document
    .querySelectorAll(".drop-target")
    .forEach((element) => element.classList.remove("drop-target"));
  state.draggingUid = null;
  setTimeout(() => (state.suppressCardClick = false), 0);
});
document.addEventListener("change", async (event) => {
  if (event.target.id !== "projectDocumentUpload") return;
  const files = [...event.target.files];
  event.target.value = "";
  if (!files.length) return;
  try {
    await uploadProjectDocuments(files);
  } catch (error) {
    alert(error.message);
  }
});
document.addEventListener("submit", async (event) => {
  if (event.target.id !== "projectDocumentReferenceForm") return;
  event.preventDefault();
  const project = currentProject();
  if (!project) return;
  const button = event.target.querySelector('button[type="submit"]');
  button.disabled = true;
  const response = await apiFetch(
    `/api/v1/projects/${project.uid}/document-references`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "If-Match": project._etag,
      },
      body: JSON.stringify(Object.fromEntries(new FormData(event.target))),
    },
  );
  button.disabled = false;
  if (!response.ok)
    return alert((await response.json()).error || t("error.documentLink"));
  updateProjectInState(await response.json());
  await loadProjectDocuments();
  renderProjectDashboard();
});
for (const id of ["statusFilter", "teamFilter", "priorityFilter", "search"])
  $(id).addEventListener(id === "search" ? "input" : "change", render);
function selectProject(key, updateAddress = true) {
  if (!state.projects.some((project) => project.key === key)) return;
  if (state.view === "projects") state.projectIndex = false;
  state.selectedProject = key;
  state.projectSection = "overview";
  state.projectDocuments = [];
  state.projectInsights = null;
  state.insightProjectKey = key;
  state.insightPage = 1;
  window.localStorage.setItem("work-tracker-project", key);
  const dates = filtered()
    .map((item) => item.scheduled_for)
    .filter(Boolean)
    .sort();
  if (dates.length) state.month = new Date(`${dates.at(-1)}T12:00:00`);
  if (updateAddress) {
    const project = currentProject();
    history.replaceState({}, "", viewCanonical(state.view, project));
  }
  render();
  void Promise.all([loadProjectCollaborators(key), loadProjectInsights()]);
}
function openProjectEdit() {
  const project = currentProject();
  if (!project) return;
  const form = $("projectEditForm");
  form.elements.name.value = project.name;
  form.elements.description.value = project.description || "";
  form.elements.status.value = project.status;
  $("projectImmutable").textContent = t("project.immutable", {
    key: project.key,
    code: project.code,
    uid: project.uid.slice(0, 8),
  });
  $("projectEditDialog").showModal();
}
function handleProjectAction(action) {
  if (action === "calendar") return setView("calendar");
  if (action === "new-item" && currentProject()?.status === "active")
    return openCreateDialog();
  if (action === "sprint" && currentProject()?.status === "active")
    return $("sprintDialog").showModal();
  if (action === "edit") openProjectEdit();
}
$("newProject").onclick = () => $("projectDialog").showModal();
$("newProjectFromList").onclick = () => $("projectDialog").showModal();
$("projectForm").onsubmit = async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const response = await apiFetch("/api/v1/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(Object.fromEntries(new FormData(form))),
  });
  if (!response.ok) return alert((await response.json()).error);
  const project = await response.json();
  state.projects.push(project);
  state.projects.sort((a, b) => a.key.localeCompare(b.key));
  $("projectDialog").close();
  form.reset();
  selectProject(project.key);
};
$("projectEditForm").onsubmit = async (event) => {
  event.preventDefault();
  const project = currentProject();
  if (!project) return;
  const response = await apiFetch(`/api/v1/projects/${project.uid}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "If-Match": project._etag,
    },
    body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))),
  });
  if (!response.ok) {
    const failure = await response.json();
    if (response.status === 409) return alert(t("validation.projectChanged"));
    return alert(failure.error || t("error.projectUpdate"));
  }
  const updated = await response.json();
  state.projects = state.projects.map((candidate) =>
    candidate.uid === updated.uid ? updated : candidate,
  );
  $("projectEditDialog").close();
  history.replaceState({}, "", projectCanonical(updated));
  render();
};
$("previousMonth").onclick = () => {
  state.month = new Date(
    state.month.getFullYear(),
    state.month.getMonth() - 1,
    1,
  );
  render();
};
$("nextMonth").onclick = () => {
  state.month = new Date(
    state.month.getFullYear(),
    state.month.getMonth() + 1,
    1,
  );
  render();
};
$("today").onclick = () => {
  const dates = filtered()
    .map((i) => i.scheduled_for)
    .filter(Boolean)
    .sort();
  if (dates.length) state.month = new Date(`${dates.at(-1)}T12:00:00`);
  render();
};
function plannerMessage(text) {
  $("plannerStatus").textContent = text;
  $("plannerStatus").hidden = !text;
}
function selectSprintDay(date) {
  if (!state.sprintSelection.start) {
    state.sprintSelection.start = date;
    plannerMessage(t("sprint.endPrompt", { date }));
    render();
    return;
  }
  const [start, end] = [state.sprintSelection.start, date].sort();
  const form = $("sprintForm");
  form.elements.start_date.value = start;
  form.elements.end_date.value = end;
  state.sprintSelection = { active: false, start: null };
  plannerMessage("");
  render();
  $("sprintDialog").showModal();
}
$("sprintButton").onclick = () => $("sprintDialog").showModal();
$("selectSprintDates").onclick = () => {
  state.sprintSelection = { active: true, start: null };
  $("sprintDialog").close();
  plannerMessage(t("sprint.startPrompt"));
  render();
};
$("sprintForm").onsubmit = async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  const data = Object.fromEntries(new FormData(form));
  data.project_key = state.selectedProject;
  const response = await apiFetch("/api/v1/sprints", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!response.ok) return alert((await response.json()).error);
  state.sprints.push(await response.json());
  state.sprints.sort((a, b) => a.start_date.localeCompare(b.start_date));
  $("sprintDialog").close();
  form.reset();
  render();
};
$("copyLink").onclick = async () => {
  await navigator.clipboard.writeText(
    new URL(canonical(state.selected), location.origin),
  );
  $("copyLink").textContent = t("work.linkCopied");
  setTimeout(() => ($("copyLink").textContent = t("work.copyLink")), 1400);
};
$("editWorkItem").onclick = startWorkItemEdit;
$("editMetadata").onsubmit = async (event) => {
  event.preventDefault();
  let estimateMinutes;
  try {
    estimateMinutes = estimateFromControls(
      $("editEstimate"),
      $("editEstimateCustom"),
    );
  } catch (error) {
    alert(error.message);
    return;
  }
  const button = $("saveMetadata");
  button.disabled = true;
  try {
    await patchSelectedWorkItem({
      status: $("editStatus").value,
      team_id: $("editTeam").value || null,
      assignee_id: $("editAssignee").value || null,
      reviewer_id: $("editReviewer").value || null,
      follower_ids: [...state.editFollowerIds],
      priority: $("editPriority").value || null,
      estimate_minutes: estimateMinutes,
      scheduled_for: $("editDate").value || null,
      scheduled_time: $("editTime").value || null,
      transition_note: $("editTransitionNote").value.trim(),
    });
  } finally {
    button.disabled = false;
  }
};
$("activityForm").onsubmit = async (event) => {
  event.preventDefault();
  if (!state.selected) return;
  const body = state.activityEditor?.getMarkdown().trim() || "";
  if (!body) return;
  const button = $("addActivity");
  button.disabled = true;
  const response = await apiFetch(
    `/api/v1/work-items/${state.selected.uid}/activities`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "If-Match": state.selected._etag,
      },
      body: JSON.stringify({ body }),
    },
  );
  button.disabled = false;
  if (response.status === 409) {
    alert(t("work.conflictReload"));
    await openItem(state.selected.key, false);
    return;
  }
  if (!response.ok)
    return alert((await response.json()).error || t("error.activityAdd"));
  const result = await response.json();
  state.selected = result.record;
  state.items = state.items.map((item) =>
    item.uid === result.record.uid ? result.record : item,
  );
  state.activityEditor?.setMarkdown("");
  renderWorkItemChrome(result.record);
  render();
};
$("toggleDone").onclick = async () => {
  if (!state.selected) return;
  $("toggleDone").disabled = true;
  const current = state.selected;
  let status = "done";
  let transition_note = "";
  if (current.status === "done") {
    status = "in_progress";
    transition_note = window.prompt(t("work.transitionNote")) || "";
    if (!transition_note) {
      $("toggleDone").disabled = false;
      return;
    }
  } else if (current.status === "backlog") status = "planned";
  else if (current.status === "planned") status = "in_progress";
  else if (current.status === "waiting") status = "in_progress";
  else if (current.reviewer_id && current.status === "in_progress")
    status = "review";
  await patchSelectedWorkItem({ status, transition_note });
  $("toggleDone").disabled = false;
};
$("cancelWorkItemEdit").onclick = cancelWorkItemEdit;
$("saveWorkItem").onclick = saveWorkItemBody;
$("copyDraft").onclick = async () => {
  await navigator.clipboard.writeText(state.detailEditor?.getMarkdown() || "");
  $("copyDraft").textContent = t("work.draftCopied");
};
$("reloadWorkItem").onclick = async () => {
  if (!state.selected) return;
  await openItem(state.selected.key, false);
};
$("detail").addEventListener("cancel", (event) => {
  if (state.editingWorkItem && !cancelWorkItemEdit()) event.preventDefault();
});
$("detail").addEventListener("close", () => {
  state.itemOpenRequest += 1;
  state.detailViewer?.destroy();
  state.detailViewer = null;
  state.detailEditor?.destroy();
  state.detailEditor = null;
  state.activityEditor?.destroy();
  state.activityEditor = null;
  for (const viewer of state.activityViewers) viewer.destroy();
  state.activityViewers = [];
  $("activityEditor").innerHTML = "";
  state.editingWorkItem = false;
  state.detailDirty = false;
  if (
    !state.suppressDetailHistory &&
    location.pathname.startsWith("/work-items/")
  ) {
    const navigation = history.state;
    if (navigation?.originInHistory)
      history.go(-((navigation.trail?.length || 0) + 1));
    else history.pushState({}, "", state.returnPath || "/");
  }
  state.suppressDetailHistory = false;
  state.itemTrail = [];
  state.selected = null;
  $("detailLoading").hidden = true;
  $("detailGrid").hidden = false;
  renderBreadcrumb();
  updateDocumentTitle();
});
$("createDialog").addEventListener("cancel", (event) => {
  if (hasUnsavedNewItem() && !window.confirm(t("validation.unsavedItem"))) {
    event.preventDefault();
    return;
  }
  state.createEditor?.setMarkdown("");
  deleteDraft(state.createDraftId);
  state.createDraftId = null;
  $("createForm").reset();
});
window.onpopstate = async (event) => {
  if (state.editingWorkItem && !cancelWorkItemEdit()) {
    history.forward();
    return;
  }
  const route = location.pathname.match(
    /^\/work-items\/([A-Z][A-Z0-9]{1,7}-(?:\d{4}[A-Z]?|BL-\d{3}))/i,
  );
  if (route) {
    state.returnPath = event.state?.returnPath || state.returnPath || "/";
    state.itemTrail = Array.isArray(event.state?.trail)
      ? event.state.trail
      : [];
    await openItem(route[1], false);
    return;
  }
  if ($("detail").open) {
    state.suppressDetailHistory = true;
    $("detail").close();
  }
  location.reload();
};
window.addEventListener("beforeunload", (event) => {
  if (!hasUnsavedWorkItem() && !hasUnsavedNewItem()) return;
  event.preventDefault();
  event.returnValue = "";
});
$("newItem").onclick = () => openCreateDialog();
$("detailBack").onclick = () => {
  if (state.editingWorkItem && !cancelWorkItemEdit()) return;
  history.back();
};
$("localeSelect").onchange = (event) => {
  window.localStorage.setItem("sprintmark-locale", event.target.value);
  document.documentElement.lang = event.target.value;
  renderStatusOptions();
  renderBuildMeta();
  render();
  if ($("detail").open && state.selected) renderWorkItemChrome(state.selected);
  if ($("documentPreviewDialog").open && state.documentSections.length)
    renderDocumentSection(state.activeDocumentSection);
  updateDocumentTitle($("detail").open ? state.selected : null);
};
$("createForm").onsubmit = async (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.currentTarget));
  data.body = state.createEditor?.getMarkdown() || "";
  data.project_key = state.selectedProject;
  data.draft_id = state.createDraftId;
  if (!data.scheduled_for) data.scheduled_for = null;
  if (!data.scheduled_time) data.scheduled_time = null;
  if (!data.priority) data.priority = null;
  try {
    data.estimate_minutes = estimateFromControls(
      $("createEstimate"),
      $("createEstimateCustom"),
    );
  } catch (error) {
    return alert(error.message);
  }
  const r = await apiFetch("/api/v1/work-items", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!r.ok) return alert((await r.json()).error);
  const item = await r.json();
  state.createDraftId = null;
  state.items.push(item);
  invalidateProjectInsights();
  state.createEditor?.setMarkdown("");
  e.currentTarget.reset();
  $("createDialog").close();
  render();
  openItem(item.key);
};
async function uploadSelectedEvidence() {
  const files = [...$("attachment").files];
  if (!files.length) return;
  try {
    for (const file of files) await uploadWorkItemFile(file, "evidence");
  } catch (error) {
    return alert(error.message);
  }
  $("attachment").value = "";
  await openItem(state.selected.key, false);
}
$("attachment").addEventListener("change", uploadSelectedEvidence);
$("evidencePasteZone").addEventListener("click", () => $("attachment").click());
async function uploadSelectedDraftEvidence() {
  const files = [...$("createAttachment").files];
  if (!files.length) return;
  try {
    for (const file of files)
      await uploadDraftFile(state.createDraftId, file, "evidence");
  } catch (error) {
    return alert(error.message);
  }
  $("createAttachment").value = "";
}
$("createAttachment").addEventListener("change", uploadSelectedDraftEvidence);
$("createEvidencePasteZone").addEventListener("click", () =>
  $("createAttachment").click(),
);
$("createEvidencePasteZone").addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  $("createAttachment").click();
});
$("attachments").addEventListener("click", async (event) => {
  const preview = event.target.closest("[data-lightbox-url]");
  if (preview) {
    $("lightboxImage").src = preview.dataset.lightboxUrl;
    $("lightboxImage").alt = preview.dataset.lightboxAlt;
    $("lightboxCaption").textContent = preview.dataset.lightboxAlt;
    $("imageLightbox").showModal();
    return;
  }
  const remove = event.target.closest("[data-attachment-name]");
  if (!remove || !state.selected) return;
  if (!globalThis.confirm(t("validation.removeEvidence"))) return;
  remove.disabled = true;
  const response = await apiFetch(
    `/api/v1/work-items/${state.selected.uid}/attachments/${encodeURIComponent(remove.dataset.attachmentName)}`,
    {
      method: "DELETE",
      headers: { "If-Match": state.selected._etag },
    },
  );
  if (!response.ok) {
    remove.disabled = false;
    return alert((await response.json()).error || t("error.evidenceRemove"));
  }
  await openItem(state.selected.key, false);
});
$("imageLightbox").addEventListener("click", (event) => {
  if (event.target === $("imageLightbox")) $("imageLightbox").close();
});
$("imageLightbox")
  .querySelector(".lightbox-close")
  .addEventListener("click", () => $("imageLightbox").close());
$("documentPreviewDialog").addEventListener("close", () => {
  state.documentPreviewViewer?.destroy();
  state.documentPreviewViewer = null;
  state.activeProjectDocument = null;
  state.documentSections = [];
  $("documentPreviewBody").innerHTML = "";
  $("documentOutline").innerHTML = "";
  updateDocumentTitle();
});

function clipboardImages(event) {
  return [...(event.clipboardData?.items || [])]
    .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
    .map((item) => item.getAsFile())
    .filter(Boolean);
}
async function pasteEvidence(event, uploader) {
  const files = clipboardImages(event);
  if (!files.length) return;
  event.preventDefault();
  try {
    for (const file of files) await uploader(file, "evidence");
    if (state.selected) await openItem(state.selected.key, false);
  } catch (error) {
    alert(error.message);
  }
}
$("evidencePasteZone").addEventListener("paste", (event) =>
  pasteEvidence(event, uploadWorkItemFile),
);
$("createEvidencePasteZone").addEventListener("paste", (event) =>
  pasteEvidence(event, (file, placement) =>
    uploadDraftFile(state.createDraftId, file, placement),
  ),
);
for (const id of [
  "editStatus",
  "editTeam",
  "editAssignee",
  "editReviewer",
  "editTransitionNote",
  "editPriority",
  "editDate",
  "editTime",
  "editEstimate",
  "editEstimateCustom",
])
  $(id).addEventListener("change", () => {
    if (state.editingWorkItem) state.detailDirty = true;
  });
$("createEstimate").addEventListener("change", () =>
  updateEstimateCustom($("createEstimate"), $("createEstimateCustom")),
);
$("editEstimate").addEventListener("change", () =>
  updateEstimateCustom($("editEstimate"), $("editEstimateCustom")),
);
$("manageFollowers").addEventListener("click", () => {
  const panel = $("followerPanel");
  panel.hidden = !panel.hidden;
  $("manageFollowers").setAttribute("aria-expanded", String(!panel.hidden));
  if (!panel.hidden) $("followerSearch").focus();
});
$("followerSearch").addEventListener("input", (event) =>
  renderFollowerOptions(event.target.value),
);
$("followerOptions").addEventListener("change", (event) => {
  const checkbox = event.target.closest("[data-follower-id]");
  if (!checkbox) return;
  if (checkbox.checked) state.editFollowerIds.add(checkbox.dataset.followerId);
  else state.editFollowerIds.delete(checkbox.dataset.followerId);
  refreshFollowerControls();
  $("followerPanel").hidden = false;
  $("manageFollowers").setAttribute("aria-expanded", "true");
});
$("toggleFollowing").addEventListener("click", () => {
  const userId = state.session?.user?.id;
  if (!userId) return;
  if (state.editFollowerIds.has(userId)) state.editFollowerIds.delete(userId);
  else state.editFollowerIds.add(userId);
  refreshFollowerControls();
});
function enableFileDrop(id, uploader) {
  const zone = $(id);
  zone.addEventListener("dragover", (event) => {
    if (
      ![...(event.dataTransfer?.items || [])].some(
        (item) => item.kind === "file",
      )
    )
      return;
    event.preventDefault();
    zone.classList.add("drop-target");
  });
  zone.addEventListener("dragleave", () =>
    zone.classList.remove("drop-target"),
  );
  zone.addEventListener("drop", async (event) => {
    const files = [...(event.dataTransfer?.files || [])];
    if (!files.length) return;
    event.preventDefault();
    zone.classList.remove("drop-target");
    try {
      for (const file of files) await uploader(file, "evidence");
      if (state.selected) await openItem(state.selected.key, false);
    } catch (error) {
      alert(error.message);
    }
  });
}
enableFileDrop("evidencePasteZone", uploadWorkItemFile);
enableFileDrop("createEvidencePasteZone", (file, placement) =>
  uploadDraftFile(state.createDraftId, file, placement),
);
$("notificationButton").addEventListener("click", () => {
  $("notificationPanel").hidden = !$("notificationPanel").hidden;
});
$("notificationPanel").addEventListener("click", async (event) => {
  const link = event.target.closest("[data-notification-id]");
  if (!link || !state.notificationEtag) return;
  const response = await apiFetch(
    `/api/v1/notifications/${link.dataset.notificationId}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "If-Match": state.notificationEtag,
      },
      body: JSON.stringify({ read: true }),
    },
  );
  if (response.ok) state.notificationEtag = response.headers.get("etag");
});
$("logoutButton").addEventListener("click", async () => {
  const response = await apiFetch("/api/v1/logout", { method: "POST" });
  if (!response.ok) return;
  state.session = null;
  history.replaceState({}, "", "/projects/");
  renderLogin();
});
load().catch((error) => {
  renderAccessView(
    `<section class="not-found"><h1>${t("app.loadError")}</h1><p>${escapeHtml(error.message)}</p><button type="button" onclick="location.reload()">${t("setup.retry")}</button></section>`,
    "error",
  );
});
