const { app, BrowserWindow, BrowserView, ipcMain, nativeImage } = require("electron");
const path = require("path");
const fs = require("fs");
const { UserAgentManager } = require("./userAgentManager");

let mainWindow;
const views = new Map();
const sessionMetadata = new Map();
const viewSessionMetadata = new WeakMap();
const configuredPartitionUserAgents = new Map();
let lastClosedSession = [];
const userDataPath = path.join(__dirname, "..", ".panel-data");
const userAgentManager = new UserAgentManager();

fs.mkdirSync(userDataPath, { recursive: true });
app.setPath("userData", userDataPath);

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1680,
    height: 980,
    minWidth: 1180,
    minHeight: 720,
    title: "Panel Workspace",
    backgroundColor: "#0b0f14",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  mainWindow.setMaxListeners(300);

  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));

  mainWindow.on("resize", () => {
    mainWindow.webContents.send("window:layout-invalidated");
  });

  mainWindow.on("closed", () => {
    for (const id of views.keys()) removeView(id);
    mainWindow = null;
  });
}

function buildPartition(panel) {
  const browser = sanitizePartitionPart(panel.browser || "browser");
  const profile = sanitizePartitionPart(panel.profile || panel.id);
  return `persist:${browser}-${profile}`;
}

function sanitizePartitionPart(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-|-$/g, "");
}

function ensureView(panel) {
  if (views.has(panel.id)) return views.get(panel.id);

  const partition = buildPartition(panel);
  const view = new BrowserView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      partition
    }
  });

  views.set(panel.id, view);
  mainWindow.addBrowserView(view);
  initializeBrowserSession(panel, view, partition);
  wireViewEvents(panel.id, view);
  loadPanelUrl(view, panel.currentUrl || panel.url || "https://example.com");
  return view;
}

function initializeBrowserSession(panel, view, partition) {
  const sessionKey = partition;
  const assignment = userAgentManager.acquire(sessionKey, panel.sessionMetadata?.userAgent);
  const metadata = {
    id: panel.id,
    partition,
    userAgent: assignment.userAgent,
    sessionNumber: assignment.sessionNumber,
    assignedAt: assignment.assignedAt
  };

  sessionMetadata.set(panel.id, metadata);
  viewSessionMetadata.set(view, metadata);
  panel.sessionMetadata = metadata;
  view.webContents.setUserAgent(metadata.userAgent);
  configureSessionUserAgent(view.webContents.session, partition, metadata.userAgent);
}

function configureSessionUserAgent(electronSession, partition, userAgent) {
  if (configuredPartitionUserAgents.get(partition) === userAgent) return;

  configuredPartitionUserAgents.set(partition, userAgent);
  electronSession.webRequest.onBeforeSendHeaders(
    { urls: ["http://*/*", "https://*/*"] },
    (details, callback) => {
      for (const headerName of Object.keys(details.requestHeaders)) {
        if (headerName.toLowerCase() === "user-agent") delete details.requestHeaders[headerName];
      }
      details.requestHeaders["User-Agent"] = userAgent;
      callback({ requestHeaders: details.requestHeaders });
    }
  );
}

function getSessionMetadata(view) {
  return viewSessionMetadata.get(view);
}

function loadPanelUrl(view, url) {
  const metadata = getSessionMetadata(view);
  view.webContents.loadURL(url, metadata ? { userAgent: metadata.userAgent } : undefined);
}

function wireViewEvents(id, view) {
  const sendStatus = (status) => {
    if (!mainWindow) return;
    mainWindow.webContents.send("panel:status", { id, ...status });
  };

  view.webContents.on("did-start-loading", () => sendStatus({ loading: true }));
  view.webContents.on("did-stop-loading", () => {
    sendStatus({
      loading: false,
      url: view.webContents.getURL(),
      title: view.webContents.getTitle()
    });
  });
  view.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
    sendStatus({ loading: false, error: `${errorCode}: ${errorDescription}`, url: validatedURL });
  });
  view.webContents.on("page-title-updated", (_event, title) => sendStatus({ title }));
  view.webContents.on("did-navigate", (_event, url) => sendStatus({ url }));
  view.webContents.on("did-navigate-in-page", (_event, url) => sendStatus({ url }));
}

function removeView(id) {
  const view = views.get(id);
  if (!view || !mainWindow) return;
  const metadata = getSessionMetadata(view) || sessionMetadata.get(id);
  mainWindow.removeBrowserView(view);
  if (!view.webContents.isDestroyed()) view.webContents.destroy();
  views.delete(id);
  if (metadata?.partition) userAgentManager.release(metadata.partition);
  sessionMetadata.delete(id);
  viewEmulationSize.delete(id);
  scrollBusy.delete(id);
}

