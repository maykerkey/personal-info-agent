import { app, BrowserWindow, dialog, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PIA_PORT) || 8787;
const SERVER_URL = process.env.PIA_SERVER_URL || `http://127.0.0.1:${PORT}`;

// 数据与配置统一放在 AppData\个人信息管家（不随安装包迁移，升级不丢数据）
app.setName('个人信息管家');
app.setPath('userData', path.join(app.getPath('appData'), '个人信息管家'));

const appRoot = app.getAppPath();
const unpackedRoot = appRoot.endsWith('.asar') ? appRoot.replace(/\.asar$/, '.asar.unpacked') : appRoot;

function loadUserEnv() {
  const file = path.join(app.getPath('userData'), '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

let child = null;

function spawnServer() {
  const dataDir = path.join(app.getPath('userData'), 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  const serverEntry = path.join(unpackedRoot, 'server', 'index.js');
  const distDir = path.join(unpackedRoot, 'dist');
  const env = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    PORT: String(PORT),
    DATABASE_URL: process.env.DATABASE_URL || `file:${path.join(dataDir, 'info.db')}`,
    STATIC_DIR: distDir,
  };
  child = spawn(process.execPath, [serverEntry], {
    cwd: unpackedRoot,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  try {
    const logStream = fs.createWriteStream(path.join(app.getPath('userData'), 'server.log'), { flags: 'a' });
    child.stdout.pipe(logStream);
    child.stderr.pipe(logStream);
  } catch {
    /* 日志失败不影响运行 */
  }
  child.stdout.on('data', (d) => console.log('[server]', String(d).trimEnd()));
  child.stderr.on('data', (d) => console.error('[server]', String(d).trimEnd()));
  child.on('exit', (code) => console.log('[server] 已退出，代码', code));
}

async function healthOk() {
  try {
    const res = await fetch(`${SERVER_URL}/api/health`, { signal: AbortSignal.timeout(700) });
    return res.ok;
  } catch {
    return false;
  }
}

async function ensureServer() {
  if (await healthOk()) return; // 已有服务在运行（如开发模式），直接复用
  spawnServer();
  for (let i = 0; i < 80; i += 1) {
    if (await healthOk()) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('内置服务启动失败');
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 860,
    minHeight: 620,
    title: '个人信息管家',
    icon: path.join(unpackedRoot, 'build', 'icon.png'),
    autoHideMenuBar: true,
    backgroundColor: '#f5f6f8',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.loadURL(SERVER_URL);
}

app.whenReady().then(async () => {
  loadUserEnv();
  try {
    await ensureServer();
  } catch (err) {
    dialog.showErrorBox('个人信息管家', `内置服务启动失败：${err.message}\n请确认端口 ${PORT} 未被占用。`);
    app.quit();
    return;
  }
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  if (child && !child.killed) child.kill();
});
