import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const publicRoot = resolve(import.meta.dirname, "..", "public");

test("project navigation and Markdown rich editing are wired in the UI", async () => {
  const [html, app, styles, logo] = await Promise.all([
    readFile(resolve(publicRoot, "index.html"), "utf8"),
    readFile(resolve(publicRoot, "app.js"), "utf8"),
    readFile(resolve(publicRoot, "styles.css"), "utf8"),
    readFile(resolve(publicRoot, "sprintmark-mark.svg"), "utf8"),
  ]);
  assert.match(html, /class="brand-lockup"/);
  assert.match(html, /sprintmark-mark\.svg/);
  assert.match(html, /id="breadcrumb" class="breadcrumb"/);
  assert.doesNotMatch(html, /class="nav projects-home"/);
  assert.match(html, /id="createEditor"/);
  assert.match(html, /id="editStatus"/);
  assert.match(html, /id="editPriority"/);
  assert.match(html, /id="toggleDone"/);
  assert.match(
    html,
    /class="content-panel">\s*<form id="editMetadata" class="edit-metadata">/,
  );
  assert.match(html, /class="schedule-control"/);
  assert.match(html, /Planlanan zaman/);
  assert.equal((html.match(/class="schedule-control"/g) || []).length, 2);
  assert.doesNotMatch(html, /aria-hidden="true">·/);
  assert.doesNotMatch(html, /metadata-heading/);
  assert.match(html, /id="imageLightbox"/);
  assert.match(html, /class="evidence-dropzone"/);
  assert.match(html, /vendor\/toastui-editor\.js/);
  assert.match(app, /window\.toastui\.Editor/);
  assert.match(app, /viewer: true/);
  assert.match(styles, /\.primary:not\(:disabled\):hover/);
  assert.match(styles, /grid-template-columns: minmax\(132px, 1fr\) 82px/);
  assert.match(logo, /Planlamadan tamamlanmaya ilerleyen üç iş kartı/);
  assert.doesNotMatch(app, /Henüz sprint oluşturulmadı/);
});

test("task viewer links always open in a separate safe tab", async () => {
  const app = await readFile(resolve(publicRoot, "app.js"), "utf8");
  assert.match(app, /function openLinksInNewTab\(root\)/);
  assert.match(app, /link\.target = "_blank"/);
  assert.match(app, /link\.rel = "noopener noreferrer"/);
  assert.match(app, /openLinksInNewTab\(\$\("detailBody"\)\)/);
});

test("browser title follows the open work item and returns to the project", async () => {
  const app = await readFile(resolve(publicRoot, "app.js"), "utf8");
  assert.match(app, /function updateDocumentTitle\(item = null\)/);
  assert.match(
    app,
    /document\.title = `\$\{item\.title\} · \$\{item\.key\} · Sprintmark`/,
  );
  assert.match(app, /updateDocumentTitle\(item\)/);
  assert.match(
    app,
    /updateDocumentTitle\(\$\("detail"\)\.open \? state\.selected : null\)/,
  );
  assert.match(
    app,
    /history\.pushState\(\{\}, "", state\.returnPath \|\| "\/"\)/,
  );
  assert.match(app, /state\.selected = null;\s+renderBreadcrumb\(\)/);
});

test("calendar overflow buttons expand and collapse every item in a day", async () => {
  const app = await readFile(resolve(publicRoot, "app.js"), "utf8");
  assert.match(app, /expandedDays: new Set\(\)/);
  assert.match(
    app,
    /const visibleItems = expanded \? dayItems : dayItems\.slice\(0, 4\)/,
  );
  assert.match(app, /aria-expanded="\$\{expanded\}"/);
  assert.match(app, /e\.target\.closest\("\.more\[data-day\]"\)/);
  assert.match(app, /state\.expandedDays\.add\(day\)/);
  assert.match(app, /state\.expandedDays\.delete\(day\)/);
  assert.match(app, /renderCalendar\(\)/);
});

