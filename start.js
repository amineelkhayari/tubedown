const { spawn, execSync } = require('child_process');
const { existsSync } = require('fs');
const path = require('path');

const isHeadlessLinux = process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY;
const isServerEnvironment = Boolean(
  process.env.PORT ||
  process.env.DATA_DIR ||
  process.env.API_KEY ||
  process.env.NODE_ENV === 'production' ||
  isHeadlessLinux
);

if (isServerEnvironment) {
  console.log('[Runner] Server or headless environment detected. Starting ytDownloader service...');
  const cmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const serviceDir = path.join(__dirname, 'service');
  const hasNodeModules = existsSync(path.join(serviceDir, 'node_modules'));
  const hasDist = existsSync(path.join(serviceDir, 'dist', 'main.js'));

  if (!hasNodeModules) {
    console.log('[Runner] Installing service dependencies...');
    execSync(`${cmd} --prefix service install --omit=dev`, { stdio: 'inherit' });
  }

  const args = hasDist 
    ? ['--prefix', 'service', 'run', 'start:prod']
    : ['--prefix', 'service', 'start'];

  const child = spawn(cmd, args, { stdio: 'inherit', shell: true });
  child.on('exit', (code) => process.exit(code ?? 0));
} else {
  const cmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const child = spawn(cmd, ['electron', '.'], { stdio: 'inherit', shell: true });
  child.on('exit', (code) => process.exit(code ?? 0));
}
