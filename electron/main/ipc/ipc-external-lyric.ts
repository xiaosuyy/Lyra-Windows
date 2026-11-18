import { ipcMain } from "electron";
import {
  fetchAmllTtml,
  fetchKugouLyric,
  searchAmllLyrics,
  searchKugouSongs,
  searchLrcLibLyrics,
  type KugouSongSearchResult,
} from "../services/ExternalLyricService";
import { windowsLog } from "../logger";

/**
 * 第三方在线歌词源 IPC
 */
const initExternalLyricIpc = (): void => {
  ipcMain.handle(
    "external-lyric:lrclib-search",
    async (_event, trackName: string, artistName: string) => {
      try {
        return await searchLrcLibLyrics(String(trackName ?? ""), String(artistName ?? ""));
      } catch (error) {
        windowsLog.error("LRCLIB 歌词搜索失败", error);
        return [];
      }
    },
  );

  ipcMain.handle(
    "external-lyric:kugou-search",
    async (_event, trackName: string, artistName: string) => {
      try {
        return await searchKugouSongs(String(trackName ?? ""), String(artistName ?? ""));
      } catch (error) {
        windowsLog.error("酷狗歌词搜索失败", error);
        return [];
      }
    },
  );

  ipcMain.handle("external-lyric:kugou-fetch", async (_event, song: KugouSongSearchResult) => {
    try {
      return await fetchKugouLyric(song);
    } catch (error) {
      windowsLog.error("酷狗歌词获取失败", error);
      return {};
    }
  });

  ipcMain.handle("external-lyric:amll-search", async (_event, trackName: string) => {
    try {
      return await searchAmllLyrics(String(trackName ?? ""));
    } catch (error) {
      windowsLog.error("AMLL 歌词搜索失败", error);
      return [];
    }
  });

  ipcMain.handle("external-lyric:amll-raw", async (_event, file: string) => {
    try {
      return await fetchAmllTtml(String(file ?? ""));
    } catch (error) {
      windowsLog.error("AMLL 歌词获取失败", error);
      return null;
    }
  });
};

export default initExternalLyricIpc;
