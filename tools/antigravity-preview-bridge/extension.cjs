const net = require('node:net');
const fs = require('node:fs');
const { randomBytes } = require('node:crypto');
const path = require('node:path');
const vscode = require('vscode');
const {
  decodePreviewRequest,
  normalizeWorkspaceRoot,
  previewPanelKey,
  previewPanelTitle,
  validatePreviewRequest,
  workspacePipeName,
  workspaceStateFile,
} = require('./previewBridgeCore.cjs');

const MAX_REQUEST_BYTES = 64 * 1024;
const PREVIEW_VIEW_TYPE = 'rtx5.antigravityPreview';

const escapeHtmlAttribute = (value) => String(value)
  .replace(/&/g, '&amp;')
  .replace(/"/g, '&quot;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;');

const writeResponse = (socket, response) => {
  if (socket.destroyed) return;
  socket.end(`${JSON.stringify(response)}\n`);
};

const activate = (context) => {
  const output = vscode.window.createOutputChannel('RTX5 Preview Bridge');
  const pipeServers = new Map();
  const pendingPipeServers = new Map();
  const previewPanels = new Map();
  const sessionId = randomBytes(12).toString('hex');
  const sessionToken = randomBytes(32).toString('hex');
  context.subscriptions.push(output);

  const simpleBrowserExtension = vscode.extensions.getExtension('vscode.simple-browser');
  if (!simpleBrowserExtension) {
    throw new Error('Antigravity\'s built-in Simple Browser extension is unavailable.');
  }
  const simpleBrowserMediaRoot = vscode.Uri.joinPath(simpleBrowserExtension.extensionUri, 'media');

  const previewWebviewOptions = () => ({
    enableForms: true,
    enableScripts: true,
    localResourceRoots: [simpleBrowserMediaRoot],
  });

  const createPreviewHtml = (webview, url) => {
    const nonce = randomBytes(16).toString('hex');
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(simpleBrowserMediaRoot, 'index.js'));
    const mainCssUri = webview.asWebviewUri(vscode.Uri.joinPath(simpleBrowserMediaRoot, 'main.css'));
    const codiconCssUri = webview.asWebviewUri(vscode.Uri.joinPath(simpleBrowserMediaRoot, 'codicon.css'));
    const focusLockEnabled = vscode.workspace
      .getConfiguration('simpleBrowser')
      .get('focusLockIndicator.enabled', true);
    const settings = escapeHtmlAttribute(JSON.stringify({ url, focusLockEnabled }));

    return `<!DOCTYPE html>
      <html>
      <head>
        <meta http-equiv="Content-type" content="text/html;charset=UTF-8">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; font-src data:; style-src ${webview.cspSource}; script-src 'nonce-${nonce}'; frame-src *;">
        <meta id="simple-browser-settings" data-settings="${settings}">
        <link rel="stylesheet" type="text/css" href="${mainCssUri}">
        <link rel="stylesheet" type="text/css" href="${codiconCssUri}">
      </head>
      <body>
        <header class="header">
          <nav class="controls">
            <button title="Back" class="back-button icon"><i class="codicon codicon-arrow-left"></i></button>
            <button title="Forward" class="forward-button icon"><i class="codicon codicon-arrow-right"></i></button>
            <button title="Reload" class="reload-button icon"><i class="codicon codicon-refresh"></i></button>
          </nav>
          <input class="url-input" type="text">
          <nav class="controls">
            <button title="Open in browser" class="open-external-button icon"><i class="codicon codicon-link-external"></i></button>
          </nav>
        </header>
        <div class="content">
          <iframe sandbox="allow-scripts allow-forms allow-same-origin allow-downloads"></iframe>
        </div>
        <script src="${scriptUri}" nonce="${nonce}"></script>
      </body>
      </html>`;
  };

  const configurePreviewPanel = (panel, url) => {
    const panelKey = previewPanelKey(url);
    panel.title = previewPanelTitle(url);
    panel.webview.options = previewWebviewOptions();
    panel.webview.html = createPreviewHtml(panel.webview, url);
    panel.iconPath = vscode.Uri.joinPath(simpleBrowserMediaRoot, 'icon.png');
    previewPanels.set(panelKey, panel);

    panel.webview.onDidReceiveMessage((message) => {
      if (message?.type !== 'openExternal' || typeof message.url !== 'string') return;
      try {
        void vscode.env.openExternal(vscode.Uri.parse(message.url));
      } catch (error) {
        output.appendLine(`Unable to open external URL: ${error.message}`);
      }
    }, undefined, context.subscriptions);
    panel.onDidDispose(() => {
      if (previewPanels.get(panelKey) === panel) previewPanels.delete(panelKey);
    }, undefined, context.subscriptions);
  };

  const openPreviewPanel = (url) => {
    const panelKey = previewPanelKey(url);
    const existingPanel = previewPanels.get(panelKey);
    if (existingPanel) {
      existingPanel.webview.html = createPreviewHtml(existingPanel.webview, url);
      existingPanel.reveal(vscode.ViewColumn.Active, false);
      return existingPanel;
    }

    const panel = vscode.window.createWebviewPanel(
      PREVIEW_VIEW_TYPE,
      previewPanelTitle(url),
      { viewColumn: vscode.ViewColumn.Active, preserveFocus: false },
      { ...previewWebviewOptions(), retainContextWhenHidden: true },
    );
    configurePreviewPanel(panel, url);
    return panel;
  };

  const findWorkspaceFolder = (workspaceRoot) => {
    const expected = normalizeWorkspaceRoot(workspaceRoot);
    return vscode.workspace.workspaceFolders?.find(
      (folder) => normalizeWorkspaceRoot(folder.uri.fsPath) === expected,
    );
  };

  const openRequest = async (request, expectedWorkspaceRoot, expectedToken = null) => {
    if (!vscode.workspace.isTrusted) {
      throw new Error('The preview bridge is disabled in untrusted workspaces.');
    }

    const validated = validatePreviewRequest(request, expectedWorkspaceRoot, expectedToken);
    if (!findWorkspaceFolder(validated.workspaceRoot)) {
      throw new Error('The requested workspace is not open in this Antigravity window.');
    }

    openPreviewPanel(validated.url);
    output.appendLine(`Opened ${validated.url}`);
    return validated;
  };

  const removeOwnedStateFile = (workspaceRoot) => {
    const stateFile = workspaceStateFile(workspaceRoot);
    try {
      const current = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      if (current.sessionToken === sessionToken) fs.unlinkSync(stateFile);
    } catch {
      // Missing, stale, or replaced state belongs to no current cleanup action.
    }
  };

  const publishPipeState = (workspaceRoot, pipeName) => {
    const stateFile = workspaceStateFile(workspaceRoot);
    const stateDirectory = path.dirname(stateFile);
    const temporaryStateFile = `${stateFile}.${process.pid}.${sessionId}.tmp`;
    const state = {
      version: 1,
      workspaceRoot: normalizeWorkspaceRoot(workspaceRoot),
      pipeName,
      sessionId,
      sessionToken,
      processId: process.pid,
      updatedAt: new Date().toISOString(),
    };

    fs.mkdirSync(stateDirectory, { recursive: true, mode: 0o700 });
    fs.writeFileSync(temporaryStateFile, `${JSON.stringify(state)}\n`, { mode: 0o600 });
    fs.renameSync(temporaryStateFile, stateFile);
  };

  const stopPipeServer = (workspaceRoot) => {
    const normalizedRoot = normalizeWorkspaceRoot(workspaceRoot);
    const pending = pendingPipeServers.get(normalizedRoot);
    if (pending) {
      pendingPipeServers.delete(normalizedRoot);
      pending.close();
    }
    const active = pipeServers.get(normalizedRoot);
    if (active) {
      pipeServers.delete(normalizedRoot);
      active.server.close();
      if (process.platform !== 'win32' && fs.existsSync(active.pipeName)) {
        fs.unlinkSync(active.pipeName);
      }
    }
    removeOwnedStateFile(normalizedRoot);
  };

  const startPipeServer = (workspaceRoot) => {
    const normalizedRoot = normalizeWorkspaceRoot(workspaceRoot);
    if (pipeServers.has(normalizedRoot) || pendingPipeServers.has(normalizedRoot)) return;

    const pipeName = workspacePipeName(normalizedRoot, sessionId);
    if (process.platform !== 'win32' && fs.existsSync(pipeName)) {
      fs.unlinkSync(pipeName);
    }

    const server = net.createServer((socket) => {
      let requestText = '';
      let handled = false;

      socket.setEncoding('utf8');
      socket.on('data', (chunk) => {
        if (handled) return;
        requestText += chunk;

        if (Buffer.byteLength(requestText, 'utf8') > MAX_REQUEST_BYTES) {
          handled = true;
          writeResponse(socket, { ok: false, error: 'Preview request is too large.' });
          return;
        }

        const newlineIndex = requestText.indexOf('\n');
        if (newlineIndex < 0) return;

        handled = true;
        const line = requestText.slice(0, newlineIndex);
        void (async () => {
          try {
            const opened = await openRequest(JSON.parse(line), normalizedRoot, sessionToken);
            writeResponse(socket, { ok: true, url: opened.url });
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            output.appendLine(`Rejected request: ${message}`);
            writeResponse(socket, { ok: false, error: message });
          }
        })();
      });
      socket.on('error', (error) => output.appendLine(`Socket error: ${error.message}`));
    });

    pendingPipeServers.set(normalizedRoot, server);
    server.on('error', (error) => {
      pendingPipeServers.delete(normalizedRoot);
      const active = pipeServers.get(normalizedRoot);
      if (active?.server === server) pipeServers.delete(normalizedRoot);
      output.appendLine(`Unable to listen on ${pipeName}: ${error.message}`);
    });
    server.on('close', () => {
      pendingPipeServers.delete(normalizedRoot);
      const active = pipeServers.get(normalizedRoot);
      if (active?.server === server) pipeServers.delete(normalizedRoot);
    });
    server.listen(pipeName, () => {
      pendingPipeServers.delete(normalizedRoot);
      pipeServers.set(normalizedRoot, { server, pipeName });
      publishPipeState(normalizedRoot, pipeName);
      output.appendLine(`Listening for ${normalizedRoot}`);
    });
    server.unref();
  };

  const syncPipeServers = () => {
    const activeRoots = new Set(
      (vscode.workspace.workspaceFolders || []).map(
        (folder) => normalizeWorkspaceRoot(folder.uri.fsPath),
      ),
    );
    for (const workspaceRoot of [...pipeServers.keys(), ...pendingPipeServers.keys()]) {
      if (!activeRoots.has(workspaceRoot) || !vscode.workspace.isTrusted) {
        stopPipeServer(workspaceRoot);
      }
    }
    if (!vscode.workspace.isTrusted) return;

    for (const folder of vscode.workspace.workspaceFolders || []) {
      startPipeServer(folder.uri.fsPath);
    }
  };

  const publishFocusedWindowState = () => {
    if (!vscode.window.state.focused) return;
    for (const [workspaceRoot, active] of pipeServers) {
      publishPipeState(workspaceRoot, active.pipeName);
    }
  };

  syncPipeServers();
  context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(syncPipeServers));
  context.subscriptions.push(vscode.workspace.onDidGrantWorkspaceTrust(syncPipeServers));
  context.subscriptions.push(vscode.window.onDidChangeWindowState((state) => {
    if (state.focused) publishFocusedWindowState();
  }));
  context.subscriptions.push({
    dispose: () => {
      for (const workspaceRoot of [...pipeServers.keys(), ...pendingPipeServers.keys()]) {
        stopPipeServer(workspaceRoot);
      }
    },
  });

  context.subscriptions.push(vscode.window.registerWebviewPanelSerializer(
    PREVIEW_VIEW_TYPE,
    {
      deserializeWebviewPanel: async (panel, state) => {
        const restoredUrl = typeof state?.url === 'string' ? state.url : null;
        if (!restoredUrl) {
          panel.dispose();
          return;
        }
        try {
          configurePreviewPanel(panel, restoredUrl);
        } catch (error) {
          output.appendLine(`Unable to restore preview: ${error.message}`);
          panel.dispose();
        }
      },
    },
  ));

  context.subscriptions.push(vscode.window.registerUriHandler({
    handleUri: async (uri) => {
      try {
        const encoded = uri.path.split('/').filter(Boolean).at(-1);
        const request = decodePreviewRequest(encoded);
        await openRequest(request, request.workspaceRoot);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        output.appendLine(`URI request failed: ${message}`);
        void vscode.window.showErrorMessage(`RTX5 Preview: ${message}`);
      }
    },
  }));

  context.subscriptions.push(vscode.commands.registerCommand('rtxPreview.open', async (value) => {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
      void vscode.window.showErrorMessage('RTX5 Preview: open a workspace folder first.');
      return;
    }

    const suppliedUrl = typeof value === 'string' ? value : undefined;
    const url = suppliedUrl || await vscode.window.showInputBox({
      title: 'Open Local Dev Server',
      prompt: 'Enter a localhost development URL',
      placeHolder: 'http://127.0.0.1:5173/',
    });
    if (!url) return;

    try {
      await openRequest({ workspaceRoot, url }, workspaceRoot);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(`RTX5 Preview: ${message}`);
    }
  }));
};

module.exports = { activate };