function setHidden(id) {
  const view = views.get(id);
  if (view) view.setBounds({ x: -10000, y: -10000, width: 1, height: 1 });
}

/* ── Mobile Viewport Emulation ─────────────────────────────────────────────
 * Each BrowserView emulates a real mobile phone (390 × ~730 CSS viewport).
 * Chromium renders the page at 390 px wide and scales the output to fit
 * the physical panel.  Pages see a proper mobile viewport, so Instagram,
 * Threads, TikTok etc. render their full mobile layouts correctly.
 * ───────────────────────────────────────────────────────────────── */

const MOBILE_W   = 390; // virtual CSS viewport width (≈ iPhone 14 / Pixel 7)
const MOBILE_DPR = 2;   // devicePixelRatio reported to pages

/** Tracks the last emulation params applied per panel, so we skip no-op updates. */
const viewEmulationSize = new Map(); // panelId → { physW, physH, virtualH }

/**
 * Apply (or re-apply) mobile device emulation to a BrowserView.
 * The virtual viewport is always MOBILE_W px wide; height is derived so that
 * the aspect ratio of the physical panel is preserved in virtual space.
 */
function applyMobileEmulation(view, panelId, physW, physH) {
  const scale    = physW / MOBILE_W;                        // e.g. 280/390 ≈ 0.718
  const virtualH = Math.max(600, Math.round(physH / scale)); // e.g. 525/0.718 ≈ 731

  try {
    view.webContents.enableDeviceEmulation({
      screenPosition:    "mobile",
      screenSize:        { width: MOBILE_W, height: virtualH },
      viewSize:          { width: MOBILE_W, height: virtualH },
      viewPosition:      { x: 0, y: 0 },
      deviceScaleFactor: MOBILE_DPR,
      scale              // shrinks the 390 px rendered content to fit physW
    });
  } catch {
    // View may not be ready yet; next mount will retry.
  }

  viewEmulationSize.set(panelId, { physW, physH, virtualH });
}

function clearMobileEmulation(view, panelId) {
  if (!viewEmulationSize.has(panelId)) return;
  try {
    view.webContents.disableDeviceEmulation();
  } catch {
    // View may be navigating or already torn down; a later mount can retry.
  }
  viewEmulationSize.delete(panelId);
}

ipcMain.handle("workspace:mount-visible", (_event, panels) => {
  const visibleIds = new Set();

  for (const panel of panels) {
    if (!panel.bounds || panel.bounds.width < 80 || panel.bounds.height < 60) continue;
    visibleIds.add(panel.id);
    const view = ensureView(panel);

    const physW = Math.round(panel.bounds.width);
    const physH = Math.round(panel.bounds.height);

    view.setBounds({
      x: Math.round(panel.bounds.x),
      y: Math.round(panel.bounds.y),
      width: physW,
      height: physH
    });
    view.setAutoResize({ width: false, height: false });

    if (panel.mobileViewport) {
      const last = viewEmulationSize.get(panel.id);
      if (!last || last.physW !== physW || last.physH !== physH) {
        applyMobileEmulation(view, panel.id, physW, physH);
      }
    } else {
      clearMobileEmulation(view, panel.id);
    }
  }

  for (const id of views.keys()) {
    if (!visibleIds.has(id)) setHidden(id);
  }
});


ipcMain.handle("workspace:launch", (_event, panels) => {
  for (const panel of panels) {
    const view = ensureView(panel);
    const current = view.webContents.getURL();
    if (!current || current === "about:blank") loadPanelUrl(view, panel.currentUrl || panel.url);
  }
});

ipcMain.handle("workspace:close-all", () => {
  lastClosedSession = [...views.keys()];
  for (const id of [...views.keys()]) removeView(id);
  return lastClosedSession;
});

ipcMain.handle("workspace:reopen-last", (_event, panels) => {
  const ids = new Set(lastClosedSession);
  for (const panel of panels) {
    if (ids.has(panel.id)) ensureView(panel);
  }
});

/* ── GC Scroll Engine ─────────────────────────────────────────────────────
 *
 * Human-like scroll: instead of one giant mouseWheel event, we dispatch a
 * series of smaller wheel events over real time that form a velocity curve
 * (ramp-up → sustain → ramp-down), matching how a real finger swipe feels.
 *
 * Per-panel lock (scrollBusy) prevents overlapping gestures.
 * All panels are launched concurrently so they stay in sync.
 * ───────────────────────────────────────────────────────────────────────── */

