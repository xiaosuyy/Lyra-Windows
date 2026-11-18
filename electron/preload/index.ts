import { contextBridge, ipcRenderer } from "electron";
import { electronAPI } from "@electron-toolkit/preload";

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld("electron", electronAPI);
    // Expose store API via preload
    contextBridge.exposeInMainWorld("api", {
      store: {
        get: (key: string) => ipcRenderer.invoke("store-get", key),
        set: (key: string, value: unknown) => ipcRenderer.invoke("store-set", key, value),
        has: (key: string) => ipcRenderer.invoke("store-has", key),
        delete: (key: string) => ipcRenderer.invoke("store-delete", key),
        reset: (keys?: string[]) => ipcRenderer.invoke("store-reset", keys),
        export: (data: any) => ipcRenderer.invoke("store-export", data),
        import: () => ipcRenderer.invoke("store-import"),
      },
      webdav: {
        getConfig: () => ipcRenderer.invoke("webdav-get-config"),
        login: (payload: {
          serverUrl: string;
          username: string;
          password: string;
          basePath: string;
        }) => ipcRenderer.invoke("webdav-login", payload),
        logout: () => ipcRenderer.invoke("webdav-logout"),
        syncUpload: (content: string) => ipcRenderer.invoke("webdav-sync-upload", content),
        syncDownload: (forceFull?: boolean) =>
          ipcRenderer.invoke("webdav-sync-download", Boolean(forceFull)),
      },
      qqmusic: {
        login: () => ipcRenderer.invoke("qqmusic-login"),
        getSession: () => ipcRenderer.invoke("qqmusic-get-session"),
        logout: () => ipcRenderer.invoke("qqmusic-logout"),
      },
    });
    // Expose logger API via preload
    contextBridge.exposeInMainWorld("logger", {
      info: (message: string, ...args: unknown[]) =>
        ipcRenderer.send("renderer-log", "info", message, args),
      warn: (message: string, ...args: unknown[]) =>
        ipcRenderer.send("renderer-log", "warn", message, args),
      error: (message: string, ...args: unknown[]) =>
        ipcRenderer.send("renderer-log", "error", message, args),
      debug: (message: string, ...args: unknown[]) =>
        ipcRenderer.send("renderer-log", "debug", message, args),
    });
  } catch (error) {
    console.error(error);
  }
}
