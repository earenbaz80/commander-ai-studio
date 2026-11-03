/* eslint-disable react-refresh/only-export-components */
import { useEffect, useState, useCallback } from 'react';

interface ElectronAPI {
  update?: {
    check: () => Promise<{ success: boolean; updateInfo?: { version: string; releaseNotes?: string } }>;
    download: () => Promise<{ success: boolean }>;
    install: () => Promise<{ success: boolean }>;
    getStatus: () => Promise<{ status: string }>;
    onUpdateAvailable?: (callback: (info: { version: string; releaseNotes?: string }) => void) => void;
    onDownloadProgress?: (callback: (progress: { percent: number }) => void) => void;
    onUpdateDownloaded?: (callback: (info: { version: string; releaseNotes?: string }) => void) => void;
  };
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

interface AutoUpdaterReturn {
  updateInfo: { version: string; releaseNotes?: string } | null;
  downloaded: boolean;
  downloading: boolean;
  progress: number;
  checking: boolean;
  checkForUpdates: () => Promise<void>;
  downloadUpdate: () => Promise<boolean>;
  installUpdate: () => Promise<boolean>;
  dismiss: () => void;
}

export function useAutoUpdater(): AutoUpdaterReturn | null {
  const [updateInfo, setUpdateInfo] = useState<{ version: string; releaseNotes?: string } | null>(null);
  const [downloaded, setDownloaded] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [checking, setChecking] = useState(false);

  const isElectron = typeof window !== 'undefined' && window.electronAPI?.update;

  const downloadUpdateFn = useCallback(async () => {
    if (!window.electronAPI?.update?.download) return false;
    setDownloading(true);
    setProgress(0);
    try {
      const result = await window.electronAPI.update.download();
      return result.success;
    } catch (err) {
      console.error('Download failed:', err);
      return false;
    } finally {
      setDownloading(false);
    }
  }, []);

  const installUpdateFn = useCallback(async () => {
    if (!window.electronAPI?.update?.install) return false;
    try {
      await window.electronAPI.update.install();
      return true;
    } catch (err) {
      console.error('Install failed:', err);
      return false;
    }
  }, []);

  const checkAndNotify = useCallback(async () => {
    const _isElectron = typeof window !== 'undefined' && window.electronAPI?.update;
    if (!_isElectron) return;
    const api = window.electronAPI;
    if (!api) return;
    setChecking(true);
    try {
      const result = await api.update?.check();
      if (result?.success && result.updateInfo) {
        setUpdateInfo({
          version: result.updateInfo.version,
          releaseNotes: result.updateInfo.releaseNotes,
        });
      }
    } catch (err) {
      console.error('Update check failed:', err);
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    if (!window.electronAPI?.update) return;

    if (window.electronAPI.update.onUpdateAvailable) {
      window.electronAPI.update.onUpdateAvailable((info: { version: string; releaseNotes?: string }) => {
        setUpdateInfo({
          version: info.version,
          releaseNotes: info.releaseNotes,
        });
      });
    }
    if (window.electronAPI.update.onDownloadProgress) {
      window.electronAPI.update.onDownloadProgress((progress: { percent: number }) => {
        setProgress(progress.percent);
      });
    }
    if (window.electronAPI.update.onUpdateDownloaded) {
      window.electronAPI.update.onUpdateDownloaded((info: { version: string; releaseNotes?: string }) => {
        setDownloaded(true);
        setDownloading(false);
        setProgress(100);
        setUpdateInfo({
          version: info.version,
          releaseNotes: info.releaseNotes,
        });
      });
    }

    return () => {};
  }, []);

  if (!isElectron) return null;

  return {
    updateInfo,
    downloaded,
    downloading,
    progress,
    checking,
    checkForUpdates: checkAndNotify,
    downloadUpdate: downloadUpdateFn,
    installUpdate: installUpdateFn,
    dismiss: () => setUpdateInfo(null),
  };
}

export function UpdateNotification() {
  const autoUpdater = useAutoUpdater();
  const checkForUpdates = autoUpdater?.checkForUpdates;

  // Los hooks deben ir antes de cualquier `return` temprano (rules-of-hooks).
  useEffect(() => {
    if (typeof window === 'undefined' || !window.electronAPI?.update) return;
    checkForUpdates?.();
  }, [checkForUpdates]);

  if (!autoUpdater) return null;

  const { updateInfo, downloaded, downloading, progress } = autoUpdater;

  if (typeof window === 'undefined' || !window.electronAPI?.update) return null;

  if (downloaded) {
    return (
      <div className="fixed bottom-4 right-4 z-50 animate-slide-in">
        <div className="bg-[var(--nc-bg-panel)] border-2 border-[var(--nc-text-accent)] rounded-lg p-4 max-w-md shadow-[0_0_30px_rgba(255,255,85,0.3)]">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1">
              <div className="flex items-center gap-2 text-[var(--nc-text-accent)] font-bold text-sm mb-2">
                <span className="flex items-center gap-1">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1M4 16H3a2 2 0 01-2-2V6a2 2 0 012-2h16a2 2 0 012 2v9a2 2 0 01-2 2h-1" stroke="currentColor" /></svg>
                  <span className="font-bold text-[12px]">Actualización disponible</span>
                </span>
                <span className="bg-[var(--nc-active-bg)] text-black text-[10px] px-1.5 py-0.5 rounded font-bold">Lista para instalar</span>
              </div>
              <p className="text-[var(--nc-text)] text-[11px] mb-3 line-clamp-2">
                Update ready to install.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    if (window.electronAPI?.update?.install) {
                      window.electronAPI.update.install();
                    }
                  }}
                  className="flex-1 bg-[var(--nc-active-bg)] text-black font-bold py-1.5 px-3 rounded text-[11px] hover:bg-[#ffff00] transition-colors"
                >
                  Instalar y reiniciar
                </button>
                <button className="px-3 py-1.5 bg-[var(--nc-bg-main)] border border-[var(--nc-border-light)] text-[var(--nc-text)] hover:bg-[var(--nc-bg-hover)] rounded text-[11px]">
                  Luego
                </button>
              </div>
            </div>
            <button className="absolute top-1 right-1 text-[var(--nc-text)]/50 hover:text-white text-[12px] w-6 h-6 flex items-center justify-center">×</button>
          </div>
        </div>
      </div>
    );
  }