const scrollBusy = new Set(); // panel IDs currently mid-scroll
const automationActions = new Map();

/**
 * Dispatch a realistic swipe-scroll gesture on a single webview.
 * @param {BrowserView} view
 * @param {string}      panelId
 * @param {number}      x          click-point x in view coords
 * @param {number}      y          click-point y in view coords
 * @param {number}      direction  +1 = scroll down (next reel), -1 = scroll up
 * @param {number}      viewHeight  view pixel height — used to size the scroll
 * @returns {Promise<void>}
 */
function humanScroll(view, panelId, x, y, direction, physHeight) {
  if (scrollBusy.has(panelId)) return Promise.resolve();
  scrollBusy.add(panelId);

  return new Promise((resolve) => {
    // Use the virtual (CSS) viewport height for accurate one-reel scroll distance.
    // With device emulation active, deltaY is in virtual CSS pixels, not physical.
    const emu          = viewEmulationSize.get(panelId);
    const scrollHeight = emu ? emu.virtualH : physHeight;

    const jitter = 1 + (Math.random() * 0.16 - 0.08);
    const targetDistance = Math.round(scrollHeight * 0.92 * jitter);

    // Build a velocity curve: we split the total distance into N steps
    // shaped as a sine-based ease-in-out (fast in the middle, slow at edges).
    const STEPS = 14;           // number of wheel events in the gesture
    const STEP_MS = 22;         // interval between steps (≈ 60 fps)
    const PRE_DELAY_MS = Math.round(60 + Math.random() * 80);  // 60–140 ms pre-pause
    const POST_DELAY_MS = Math.round(80 + Math.random() * 120); // 80–200 ms post-pause

    // Sine-based weight distribution — gives a smooth velocity ramp
    const weights = Array.from({ length: STEPS }, (_, i) => {
      const t = (i + 0.5) / STEPS; // 0..1, center of each step
      return Math.sin(t * Math.PI); // 0 → 1 → 0 bell curve
    });
    const weightSum = weights.reduce((a, b) => a + b, 0);
    const deltas = weights.map(w => Math.round((w / weightSum) * targetDistance));

    // Correct rounding drift so total always equals targetDistance
    const actual = deltas.reduce((a, b) => a + b, 0);
    deltas[Math.floor(STEPS / 2)] += targetDistance - actual;

    let step = 0;

    const fire = () => {
      if (view.webContents.isDestroyed() || !scrollBusy.has(panelId)) {
        scrollBusy.delete(panelId);
        resolve();
        return;
      }
      const delta = deltas[step] * direction; // negative = scroll down on screen
      view.webContents.sendInputEvent({
        type: "mouseWheel",
        x,
        y,
        deltaX: 0,
        deltaY: -delta,   // negative deltaY → page scrolls down (next reel)
        canScroll: true,
        hasPreciseScrollingDeltas: true,
        wheelTicksX: 0,
        wheelTicksY: 0
      });
      step++;
      if (step < STEPS) {
        setTimeout(fire, STEP_MS);
      } else {
        // Post-gesture settle pause
        setTimeout(() => {
          scrollBusy.delete(panelId);
          resolve();
        }, POST_DELAY_MS);
      }
    };

    // Pre-gesture pause before the first event
    setTimeout(fire, PRE_DELAY_MS);
  });
}

function pointerFromPoint(view, point) {
  const bounds = view.getBounds();
  const hasRatioPoint = Number.isFinite(Number(point?.xRatio)) && Number.isFinite(Number(point?.yRatio));
  const hasPixelPoint = Number.isFinite(Number(point?.x)) && Number.isFinite(Number(point?.y));
  const xRatio = clamp(Number(point?.xRatio) || 0.5, 0, 1);
  const yRatio = clamp(Number(point?.yRatio) || 0.5, 0, 1);
  return {
    bounds,
    x: Math.max(1, Math.min(bounds.width - 1, Math.round(hasRatioPoint ? bounds.width * xRatio : hasPixelPoint ? Number(point.x) : bounds.width * 0.5))),
    y: Math.max(1, Math.min(bounds.height - 1, Math.round(hasRatioPoint ? bounds.height * yRatio : hasPixelPoint ? Number(point.y) : bounds.height * 0.5)))
  };
}

