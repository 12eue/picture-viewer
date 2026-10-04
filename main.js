const { app, BrowserWindow, Menu, dialog, ipcMain } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const IMAGE_EXTENSIONS = new Set([
  '.avif',
  '.bmp',
  '.gif',
  '.ico',
  '.jpeg',
  '.jpg',
  '.png',
  '.svg',
  '.tif',
  '.tiff',
  '.webp',
]);

const collator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base',
});

let mainWindow = null;
let pendingOpenPath = null;

function isImagePath(filePath) {
  return IMAGE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function findImageArgument(argv) {
  for (const argument of argv) {
    if (!argument || argument.startsWith('-')) {
      continue;
    }

    const candidate = path.resolve(argument);
    if (isImagePath(candidate)) {
      return candidate;
    }
  }

  return null;
}

function sendOpenPath(targetPath) {
  if (!targetPath) {
    return;
  }

  if (!mainWindow || mainWindow.isDestroyed()) {
    pendingOpenPath = targetPath;
    return;
  }

  if (mainWindow.webContents.isLoading()) {
    pendingOpenPath = targetPath;
    return;
  }

  mainWindow.webContents.send('app:open-path', targetPath);
}

async function chooseAndOpen({ directory = false } = {}) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return null;
  }

  const result = await dialog.showOpenDialog(mainWindow, {
    title: directory ? '选择图片目录' : '选择图片',
    properties: [directory ? 'openDirectory' : 'openFile'],
    filters: directory
      ? undefined
      : [
          {
            name: '图片',
            extensions: [...IMAGE_EXTENSIONS].map((extension) => extension.slice(1)),
          },
          { name: '所有文件', extensions: ['*'] },
        ],
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  return result.filePaths[0];
}

function buildApplicationMenu() {
  const template = [
    ...(process.platform === 'darwin'
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' },
            ],
          },
        ]
      : []),
    {
      label: '文件',
      submenu: [
        {
          label: '打开文件…',
          accelerator: 'CmdOrCtrl+O',
          click: async () => {
            const selectedPath = await chooseAndOpen();
            sendOpenPath(selectedPath);
          },
        },
        {
          label: '打开目录…',
          accelerator: 'CmdOrCtrl+Shift+O',
          click: async () => {
            const selectedPath = await chooseAndOpen({ directory: true });
            sendOpenPath(selectedPath);
          },
        },
        { type: 'separator' },
        process.platform === 'darwin' ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: '窗口',
      submenu: [{ role: 'minimize' }, { role: 'zoom' }, { role: 'front' }],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function getPathInfo(targetPath) {
  const resolvedPath = path.resolve(targetPath);
  const stats = await fs.stat(resolvedPath);

  if (stats.isDirectory()) {
    return { kind: 'directory', path: resolvedPath };
  }

  if (stats.isFile() && isImagePath(resolvedPath)) {
    return {
      kind: 'image',
      path: resolvedPath,
      directory: path.dirname(resolvedPath),
    };
  }

  throw new Error('仅支持打开图片文件或目录');
}

async function listDirectory(targetPath) {
  const resolvedPath = path.resolve(targetPath);
  const entries = await fs.readdir(resolvedPath, { withFileTypes: true });

  const directories = [];
  const images = [];

  for (const entry of entries) {
    if (entry.name.startsWith('.')) {
      continue;
    }

    const entryPath = path.join(resolvedPath, entry.name);

    if (entry.isDirectory()) {
      directories.push({
        name: entry.name,
        path: entryPath,
      });
      continue;
    }

    if (entry.isFile() && isImagePath(entryPath)) {
      images.push({
        name: entry.name,
        path: entryPath,
        url: pathToFileURL(entryPath).href,
      });
    }
  }

  directories.sort((left, right) => collator.compare(left.name, right.name));
  images.sort((left, right) => collator.compare(left.name, right.name));

  const parentPath = path.dirname(resolvedPath);

  return {
    path: resolvedPath,
    parent: parentPath === resolvedPath ? null : parentPath,
    directories,
    images,
  };
}

function registerIpcHandlers() {
  ipcMain.handle('fs:path-info', (_event, targetPath) => {
    if (typeof targetPath !== 'string' || targetPath.length === 0) {
      throw new Error('路径无效');
    }

    return getPathInfo(targetPath);
  });

  ipcMain.handle('fs:list-directory', (_event, targetPath) => {
    if (typeof targetPath !== 'string' || targetPath.length === 0) {
      throw new Error('目录无效');
    }

    return listDirectory(targetPath);
  });

  ipcMain.handle('dialog:open-file', () => chooseAndOpen());
  ipcMain.handle('dialog:open-directory', () => chooseAndOpen({ directory: true }));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: '图片查看器',
    backgroundColor: '#0d0f12',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.webContents.once('did-finish-load', () => {
    if (pendingOpenPath) {
      const targetPath = pendingOpenPath;
      pendingOpenPath = null;
      mainWindow.webContents.send('app:open-path', targetPath);
    }
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  pendingOpenPath = findImageArgument(process.argv);

  app.on('second-instance', (_event, commandLine) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.focus();
    }

    sendOpenPath(findImageArgument(commandLine));
  });

  app.on('open-file', (event, filePath) => {
    event.preventDefault();
    sendOpenPath(filePath);
  });

  app.whenReady().then(() => {
    registerIpcHandlers();
    buildApplicationMenu();
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
}
