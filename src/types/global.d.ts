import { DialogApi, LoadingBarApi, MessageApi, ModalApi, NotificationApi } from "naive-ui";

declare global {
  interface Window {
    // naiveui
    $message: MessageApi;
    $dialog: DialogApi;
    $notification: NotificationApi;
    $loadingBar: LoadingBarApi;
    $modal: ModalApi;
    // electron
    api: {
      store: {
        get: (key: string) => Promise<any>;
        set: (key: string, value: unknown) => Promise<boolean>;
        has: (key: string) => Promise<boolean>;
        delete: (key: string) => Promise<boolean>;
        reset: (keys?: string[]) => Promise<boolean>;
        export: (data: any) => Promise<{ success: boolean; path?: string; error?: string }>;
        import: () => Promise<{ success: boolean; data?: any; error?: string }>;
      };
      webdav: {
        getConfig: () => Promise<{
          configured: boolean;
          serverUrl: string;
          username: string;
          basePath: string;
        }>;
        login: (payload: {
          serverUrl: string;
          username: string;
          password: string;
          basePath: string;
        }) => Promise<{
          success: boolean;
          error?: string;
          config?: { configured: boolean; serverUrl: string; username: string; basePath: string };
        }>;
        logout: () => Promise<boolean>;
        syncUpload: (content: string) => Promise<{ success: boolean; error?: string }>;
        syncDownload: () => Promise<{
          success: boolean;
          data?: string;
          notFound?: boolean;
          error?: string;
        }>;
      };
      qqmusic: {
        login: () => Promise<{ success: boolean; error?: string }>;
        getSession: () => Promise<{
          loggedIn: boolean;
          uin: string;
          nickname: string;
          avatarUrl: string;
        }>;
        logout: () => Promise<boolean>;
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
