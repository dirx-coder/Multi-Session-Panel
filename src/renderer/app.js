const storageKey = "panel-workspace-state-v1";
const themeStorageKey = "panel-workspace-theme";
const uiStorageKey = "panel-workspace-ui-v1";
const automationTargetsKey = "panel-automation-targets-v1";

const defaultWorkspaces = {
  "social-monitor": {
    id: "social-monitor",
    name: "Social Monitor",
    rows: 2,
    columns: 5,
    autoFit: true,
    mobileViewport: true,
    scale: 100,
    panels: [
      ["chrome", "Chrome 1", "https://www.instagram.com/"],
      ["chrome", "Chrome 2", "https://www.instagram.com/"],
      ["chrome", "Chrome 3", "https://www.instagram.com/"],
      ["firefox", "Firefox 1", "https://chat.openai.com/"],
      ["firefox", "Firefox 2", "https://chat.openai.com/"],
      ["duckduckgo", "DuckDuckGo 1", "https://duckduckgo.com/"],
      ["edge", "Edge 1", "https://www.bing.com/"],
      ["chrome", "Chrome 4", "https://news.ycombinator.com/"],
      ["firefox", "Firefox 3", "https://github.com/"],
      ["edge", "Edge 2", "https://www.wikipedia.org/"]
    ].map((item, index) => createPanel(item[0], item[1], item[2], index))
  }
};

let state = loadState();
let activeWorkspaceId = state.activeWorkspaceId || "social-monitor";
let maximizedPanelId = null;
let selectedPanelIds = new Set();
let filters = new Set(["chrome", "firefox", "duckduckgo", "edge"]);
let layoutRaf = null;
let currentTheme = loadTheme();
let uiState = loadUiState();
const defaultGlobalControlState = {
  visible: false,
  hoverTargetMode: false,
  autoMode: false,
  repeatMode: false,
  concurrencyMode: true,
  lastAction: null,
  autoInterval: null,
  repeatRunning: false,
  point: { xRatio: 0.5, yRatio: 0.5 },
  clickTarget: null
};
let globalControlState = createDefaultGlobalControlState();
let gcScrollIndex = 0; // round-robin pointer for sequential scroll
let automationRunId = 0;
let globalControllerResetId = 0;
let resizeState = null;
const PHONE_BASE_WIDTH = 280;
const PHONE_BASE_HEIGHT = 525;
const PHONE_ASPECT_RATIO = PHONE_BASE_WIDTH / PHONE_BASE_HEIGHT;
let automationState = {
  status: "idle",
  detected: [],
  selectedElement: null,
  selectedTargetId: "pointer",
  savedTargets: loadAutomationTargets(),
  progress: { done: 0, total: 0 },
  summary: { success: 0, failed: 0, skipped: 0 },
  error: ""
};

const grid = document.getElementById("dashboardGrid");
const rowsInput = document.getElementById("rowsInput");
const columnsInput = document.getElementById("columnsInput");
const panelScale = document.getElementById("panelScale");
const autoFitLayout = document.getElementById("autoFitLayout");
const mobileViewport = document.getElementById("mobileViewport");
const stretchMode = document.getElementById("stretchMode");
const freeResizeMode = document.getElementById("freeResizeMode");
const browserSelect = document.getElementById("browserSelect");
const startupUrl = document.getElementById("startupUrl");
const statusText = document.getElementById("statusText");
const tabCountInput = document.getElementById("tabCountInput");
const tabCreateMode = document.getElementById("tabCreateMode");
const fullscreenDashboard = document.getElementById("fullscreenDashboard");
const exitFullscreen = document.getElementById("exitFullscreen");
const themeToggle = document.getElementById("themeToggle");
const deleteSelected = document.getElementById("deleteSelected");
const dashboardWrap = document.querySelector(".dashboard-wrap");
const toggleSidebar = document.getElementById("toggleSidebar");
const toggleControls = document.getElementById("toggleControls");
const restoreSidebar = document.getElementById("restoreSidebar");
const restoreControls = document.getElementById("restoreControls");
const gcCollapseBtn = document.getElementById("gcCollapseBtn");
const globalControlToggle = document.getElementById("globalControlToggle");
const globalControlCenter = document.getElementById("globalControlCenter");
const globalPositionText = document.getElementById("globalPositionText");
const gcShell = document.getElementById("gcShell");
const hoverTargetMode = document.getElementById("hoverTargetMode");
const gcClickX = document.getElementById("gcClickX");
const gcClickY = document.getElementById("gcClickY");
const gcRunClick = document.getElementById("gcRunClick");
const gcResetCoordinates = document.getElementById("gcResetCoordinates");
const gcResetAutomation = document.getElementById("gcResetAutomation");
const gcResetAll = document.getElementById("gcResetAll");
const gcTargetMarker = document.createElement("button");
gcTargetMarker.id = "gcTargetMarker";
gcTargetMarker.className = "gc-target-marker";
gcTargetMarker.type = "button";
gcTargetMarker.setAttribute("aria-label", "Drag click target");
gcTargetMarker.title = "Drag click target";
const gcAutoMode = document.getElementById("gcAutoMode");
const gcRepeatMode = document.getElementById("gcRepeatMode");
const gcConcurrencyMode = document.getElementById("gcConcurrencyMode");
const gcRepeatConfig = document.getElementById("gcRepeatConfig");
const gcAutoConfig = document.getElementById("gcAutoConfig");
const gcRepeatCount = document.getElementById("gcRepeatCount");
const gcRepeatDelay = document.getElementById("gcRepeatDelay");
const gcAutoInterval = document.getElementById("gcAutoInterval");
const autoClickTarget = document.getElementById("autoClickTarget");
const autoClickTargetHint = document.getElementById("autoClickTargetHint");
const autoClickState = document.getElementById("autoClickState");
const detectElements = document.getElementById("detectElements");
const saveManualTarget = document.getElementById("saveManualTarget");
const runAutoClick = document.getElementById("runAutoClick");
const detectedElementList = document.getElementById("detectedElementList");
const autoClickProgressBar = document.getElementById("autoClickProgressBar");
const autoClickProgressText = document.getElementById("autoClickProgressText");
const automationSummary = document.getElementById("automationSummary");
const autoClickError = document.getElementById("autoClickError");
const gcPositionKey = "panel-gc-position-v1";
let isDashboardMaximized = false;
const gcTargetDrag = {
  dragging: false,
  offsetX: 0,
  offsetY: 0
};

function createPanel(browser, name, url, index) {
  return {
    id: `${browser}-${index + 1}-${Math.random().toString(36).slice(2, 8)}`,
    browser,
    profile: `${browser}-${index + 1}`,
    name,
    title: name,
    url,
    currentUrl: url,
    order: index,
    status: "idle",
    selected: false,
    customSize: null
  };
}

function createDefaultGlobalControlState(overrides = {}) {
  return {
    ...defaultGlobalControlState,
    ...overrides,
    point: { ...defaultGlobalControlState.point, ...(overrides.point || {}) },
    clickTarget: overrides.clickTarget ?? defaultGlobalControlState.clickTarget
  };
}

function defaultAutomationSessionState() {
  return {
    status: "idle",
    detected: [],
    selectedElement: null,
    selectedTargetId: "pointer",
    progress: { done: 0, total: 0 },
    summary: { success: 0, failed: 0, skipped: 0 },
    error: ""
  };
}

function loadState() {
  let nextState;
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey));
    if (parsed && parsed.workspaces) nextState = parsed;
  } catch {
    // Ignore corrupt local state and rebuild defaults.
  }
  nextState ||= {
    activeWorkspaceId: "social-monitor",
    workspaces: structuredClone(defaultWorkspaces),
    savedLayouts: {}
  };
  return normalizeState(nextState);
}

function normalizeState(nextState) {
  delete nextState.workspaces["research-wall"];
  delete nextState.savedLayouts?.["research-wall"];
  if (!nextState.workspaces["social-monitor"]) {
    nextState.workspaces["social-monitor"] = structuredClone(defaultWorkspaces["social-monitor"]);
  }
  if (!nextState.workspaces[nextState.activeWorkspaceId]) {
    nextState.activeWorkspaceId = "social-monitor";
  }
  Object.values(nextState.workspaces).forEach((workspace) => {
    workspace.autoFit ??= true;
    workspace.mobileViewport ??= true;
    workspace.stretchMode ??= false;
    workspace.freeResizeMode ??= false;
    workspace.rows ??= 2;
    workspace.columns ??= 5;
    workspace.scale ??= 100;
    workspace.panels.forEach((panel, index) => {
      panel.order ??= index;
      panel.profile ||= `${panel.browser}-${index + 1}`;
      panel.mobileViewport = workspace.mobileViewport;
      panel.customSize ??= null;
    });
  });
  nextState.savedLayouts ||= {};
  return nextState;
}

