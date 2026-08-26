import { locale, t, translateDocument } from "./i18n.js";

const state = {
  projects: [],
  selectedProject: null,
  items: [],
  sprints: [],
  view: "calendar",
  month: new Date(),
  selected: null,
  draggingUid: null,
  suppressCardClick: false,
  sprintSelection: { active: false, start: null },
  detailEditor: null,
  detailViewer: null,
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
const escapeHtml = (v) =>
  String(v ?? "").replace(
    /[&<>\"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );
const teamName = (v) =>
  t(v === "web-development" ? "Web Yazılım" : "İçerik / Teknik");
const statusName = (v) =>
  t(
    {
      open: "Açık",
      done: "Tamamlandı",
      triage: "Değerlendirilecek",
      software: "Yazılıma İletilecek",
      waiting: "Beklemede",
    }[v] || v,
  );
const sprintStatusName = (v) =>
  t({ planned: "Planlandı", active: "Aktif", completed: "Tamamlandı" }[v] || v);
const priorityName = (v) =>
  t(
    { critical: "Kritik", high: "Yüksek", medium: "Orta", low: "Düşük" }[v] ||
      "Belirlenmedi",
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
const currentProject = () =>
  state.projects.find((project) => project.key === state.selectedProject);
const projectSprints = () =>
  state.sprints.filter(
    (sprint) => sprint.project_key === state.selectedProject,
  );
function renderProjectOptions() {
  $("projectSelect").innerHTML = state.projects
    .filter(
      (project) =>
        project.status === "active" || project.key === state.selectedProject,
    )
    .map(
      (project) =>
        `<option value="${project.key}">${escapeHtml(project.name)} (${project.code})${project.status === "archived" ? " · Arşiv" : ""}</option>`,
    )
    .join("");
  $("projectSelect").value = state.selectedProject;
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
    html += `<div class="day${outside}${today}${sprintClass}${pickClass}" data-drop-date="${iso}"><div class="date"><span>${date.getDate()}</span><span><button class="day-add" data-create-date="${iso}" title="Bu güne iş ekle">+</button><span class="count">${dayItems.length ? `${dayItems.length} iş` : ""}</span></span></div><div class="sprint-markers">${markers}</div>${dayItems.slice(0, 4).map(card).join("")}${dayItems.length > 4 ? `<button class="more" data-day="${iso}">+${dayItems.length - 4} daha</button>` : ""}</div>`;
  }
  $("calendar").innerHTML = html;
  const undated = items.filter((i) => !i.scheduled_for);
  $("undated").innerHTML = undated.map(card).join("") || "<span>Yok</span>";
  $("undatedCount").textContent = `${undated.length} iş`;
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
      return `<button class="project-list-card${project.key === state.selectedProject ? " active" : ""}" data-project-key="${project.key}"><span><strong>${escapeHtml(project.name)}</strong><small>${project.key} · ${project.code}</small></span><span class="project-status ${project.status}">${project.status === "active" ? "Aktif" : "Arşiv"}</span><small>${items.filter((item) => item.kind === "task").length} iş · ${items.filter((item) => item.kind === "backlog").length} backlog</small></button>`;
    })
    .join("");
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
    ? `<section class="dashboard-section"><div class="section-head"><div><h3>Sprintler</h3><p>Planlanan ve aktif çalışma dönemleri</p></div><button data-project-action="sprint">Sprint oluştur</button></div><div class="dashboard-sprints">${sprints
        .map((sprint) => {
          const count = tasks.filter(
            (item) =>
              item.scheduled_for >= sprint.start_date &&
              item.scheduled_for <= sprint.end_date,
          ).length;
          return `<article><strong>${escapeHtml(sprint.name)}</strong><span>${sprint.start_date} → ${sprint.end_date}</span><small>${sprintStatusName(sprint.status)} · ${count} iş</small></article>`;
        })
        .join("")}</div></section>`
    : "";
  $("projectDashboard").innerHTML = `
    <section class="project-hero">
      <div><span class="eyebrow">${project.key} · ${project.code}</span><h2>${escapeHtml(project.name)}</h2><p>${escapeHtml(project.description || "")}</p></div>
      <div class="project-actions"><button data-project-action="calendar">Takvime git</button><button data-project-action="new-item" ${project.status === "archived" ? "disabled" : ""}>Yeni iş oluştur</button><button data-project-action="sprint" ${project.status === "archived" ? "disabled" : ""}>Sprint oluştur</button><button data-project-action="edit">Projeyi düzenle</button></div>
    </section>
    <section class="project-metrics">
      <article><span>Tamamlanma</span><strong>%${progress}</strong><small>${done}/${tasks.length} görev</small></article>
      <article><span>Açık işler</span><strong>${open}</strong><small>Tamamlanmayı bekliyor</small></article>
      <article><span>Backlog</span><strong>${backlog}</strong><small>Değerlendirilecek kayıt</small></article>
      <article><span>Tarihsiz</span><strong>${undated}</strong><small>Takvime alınacak iş</small></article>
    </section>
    ${sprintSection}
    <section class="dashboard-section"><div class="section-head"><div><h3>Son güncellenen işler</h3><p>Güncelleme zamanına göre son kayıtlar</p></div></div><div class="recent-items">${recent
      .map(
        (item) =>
          `<button data-key="${item.key}"><span><strong>${item.key}</strong>${escapeHtml(item.title)}</span><small>${item.completed_at ? `✓ ${escapeHtml(relativeElapsed(item.completed_at))} · ` : ""}${item.updated_at.slice(0, 10)} · ${statusName(item.status)}</small></button>`,
      )
      .join("")}</div></section>`;
}
function renderProjects() {
  renderProjectList();
  renderProjectDashboard();
}
function render() {
  renderSprintStrip();
  renderCalendar();
  renderBacklog();
  renderProjects();
  $("calendarView").hidden = state.view !== "calendar";
  $("backlogView").hidden = state.view !== "backlog";
  $("projectsView").hidden = state.view !== "projects";
  const projectItems = state.items.filter(
    (item) => item.project_key === state.selectedProject,
  );
  $("summary").textContent =
    state.view === "projects"
      ? `${state.projects.filter((project) => project.status === "active").length} aktif proje · ${state.projects.filter((project) => project.status === "archived").length} arşiv`
      : `${projectItems.filter((i) => i.kind === "task").length} takvim işi · ${projectItems.filter((i) => i.kind === "backlog").length} backlog`;
  const activeProject = currentProject();
  $("newItem").disabled = activeProject?.status !== "active";
  $("sprintButton").disabled = activeProject?.status !== "active";
  document.body.dataset.view = state.view;
  document.title = `${activeProject?.name || t("Projeler")} · Sprintmark`;
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
    const target =
      view === "projects" && project
        ? projectCanonical(project)
        : `/?project=${encodeURIComponent(state.selectedProject)}`;
    history.pushState({ view }, "", target);
  }
  render();
}
async function openItem(key, push = true) {
  const response = await fetch(`/api/v1/work-items/${key}`);
  if (!response.ok) {
    location.href = `/work-items/${key}/bulunamadi`;
    return;
  }
  const item = await response.json();
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
    item.status === "done"
      ? t("Yeniden aç")
      : t("✓ Tamamlandı olarak işaretle");
  $("toggleDone").classList.toggle("reopen", item.status === "done");
  const completionFact = item.completed_at
    ? `<dt>Tamamlanma</dt><dd class="completion-time"><time datetime="${escapeHtml(item.completed_at)}">${localDateTime(item.completed_at)}</time><small>${escapeHtml(relativeElapsed(item.completed_at))}</small></dd>`
    : "";
  $("facts").innerHTML =
    `<dt>Proje</dt><dd>${escapeHtml(state.projects.find((project) => project.key === item.project_key)?.name || item.project_key)}</dd><dt>Takvim</dt><dd>${item.scheduled_for ? `${item.scheduled_for}${item.scheduled_time ? ` · ${item.scheduled_time}` : ""}` : "—"}</dd><dt>Öncelik</dt><dd>${priorityName(item.priority)}</dd>${completionFact}<dt>Oluşturma</dt><dd>${localDateTime(item.created_at)}</dd><dt>Güncelleme</dt><dd>${localDateTime(item.updated_at)}</dd><dt>Eski kimlik</dt><dd>${item.legacy_ids.join(", ") || "—"}</dd>`;
  $("detailBody").hidden = false;
  $("detailEditor").hidden = true;
  $("editorActions").hidden = true;
  $("editConflict").hidden = true;
  $("editWorkItem").hidden = false;
  $("attachments").innerHTML = item.attachments
    .map((attachment) => {
      if (typeof attachment === "string") {
        return `<div class="attachment-reference"><strong>Kan&#305;t dosyas&#305;</strong><code>${escapeHtml(attachment)}</code></div>`;
      }
      if (!attachment?.url) return "";
      const url = escapeHtml(attachment.url);
      return `<a href="${url}" target="_blank" rel="noopener"><img src="${url}" alt="${escapeHtml(attachment.original_name || "Gorev gorseli")}"></a>`;
    })
    .join("");
  if (push) {
    state.returnPath = `${location.pathname}${location.search}`;
    history.pushState({ key: item.key }, "", canonical(item));
  }
  if (!$("detail").open) $("detail").showModal();
  window.requestAnimationFrame(() => renderWorkItemViewer(item.body));
}
async function createDraft() {
  const response = await fetch("/api/v1/drafts", { method: "POST" });
  if (!response.ok)
    throw new Error((await response.json()).error || "Taslak oluşturulamadı.");
  return response.json();
}
async function deleteDraft(id) {
  if (!id) return;
  await fetch(`/api/v1/drafts/${id}`, { method: "DELETE" }).catch(() => {});
}
async function uploadDraftImage(draftId, file, placement = "evidence") {
  if (!draftId) throw new Error("Taslak oturumu bulunamadı.");
  const data = new FormData();
  data.append("file", file, file.name || `clipboard-${Date.now()}.png`);
  data.append("placement", placement);
  data.append("alt", file.name || "Clipboard image");
  const response = await fetch(`/api/v1/drafts/${draftId}/attachments`, {
    method: "POST",
    body: data,
  });
  if (!response.ok)
    throw new Error((await response.json()).error || "Görsel yüklenemedi.");
  return response.json();
}
async function uploadWorkItemImage(file, placement = "evidence") {
  if (!state.selected) throw new Error("İş kaydı bulunamadı.");
  const data = new FormData();
  data.append("file", file, file.name || `clipboard-${Date.now()}.png`);
  data.append("placement", placement);
  data.append("alt", file.name || "Clipboard image");
  const response = await fetch(
    `/api/v1/work-items/${state.selected.uid}/attachments`,
    { method: "POST", body: data },
  );
  if (!response.ok)
    throw new Error((await response.json()).error || "Görsel yüklenemedi.");
  const result = await response.json();
  state.selected = result.record;
  state.items = state.items.map((item) =>
    item.uid === result.record.uid ? result.record : item,
  );
  return result;
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
    (file, placement) => uploadDraftImage(state.editDraftId, file, placement),
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
  if (
    hasUnsavedWorkItem() &&
    !window.confirm("Kaydedilmemiş içerik değişiklikleri silinsin mi?")
  )
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
    return alert((await response.json()).error || "İçerik kaydedilemedi.");
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
    alert(
      "İş başka bir işlemde güncellendi. Güncel bilgiler yüklenecek; değişikliği yeniden uygulayın.",
    );
    await openItem(state.selected.key, false);
    return null;
  }
  if (!response.ok) {
    alert((await response.json()).error || "İş bilgileri güncellenemedi.");
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
          uploadDraftImage(state.createDraftId, file, placement),
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
  const requestedProject = new window.URLSearchParams(location.search).get(
    "project",
  );
  const rememberedProject = window.localStorage.getItem("work-tracker-project");
  state.selectedProject =
    state.projects.find((project) => project.key === requestedProject)?.key ||
    state.projects.find((project) => project.key === rememberedProject)?.key ||
    state.projects.find((project) => project.status === "active")?.key ||
    state.projects[0]?.key;
  renderProjectOptions();
  $("buildMeta").textContent = `v${meta.version}`;
  $("buildMeta").setAttribute("aria-label", `Sprintmark sürüm ${meta.version}`);
  $("buildMeta").dataset.branch = meta.branch;
  $("buildMeta").dataset.commit = meta.sha;
  $("buildMeta").dataset.dirty = String(Boolean(meta.dirty));
  const statuses = [...new Set(state.items.map((i) => i.status))];
  $("statusFilter").innerHTML =
    '<option value="">Tüm durumlar</option>' +
    statuses
      .map((s) => `<option value="${s}">${statusName(s)}</option>`)
      .join("");
  const dates = filtered()
    .map((i) => i.scheduled_for)
    .filter(Boolean)
    .sort();
  if (dates.length) state.month = new Date(`${dates.at(-1)}T12:00:00`);
  render();
  translateDocument();
  const projectRoute = location.pathname.match(/^\/projects\/(PRJ-\d{3})/i);
  if (projectRoute) {
    const project = state.projects.find(
      (candidate) => candidate.key === projectRoute[1].toUpperCase(),
    );
    if (project) state.selectedProject = project.key;
    renderProjectOptions();
    setView("projects", false);
  } else if (location.pathname === "/projects") {
    setView("projects", false);
  }
  const route = location.pathname.match(
    /^\/work-items\/([A-Z][A-Z0-9]{1,7}-(?:\d{4}[A-Z]?|BL-\d{3}))/i,
  );
  if (route) openItem(route[1], false);
}
document.addEventListener("click", (e) => {
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
      !window.confirm("Kaydedilmemiş yeni iş içeriği silinsin mi?")
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
    alert(failure.error || "Tarih güncellenemedi.");
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
for (const id of ["statusFilter", "teamFilter", "priorityFilter", "search"])
  $(id).addEventListener(id === "search" ? "input" : "change", render);
function selectProject(key, updateAddress = true) {
  if (!state.projects.some((project) => project.key === key)) return;
  state.selectedProject = key;
  window.localStorage.setItem("work-tracker-project", key);
  renderProjectOptions();
  const dates = filtered()
    .map((item) => item.scheduled_for)
    .filter(Boolean)
    .sort();
  if (dates.length) state.month = new Date(`${dates.at(-1)}T12:00:00`);
  if (updateAddress) {
    const project = currentProject();
    history.replaceState(
      {},
      "",
      state.view === "projects" && project
        ? projectCanonical(project)
        : `/?project=${encodeURIComponent(key)}`,
    );
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
  $("projectImmutable").textContent =
    `${project.key} · ${project.code} · UUID ${project.uid.slice(0, 8)} değişmez kimliklerdir.`;
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
    if (response.status === 409)
      return alert(
        "Proje başka bir işlemde güncellendi. Sayfayı yenileyip tekrar deneyin.",
      );
    return alert(failure.error || "Proje güncellenemedi.");
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
    plannerMessage(`${date} başlangıç seçildi; şimdi bitiş gününü seçin.`);
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
  plannerMessage("Sprint başlangıç gününü takvimden seçin.");
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
  $("copyLink").textContent = "Bağlantı kopyalandı";
  setTimeout(
    () => ($("copyLink").textContent = "Kalıcı bağlantıyı kopyala"),
    1400,
  );
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
  $("copyDraft").textContent = "Taslak kopyalandı";
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
});
$("createDialog").addEventListener("cancel", (event) => {
  if (
    hasUnsavedNewItem() &&
    !window.confirm("Kaydedilmemiş yeni iş içeriği silinsin mi?")
  ) {
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
  render();
  translateDocument();
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
$("attachmentForm").onsubmit = async (e) => {
  e.preventDefault();
  const files = [...$("attachment").files];
  if (!files.length) return;
  try {
    for (const file of files) await uploadWorkItemImage(file, "evidence");
  } catch (error) {
    return alert(error.message);
  }
  $("attachment").value = "";
  await openItem(state.selected.key, false);
};

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
  pasteEvidence(event, uploadWorkItemImage),
);
$("createEvidencePasteZone").addEventListener("paste", (event) =>
  pasteEvidence(event, (file, placement) =>
    uploadDraftImage(state.createDraftId, file, placement),
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
function enableImageDrop(id, uploader) {
  const zone = $(id);
  zone.addEventListener("dragover", (event) => {
    if (
      ![...(event.dataTransfer?.items || [])].some((item) =>
        item.type.startsWith("image/"),
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
    const files = [...(event.dataTransfer?.files || [])].filter((file) =>
      file.type.startsWith("image/"),
    );
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
enableImageDrop("evidencePasteZone", uploadWorkItemImage);
enableImageDrop("createEvidencePasteZone", (file, placement) =>
  uploadDraftImage(state.createDraftId, file, placement),
);
load().catch((error) => {
  document.querySelector("main").innerHTML =
    `<section class="not-found"><h1>Uygulama yüklenemedi</h1><p>${escapeHtml(error.message)}</p></section>`;
});