function sendMouseClick(view, x, y, clickCount = 1) {
  view.webContents.sendInputEvent({ type: "mouseDown", x, y, button: "left", clickCount });
  view.webContents.sendInputEvent({ type: "mouseUp", x, y, button: "left", clickCount });
}

automationActions.set("stop", ({ view, panel }) => {
  scrollBusy.delete(panel.id);
  view.webContents.stop();
  return Promise.resolve();
});

automationActions.set("scroll-down", ({ view, panel, point }) => {
  const target = pointerFromPoint(view, point);
  return humanScroll(view, panel.id, target.x, target.y, 1, target.bounds.height);
});

automationActions.set("scroll", automationActions.get("scroll-down"));

automationActions.set("scroll-up", ({ view, panel, point }) => {
  const target = pointerFromPoint(view, point);
  return humanScroll(view, panel.id, target.x, target.y, -1, target.bounds.height);
});

automationActions.set("click", ({ view, point }) => {
  const target = pointerFromPoint(view, point);
  sendMouseClick(view, target.x, target.y, 1);
  return Promise.resolve();
});

automationActions.set("double-click", ({ view, point }) => {
  const target = pointerFromPoint(view, point);
  sendMouseClick(view, target.x, target.y, 1);
  sendMouseClick(view, target.x, target.y, 2);
  return Promise.resolve();
});

function resolveAutomationPanels(panels) {
  return (Array.isArray(panels) ? panels : []).map((panel) => {
    const view = views.get(panel.id);
    if (!view || view.webContents.isDestroyed()) {
      return { panel, skipped: true, reason: "Panel is not open" };
    }
    return { panel, view };
  });
}

const elementDetectionScript = `
(() => {
  const selectors = [
    "button",
    "a[href]",
    "input",
    "select",
    "textarea",
    "summary",
    "[role='button']",
    "[role='link']",
    "[role='checkbox']",
    "[role='switch']",
    "[role='menuitem']",
    "[role='tab']",
    "[contenteditable='true']",
    "[tabindex]:not([tabindex='-1'])",
    "[onclick]"
  ].join(",");

  function visible(el, rect) {
    const style = window.getComputedStyle(el);
    return rect.width >= 4 && rect.height >= 4 &&
      style.visibility !== "hidden" &&
      style.display !== "none" &&
      Number(style.opacity || 1) > 0.05 &&
      rect.bottom >= 0 &&
      rect.right >= 0 &&
      rect.top <= window.innerHeight &&
      rect.left <= window.innerWidth;
  }

  function labelFor(el) {
    const aria = el.getAttribute("aria-label") || el.getAttribute("title") || el.getAttribute("alt");
    const labelled = el.getAttribute("aria-labelledby");
    const labelledText = labelled ? labelled.split(/\\s+/).map((id) => document.getElementById(id)?.innerText || "").join(" ") : "";
    const formLabel = el.id ? document.querySelector("label[for='" + CSS.escape(el.id) + "']")?.innerText : "";
    const text = aria || labelledText || formLabel || el.innerText || el.value || el.placeholder || el.name || "";
    return String(text).replace(/\\s+/g, " ").trim().slice(0, 80);
  }

  function pathFor(el) {
    const parts = [];
    let node = el;
    while (node && node.nodeType === Node.ELEMENT_NODE && parts.length < 5) {
      const tag = node.tagName.toLowerCase();
      if (node.id) {
        parts.unshift(tag + "#" + CSS.escape(node.id));
        break;
      }
      const stable = ["data-testid", "data-test", "data-qa", "name", "aria-label"].find((attr) => node.getAttribute(attr));
      if (stable) {
        parts.unshift(tag + "[" + stable + "='" + CSS.escape(node.getAttribute(stable)) + "']");
        break;
      }
      const index = Array.from(node.parentElement?.children || []).filter((child) => child.tagName === node.tagName).indexOf(node) + 1;
      parts.unshift(tag + ":nth-of-type(" + Math.max(1, index) + ")");
      node = node.parentElement;
    }
    return parts.join(" > ");
  }

  const width = Math.max(1, window.innerWidth || document.documentElement.clientWidth || 1);
  const height = Math.max(1, window.innerHeight || document.documentElement.clientHeight || 1);
  return Array.from(document.querySelectorAll(selectors))
    .map((el, index) => {
      const rect = el.getBoundingClientRect();
      if (!visible(el, rect)) return null;
      const tag = el.tagName.toLowerCase();
      const role = el.getAttribute("role") || (tag === "a" ? "link" : tag);
      const label = labelFor(el);
      const isNative = /^(button|a|input|select|textarea|summary)$/.test(tag);
      const hasExplicitRole = Boolean(el.getAttribute("role"));
      const hasLabel = label.length > 0;
      const confidence = Math.min(0.98, 0.48 + (isNative ? 0.22 : 0) + (hasExplicitRole ? 0.16 : 0) + (hasLabel ? 0.12 : 0));
      return {
        id: "el-" + index,
        selector: pathFor(el),
        label,
        tag,
        role,
        inputType: el.getAttribute("type") || "",
        xRatio: Math.min(1, Math.max(0, (rect.left + rect.width / 2) / width)),
        yRatio: Math.min(1, Math.max(0, (rect.top + rect.height / 2) / height)),
        widthRatio: Math.min(1, Math.max(0, rect.width / width)),
        heightRatio: Math.min(1, Math.max(0, rect.height / height)),
        confidence
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 80);
})()
`;

