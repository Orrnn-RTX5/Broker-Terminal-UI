const { contextBridge, ipcRenderer } = require('electron');

const isAllowedExternalUrl = (value) => {
    if (typeof value !== 'string') return false;
    try {
        const parsed = new URL(value);
        return parsed.protocol === 'https:' || parsed.protocol === 'http:';
    } catch {
        return false;
    }
};

const runtimeInfo = ipcRenderer.sendSync('get-app-runtime-info');
const isPackaged = Boolean(runtimeInfo?.isPackaged);

contextBridge.exposeInMainWorld('electron', {
    // App version from package.json
    appVersion: ipcRenderer.sendSync('get-app-version'),
    isPackaged,

    // The renderer has painted login, the terminal, or a recovery surface.
    startupReady: () => ipcRenderer.send('desktop-startup-ready'),

    // Shell utilities
    shell: {
        openPath: (path) => ipcRenderer.invoke('shell-open-path', path),
        openDataFolder: () => ipcRenderer.invoke('shell-open-data-folder'),
        openExternal: (url) => {
            if (!isAllowedExternalUrl(url)) return Promise.resolve(false);
            return ipcRenderer.invoke('shell-open-external', url);
        },
    },

    // Window controls
    window: {
        minimize: () => ipcRenderer.send('window-minimize'),
        maximize: () => ipcRenderer.send('window-maximize'),
        close: () => ipcRenderer.send('window-close'),
        isMaximized: () => ipcRenderer.invoke('window-is-maximized'),
        setTitle: (title) => ipcRenderer.send('set-window-title', title),
        onMaximizeChange: (callback) => {
            const handler = (_event, isMaximized) => callback(isMaximized);
            ipcRenderer.on('window-maximized', handler);
            return () => ipcRenderer.removeListener('window-maximized', handler);
        },
    },

    ipcRenderer: {
        send: (channel, data) => {
            const allowedChannels = ['app-quit', 'install-update'];
            if (allowedChannels.includes(channel)) {
                ipcRenderer.send(channel, data);
            }
        },
        on: (channel, func) => {
            const allowedChannels = ['update-status'];
            if (allowedChannels.includes(channel)) {
                ipcRenderer.on(channel, (event, ...args) => func(...args));
            }
        },
        removeListener: (channel, func) => {
            ipcRenderer.removeListener(channel, func);
        },
    },

 
    updater: {
        isSupported: isPackaged,
        onStatus: (callback) => {
            const handler = (_event, data) => callback(data);
            ipcRenderer.on('update-status', handler);
            // Return cleanup function
            return () => ipcRenderer.removeListener('update-status', handler);
        },
        checkForUpdates: () => {
            return ipcRenderer.invoke('check-for-updates');
        },
        downloadNow: () => {
            return ipcRenderer.invoke('download-update');
        },
        installNow: () => {
            ipcRenderer.send('install-update');
        },
    },
});
