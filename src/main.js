const { app, BrowserWindow, Menu, ipcMain, dialog, clipboard, nativeImage, shell } = require('electron');
const path = require('path');
const fs = require('fs/promises');

const FILE_EXTS = ['mmd', 'mermaid', 'md', 'markdown', 'txt'];
const isMac = process.platform === 'darwin';

let win = null;
let rendererReady = false;
let quitting = false; // ⌘Q / app quit in progress (vs. just closing the window)
let pendingFiles = filesFromArgv(process.argv); // opened before the UI was ready
let clipboardWatch = { enabled: true, timer: null, last: '' };

// ---------- single instance + file opening ----------

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    filesFromArgv(argv).forEach(openFile);
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
}

// macOS: files dropped on the dock icon / opened from Finder
app.on('open-file', (e, file) => {
  e.preventDefault();
  openFile(file);
});

function filesFromArgv(argv) {
  // Packaged: [exe, ...files]; dev: [electron, appPath, ...files]
  return argv
    .slice(app.isPackaged ? 1 : 2)
    .filter((a) => !a.startsWith('-') && FILE_EXTS.includes(path.extname(a).slice(1).toLowerCase()));
}

async function openFile(filePath) {
  if (!win || !rendererReady) {
    pendingFiles.push(filePath);
    return;
  }
  try {
    const content = await fs.readFile(filePath, 'utf8');
    win.webContents.send('file-opened', { path: filePath, content });
    app.addRecentDocument(filePath);
  } catch (err) {
    dialog.showErrorBox('Could not open file', `${filePath}\n\n${err.message}`);
  }
}

// ---------- window ----------

function createWindow() {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 700,
    minHeight: 450,
    title: 'Mermaid Viewer',
    backgroundColor: '#1e1e1e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  win.webContents.on('did-start-loading', () => (rendererReady = false));

  // Open external links in the default browser, never inside the app
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  win.on('close', (e) => {
    if (win.__forceClose) return;
    e.preventDefault();
    win.webContents.send('request-close');
  });

  win.on('closed', () => {
    win = null;
  });
}

// ---------- clipboard watching ----------

// clipboard.* is synchronous in older Electron and returns promises in newer releases;
// awaiting works for both.
async function readClipboardText() {
  try {
    const text = await clipboard.readText();
    return typeof text === 'string' ? text : '';
  } catch {
    return '';
  }
}

async function startClipboardWatch() {
  stopClipboardWatch();
  clipboardWatch.last = await readClipboardText();
  let busy = false;
  clipboardWatch.timer = setInterval(async () => {
    if (busy) return;
    busy = true;
    const text = await readClipboardText();
    busy = false;
    if (text && text !== clipboardWatch.last) {
      clipboardWatch.last = text;
      win?.webContents.send('clipboard-changed', text);
    }
  }, 800);
}

function stopClipboardWatch() {
  if (clipboardWatch.timer) clearInterval(clipboardWatch.timer);
  clipboardWatch.timer = null;
}

function setClipboardWatch(enabled) {
  clipboardWatch.enabled = enabled;
  enabled ? startClipboardWatch() : stopClipboardWatch();
  const item = Menu.getApplicationMenu()?.getMenuItemById('watch-clipboard');
  if (item) item.checked = enabled;
  win?.webContents.send('clipboard-watch-state', enabled);
}

// ---------- menu ----------

function send(channel, ...args) {
  win?.webContents.send(channel, ...args);
}

function buildMenu() {
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'New Diagram', accelerator: 'CmdOrCtrl+N', click: () => send('menu', 'new') },
        { label: 'New Board', accelerator: 'CmdOrCtrl+Shift+N', click: () => send('menu', 'new-board') },
        { label: 'Open…', accelerator: 'CmdOrCtrl+O', click: () => send('menu', 'open') },
        ...(isMac ? [{ role: 'recentDocuments', submenu: [{ role: 'clearRecentDocuments' }] }] : []),
        { type: 'separator' },
        { label: 'Save', accelerator: 'CmdOrCtrl+S', click: () => send('menu', 'save') },
        { label: 'Save As…', accelerator: 'CmdOrCtrl+Shift+S', click: () => send('menu', 'save-as') },
        { type: 'separator' },
        { label: 'Export as SVG…', accelerator: 'CmdOrCtrl+E', click: () => send('menu', 'export-svg') },
        { label: 'Export as PNG…', accelerator: 'CmdOrCtrl+Shift+E', click: () => send('menu', 'export-png') },
        { label: 'Copy Diagram as PNG', accelerator: 'CmdOrCtrl+Shift+C', click: () => send('menu', 'copy-png') },
        { type: 'separator' },
        { label: 'Close Tab', accelerator: 'CmdOrCtrl+W', click: () => send('menu', 'close-tab') },
        ...(isMac ? [] : [{ type: 'separator' }, { role: 'quit' }]),
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
        { type: 'separator' },
        {
          label: 'Import from Clipboard',
          accelerator: 'CmdOrCtrl+Shift+V',
          click: () => send('menu', 'import-clipboard'),
        },
        { label: 'Combine All Tabs into a Board', click: () => send('menu', 'combine-tabs') },
        {
          id: 'watch-clipboard',
          label: 'Auto-import Mermaid from Clipboard',
          type: 'checkbox',
          checked: clipboardWatch.enabled,
          click: (item) => setClipboardWatch(item.checked),
        },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Zoom In', accelerator: 'CmdOrCtrl+=', click: () => send('menu', 'zoom-in') },
        { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', click: () => send('menu', 'zoom-out') },
        { label: 'Actual Size', accelerator: 'CmdOrCtrl+0', click: () => send('menu', 'zoom-reset') },
        { label: 'Fit to Window', accelerator: 'CmdOrCtrl+9', click: () => send('menu', 'zoom-fit') },
        { type: 'separator' },
        { label: 'Present', accelerator: 'F5', click: () => send('menu', 'present') },
        { label: 'Present (alternate shortcut)', accelerator: 'CmdOrCtrl+Shift+Enter', visible: false, click: () => send('menu', 'present') },
        { type: 'separator' },
        { label: 'Toggle Editor', accelerator: 'CmdOrCtrl+B', click: () => send('menu', 'toggle-editor') },
        { label: 'Swap Layout (side / stacked)', accelerator: 'CmdOrCtrl+L', click: () => send('menu', 'toggle-layout') },
        { type: 'separator' },
        { label: 'Next Tab', accelerator: 'Ctrl+Tab', click: () => send('menu', 'next-tab') },
        { label: 'Previous Tab', accelerator: 'Ctrl+Shift+Tab', click: () => send('menu', 'prev-tab') },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { role: 'toggleDevTools' },
      ],
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        { label: 'Mermaid Syntax Reference', click: () => shell.openExternal('https://mermaid.js.org/intro/') },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------- IPC ----------