function elementLocatorScript(target) {
  return `
(() => {
  const target = ${JSON.stringify(target || {})};
  const width = Math.max(1, window.innerWidth || document.documentElement.clientWidth || 1);
  const height = Math.max(1, window.innerHeight || document.documentElement.clientHeight || 1);
  function visible(el, rect) {
    const style = window.getComputedStyle(el);
    return rect.width >= 4 && rect.height >= 4 && style.visibility !== "hidden" && style.display !== "none" && Number(style.opacity || 1) > 0.05;
  }
  function labelFor(el) {
    const text = el.getAttribute("aria-label") || el.getAttribute("title") || el.innerText || el.value || el.placeholder || el.name || "";
    return String(text).replace(/\\s+/g, " ").trim().slice(0, 80).toLowerCase();
  }
  function hit(el, score) {
    const rect = el.getBoundingClientRect();
    if (!visible(el, rect)) return null;
    return {
      xRatio: Math.min(1, Math.max(0, (rect.left + rect.width / 2) / width)),
      yRatio: Math.min(1, Math.max(0, (rect.top + rect.height / 2) / height)),
      widthRatio: Math.min(1, Math.max(0, rect.width / width)),
      heightRatio: Math.min(1, Math.max(0, rect.height / height)),
      confidence: Math.min(0.99, score)
    };
  }
  if (target.selector) {
    try {
      const exact = document.querySelector(target.selector);
      const found = exact ? hit(exact, 0.94) : null;
      if (found) return found;
    } catch {}
  }
  const selectors = ["button", "a[href]", "input", "select", "textarea", "summary", "[role]", "[tabindex]:not([tabindex='-1'])", "[onclick]"].join(",");
  const wantedLabel = String(target.label || "").trim().toLowerCase();
  const wantedRole = String(target.role || "").trim().toLowerCase();
  const wantedTag = String(target.tag || "").trim().toLowerCase();
  const candidates = Array.from(document.querySelectorAll(selectors));
  let best = null;
  for (const el of candidates) {
    const tag = el.tagName.toLowerCase();
    const role = (el.getAttribute("role") || (tag === "a" ? "link" : tag)).toLowerCase();
    const label = labelFor(el);
    let score = 0.2;
    if (wantedTag && tag === wantedTag) score += 0.18;
    if (wantedRole && role === wantedRole) score += 0.22;
    if (wantedLabel && label === wantedLabel) score += 0.32;
    else if (wantedLabel && label.includes(wantedLabel)) score += 0.18;
    const pointDelta = Math.abs((target.xRatio ?? 0.5) - ((el.getBoundingClientRect().left + el.getBoundingClientRect().width / 2) / width)) +
      Math.abs((target.yRatio ?? 0.5) - ((el.getBoundingClientRect().top + el.getBoundingClientRect().height / 2) / height));
    score += Math.max(0, 0.18 - pointDelta * 0.12);
    const result = hit(el, score);
    if (result && (!best || result.confidence > best.confidence)) best = result;
  }
  return best && best.confidence >= 0.48 ? best : null;
})()
`;
}

async function detectElementsForPanels(panels) {
  const results = [];
  for (const item of resolveAutomationPanels(panels)) {
    if (item.skipped) {
      results.push({ panelId: item.panel.id, status: "skipped", reason: item.reason, elements: [] });
      continue;
    }
    try {
      const elements = await item.view.webContents.executeJavaScript(elementDetectionScript, true);
      results.push({ panelId: item.panel.id, status: "success", elements: Array.isArray(elements) ? elements : [] });
    } catch (error) {
      results.push({ panelId: item.panel.id, status: "failed", reason: error.message, elements: [] });
    }
  }
  return results;
}

