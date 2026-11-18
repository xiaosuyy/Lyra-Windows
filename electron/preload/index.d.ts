import { ElectronAPI } from "@electron-toolkit/preload";
import type { StoreType } from "../main/store";

declare global {
  interface Window {
    electron: ElectronAPI;
    api: {
      store: {
        get<K extends keyof StoreType>(key: K): Promise<StoreType[K]>;
        set<K extends keyof StoreType>(key: K, value: StoreType[K]): Promise<boolean>;
        has(key: keyof StoreType): Promise<boolean>;
        delete(key: keyof StoreType): Promise<boolean>;
        reset(keys?: (keyof StoreType)[]): Promise<boolean>;
        export(data: any): Promise<{ success: boolean; path?: string; error?: string }>;
        import(): Promise<{ success: boolean; data?: any; error?: string }>;
      };
      webdav: {
        getConfig(): Promise<{
          configured: boolean;
          serverUrl: string;
          username: string;
          basePath: string;
        }>;
        login(payload: {
          serverUrl: string;
          username: string;
          password: string;
          basePath: string;
        }): Promise<{
          success: boolean;
          error?: string;
          config?: { configured: boolean; serverUrl: string; username: string; basePath: string };
        }>;
        logout(): Promise<boolean>;
        syncUpload(content: string): Promise<{ success: boolean; error?: string }>;
        syncDownload(): Promise<{
          success: boolean;
          data?: string;
          notFound?: boolean;
          error?: string;
        }>;
      };
      qqmusic: {
        login(): Promise<{ success: boolean; error?: string }>;
        getSession(): Promise<{
          loggedIn: boolean;
          uin: string;
          nickname: string;
          avatarUrl: string;
        }>;
        logout(): Promise<boolean>;
      };
    };
    // logs
    logger: {
      info: (message: string, ...args: unknown[]) => void;
      warn: (message: string, ...args: unknown[]) => void;
      error: (message: string, ...args: unknown[]) => void;
      debug: (message: string, ...args: unknown[]) => void;
    };
  }
}
