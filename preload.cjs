const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
    // App version from package.json
    appVersion: ipcRenderer.sendSync('get-app-version'),

    // Shell utilities
    shell: {
        openPath: (path) => ipcRenderer.invoke('shell-open-path', path),
        openExternal: (url) => ipcRenderer.invoke('shell-open-external', url),
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
        onStatus: (callback) => {
            const handler = (_event, data) => callback(data);
            ipcRenderer.on('update-status', handler);
            // Return cleanup function
            return () => ipcRenderer.removeListener('update-status', handler);
        },
        installNow: () => {
            ipcRenderer.send('install-update');
        },
    },
});