const fileFilters = [
  { name: 'Mermaid', extensions: ['mmd', 'mermaid'] },
  { name: 'Markdown', extensions: ['md', 'markdown'] },
  { name: 'All Files', extensions: ['*'] },
];

ipcMain.handle('open-dialog', async () => {
  const res = await dialog.showOpenDialog(win, {
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Mermaid & Markdown', extensions: FILE_EXTS }, ...fileFilters],
  });
  if (res.canceled) return [];
  return Promise.all(
    res.filePaths.map(async (p) => {
      app.addRecentDocument(p);
      return { path: p, content: await fs.readFile(p, 'utf8') };
    })
  );
});

ipcMain.handle('read-file', async (_e, filePath) => {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch {
    return null;
  }
});

ipcMain.handle('save-file', async (_e, { path: filePath, content, defaultName, wrapMarkdown, markdownContent }) => {
  let target = filePath;
  if (!target) {
    const res = await dialog.showSaveDialog(win, {
      defaultPath: defaultName || 'diagram.mmd',
      filters: fileFilters,
    });
    if (res.canceled) return null;
    target = res.filePath;
  }
  if (/\.(md|markdown)$/i.test(target)) {
    if (markdownContent != null) content = markdownContent;
    else if (wrapMarkdown) content = '```mermaid\n' + content + '```\n';
  }
  await fs.writeFile(target, content, 'utf8');
  app.addRecentDocument(target);
  return target;
});

ipcMain.handle('export-file', async (_e, { defaultName, data, encoding, ext }) => {
  const res = await dialog.showSaveDialog(win, {
    defaultPath: defaultName,
    filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
  });
  if (res.canceled) return null;
  const buf = encoding === 'base64' ? Buffer.from(data, 'base64') : Buffer.from(data, 'utf8');
  await fs.writeFile(res.filePath, buf);
  return res.filePath;
});

ipcMain.handle('clipboard-read', () => readClipboardText());

ipcMain.handle('clipboard-write-png', async (_e, dataUrl) => {
  await clipboard.writeImage(nativeImage.createFromDataURL(dataUrl));
  clipboardWatch.last = await readClipboardText();
  return true;
});

ipcMain.handle('clipboard-write-text', async (_e, text) => {
  await clipboard.writeText(text);
  clipboardWatch.last = text; // don't re-import our own copy
  return true;
});

ipcMain.handle('confirm-discard', async (_e, message) => {
  const res = await dialog.showMessageBox(win, {
    type: 'warning',
    buttons: ['Save', "Don't Save", 'Cancel'],
    defaultId: 0,
    cancelId: 2,
    message,
  });
  return ['save', 'discard', 'cancel'][res.response];
});

ipcMain.on('renderer-ready', () => {
  rendererReady = true;
  const files = pendingFiles;
  pendingFiles = [];
  files.forEach(openFile);
});
ipcMain.on('set-fullscreen', (_e, on) => win?.setFullScreen(!!on));
ipcMain.on('set-title', (_e, title) => win?.setTitle(title));
ipcMain.on('set-edited', (_e, edited) => isMac && win?.setDocumentEdited(edited));
ipcMain.on('set-clipboard-watch', (_e, enabled) => setClipboardWatch(enabled));
ipcMain.on('close-confirmed', () => {
  if (!win) return;
  win.__forceClose = true;
  win.close();
  // The unsaved-changes check cancelled the original quit; resume it
  if (quitting) app.quit();
});

ipcMain.on('close-cancelled', () => (quitting = false));

app.on('before-quit', () => {
  quitting = true;
});

// ---------- lifecycle ----------

app.whenReady().then(() => {
  buildMenu();
  createWindow();
  if (clipboardWatch.enabled) startClipboardWatch();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  stopClipboardWatch();
  if (!isMac) app.quit();
});
