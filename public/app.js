import { locale, t, tp, translateDocument } from "./i18n.js";

const initialView = location.pathname.startsWith("/projects")
  ? "projects"
  : location.pathname.startsWith("/backlog")
    ? "backlog"
    : "calendar";
const state = {
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
  expandedDays: new Set(),
  sprintSelection: { active: false, start: null },
  detailEditor: null,
  detailViewer: null,
  documentPreviewViewer: null,
  createEditor: null,
  createDraftId: null,
  editDraftId: null,
  createContext: null,
  meta: null,
  editingWorkItem: false,
  detailDirty: false,
  returnPath: "/",
};
const $ = (id) => document.getElementById(id);
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
document.documentElement.classList.add("i18n-ready");
const escapeHtml = (v) =>
  String(v ?? "").replace(
    /[&<>\"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );
const teamName = (value) =>
  t(
    value === "web-development"
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
const workItemStatuses = (item) =>
  item.kind === "backlog"
    ? ["triage", "software", "waiting", "done"]
    : ["open", "done"];
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
function renderProjectOptions() {
  $("projectSelect").innerHTML = state.projects
    .filter(
      (project) =>
        project.status === "active" || project.key === state.selectedProject,
    )
    .map(
      (project) =>
        `<option value="${project.key}">${escapeHtml(project.name)} (${project.code})${project.status === "archived" ? ` · ${t("project.status.archived")}` : ""}</option>`,
    )
    .join("");
  $("projectSelect").value = state.selectedProject;
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
function sanitizeEditorHtml(html) {
  return window.DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
}
function makeEditor(
  element,
  initialValue = "",
  height = "430px",
  onChange = null,
  imageUploader = null,
) {
  const editor = new window.toastui.Editor({
    el: element,
    height,
    initialEditType: "wysiwyg",
    previewStyle: "vertical",
    hideModeSwitch: true,
    usageStatistics: false,
    initialValue,
    toolbarItems: editorToolbar,
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
  if (onChange) editor.on("change", onChange);
  return editor;
}
function openLinksInNewTab(root) {
  for (const link of root.querySelectorAll("a")) {
    link.target = "_blank";
    link.rel = "noopener noreferrer";
  }
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
      (!team || i.team === team) &&
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
    html += `<div class="day${outside}${today}${sprintClass}${pickClass}" data-drop-date="${iso}"><div class="date"><span>${date.getDate()}</span><span><button class="day-add" data-create-date="${iso}" title="${t("calendar.addToDay")}">+</button><span class="count">${dayItems.length ? tp("calendar.itemCount", dayItems.length) : ""}</span></span></div><div class="sprint-markers">${markers}</div>${visibleItems.map(card).join("")}${moreButton}</div>`;
  }
  $("calendar").innerHTML = html;
  const undated = items.filter((i) => !i.scheduled_for);
  $("undated").innerHTML =
    undated.map(card).join("") || `<span>${t("calendar.empty")}</span>`;
  $("undatedCount").textContent = tp("calendar.itemCount", undated.length);
}
function renderBacklog() {
  const items = filtered().filter((i) => i.kind === "backlog"),
    statuses = ["software", "triage", "waiting", "done"];
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
      return `<button class="project-list-card${!state.projectIndex && project.key === state.selectedProject ? " active" : ""}" data-project-key="${project.key}"><span><strong>${escapeHtml(project.name)}</strong><small>${project.key} · ${project.code}</small></span><span class="project-status ${project.status}">${t(project.status === "active" ? "project.status.active" : "project.status.archived")}</span><small>${tp("count.task", taskCount)} · ${tp("count.backlog", backlogCount)}</small></button>`;
    })
    .join("");
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
  renderProjectOptions();
}

async function loadProjectDocuments() {
  const project = currentProject();
  if (!project) return;
  const response = await fetch(`/api/v1/projects/${project.uid}/documents`);
  if (!response.ok)
    throw new Error((await response.json()).error || t("error.documentsLoad"));
  state.projectDocuments = (await response.json()).items;
}

async function setProjectSection(section, updateAddress = true) {
  if (!["overview", "documents"].includes(section)) return;
  state.projectSection = section;
  if (section === "documents") {
    try {
      await loadProjectDocuments();
    } catch (error) {
      alert(error.message);
    }
  }
  if (updateAddress && state.view === "projects") {
    const project = currentProject();
    const suffix = section === "documents" ? "?tab=documents" : "";
    if (project)
      history.replaceState({}, "", `${projectCanonical(project)}${suffix}`);
  }
  renderProjectDashboard();
  renderBreadcrumb();
  translateDocument();
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
  const response = await fetch(projectDocument.url);
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
    const response = await fetch(`/api/v1/projects/${project.uid}/documents`, {
      method: "POST",
      headers: { "If-Match": project._etag },
      body: data,
    });
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
  const overview = `<section class="project-metrics"><article><span>${t("dashboard.completed")}</span><strong>%${progress}</strong><small>${tp("dashboard.completedCaption", tasks.length, { done, total: tasks.length })}</small></article><article><span>${t("dashboard.open")}</span><strong>${open}</strong><small>${t("dashboard.openCaption")}</small></article><article><span>${t("dashboard.backlog")}</span><strong>${backlog}</strong><small>${t("dashboard.backlogCaption")}</small></article><article><span>${t("dashboard.unscheduled")}</span><strong>${undated}</strong><small>${t("dashboard.unscheduledCaption")}</small></article></section>${sprintSection}<section class="dashboard-section"><div class="section-head"><div><h3>${t("dashboard.recent")}</h3><p>${t("dashboard.recentCaption")}</p></div></div><div class="recent-items">${recent
    .map(
      (item) =>
        `<button data-key="${item.key}"><span><strong>${item.key}</strong>${escapeHtml(item.title)}</span><small>${item.completed_at ? `✓ ${escapeHtml(relativeElapsed(item.completed_at))} · ` : ""}${item.updated_at.slice(0, 10)} · ${statusName(item.status)}</small></button>`,
    )
    .join("")}</div></section>`;
  $("projectDashboard").innerHTML =
    `<section class="project-hero"><div><span class="eyebrow">${project.key} · ${project.code}</span><h2>${escapeHtml(project.name)}</h2><p>${escapeHtml(project.description || "")}</p></div><div class="project-actions"><button data-project-action="calendar">${t("project.goCalendar")}</button><button data-project-action="new-item" ${project.status === "archived" ? "disabled" : ""}>${t("project.createItem")}</button><button data-project-action="sprint" ${project.status === "archived" ? "disabled" : ""}>${t("sprint.create")}</button><button data-project-action="edit">${t("project.edit")}</button></div></section><nav class="project-tabs" aria-label="${t("project.sectionsLabel")}"><button data-project-tab="overview" class="${state.projectSection === "overview" ? "active" : ""}" aria-selected="${state.projectSection === "overview"}">${t("breadcrumb.overview")}</button><button data-project-tab="documents" class="${state.projectSection === "documents" ? "active" : ""}" aria-selected="${state.projectSection === "documents"}">${t("breadcrumb.documents")} <span>${project.documents?.length || 0}</span></button></nav>${state.projectSection === "documents" ? renderProjectDocuments(project) : overview}`;
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
function renderWorkItemChrome(item) {
  $("detailTitle").textContent = item.title;
  $("detailKey").textContent = item.key;
  $("detailUid").textContent = `UUID ${item.uid.slice(0, 8)}`;
  $("detailStatus").textContent = statusName(item.status);
  $("detailPriority").textContent = priorityName(item.priority);
  $("detailTeam").textContent = teamName(item.team);
  $("editStatus").innerHTML = workItemStatuses(item)
    .map((status) => `<option value="${status}">${statusName(status)}</option>`)
    .join("");
  $("editStatus").value = item.status;
  $("editTeam").value = item.team;
  $("editPriority").value = item.priority || "";
  $("editDate").value = item.scheduled_for || "";
  $("editTime").value = item.scheduled_time || "";
  $("toggleDone").textContent =
    item.status === "done" ? t("work.reopen") : t("work.markDone");
  $("toggleDone").classList.toggle("reopen", item.status === "done");
  const completionFact = item.completed_at
    ? `<dt>${t("work.completedAt")}</dt><dd class="completion-time"><time datetime="${escapeHtml(item.completed_at)}">${localDateTime(item.completed_at)}</time><small>${escapeHtml(relativeElapsed(item.completed_at))}</small></dd>`
    : "";
  $("facts").innerHTML =
    `<dt>${t("work.project")}</dt><dd>${escapeHtml(state.projects.find((project) => project.key === item.project_key)?.name || item.project_key)}</dd><dt>${t("work.calendar")}</dt><dd>${item.scheduled_for ? `${item.scheduled_for}${item.scheduled_time ? ` · ${item.scheduled_time}` : ""}` : "—"}</dd><dt>${t("work.priority")}</dt><dd>${priorityName(item.priority)}</dd>${completionFact}<dt>${t("work.created")}</dt><dd>${localDateTime(item.created_at)}</dd><dt>${t("work.updated")}</dt><dd>${localDateTime(item.updated_at)}</dd><dt>${t("work.legacyId")}</dt><dd>${item.legacy_ids.join(", ") || "—"}</dd>`;
  renderEvidence(item);
  translateDocument();
}
async function openItem(key, push = true) {
  const response = await fetch(`/api/v1/work-items/${key}`);
  if (!response.ok) {
    location.href = `/work-items/${key}/bulunamadi`;
    return;
  }
  const item = await response.json();
  const referencesResponse = await fetch(
    `/api/v1/work-items/${item.uid}/file-references`,
  );
  state.fileReferences = referencesResponse.ok
    ? (await referencesResponse.json()).items
    : [];
  state.detailEditor?.destroy();
  state.detailEditor = null;
  state.editingWorkItem = false;
  state.detailDirty = false;
  state.selected = item;
  if (state.selectedProject !== item.project_key) {
    state.selectedProject = item.project_key;
    window.localStorage.setItem("work-tracker-project", item.project_key);
    renderProjectOptions();
    render();
  }
  renderWorkItemChrome(item);
  $("detailBody").hidden = false;
  $("detailEditor").hidden = true;
  $("editorActions").hidden = true;
  $("editConflict").hidden = true;
  $("editWorkItem").hidden = false;
  if (push) {
    state.returnPath = `${location.pathname}${location.search}`;
    history.pushState({ key: item.key }, "", canonical(item));
  }
  if (!$("detail").open) $("detail").showModal();
  renderBreadcrumb();
  updateDocumentTitle(item);
  window.requestAnimationFrame(() => renderWorkItemViewer(item.body));
}
async function createDraft() {
  const response = await fetch("/api/v1/drafts", { method: "POST" });
  if (!response.ok)
    throw new Error((await response.json()).error || t("error.draftCreate"));
  return response.json();
}
async function deleteDraft(id) {
  if (!id) return;
  await fetch(`/api/v1/drafts/${id}`, { method: "DELETE" }).catch(() => {});
}
async function uploadDraftFile(draftId, file, placement = "evidence") {
  if (!draftId) throw new Error(t("error.draftMissing"));
  const data = new FormData();
  data.append("file", file, file.name || `clipboard-${Date.now()}.png`);
  data.append("placement", placement);
  data.append("alt", file.name || "Clipboard image");
  const response = await fetch(`/api/v1/drafts/${draftId}/attachments`, {
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
  const response = await fetch(
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
  const response = await fetch(`/api/v1/work-items/${state.selected.uid}`, {
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
  const response = await fetch(`/api/v1/work-items/${state.selected.uid}`, {
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
  render();
  await openItem(updated.key, false);
  return updated;
}
async function openCreateDialog(context = null) {
  if (currentProject()?.status !== "active") return;
  state.createContext = context;
  const draft = await createDraft();
  state.createDraftId = draft.id;
  const form = $("createForm");
  if (context?.scheduledFor) {
    const now = new Date();
    form.elements.scheduled_for.value = context.scheduledFor;
    form.elements.scheduled_time.value = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
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
  });
}
async function load() {
  const [projects, records, sprints, meta] = await Promise.all([
    fetch("/api/v1/projects").then((r) => r.json()),
    fetch("/api/v1/work-items").then((r) => r.json()),
    fetch("/api/v1/sprints").then((r) => r.json()),
    fetch("/api/v1/meta").then((r) => r.json()),
  ]);
  state.projects = projects.items;
  state.items = records.items;
  state.sprints = sprints.items;
  state.meta = meta;
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
  state.projectSection =
    state.view === "projects" &&
    new window.URLSearchParams(location.search).get("tab") === "documents"
      ? "documents"
      : "overview";
  if (state.projectSection === "documents") await loadProjectDocuments();
  renderProjectOptions();
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
  if (route) openItem(route[1], false);
}
document.addEventListener("click", async (e) => {
  const projectTab = e.target.closest("[data-project-tab]");
  if (projectTab) {
    await setProjectSection(projectTab.dataset.projectTab);
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
    const response = await fetch(
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
    openCreateDialog({ scheduledFor: createForDate.dataset.createDate });
    return;
  }
  const cardButton = e.target.closest("[data-key]");
  if (cardButton && !state.suppressCardClick) openItem(cardButton.dataset.key);
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
async function scheduleItem(uid, scheduledFor) {
  const item = state.items.find((candidate) => candidate.uid === uid);
  if (!item || item.kind !== "task" || item.scheduled_for === scheduledFor)
    return;
  const response = await fetch(`/api/v1/work-items/${uid}`, {
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
  const response = await fetch(
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
  window.localStorage.setItem("work-tracker-project", key);
  renderProjectOptions();
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
$("projectSelect").onchange = (event) => selectProject(event.target.value);
$("newProject").onclick = () => $("projectDialog").showModal();
$("newProjectFromList").onclick = () => $("projectDialog").showModal();
$("projectForm").onsubmit = async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const response = await fetch("/api/v1/projects", {
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
  const response = await fetch(`/api/v1/projects/${project.uid}`, {
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
  renderProjectOptions();
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
  const response = await fetch("/api/v1/sprints", {
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
  const button = $("saveMetadata");
  button.disabled = true;
  await patchSelectedWorkItem({
    status: $("editStatus").value,
    team: $("editTeam").value,
    priority: $("editPriority").value || null,
    scheduled_for: $("editDate").value || null,
    scheduled_time: $("editTime").value || null,
  });
  button.disabled = false;
};
$("toggleDone").onclick = async () => {
  if (!state.selected) return;
  $("toggleDone").disabled = true;
  await patchSelectedWorkItem({
    status:
      state.selected.status === "done"
        ? state.selected.kind === "backlog"
          ? "triage"
          : "open"
        : "done",
  });
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
  state.detailViewer?.destroy();
  state.detailViewer = null;
  state.detailEditor?.destroy();
  state.detailEditor = null;
  state.editingWorkItem = false;
  state.detailDirty = false;
  if (location.pathname.startsWith("/work-items/"))
    history.pushState({}, "", state.returnPath || "/");
  state.selected = null;
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
window.onpopstate = () => location.reload();
window.addEventListener("beforeunload", (event) => {
  if (!hasUnsavedWorkItem() && !hasUnsavedNewItem()) return;
  event.preventDefault();
  event.returnValue = "";
});
$("newItem").onclick = openCreateDialog;
$("localeSelect").onchange = (event) => {
  window.localStorage.setItem("sprintmark-locale", event.target.value);
  document.documentElement.lang = event.target.value;
  renderProjectOptions();
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
  const r = await fetch("/api/v1/work-items", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!r.ok) return alert((await r.json()).error);
  const item = await r.json();
  state.createDraftId = null;
  state.items.push(item);
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
  const response = await fetch(
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
  "editPriority",
  "editDate",
  "editTime",
])
  $(id).addEventListener("change", () => {
    if (state.editingWorkItem) state.detailDirty = true;
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
load().catch((error) => {
  document.body.classList.remove("app-loading");
  document.querySelector("main").innerHTML =
    `<section class="not-found"><h1>${t("app.loadError")}</h1><p>${escapeHtml(error.message)}</p></section>`;
});
