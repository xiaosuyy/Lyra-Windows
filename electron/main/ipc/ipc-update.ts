import { ipcMain } from "electron";
import { checkUpdate, installUpdate, startDownloadUpdate, type UpdateSource } from "../update";
import mainWindow from "../windows/main-window";

const normalizeSource = (value: unknown): UpdateSource =>
  value === "ghproxy" ? "ghproxy" : "github";

const initUpdateIpc = () => {
  // 检查更新
  ipcMain.on("check-update", (_event, showTip, source) => {
    const mainWin = mainWindow.getWin();
    if (!mainWin) return;
    void checkUpdate(mainWin, Boolean(showTip), normalizeSource(source));
  });

  // 开始下载更新
  ipcMain.on("start-download-update", (_event, source) => {
    const mainWin = mainWindow.getWin();
    if (!mainWin) return;
    void startDownloadUpdate(mainWin, normalizeSource(source));
  });

  // 安装已下载的更新
  ipcMain.on("install-update", () => installUpdate());
};

export default initUpdateIpc;