ipcMain.handle("workspace:global-control", (_event, { action, point, panels }) => {
  const executor = automationActions.get(action);
  if (!executor) return;

  // Launch all panels concurrently — they start at the same moment.
  const tasks = resolveAutomationPanels(panels)
    .filter((item) => !item.skipped)
    .map(({ panel, view }) => executor({ panel, view, point }));

  // Return after all gestures are scheduled (they run async in the background).
  // We do NOT await humanScroll here so the IPC call returns immediately and
  // the renderer stays unblocked while the gesture plays out.
  void Promise.all(tasks);
});

ipcMain.handle("workspace:cancel-automation", (_event, { panels } = {}) => {
  const panelIds = Array.isArray(panels) ? panels.map((panel) => panel.id).filter(Boolean) : [];
  if (panelIds.length) {
    panelIds.forEach((panelId) => scrollBusy.delete(panelId));
  } else {
    scrollBusy.clear();
  }
});

ipcMain.handle("workspace:detect-elements", async (_event, { panels }) => {
  return detectElementsForPanels(panels);
});

ipcMain.handle("workspace:automation-action", async (_event, { action, target, point, panels }) => {
  const executor = automationActions.get(action);
  const results = [];
  if (!executor) {
    return { status: "failed", results: [], summary: { success: 0, failed: 1, skipped: 0 }, error: `Unsupported action: ${action}` };
  }

  for (const item of resolveAutomationPanels(panels)) {
    if (item.skipped) {
      results.push({ panelId: item.panel.id, status: "skipped", reason: item.reason });
      continue;
    }

    try {
      let targetPoint = point;
      let confidence = typeof target?.confidence === "number" ? target.confidence : 0.72;
      if (target?.mode === "element" || target?.selector || target?.label) {
        const located = await item.view.webContents.executeJavaScript(elementLocatorScript(target), true);
        if (!located) {
          results.push({ panelId: item.panel.id, status: "skipped", reason: "Target element was not found" });
          continue;
        }
        targetPoint = { xRatio: located.xRatio, yRatio: located.yRatio };
        confidence = located.confidence;
      }
      await executor({ panel: item.panel, view: item.view, point: targetPoint });
      results.push({ panelId: item.panel.id, status: "success", confidence });
    } catch (error) {
      results.push({ panelId: item.panel.id, status: "failed", reason: error.message });
    }
  }

  const summary = results.reduce((memo, result) => {
    memo[result.status] = (memo[result.status] || 0) + 1;
    return memo;
  }, { success: 0, failed: 0, skipped: 0 });
  return { status: summary.failed ? "failed" : "completed", results, summary };
});


ipcMain.handle("panel:command", async (_event, { id, command, value, panel }) => {
  const view = command === "open" ? ensureView(panel) : views.get(id);
  if (!view) return null;
  const wc = view.webContents;

  switch (command) {
    case "back":
      if (wc.canGoBack()) wc.goBack();
      break;
    case "forward":
      if (wc.canGoForward()) wc.goForward();
      break;
    case "home":
      loadPanelUrl(view, panel.url);
      break;
    case "reload":
    case "refresh":
      wc.reload();
      break;
    case "navigate":
      loadPanelUrl(view, value);
      break;
    case "mute":
      wc.setAudioMuted(!wc.isAudioMuted());
      return wc.isAudioMuted();
    case "stop":
    case "pause":
      wc.stop();
      break;
    case "close":
      removeView(id);
      break;
    case "screenshot": {
      const image = await wc.capturePage();
      const file = path.join(app.getPath("pictures"), `panel-${id}-${Date.now()}.png`);
      require("fs").writeFileSync(file, image.toPNG());
      return file;
    }
    case "inspect":
      wc.openDevTools({ mode: "right", activate: true });
      break;
    case "status":
      return {
        title: wc.getTitle(),
        url: wc.getURL(),
        loading: wc.isLoading(),
        muted: wc.isAudioMuted()
      };
    default:
      break;
  }

  return null;
});

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

ipcMain.handle("panel:capture-thumbnail", async (_event, id) => {
  const view = views.get(id);
  if (!view) return null;
  const image = await view.webContents.capturePage();
  const thumb = nativeImage.createFromBuffer(image.resize({ width: 480 }).toPNG());
  return thumb.toDataURL();
});

ipcMain.handle("window:maximize-toggle", () => {
  if (!mainWindow) return false;
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow.maximize();
  }
  return mainWindow.isMaximized();
});

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