  if (updateInfo && !downloading && !downloaded) {
    return (
      <div className="fixed bottom-4 right-4 z-50 animate-slide-in">
        <div className="bg-[var(--nc-bg-panel)] border-2 border-[var(--nc-border-light)] rounded-lg p-4 max-w-md shadow-[0_0_30px_rgba(0,255,255,0.3)]">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1">
              <div className="flex items-center gap-2 text-[var(--nc-text)] font-bold text-sm mb-2">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1M4 16H3a2 2 0 01-2-2V6a2 2 0 012-2h16a2 2 0 012 2v9a2 2 0 01-2 2h-1" stroke="currentColor" /></svg>
                <span className="font-bold">Actualización disponible</span>
                <span className="bg-[var(--nc-highlight-bg)] text-black text-[10px] px-1.5 py-0.5 rounded font-bold">v{updateInfo.version}</span>
              </div>
              <p className="text-[var(--nc-text)] text-[11px] mb-3 line-clamp-2">
                {updateInfo.releaseNotes || 'Una nueva versión está disponible con mejoras y correcciones.'}
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    if (window.electronAPI?.update?.download) {
                      window.electronAPI.update.download();
                    }
                  }}
                  className="flex-1 bg-[var(--nc-highlight-bg)] text-black font-bold py-1.5 px-3 rounded text-[11px] hover:bg-[#00dddd] transition-colors"
                >
                  Descargar actualización
                </button>
                <button className="px-3 py-1.5 bg-[var(--nc-bg-main)] border border-[var(--nc-border-light)] text-[var(--nc-text)] hover:bg-[var(--nc-bg-hover)] rounded text-[11px]">
                  Luego
                </button>
              </div>
            </div>
            <button className="absolute top-1 right-1 text-[var(--nc-text)]/50 hover:text-white text-[12px] w-6 h-6 flex items-center justify-center">×</button>
          </div>
        </div>
      </div>
    );
  }

  if (downloading) {
    return (
      <div className="fixed bottom-4 right-4 z-50 animate-slide-in">
        <div className="bg-[var(--nc-bg-panel)] border-2 border-[var(--nc-text-accent)] rounded-lg p-4 max-w-md shadow-[0_0_30px_rgba(255,255,85,0.4)]">
          <div className="flex items-center gap-2 text-[var(--nc-text-accent)] font-bold text-sm mb-2">
            <svg className="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1M4 16H3a2 2 0 01-2-2V6a2 2 0 012-2h16a2 2 0 012 2v9a2 2 0 01-2 2h-1" stroke="currentColor" /></svg>
            <span>Descargando actualización...</span>
          </div>
          <div className="w-full bg-[var(--nc-bg-panel)] border border-[var(--nc-text-accent)] rounded h-2 overflow-hidden">
            <div
              className="bg-[var(--nc-active-bg)] h-full transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="text-[var(--nc-text-accent)] text-[11px] text-right mt-1">{Math.round(progress)}%</p>
        </div>
      </div>
    );
  }

  return null;
}