const { spawn } = require('node:child_process');
const path = require('node:path');
const electronPath = require('electron');

const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;

const projectRoot = path.resolve(__dirname, '..');
const electronArguments = [projectRoot, ...process.argv.slice(2)];

const child = spawn(electronPath, electronArguments, {
  env: environment,
  stdio: 'inherit',
});

child.on('error', (error) => {
  console.error(`无法启动 Electron：${error.message}`);
  process.exitCode = 1;
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (!child.killed) {
      child.kill(signal);
    }
  });
}
