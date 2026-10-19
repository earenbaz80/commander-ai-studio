export interface ElectronAPI {
  isElectron: boolean;
  minimize: () => Promise<void>;
  maximize: () => Promise<void>;
  close: () => Promise<void>;
  isMaximized: () => Promise<boolean>;
  getAppInfo: () => Promise<{
    name: string;
    version: string;
    electronVersion: string;
    nodeVersion: string;
    platform: string;
    arch: string;
  }>;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
    __TAURI__?: any;
  }
}