test("the rich viewer replaces the legacy Markdown renderer so tables can render", async () => {
  const app = await readFile(resolve(publicRoot, "app.js"), "utf8");
  assert.match(app, /renderWorkItemViewer/);
  assert.doesNotMatch(app, /function markdown\(/);
  assert.match(app, /toolbarItems: editorToolbar/);
  assert.match(app, /addImageBlobHook/);
  assert.match(app, /data-create-date/);
  assert.match(app, /scheduled_time/);
  assert.match(app, /priorityFilter/);
  assert.match(app, /completed_at/);
  assert.match(app, /relativeElapsed/);
  assert.match(app, /patchSelectedWorkItem/);
  assert.match(app, /`v\$\{state\.meta\.version\}`/);
  assert.doesNotMatch(app, /çalışma ağacı kirli/);
});

test("task evidence supports files, downloads and legacy workspace references", async () => {
  const [html, app, styles] = await Promise.all([
    readFile(resolve(publicRoot, "index.html"), "utf8"),
    readFile(resolve(publicRoot, "app.js"), "utf8"),
    readFile(resolve(publicRoot, "styles.css"), "utf8"),
  ]);
  assert.match(html, /Kanıt dosyaları/);
  assert.match(html, /id="createAttachment"/);
  assert.match(html, /accept="[^"]*\.pdf[^"]*\.csv[^"]*\.xlsx[^"]*\.docx/);
  assert.match(app, /fileReferences: \[\]/);
  assert.match(app, /\/file-references/);
  assert.match(app, /function linkWorkspaceReferences\(root\)/);
  assert.match(app, /className = "workspace-file-link"/);
  assert.match(app, /function renderFileCard/);
  assert.match(app, /download=1/);
  assert.match(app, /target="_blank" rel="noopener noreferrer"/);
  assert.match(app, /function enableFileDrop/);
  assert.doesNotMatch(app, /function enableImageDrop/);
  assert.match(styles, /\.file-card/);
  assert.match(styles, /\.missing-file-reference/);
});

test("project documents render as heading-based documentation pages", async () => {
  const [html, app, styles] = await Promise.all([
    readFile(resolve(publicRoot, "index.html"), "utf8"),
    readFile(resolve(publicRoot, "app.js"), "utf8"),
    readFile(resolve(publicRoot, "styles.css"), "utf8"),
  ]);
  assert.match(html, /id="documentPreviewDialog"/);
  assert.match(html, /id="documentOutline"/);
  assert.match(html, /id="documentPreviewBody"/);
  assert.match(app, /data-project-tab="documents"/);
  assert.match(app, /function splitMarkdownSections\(markdown\)/);
  assert.match(app, /const heading = line\.match/);
  assert.match(app, /headings\.push/);
  assert.match(app, /data-document-section/);
  assert.match(app, /function renderDocumentSection\(index\)/);
  assert.match(app, /\/document-references/);
  assert.match(app, /projectDocumentUpload/);
  assert.match(
    app,
    /data-project-document-preview="\$\{document\.index\}">\$\{t\("documents\.open"\)\}<\/button>/,
  );
  assert.match(
    app,
    /href="\$\{escapeHtml\(document\.url\)\}"[^>]*>\$\{t\("documents\.preview"\)\}<\/a>/,
  );
  assert.match(html, /id="documentPreviewOpen"/);
  assert.match(html, />Dosyayı önizle<\/a/);
  assert.match(app, /target="_blank" rel="noopener noreferrer"/);
  assert.match(styles, /\.project-tabs/);
  assert.match(styles, /\.document-reader/);
  assert.match(styles, /\.document-outline \.outline-level-3/);
  assert.match(styles, /\.document-outline \.outline-level-4/);
  assert.match(styles, /\.document-page/);
});

test("direct project routes avoid rendering the calendar before project data", async () => {
  const [html, app, styles] = await Promise.all([
    readFile(resolve(publicRoot, "index.html"), "utf8"),
    readFile(resolve(publicRoot, "app.js"), "utf8"),
    readFile(resolve(publicRoot, "styles.css"), "utf8"),
  ]);
  assert.match(html, /<body class="app-loading" data-view="calendar">/);
  assert.match(html, /location\.pathname\.startsWith\("\/projects"\)/);
  assert.match(html, /location\.pathname\.startsWith\("\/backlog"\)/);
  assert.match(app, /const initialView = location\.pathname\.startsWith/);
  assert.match(app, /const viewCanonical/);
  assert.match(app, /view === "backlog" \? "backlog" : "calendar"/);
  assert.match(app, /function applyViewShell\(view\)/);
  assert.match(app, /view: initialView/);
  assert.match(app, /document\.body\.classList\.remove\("app-loading"\)/);
  assert.match(styles, /body\.app-loading main > section/);
  assert.match(styles, /@keyframes loading-sheen/);
});

test("the projects root is distinct from a selected project detail", async () => {
  const [html, app, styles] = await Promise.all([
    readFile(resolve(publicRoot, "index.html"), "utf8"),
    readFile(resolve(publicRoot, "app.js"), "utf8"),
    readFile(resolve(publicRoot, "styles.css"), "utf8"),
  ]);
  assert.match(html, /id="breadcrumb"/);
  assert.doesNotMatch(html, /data-project-root/);
  assert.match(app, /projectIndex:/);
  assert.match(app, /href: "\/projects\/"/);
  assert.match(app, /function renderBreadcrumb\(\)/);
  assert.match(app, /aria-current="page"/);
  assert.match(app, /\$\("projectDashboard"\)\.hidden = state\.projectIndex/);
  assert.match(
    app,
    /!state\.projectIndex && project\.key === state\.selectedProject/,
  );
  assert.match(styles, /\.project-index \.projects-layout/);
  assert.match(styles, /\.project-index \.project-list/);
  assert.match(styles, /\.project-dashboard\[hidden\]/);
});

test("the saved locale is applied before the first visible header paint", async () => {
  const [html, app, styles] = await Promise.all([
    readFile(resolve(publicRoot, "index.html"), "utf8"),
    readFile(resolve(publicRoot, "app.js"), "utf8"),
    readFile(resolve(publicRoot, "styles.css"), "utf8"),
  ]);
  assert.match(html, /<html lang="en">/);
  assert.match(html, /localStorage\.getItem\("sprintmark-locale"\)/);
  assert.match(html, /document\.documentElement\.lang = savedLocale/);
  assert.match(
    app,
    /translateDocument\(\);\s+document\.documentElement\.classList\.add\("i18n-ready"\)/,
  );
  assert.match(styles, /html:not\(\.i18n-ready\) header/);
});