function persist() {
  state.activeWorkspaceId = activeWorkspaceId;
  localStorage.setItem(storageKey, JSON.stringify(state));
}

function loadUiState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(uiStorageKey));
    return {
      sidebarCollapsed: Boolean(parsed?.sidebarCollapsed),
      controlsCollapsed: Boolean(parsed?.controlsCollapsed)
    };
  } catch {
    return { sidebarCollapsed: false, controlsCollapsed: false };
  }
}

function persistUiState() {
  localStorage.setItem(uiStorageKey, JSON.stringify(uiState));
}

function loadAutomationTargets() {
  try {
    const parsed = JSON.parse(localStorage.getItem(automationTargetsKey));
    return Array.isArray(parsed) ? parsed.filter((target) => target?.id && target?.name) : [];
  } catch {
    return [];
  }
}

function persistAutomationTargets() {
  localStorage.setItem(automationTargetsKey, JSON.stringify(automationState.savedTargets));
}

function loadTheme() {
  const saved = localStorage.getItem(themeStorageKey);
  if (saved === "light" || saved === "dark") return saved;
  return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function applyTheme() {
  document.documentElement.dataset.theme = currentTheme;
  themeToggle.textContent = currentTheme === "dark" ? "Light Mode" : "Dark Mode";
  themeToggle.setAttribute("aria-label", `Switch to ${currentTheme === "dark" ? "light" : "dark"} mode`);
  localStorage.setItem(themeStorageKey, currentTheme);
}

function applyUiState() {
  const roots = [document.documentElement, document.body];
  roots.forEach((root) => {
    root.classList.toggle("sidebar-collapsed", uiState.sidebarCollapsed);
    root.classList.toggle("controls-collapsed", uiState.controlsCollapsed);
  });

  toggleSidebar.setAttribute("aria-pressed", String(uiState.sidebarCollapsed));
  toggleSidebar.setAttribute("aria-label", uiState.sidebarCollapsed ? "Show sidebar" : "Hide sidebar");
  toggleSidebar.setAttribute("title", uiState.sidebarCollapsed ? "Show sidebar" : "Hide sidebar");

  toggleControls.setAttribute("aria-pressed", String(uiState.controlsCollapsed));
  toggleControls.setAttribute("aria-label", uiState.controlsCollapsed ? "Show control panel" : "Hide control panel");
  toggleControls.setAttribute("title", uiState.controlsCollapsed ? "Show control panel" : "Hide control panel");

  persistUiState();
  queueLayoutSync();
  window.setTimeout(queueLayoutSync, 280);
}

function setSidebarCollapsed(collapsed) {
  uiState.sidebarCollapsed = collapsed;
  applyUiState();
}

function setControlsCollapsed(collapsed) {
  uiState.controlsCollapsed = collapsed;
  applyUiState();
}

function activeWorkspace() {
  return state.workspaces[activeWorkspaceId];
}

function visiblePanels() {
  return activeWorkspace()
    .panels
    .filter((panel) => filters.has(panel.browser))
    .sort((a, b) => a.order - b.order);
}

function renderWorkspaceNav() {
  const nav = document.getElementById("workspacesSection");
  const createButton = document.getElementById("createWorkspace");

  Object.values(state.workspaces)
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach((workspace) => {
      let button = nav.querySelector(`[data-workspace="${workspace.id}"]`);
      if (!button) {
        button = document.createElement("button");
        button.className = "workspace-item";
        button.dataset.workspace = workspace.id;
        button.innerHTML = `<span></span><strong data-workspace-count="${workspace.id}"></strong>`;
        button.addEventListener("click", () => switchWorkspace(workspace.id));
        if (createButton) {
          nav.insertBefore(button, createButton);
        } else {
          nav.appendChild(button);
        }
      }
      button.querySelector("span").textContent = workspace.name;
    });

  document.querySelectorAll(".workspace-item").forEach((button) => {
    if (!state.workspaces[button.dataset.workspace]) button.remove();
  });

  document.querySelectorAll(".workspace-item").forEach((button) => {
    button.classList.toggle("active", button.dataset.workspace === activeWorkspaceId);
  });
  document.querySelectorAll("[data-workspace-count]").forEach((countEl) => {
    const workspace = state.workspaces[countEl.dataset.workspaceCount];
    const count = workspace?.panels.length || 0;
    countEl.textContent = `${count} panel${count === 1 ? "" : "s"}`;
  });
}

function pruneSelection() {
  const panelIds = new Set(activeWorkspace().panels.map((panel) => panel.id));
  selectedPanelIds = new Set([...selectedPanelIds].filter((id) => panelIds.has(id)));
}

function renderSelectionState() {
  const selectedCount = selectedPanelIds.size;
  deleteSelected.disabled = selectedCount === 0;
  deleteSelected.textContent = selectedCount ? `Delete Selected (${selectedCount})` : "Delete Selected";
}

function renderControls() {
  const workspace = activeWorkspace();
  rowsInput.value = workspace.rows;
  columnsInput.value = workspace.columns;
  panelScale.value = workspace.scale;
  autoFitLayout.checked = workspace.autoFit;
  mobileViewport.checked = workspace.mobileViewport;
  stretchMode.checked = Boolean(workspace.stretchMode);
  freeResizeMode.checked = Boolean(workspace.freeResizeMode);
  freeResizeMode.disabled = !workspace.stretchMode;
  rowsInput.disabled = workspace.autoFit;
  columnsInput.disabled = false;
  const selectedBrowser = browserSelect.value;
  const panel = workspace.panels.find((item) => item.browser === selectedBrowser);
  startupUrl.value = panel?.url || "https://example.com/";
}

function renderGrid() {
  const workspace = activeWorkspace();
  const panels = visiblePanels();
  pruneSelection();
  const layout = resolveLayout(workspace, panels.length);
  const isDashboardFullscreen = document.fullscreenElement === document.documentElement || isDashboardMaximized;
  workspace.rows = layout.rows;
  workspace.columns = layout.columns;
  panels.forEach((panel) => {
    panel.mobileViewport = workspace.mobileViewport;
  });

  document.body.classList.toggle("dashboard-fullscreen", document.fullscreenElement === document.documentElement);
  document.body.classList.toggle("dashboard-maximized", isDashboardMaximized);
  updateGridMetrics(workspace, layout);
  rowsInput.value = layout.rows;
  columnsInput.value = layout.columns;
  grid.classList.toggle("fullscreen-active", Boolean(maximizedPanelId));
  grid.classList.toggle("dashboard-fullscreen-grid", isDashboardFullscreen);
  grid.classList.toggle("stretch-grid", Boolean(workspace.stretchMode));
  grid.innerHTML = "";

  panels.forEach((panel) => {
    const article = document.createElement("article");
    article.className = `browser-panel ${selectedPanelIds.has(panel.id) ? "selected" : ""}`;
    article.classList.toggle("stretch-enabled", Boolean(workspace.stretchMode));
    article.classList.toggle("free-resize", Boolean(workspace.stretchMode && workspace.freeResizeMode));
    article.draggable = true;
    article.dataset.panelId = panel.id;
    article.dataset.browser = panel.browser ?? "";
    applyPanelSizeStyles(article, panel, workspace);
    const isFullscreen = maximizedPanelId === panel.id;
    if (isFullscreen) {
      article.classList.add("fullscreen-panel");
      article.draggable = false;
    }

    const statusClass = panel.status === "loading" ? "loading" : panel.status === "live" ? "live" : "";
    const BADGE = { chrome: "CH", firefox: "FF", duckduckgo: "DDG", edge: "ED" };
    const browserTag = BADGE[panel.browser] ?? panel.browser?.slice(0, 3).toUpperCase() ?? "BR";

    article.innerHTML = `
      <div class="panel-chrome">
        <label class="panel-select" title="Select panel">
          <input type="checkbox" data-select-panel="${panel.id}" ${selectedPanelIds.has(panel.id) ? "checked" : ""} aria-label="Select ${escapeHtml(panel.name)}" />
          <span></span>
        </label>
        <span class="status-dot ${statusClass}" aria-hidden="true"></span>
        <span class="browser-icon ${escapeHtml(panel.browser)}" aria-hidden="true"></span>
        <span class="panel-name" title="${escapeHtml(panel.title || panel.name)}">${escapeHtml(panel.name)}</span>
        <span class="panel-browser-badge" aria-hidden="true">${browserTag}</span>
      </div>
      <div class="device-frame" aria-hidden="true"></div>
      <div class="device-speaker" aria-hidden="true"></div>
      <div class="device-camera" aria-hidden="true"></div>
      <div class="device-screen">
        <div class="view-slot" data-slot-id="${panel.id}">
          <div class="view-placeholder">
            <span class="placeholder-label">${escapeHtml(panel.name)}</span>
            <span class="placeholder-url">${escapeHtml(panel.url)}</span>
          </div>
          <div class="automation-highlight-layer" data-automation-layer="${panel.id}"></div>
        </div>
      </div>
      <button class="phone-resize-handle" data-resize-panel="${panel.id}" type="button" title="Resize phone" aria-label="Resize ${escapeHtml(panel.name)}"></button>
    `;

    grid.appendChild(article);
  });

  attachPanelHandlers();
  renderAutomationHighlights();
  renderSelectionState();
  queueLayoutSync();
  positionTargetMarker();
  persist();
}

function updateGridMetrics(workspace, layout = resolveLayout(workspace, visiblePanels().length)) {
  const panelHeight = Math.round(PHONE_BASE_HEIGHT * (workspace.scale / 100));
  const panelWidth = Math.round(PHONE_BASE_WIDTH * (workspace.scale / 100));
  grid.style.setProperty("--columns", layout.columns);
  grid.style.setProperty("--rows", layout.rows);
  grid.style.setProperty("--panel-width", `${panelWidth}px`);
  grid.style.setProperty("--panel-height", `${panelHeight}px`);
}

function scaledDefaultPhoneSize(workspace) {
  return {
    width: Math.round(PHONE_BASE_WIDTH * (workspace.scale / 100)),
    height: Math.round(PHONE_BASE_HEIGHT * (workspace.scale / 100))
  };
}

function applyPanelSizeStyles(article, panel, workspace) {
  if (workspace.stretchMode && panel.customSize?.width && panel.customSize?.height) {
    article.style.setProperty("--phone-width", `${Math.round(panel.customSize.width)}px`);
    article.style.setProperty("--phone-height", `${Math.round(panel.customSize.height)}px`);
  } else {
    article.style.removeProperty("--phone-width");
    article.style.removeProperty("--phone-height");
  }
}

function resolveLayout(workspace, panelCount) {
  const count = Math.max(1, panelCount || 1);
  const columns = Math.max(1, Number(workspace.columns) || 1);
  const rows = workspace.autoFit
    ? Math.max(1, Math.ceil(count / columns))
    : Math.max(1, Number(workspace.rows) || 1);
  return { rows, columns };
}

function attachPanelHandlers() {
  document.querySelectorAll(".browser-panel").forEach((panelEl) => {
    panelEl.addEventListener("click", (event) => {
      if (event.target.closest("button, input, label, select")) return;
      const id = panelEl.dataset.panelId;
      if (event.metaKey || event.ctrlKey) {
        selectedPanelIds.has(id) ? selectedPanelIds.delete(id) : selectedPanelIds.add(id);
      } else {
        selectedPanelIds = new Set([id]);
      }
      renderGrid();
    });

    panelEl.addEventListener("dragstart", () => panelEl.classList.add("dragging"));
    panelEl.addEventListener("dragend", () => panelEl.classList.remove("dragging"));
    panelEl.addEventListener("dragover", (event) => event.preventDefault());
    panelEl.addEventListener("drop", (event) => {
      event.preventDefault();
      const source = document.querySelector(".browser-panel.dragging");
      if (!source || source === panelEl) return;
      swapPanels(source.dataset.panelId, panelEl.dataset.panelId);
    });

    panelEl.addEventListener("dblclick", (event) => {
      if (event.target.closest("button, input, label, select")) return;
      maximizedPanelId = maximizedPanelId === panelEl.dataset.panelId ? null : panelEl.dataset.panelId;
      renderGrid();
    });
  });

  document.querySelectorAll("[data-select-panel]").forEach((checkbox) => {
    checkbox.addEventListener("change", (event) => {
      event.stopPropagation();
      checkbox.checked ? selectedPanelIds.add(checkbox.dataset.selectPanel) : selectedPanelIds.delete(checkbox.dataset.selectPanel);
      renderGrid();
    });
  });

  document.querySelectorAll("[data-resize-panel]").forEach((handle) => {
    handle.addEventListener("pointerdown", startPhoneResize);
  });
}

function startPhoneResize(event) {
  if (event.button !== 0) return;
  const workspace = activeWorkspace();
  if (!workspace.stretchMode) return;
  event.preventDefault();
  event.stopPropagation();

  const panelId = event.currentTarget.dataset.resizePanel;
  const panel = workspace.panels.find((item) => item.id === panelId);
  const panelEl = document.querySelector(`[data-panel-id="${panelId}"]`);
  if (!panel || !panelEl) return;

  const rect = panelEl.getBoundingClientRect();
  resizeState = {
    panelId,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    startWidth: rect.width,
    startHeight: rect.height,
    freeResize: Boolean(workspace.freeResizeMode)
  };
  panelEl.classList.add("resizing");
  panelEl.draggable = false;
  event.currentTarget.setPointerCapture?.(event.pointerId);
}

function updatePhoneResize(event) {
  if (!resizeState) return;
  event.preventDefault();

  const workspace = activeWorkspace();
  const panel = workspace.panels.find((item) => item.id === resizeState.panelId);
  const panelEl = document.querySelector(`[data-panel-id="${resizeState.panelId}"]`);
  if (!panel || !panelEl) return;

  const minWidth = 190;
  const maxWidth = 720;
  const minHeight = 330;
  const maxHeight = 1280;
  const width = clamp(resizeState.startWidth + event.clientX - resizeState.startX, minWidth, maxWidth);
  const height = resizeState.freeResize
    ? clamp(resizeState.startHeight + event.clientY - resizeState.startY, minHeight, maxHeight)
    : Math.round(width / PHONE_ASPECT_RATIO);

  panel.customSize = { width: Math.round(width), height: Math.round(height) };
  applyPanelSizeStyles(panelEl, panel, workspace);
  queueLayoutSync();
}

function endPhoneResize(event) {
  if (!resizeState) return;
  const panelEl = document.querySelector(`[data-panel-id="${resizeState.panelId}"]`);
  panelEl?.classList.remove("resizing");
  if (panelEl) panelEl.draggable = true;
  event.target.releasePointerCapture?.(resizeState.pointerId);
  resizeState = null;
  persist();
  queueLayoutSync();
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function viewSlotAtPoint(clientX, clientY) {
  return [...document.querySelectorAll(".view-slot")].find((slot) => {
    const rect = slot.getBoundingClientRect();
    return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
  });
}

function swapPanels(sourceId, targetId) {
  const workspace = activeWorkspace();
  const source = workspace.panels.find((panel) => panel.id === sourceId);
  const target = workspace.panels.find((panel) => panel.id === targetId);
  if (!source || !target) return;
  [source.order, target.order] = [target.order, source.order];
  renderGrid();
}

function queueLayoutSync() {
  if (layoutRaf) cancelAnimationFrame(layoutRaf);
  layoutRaf = requestAnimationFrame(syncEmbeddedBounds);
}

function syncEmbeddedBounds() {
  layoutRaf = null;
  const viewport = dashboardWrap.getBoundingClientRect();
  const overlay = (globalControlState.visible ? gcShell : globalControlToggle).getBoundingClientRect();
  const panels = visiblePanels().map((panel) => {
    const slot = document.querySelector(`[data-slot-id="${panel.id}"]`);
    if (!slot) return null;
    const bounds = slot.getBoundingClientRect();
    // Use intersectRects only to decide whether the panel is in view.
    // Pass full slot bounds so the webview never resizes mid-scroll.
    const clipped = intersectRects(bounds, viewport);
    if (!clipped) return null;
    if (rectsOverlap(bounds, overlay)) return null;
    return {
      ...panel,
      bounds: {
        x: Math.round(bounds.x),
        y: Math.round(bounds.y),
        width: Math.round(bounds.width),
        height: Math.round(bounds.height)
      }
    };
  }).filter(Boolean);

  window.panelApi.mountVisible(panels);
}

function intersectRects(rect, viewport) {
  const left = Math.max(rect.left, viewport.left);
  const top = Math.max(rect.top, viewport.top);
  const right = Math.min(rect.right, viewport.right);
  const bottom = Math.min(rect.bottom, viewport.bottom);
  const width = right - left;
  const height = bottom - top;

  if (width < 80 || height < 60) return null;
  return { x: left, y: top, width, height };
}

function rectsOverlap(a, b) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

function setStatus(message) {
  statusText.textContent = message;
}

function selectedOrAllPanels() {
  const workspace = activeWorkspace();
  const selected = workspace.panels.filter((panel) => selectedPanelIds.has(panel.id));
  return selected.length ? selected : visiblePanels();
}

async function createPhoneTabs() {
  const workspace = activeWorkspace();
  const count = Math.max(1, Math.floor(Number(tabCountInput.value) || 0));
  const shouldReplace = tabCreateMode.value === "replace";
  const browser = browserSelect.value;
  const url = normalizeUrl(startupUrl.value || "https://example.com/");
  const startIndex = shouldReplace ? 0 : workspace.panels.length;
  const previousPanels = shouldReplace ? [...workspace.panels] : [];
  const nextPanels = Array.from({ length: count }, (_value, index) =>
    createPanel(browser, `${browserLabel(browser)} ${startIndex + index + 1}`, url, startIndex + index)
  );
  if (workspace.stretchMode) {
    const defaultSize = scaledDefaultPhoneSize(workspace);
    nextPanels.forEach((panel) => {
      panel.customSize = { ...defaultSize };
    });
  }

  if (shouldReplace) {
    await Promise.all(previousPanels.map((panel) =>
      window.panelApi.panelCommand({ id: panel.id, command: "close", panel })
    ));
    selectedPanelIds.clear();
    maximizedPanelId = null;
    workspace.panels = nextPanels;
  } else {
    workspace.panels.push(...nextPanels);
  }

  workspace.autoFit = true;
  renderWorkspaceNav();
  renderControls();
  renderGrid();
  setStatus(`${shouldReplace ? "Created" : "Added"} ${count} tab${count === 1 ? "" : "s"}`);
}

async function deleteSelectedPanels() {
  const workspace = activeWorkspace();
  const selected = workspace.panels.filter((panel) => selectedPanelIds.has(panel.id));
  if (!selected.length) {
    setStatus("Select workspaces to delete");
    return;
  }

  const confirmed = confirm(`Delete ${selected.length} selected workspace${selected.length === 1 ? "" : "s"}? This only removes the selected items.`);
  if (!confirmed) return;

  await Promise.all(selected.map((panel) =>
    window.panelApi.panelCommand({ id: panel.id, command: "close", panel })
  ));

  const selectedIds = new Set(selected.map((panel) => panel.id));
  workspace.panels = workspace.panels
    .filter((panel) => !selectedIds.has(panel.id))
    .sort((a, b) => a.order - b.order)
    .map((panel, index) => ({ ...panel, order: index }));
  selectedPanelIds.clear();
  if (maximizedPanelId && selectedIds.has(maximizedPanelId)) maximizedPanelId = null;
  renderWorkspaceNav();
  renderControls();
  renderGrid();
  setStatus(`Deleted ${selected.length} selected workspace${selected.length === 1 ? "" : "s"}`);
}

function createWorkspace() {
  const existingCount = Object.keys(state.workspaces).length + 1;
  const name = prompt("Workspace name", `Workspace ${existingCount}`);
  if (!name?.trim()) return;
  const idBase = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "workspace";
  let id = idBase;
  let suffix = 2;
  while (state.workspaces[id]) id = `${idBase}-${suffix++}`;

  state.workspaces[id] = {
    id,
    name: name.trim(),
    rows: 1,
    columns: 3,
    autoFit: true,
    mobileViewport: true,
    stretchMode: false,
    freeResizeMode: false,
    scale: 100,
    panels: []
  };
  activeWorkspaceId = id;
  selectedPanelIds.clear();
  maximizedPanelId = null;
  persist();
  renderWorkspaceNav();
  renderControls();
  renderGrid();
  setStatus(`${name.trim()} workspace created`);
}

function switchWorkspace(id) {
  if (!state.workspaces[id]) return;
  activeWorkspaceId = id;
  selectedPanelIds.clear();
  maximizedPanelId = null;
  renderWorkspaceNav();
  renderControls();
  renderGrid();
}

function browserLabel(browser) {
  return {
    chrome: "Chrome",
    firefox: "Firefox",
    duckduckgo: "DuckDuckGo",
    edge: "Edge"
  }[browser] || "Phone";
}

async function enterDashboardFullscreen() {
  maximizedPanelId = null;
  try {
    if (window.panelApi.maximizeToggle) {
      const maximized = await window.panelApi.maximizeToggle();
      isDashboardMaximized = maximized;
      renderGrid();
      setStatus(maximized ? "Fullscreen dashboard enabled" : "Fullscreen dashboard exited");
    } else {
      await document.documentElement.requestFullscreen();
      setStatus("Fullscreen dashboard enabled");
    }
  } catch (error) {
    setStatus(`Fullscreen blocked: ${error.message}`);
  }
}

async function exitDashboardFullscreen() {
  if (document.fullscreenElement) {
    await document.exitFullscreen();
  }
  if (isDashboardMaximized && window.panelApi.maximizeToggle) {
    await window.panelApi.maximizeToggle();
    isDashboardMaximized = false;
    renderGrid();
  }
}

function launchPanels(panels) {
  window.panelApi.launchWorkspace(panels);
  queueLayoutSync();
}

function renderGlobalControl() {
  // Drive visibility via aria-hidden so CSS transitions animate properly
  globalControlCenter.setAttribute("aria-hidden", String(!globalControlState.visible));
  globalControlToggle.setAttribute("aria-expanded", String(globalControlState.visible));
  globalControlToggle.setAttribute("aria-label", `${globalControlState.visible ? "Hide" : "Show"} Global Control Center`);
  hoverTargetMode.checked = globalControlState.hoverTargetMode;
  globalPositionText.textContent = globalControlState.clickTarget
    ? `${globalControlState.clickTarget.x}px, ${globalControlState.clickTarget.y}px`
    : "No target";
  document.body.classList.toggle("gc-target-mode", globalControlState.hoverTargetMode);
  if (globalControlState.hoverTargetMode && !gcTargetMarker.isConnected) {
    document.body.appendChild(gcTargetMarker);
  } else if (!globalControlState.hoverTargetMode && gcTargetMarker.isConnected) {
    gcTargetMarker.remove();
  }
  gcClickX.value = globalControlState.clickTarget?.x ?? "";
  gcClickY.value = globalControlState.clickTarget?.y ?? "";
  gcRunClick.disabled = !globalControlState.clickTarget;

  gcAutoMode.checked = globalControlState.autoMode;
  gcRepeatMode.checked = globalControlState.repeatMode;
  gcConcurrencyMode.checked = globalControlState.concurrencyMode;
  gcAutoConfig.classList.toggle("hidden", !globalControlState.autoMode);
  gcRepeatConfig.classList.toggle("hidden", !globalControlState.repeatMode);

  positionTargetMarker();
  queueLayoutSync();
}

function isGlobalAutomationRunning() {
  return Boolean(globalControlState.autoInterval || globalControlState.repeatRunning || automationState.status === "running");
}

function stopGlobalControllerAutomation() {
  automationRunId += 1;
  globalControllerResetId += 1;
  stopAutoMode();
  void window.panelApi.cancelAutomation?.({ panels: visiblePanels() });
  globalControlState.autoMode = false;
  globalControlState.repeatMode = false;
  globalControlState.repeatRunning = false;
}

function resetGlobalControllerUiPosition() {
  localStorage.removeItem(gcPositionKey);
  gcShell.style.left = "";
  gcShell.style.top = "";
  gcShell.style.right = "";
  gcShell.style.bottom = "";
}

function resetAutomationSessionState() {
  Object.assign(automationState, defaultAutomationSessionState(), {
    savedTargets: automationState.savedTargets
  });
  detectedElementList.innerHTML = "";
  autoClickProgressBar.style.width = "0%";
  autoClickTarget.value = "pointer";
  gcRepeatCount.value = 5;
  gcRepeatDelay.value = 2000;
  gcAutoInterval.value = 2000;
}

function resetCoordinates() {
  globalControlState.hoverTargetMode = false;
  globalControlState.clickTarget = null;
  globalControlState.point = { ...defaultGlobalControlState.point };
  gcTargetDrag.dragging = false;
  gcTargetMarker.classList.remove("dragging", "saved-pulse");
  gcTargetMarker.remove();
  renderGlobalControl();
  renderAutoClickPanel();
  setStatus("Click coordinates reset");
}

function resetAutomation() {
  stopGlobalControllerAutomation();
  gcScrollIndex = 0;
  globalControlState.lastAction = null;
  globalControlState.autoMode = false;
  globalControlState.repeatMode = false;
  globalControlState.concurrencyMode = defaultGlobalControlState.concurrencyMode;
  resetAutomationSessionState();
  renderGlobalControl();
  renderAutoClickPanel();
  setStatus("Automation settings reset");
}

function resetAllGlobalController() {
  if (isGlobalAutomationRunning()) {
    const confirmed = confirm("An automation is currently running. Reset the Global Controller and stop it safely?");
    if (!confirmed) return;
  }

  stopGlobalControllerAutomation();
  gcScrollIndex = 0;
  globalControlState = createDefaultGlobalControlState();
  resetAutomationSessionState();
  resetGlobalControllerUiPosition();
  gcTargetDrag.dragging = false;
  gcTargetMarker.classList.remove("dragging", "saved-pulse");
  gcTargetMarker.remove();
  renderGlobalControl();
  renderAutoClickPanel();
  setStatus("Global Controller fully reset");
}

function positionTargetMarker() {
  if (!globalControlState.hoverTargetMode || gcTargetDrag.dragging) return;
  const target = globalControlState.clickTarget;
  if (target) {
    const slot = document.querySelector(`[data-slot-id="${target.panelId}"]`);
    if (slot) {
      const rect = slot.getBoundingClientRect();
      setTargetMarkerPosition(rect.left + target.x, rect.top + target.y);
      return;
    }
  }

  const shellRect = gcShell.getBoundingClientRect();
  setTargetMarkerPosition(shellRect.right - 28, shellRect.top + 72);
}

function setTargetMarkerPosition(clientX, clientY) {
  gcTargetMarker.style.left = `${Math.round(clientX)}px`;
  gcTargetMarker.style.top = `${Math.round(clientY)}px`;
}

function saveClickTargetFromDrop(clientX, clientY) {
  const slot = viewSlotAtPoint(clientX, clientY);
  if (!slot) {
    positionTargetMarker();
    setStatus("Drop the green target inside a phone workspace");
    return false;
  }

  const rect = slot.getBoundingClientRect();
  const x = Math.round(clamp(clientX - rect.left, 0, rect.width));
  const y = Math.round(clamp(clientY - rect.top, 0, rect.height));
  globalControlState.clickTarget = {
    panelId: slot.dataset.slotId,
    x,
    y,
    width: Math.round(rect.width),
    height: Math.round(rect.height)
  };
  globalControlState.point = {
    x,
    y,
    xRatio: clamp(x / Math.max(1, rect.width), 0, 1),
    yRatio: clamp(y / Math.max(1, rect.height), 0, 1)
  };
  automationState.status = automationState.status === "running" ? automationState.status : "ready";
  automationState.selectedTargetId = "pointer";
  gcTargetMarker.classList.remove("saved-pulse");
  void gcTargetMarker.offsetWidth;
  gcTargetMarker.classList.add("saved-pulse");
  renderGlobalControl();
  renderAutoClickPanel();
  setStatus(`Click target saved: X ${x}, Y ${y}`);
  return true;
}

function renderAutoClickPanel() {
  const labels = {
    idle: "Idle",
    ready: "Ready",
    running: "Running",
    completed: "Completed",
    error: "Error"
  };
  autoClickState.textContent = labels[automationState.status] || "Idle";
  autoClickState.className = `automation-state ${automationState.status}`;

  const currentValue = automationState.selectedTargetId || autoClickTarget.value || "pointer";
  autoClickTarget.innerHTML = `<option value="pointer">Current pointer</option>`;
  automationState.savedTargets.forEach((target) => {
    const option = document.createElement("option");
    option.value = target.id;
    option.textContent = target.name;
    autoClickTarget.appendChild(option);
  });
  if ([...autoClickTarget.options].some((option) => option.value === currentValue)) {
    autoClickTarget.value = currentValue;
  } else {
    autoClickTarget.value = "pointer";
    automationState.selectedTargetId = "pointer";
  }

  const savedTarget = automationState.savedTargets.find((target) => target.id === autoClickTarget.value);
  const selectedElement = automationState.selectedElement;
  const confidence = selectedElement?.confidence ?? savedTarget?.confidence;
  autoClickTargetHint.textContent = savedTarget
    ? `${savedTarget.role || savedTarget.tag || "element"} · ${Math.round((confidence || 0.72) * 100)}%`
    : `Pointer ${Math.round(globalControlState.point.xRatio * 100)}%, ${Math.round(globalControlState.point.yRatio * 100)}%`;

  const progressTotal = automationState.progress.total || 0;
  const progressDone = automationState.progress.done || 0;
  const progressPct = progressTotal ? Math.round((progressDone / progressTotal) * 100) : 0;
  autoClickProgressBar.style.width = `${progressPct}%`;
  autoClickProgressText.textContent = `${progressDone} / ${progressTotal}`;
  automationSummary.innerHTML = `
    <span>Success ${automationState.summary.success || 0}</span>
    <span>Failed ${automationState.summary.failed || 0}</span>
    <span>Skipped ${automationState.summary.skipped || 0}</span>
  `;
  autoClickError.textContent = automationState.error || "";
  const automationRunning = automationState.status === "running";
  detectElements.disabled = automationRunning;
  saveManualTarget.disabled = automationRunning;
  runAutoClick.disabled = automationRunning;

  detectedElementList.innerHTML = "";
  flattenDetectedElements().slice(0, 10).forEach((item) => {
    const button = document.createElement("button");
    button.className = "detected-element";
    button.type = "button";
    button.dataset.panelId = item.panelId;
    button.dataset.elementId = item.element.id;
    button.innerHTML = `
      <span>
        <strong>${escapeHtml(item.element.label || item.element.role || item.element.tag || "Interactive element")}</strong>
        <small>${escapeHtml(item.panelName)} · ${escapeHtml(item.element.role || item.element.tag)}</small>
      </span>
      <em>${Math.round(item.element.confidence * 100)}%</em>
    `;
    button.addEventListener("click", () => selectDetectedElement(item.panelId, item.element.id));
    detectedElementList.appendChild(button);
  });

  renderAutomationHighlights();
}

function flattenDetectedElements() {
  const panelsById = new Map(activeWorkspace().panels.map((panel) => [panel.id, panel]));
  return automationState.detected.flatMap((result) => {
    const panel = panelsById.get(result.panelId);
    return (result.elements || []).map((element) => ({
      panelId: result.panelId,
      panelName: panel?.name || result.panelId,
      element
    }));
  });
}

function selectDetectedElement(panelId, elementId) {
  const result = automationState.detected.find((item) => item.panelId === panelId);
  const element = result?.elements?.find((item) => item.id === elementId);
  if (!element) return;
  automationState.selectedElement = { panelId, ...element, mode: "element" };
  automationState.status = "ready";
  automationState.error = "";
  renderAutoClickPanel();
}

function renderAutomationHighlights() {
  document.querySelectorAll("[data-automation-layer]").forEach((layer) => {
    layer.innerHTML = "";
    const panelId = layer.dataset.automationLayer;
    const result = automationState.detected.find((item) => item.panelId === panelId);
    const elements = (result?.elements || []).slice(0, 20);
    elements.forEach((element) => {
      const box = document.createElement("button");
      const selected = automationState.selectedElement?.panelId === panelId && automationState.selectedElement?.id === element.id;
      box.className = `automation-highlight ${selected ? "selected" : ""}`;
      box.type = "button";
      box.title = `${element.label || element.role || element.tag} · ${Math.round(element.confidence * 100)}% confidence`;
      box.style.left = `${(element.xRatio - element.widthRatio / 2) * 100}%`;
      box.style.top = `${(element.yRatio - element.heightRatio / 2) * 100}%`;
      box.style.width = `${Math.max(3, element.widthRatio * 100)}%`;
      box.style.height = `${Math.max(3, element.heightRatio * 100)}%`;
      box.innerHTML = `<span>${Math.round(element.confidence * 100)}%</span>`;
      box.addEventListener("click", (event) => {
        event.stopPropagation();
        selectDetectedElement(panelId, element.id);
      });
      layer.appendChild(box);
    });
  });
}

async function detectInteractiveElements() {
  const runId = ++automationRunId;
  const panels = selectedOrAllPanels();
  if (!panels.length) {
    setAutomationError("Create or select at least one panel before detecting elements.");
    return;
  }

  automationState.status = "running";
  automationState.error = "";
  automationState.progress = { done: 0, total: panels.length };
  automationState.summary = { success: 0, failed: 0, skipped: 0 };
  renderAutoClickPanel();

  let results;
  try {
    results = await window.panelApi.detectElements({ panels });
  } catch (error) {
    if (runId !== automationRunId) return;
    setAutomationError(`Element detection failed: ${error.message}`);
    return;
  }
  if (runId !== automationRunId) return;
  automationState.detected = results;
  automationState.summary = results.reduce((memo, result) => {
    memo[result.status] = (memo[result.status] || 0) + 1;
    return memo;
  }, { success: 0, failed: 0, skipped: 0 });
  automationState.progress = { done: results.length, total: panels.length };
  const firstElement = flattenDetectedElements()[0];
  automationState.selectedElement = firstElement ? { panelId: firstElement.panelId, ...firstElement.element, mode: "element" } : null;
  automationState.status = firstElement ? "ready" : "error";
  automationState.error = firstElement ? "" : "No interactive elements were detected in the current workspace.";
  setStatus(firstElement ? `Detected ${flattenDetectedElements().length} interactive elements` : "No elements detected");
  renderAutoClickPanel();
}

function saveManualAutomationTarget() {
  const source = automationState.selectedElement || {
    mode: "point",
    xRatio: globalControlState.point.xRatio,
    yRatio: globalControlState.point.yRatio,
    confidence: 0.7,
    role: "point",
    label: "Manual pointer"
  };
  const name = prompt("Automation target name", source.label ? `Click ${source.label}` : "Click target");
  if (!name?.trim()) return;
  const target = {
    ...source,
    id: `target-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name: name.trim(),
    savedAt: Date.now()
  };
  automationState.savedTargets.push(target);
  persistAutomationTargets();
  automationState.selectedTargetId = target.id;
  automationState.status = "ready";
  automationState.error = "";
  setStatus(`Saved automation target: ${target.name}`);
  renderAutoClickPanel();
}

function setAutomationError(message) {
  automationState.status = "error";
  automationState.error = message;
  setStatus(message);
  renderAutoClickPanel();
}

function selectedAutomationTarget() {
  if (autoClickTarget.value === "pointer") {
    return {
      mode: "point",
      name: "Current pointer",
      xRatio: globalControlState.point.xRatio,
      yRatio: globalControlState.point.yRatio,
      confidence: 0.7
    };
  }
  return automationState.savedTargets.find((target) => target.id === autoClickTarget.value);
}

async function runAutoClickAutomation() {
  const panels = selectedOrAllPanels();
  const target = selectedAutomationTarget();
  if (!panels.length) {
    setAutomationError("Create or select at least one panel before running Auto Click.");
    return;
  }
  if (!target) {
    setAutomationError("Choose a target or save the current pointer first.");
    return;
  }

  const confidenceText = `${Math.round((target.confidence || 0.7) * 100)}%`;
  const confirmed = confirm(`Run Auto Click on ${panels.length} panel${panels.length === 1 ? "" : "s"}?\n\nTarget: ${target.name || target.label || "Current pointer"}\nConfidence: ${confidenceText}`);
  if (!confirmed) {
    automationState.status = "idle";
    automationState.error = "";
    renderAutoClickPanel();
    return;
  }

  const runId = ++automationRunId;
  automationState.status = "running";
  automationState.error = "";
  automationState.progress = { done: 0, total: panels.length };
  automationState.summary = { success: 0, failed: 0, skipped: 0 };
  renderAutoClickPanel();

  for (const panel of panels) {
    if (runId !== automationRunId) return;
    let result;
    try {
      result = await window.panelApi.automationAction({
        action: "click",
        target: target.mode === "point" ? null : target,
        point: target.mode === "point" ? target : null,
        panels: [panel]
      });
    } catch (error) {
      if (runId !== automationRunId) return;
      automationState.summary.failed += 1;
      automationState.error = `Auto Click failed: ${error.message}`;
      automationState.progress.done += 1;
      renderAutoClickPanel();
      continue;
    }
    if (runId !== automationRunId) return;
    automationState.summary.success += result.summary?.success || 0;
    automationState.summary.failed += result.summary?.failed || 0;
    automationState.summary.skipped += result.summary?.skipped || 0;
    automationState.error = result.error || automationState.error;
    automationState.progress.done += 1;
    renderAutoClickPanel();
    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  if (runId !== automationRunId) return;
  automationState.status = automationState.summary.failed ? "error" : "completed";
  setStatus(`Auto Click complete: ${automationState.summary.success} success, ${automationState.summary.failed} failed, ${automationState.summary.skipped} skipped`);
  renderAutoClickPanel();
}

async function runGlobalAction(action) {
  const panels = visiblePanels();
  if (!panels.length) {
    setStatus("Create tabs before using Global Control");
    return;
  }

  globalControlState.lastAction = action;

  // Sequential mode: scroll one panel at a time, round-robin
  let targetPanels;
  if (globalControlState.concurrencyMode) {
    targetPanels = panels;
  } else {
    gcScrollIndex = gcScrollIndex % panels.length;
    targetPanels = [panels[gcScrollIndex]];
    gcScrollIndex = (gcScrollIndex + 1) % panels.length;
  }

  try {
    await window.panelApi.globalControl({
      action,
      point: globalControlState.point,
      panels: targetPanels
    });
  } catch (error) {
    setStatus(`Global action failed: ${error.message}`);
    return;
  }

  const label = targetPanels.length === 1
    ? targetPanels[0].name
    : `${panels.length} tab${panels.length === 1 ? "" : "s"}`;
  setStatus(`Global ${action === "double-click" ? "double click" : action.replace("-", " ")} → ${label}`);

  if (globalControlState.autoMode && !globalControlState.autoInterval) {
    startAutoMode(action);
  }
  if (globalControlState.repeatMode && !globalControlState.repeatRunning) {
    startRepeatMode(action);
  }
}

async function runVisualTargetClick() {
  if (!globalControlState.clickTarget) {
    setStatus("Drop the green target inside a phone workspace first");
    return;
  }

  const panels = selectedOrAllPanels();
  if (!panels.length) {
    setStatus("Create or select phone workspaces before running click");
    return;
  }

  try {
    await window.panelApi.globalControl({
      action: "click",
      point: globalControlState.point,
      panels
    });
  } catch (error) {
    setStatus(`Run Click failed: ${error.message}`);
    return;
  }

  const label = panels.length === 1 ? panels[0].name : `${panels.length} phone workspaces`;
  setStatus(`Run Click → X ${globalControlState.clickTarget.x}, Y ${globalControlState.clickTarget.y} on ${label}`);
}

function startAutoMode(action) {
  stopAutoMode();
  const resetId = globalControllerResetId;
  const interval = Math.max(200, Number(gcAutoInterval.value) || 2000);
  globalControlState.autoInterval = setInterval(() => {
    if (!globalControlState.autoMode || resetId !== globalControllerResetId) {
      stopAutoMode();
      return;
    }
    const panels = visiblePanels();
    if (!panels.length) return;
    let targetPanels;
    if (globalControlState.concurrencyMode) {
      targetPanels = panels;
    } else {
      gcScrollIndex = gcScrollIndex % panels.length;
      targetPanels = [panels[gcScrollIndex]];
      gcScrollIndex = (gcScrollIndex + 1) % panels.length;
    }
    window.panelApi.globalControl({
      action,
      point: globalControlState.point,
      panels: targetPanels
    }).catch((error) => setStatus(`Auto action failed: ${error.message}`));
  }, interval);
}

function stopAutoMode() {
  if (globalControlState.autoInterval) {
    clearInterval(globalControlState.autoInterval);
    globalControlState.autoInterval = null;
  }
}

async function startRepeatMode(action) {
  if (globalControlState.repeatRunning) return;
  const resetId = globalControllerResetId;
  globalControlState.repeatRunning = true;
  const count = Math.max(1, Math.min(999, Number(gcRepeatCount.value) || 5));
  const delay = Math.max(100, Number(gcRepeatDelay.value) || 2000);
  let completed = true;

  for (let i = 1; i < count; i++) {
    if (!globalControlState.repeatMode || !globalControlState.repeatRunning || resetId !== globalControllerResetId) {
      completed = false;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, delay));
    if (!globalControlState.repeatMode || !globalControlState.repeatRunning || resetId !== globalControllerResetId) {
      completed = false;
      break;
    }
    const panels = visiblePanels();
    if (!panels.length) {
      completed = false;
      break;
    }
    let targetPanels;
    if (globalControlState.concurrencyMode) {
      targetPanels = panels;
    } else {
      gcScrollIndex = gcScrollIndex % panels.length;
      targetPanels = [panels[gcScrollIndex]];
      gcScrollIndex = (gcScrollIndex + 1) % panels.length;
    }
    try {
      await window.panelApi.globalControl({
        action,
        point: globalControlState.point,
        panels: targetPanels
      });
    } catch (error) {
      if (resetId === globalControllerResetId) setStatus(`Repeat action failed: ${error.message}`);
      completed = false;
      break;
    }
    if (resetId !== globalControllerResetId) {
      completed = false;
      break;
    }
    setStatus(`Repeat ${i + 1}/${count} — ${action.replace("-", " ")} → ${targetPanels[0]?.name ?? ""}`);
  }
  if (resetId !== globalControllerResetId) return;
  globalControlState.repeatRunning = false;
  renderGlobalControl();
  setStatus(completed ? `Repeat complete (${count}×)` : "Repeat stopped");
}

async function applyStartupUrl() {
  const browser = browserSelect.value;
  const url = normalizeUrl(startupUrl.value);
  const workspace = activeWorkspace();
  const targets = workspace.panels.filter((panel) => panel.browser === browser && (!selectedPanelIds.size || selectedPanelIds.has(panel.id)));
  const applyButton = document.getElementById("applyUrl");

  if (!targets.length) {
    setStatus(`No ${browserLabel(browser)} tabs matched the current selection`);
    return;
  }

  applyButton.disabled = true;
  setStatus(`Updating ${targets.length} ${browserLabel(browser)} tab${targets.length === 1 ? "" : "s"}...`);

  for (const panel of targets) {
    panel.url = url;
    panel.currentUrl = url;
  }

  try {
    await Promise.all(targets.map((panel) =>
      window.panelApi.panelCommand({ id: panel.id, command: "navigate", value: url, panel })
    ));
    setStatus(`Updated ${targets.length} ${browserLabel(browser)} startup URL${targets.length === 1 ? "" : "s"}`);
    persist();
  } catch (error) {
    setStatus(`URL update failed: ${error.message}`);
  } finally {
    applyButton.disabled = false;
  }
}

function normalizeUrl(value) {
  const trimmed = value.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[char]));
}

document.getElementById("launchWorkspace").addEventListener("click", () => {
  launchPanels(visiblePanels());
  setStatus("Workspace launched inside this app");
});

document.getElementById("launchSelected").addEventListener("click", () => {
  activeWorkspace().panels
    .filter((panel) => selectedPanelIds.has(panel.id))
    .forEach((panel) => window.panelApi.panelCommand({ id: panel.id, command: "reload", panel }));
  setStatus(selectedPanelIds.size ? "Selected panels reloaded" : "Select panels first");
});

document.getElementById("closeAll").addEventListener("click", async () => {
  await window.panelApi.closeAll();
  setStatus("All embedded panels closed");
});

document.getElementById("refreshAll").addEventListener("click", () => {
  selectedOrAllPanels().forEach((panel) => window.panelApi.panelCommand({ id: panel.id, command: "reload", panel }));
  setStatus("Reload requested");
});

document.getElementById("createTabs").addEventListener("click", createPhoneTabs);
fullscreenDashboard.addEventListener("click", enterDashboardFullscreen);
exitFullscreen.addEventListener("click", exitDashboardFullscreen);
toggleSidebar.addEventListener("click", () => setSidebarCollapsed(!uiState.sidebarCollapsed));
toggleControls.addEventListener("click", () => setControlsCollapsed(!uiState.controlsCollapsed));
restoreSidebar.addEventListener("click", () => setSidebarCollapsed(false));
restoreControls.addEventListener("click", () => setControlsCollapsed(false));
themeToggle.addEventListener("click", () => {
  currentTheme = currentTheme === "dark" ? "light" : "dark";
  applyTheme();
});
deleteSelected.addEventListener("click", deleteSelectedPanels);
globalControlToggle.addEventListener("click", () => {
  globalControlState.visible = !globalControlState.visible;
  renderGlobalControl();
});

if (gcCollapseBtn) {
  gcCollapseBtn.addEventListener("click", () => {
    globalControlState.visible = false;
    renderGlobalControl();
  });
}
hoverTargetMode.addEventListener("change", () => {
  globalControlState.hoverTargetMode = hoverTargetMode.checked;
  renderGlobalControl();
  setStatus(globalControlState.hoverTargetMode ? "Hover Target Mode enabled" : "Hover Target Mode disabled");
});
gcRunClick.addEventListener("click", runVisualTargetClick);
gcResetCoordinates.addEventListener("click", resetCoordinates);
gcResetAutomation.addEventListener("click", resetAutomation);
gcResetAll.addEventListener("click", resetAllGlobalController);
document.getElementById("globalScrollUp").addEventListener("click", () => runGlobalAction("scroll-up"));
document.getElementById("globalScrollDown").addEventListener("click", () => runGlobalAction("scroll-down"));
document.getElementById("globalDoubleClick").addEventListener("click", () => runGlobalAction("double-click"));
document.getElementById("globalStop").addEventListener("click", () => {
  stopGlobalControllerAutomation();
  renderGlobalControl();
  renderAutoClickPanel();
  setStatus("Global automation stopped");
});

gcAutoMode.addEventListener("change", () => {
  globalControlState.autoMode = gcAutoMode.checked;
  if (!globalControlState.autoMode) stopAutoMode();
  renderGlobalControl();
});

gcRepeatMode.addEventListener("change", () => {
  globalControlState.repeatMode = gcRepeatMode.checked;
  if (!globalControlState.repeatMode) globalControlState.repeatRunning = false;
  renderGlobalControl();
});

gcConcurrencyMode.addEventListener("change", () => {
  globalControlState.concurrencyMode = gcConcurrencyMode.checked;
  renderGlobalControl();
});

autoClickTarget.addEventListener("change", () => {
  automationState.selectedTargetId = autoClickTarget.value || "pointer";
  automationState.status = "ready";
  automationState.error = "";
  renderAutoClickPanel();
});
detectElements.addEventListener("click", detectInteractiveElements);
saveManualTarget.addEventListener("click", saveManualAutomationTarget);
runAutoClick.addEventListener("click", runAutoClickAutomation);

document.getElementById("saveLayout").addEventListener("click", () => {
  const workspace = activeWorkspace();
  state.savedLayouts[workspace.id] = {
    rows: workspace.rows,
    columns: workspace.columns,
    autoFit: workspace.autoFit,
    mobileViewport: workspace.mobileViewport,
    stretchMode: workspace.stretchMode,
    freeResizeMode: workspace.freeResizeMode,
    scale: workspace.scale,
    order: workspace.panels.map((panel) => ({ id: panel.id, order: panel.order, customSize: panel.customSize }))
  };
  persist();
  setStatus("Layout saved");
});

document.getElementById("loadLayout").addEventListener("click", () => {
  const workspace = activeWorkspace();
  const saved = state.savedLayouts[workspace.id];
  if (!saved) {
    setStatus("No saved layout for this workspace");
    return;
  }
  workspace.rows = saved.rows;
  workspace.columns = saved.columns;
  workspace.autoFit = saved.autoFit ?? workspace.autoFit;
  workspace.mobileViewport = saved.mobileViewport ?? workspace.mobileViewport;
  workspace.stretchMode = saved.stretchMode ?? workspace.stretchMode;
  workspace.freeResizeMode = saved.freeResizeMode ?? workspace.freeResizeMode;
  workspace.scale = saved.scale;
  saved.order.forEach((savedPanel) => {
    const panel = workspace.panels.find((item) => item.id === savedPanel.id);
    if (panel) {
      panel.order = savedPanel.order;
      panel.customSize = savedPanel.customSize ?? panel.customSize ?? null;
    }
  });
  renderControls();
  renderGrid();
  setStatus("Layout loaded");
});

document.getElementById("applyUrl").addEventListener("click", applyStartupUrl);

rowsInput.addEventListener("change", () => {
  activeWorkspace().rows = Math.max(1, Number(rowsInput.value) || 1);
  renderGrid();
});

columnsInput.addEventListener("change", () => {
  activeWorkspace().columns = Math.max(1, Number(columnsInput.value) || 1);
  renderGrid();
});

panelScale.addEventListener("input", () => {
  const workspace = activeWorkspace();
  workspace.scale = Math.max(55, Math.min(240, Number(panelScale.value) || 100));
  updateGridMetrics(workspace);
  queueLayoutSync();
  persist();
});

autoFitLayout.addEventListener("change", () => {
  activeWorkspace().autoFit = autoFitLayout.checked;
  renderControls();
  renderGrid();
  setStatus(autoFitLayout.checked ? "Auto arrange enabled" : "Manual arrange enabled");
});

mobileViewport.addEventListener("change", () => {
  const workspace = activeWorkspace();
  workspace.mobileViewport = mobileViewport.checked;
  workspace.panels.forEach((panel) => {
    panel.mobileViewport = workspace.mobileViewport;
  });
  renderGrid();
  setStatus(mobileViewport.checked ? "Compact view enabled" : "Wide desktop view enabled");
});

stretchMode.addEventListener("change", () => {
  const workspace = activeWorkspace();
  workspace.stretchMode = stretchMode.checked;
  if (!workspace.stretchMode) {
    workspace.freeResizeMode = false;
    workspace.panels.forEach((panel) => {
      panel.customSize = null;
    });
  } else {
    const defaultSize = scaledDefaultPhoneSize(workspace);
    workspace.panels.forEach((panel) => {
      panel.customSize ||= { ...defaultSize };
    });
  }
  renderControls();
  renderGrid();
  setStatus(workspace.stretchMode ? "Stretch mode enabled" : "Stretch mode disabled");
});

freeResizeMode.addEventListener("change", () => {
  const workspace = activeWorkspace();
  workspace.freeResizeMode = freeResizeMode.checked;
  renderControls();
  renderGrid();
  setStatus(workspace.freeResizeMode ? "Free resize enabled" : "Aspect ratio lock enabled");
});

browserSelect.addEventListener("change", renderControls);

document.querySelectorAll(".check-row input").forEach((input) => {
  input.addEventListener("change", () => {
    input.checked ? filters.add(input.value) : filters.delete(input.value);
    renderGrid();
  });
});

document.querySelectorAll(".workspace-item").forEach((button) => {
  button.addEventListener("click", () => switchWorkspace(button.dataset.workspace));
});

window.addEventListener("resize", () => {
  queueLayoutSync();
  positionTargetMarker();
});
window.addEventListener("pointermove", updatePhoneResize);
window.addEventListener("pointerup", endPhoneResize);
window.addEventListener("pointercancel", endPhoneResize);
dashboardWrap.addEventListener("scroll", () => {
  queueLayoutSync();
  positionTargetMarker();
});
document.addEventListener("fullscreenchange", () => {
  renderGrid();
  setStatus(document.fullscreenElement ? "Fullscreen dashboard enabled" : "Fullscreen dashboard exited");
});
window.panelApi.onLayoutInvalidated(queueLayoutSync);
window.panelApi.onPanelStatus((payload) => {
  const panel = activeWorkspace().panels.find((item) => item.id === payload.id);
  if (!panel) return;
  if (payload.title) panel.title = payload.title;
  if (payload.url) panel.currentUrl = payload.url;
  panel.status = payload.loading ? "loading" : "live";
  updatePanelStatus(payload.id);
});

function updatePanelStatus(panelId) {
  const panel = activeWorkspace().panels.find((item) => item.id === panelId);
  const panelEl = document.querySelector(`[data-panel-id="${panelId}"]`);
  if (!panel || !panelEl) return;
  const dot = panelEl.querySelector(".status-dot");
  const name = panelEl.querySelector(".panel-name");
  if (dot) {
    dot.classList.toggle("loading", panel.status === "loading");
    dot.classList.toggle("live", panel.status === "live");
  }
  if (name) name.title = panel.title || panel.name;
  persist();
}

document.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "r") {
    event.preventDefault();
    selectedOrAllPanels().forEach((panel) => window.panelApi.panelCommand({ id: panel.id, command: "reload", panel }));
  }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "l") {
    event.preventDefault();
    document.getElementById("launchWorkspace").click();
  }
  if (event.key === "Escape" && maximizedPanelId) {
    maximizedPanelId = null;
    renderGrid();
  }
});

renderWorkspaceNav();
renderControls();
applyTheme();
applyUiState();
renderGlobalControl();
renderAutoClickPanel();
renderGrid();

/* ── Visual Click Target ───────────────────────────────────────── */

(function initVisualClickTarget() {
  gcTargetMarker.addEventListener("pointerdown", (event) => {
    if (!globalControlState.hoverTargetMode || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = gcTargetMarker.getBoundingClientRect();
    gcTargetDrag.dragging = true;
    gcTargetDrag.offsetX = event.clientX - rect.left;
    gcTargetDrag.offsetY = event.clientY - rect.top;
    gcTargetMarker.classList.add("dragging");
    gcTargetMarker.setPointerCapture?.(event.pointerId);
  });

  gcTargetMarker.addEventListener("pointermove", (event) => {
    if (!gcTargetDrag.dragging) return;
    event.preventDefault();
    const x = event.clientX - gcTargetDrag.offsetX + gcTargetMarker.offsetWidth / 2;
    const y = event.clientY - gcTargetDrag.offsetY + gcTargetMarker.offsetHeight / 2;
    setTargetMarkerPosition(
      clamp(x, 8, Math.max(8, window.innerWidth - 8)),
      clamp(y, 8, Math.max(8, window.innerHeight - 8))
    );
  });

  gcTargetMarker.addEventListener("pointerup", (event) => {
    if (!gcTargetDrag.dragging) return;
    event.preventDefault();
    gcTargetDrag.dragging = false;
    gcTargetMarker.classList.remove("dragging");
    gcTargetMarker.releasePointerCapture?.(event.pointerId);
    const rect = gcTargetMarker.getBoundingClientRect();
    saveClickTargetFromDrop(rect.left + rect.width / 2, rect.top + rect.height / 2);
  });

  gcTargetMarker.addEventListener("pointercancel", () => {
    gcTargetDrag.dragging = false;
    gcTargetMarker.classList.remove("dragging");
    positionTargetMarker();
  });
})();

/* ── GC Dragging ─────────────────────────────────────────────── */

(function initGcDrag() {
  // The pill button is the drag handle (also the expand/collapse trigger)
  const dragHandle = gcShell.querySelector(".gc-pill");
  if (!dragHandle) return;

  let dragging = false;
  let didDrag = false;
  let suppressNextClick = false;
  let offsetX = 0;
  let offsetY = 0;

  function restoreGcPosition() {
    try {
      const saved = JSON.parse(localStorage.getItem(gcPositionKey));
      if (saved && typeof saved.left === "number" && typeof saved.top === "number") {
        // Use a small settle delay so the widget has its real dimensions
        requestAnimationFrame(() => {
          const shellRect = gcShell.getBoundingClientRect();
          gcShell.style.left = `${clamp(saved.left, 0, Math.max(0, window.innerWidth - shellRect.width))}px`;
          gcShell.style.top = `${clamp(saved.top, 0, Math.max(0, window.innerHeight - shellRect.height))}px`;
          gcShell.style.right = "auto";
          gcShell.style.bottom = "auto";
        });
      }
    } catch {
      // Use default CSS position (bottom-right).
    }
  }

  function saveGcPosition() {
    const rect = gcShell.getBoundingClientRect();
    localStorage.setItem(gcPositionKey, JSON.stringify({ left: rect.left, top: rect.top }));
  }

  let startX = 0;
  let startY = 0;
  const DRAG_THRESHOLD = 5; // pixels before we consider it a drag

  dragHandle.addEventListener("pointerdown", (event) => {
    // Only primary button
    if (event.button !== 0) return;
    dragging = true;
    didDrag = false;
    startX = event.clientX;
    startY = event.clientY;
    const rect = gcShell.getBoundingClientRect();
    offsetX = event.clientX - rect.left;
    offsetY = event.clientY - rect.top;
    dragHandle.setPointerCapture?.(event.pointerId);
  });

  dragHandle.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    if (!didDrag && Math.sqrt(dx * dx + dy * dy) < DRAG_THRESHOLD) return;
    didDrag = true;
    event.preventDefault();
    dragHandle.style.cursor = "grabbing";
    const shellRect = gcShell.getBoundingClientRect();
    const maxLeft = window.innerWidth - shellRect.width;
    const maxTop = window.innerHeight - shellRect.height;
    const left = clamp(event.clientX - offsetX, 0, Math.max(0, maxLeft));
    const top = clamp(event.clientY - offsetY, 0, Math.max(0, maxTop));
    gcShell.style.left = `${left}px`;
    gcShell.style.top = `${top}px`;
    gcShell.style.right = "auto";
    gcShell.style.bottom = "auto";
    queueLayoutSync();
  });

  dragHandle.addEventListener("pointerup", (event) => {
    if (!dragging) return;
    dragging = false;
    dragHandle.style.cursor = "";
    dragHandle.releasePointerCapture?.(event.pointerId);
    if (didDrag) {
      saveGcPosition();
      suppressNextClick = true;
      queueLayoutSync();
    }
    didDrag = false;
  });

  dragHandle.addEventListener("pointercancel", () => {
    dragging = false;
    dragHandle.style.cursor = "";
    didDrag = false;
  });

  dragHandle.addEventListener("click", (event) => {
    if (suppressNextClick) {
      event.stopImmediatePropagation();
      suppressNextClick = false;
    }
  }, { capture: true });

  restoreGcPosition();
})();
