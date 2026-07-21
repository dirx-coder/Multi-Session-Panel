const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("panelApi", {
  mountVisible: (panels) => ipcRenderer.invoke("workspace:mount-visible", panels),
  launchWorkspace: (panels) => ipcRenderer.invoke("workspace:launch", panels),
  closeAll: () => ipcRenderer.invoke("workspace:close-all"),
  reopenLast: (panels) => ipcRenderer.invoke("workspace:reopen-last", panels),
  panelCommand: (payload) => ipcRenderer.invoke("panel:command", payload),
  globalControl: (payload) => ipcRenderer.invoke("workspace:global-control", payload),
  cancelAutomation: (payload) => ipcRenderer.invoke("workspace:cancel-automation", payload),
  detectElements: (payload) => ipcRenderer.invoke("workspace:detect-elements", payload),
  automationAction: (payload) => ipcRenderer.invoke("workspace:automation-action", payload),
  captureThumbnail: (id) => ipcRenderer.invoke("panel:capture-thumbnail", id),
  maximizeToggle: () => ipcRenderer.invoke("window:maximize-toggle"),
  onPanelStatus: (callback) => {
    ipcRenderer.on("panel:status", (_event, payload) => callback(payload));
  },
  onLayoutInvalidated: (callback) => {
    ipcRenderer.on("window:layout-invalidated", callback);
  }
});
