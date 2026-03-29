const { spawn } = require('node:child_process');
const http = require('node:http');
const net = require('node:net');

const cwd = process.cwd();
const isWindows = process.platform === 'win32';
const npmCommand = isWindows ? 'npm.cmd' : 'npm';
const npmRunnerCommand = isWindows ? 'cmd.exe' : npmCommand;
const dockerCommand = isWindows ? 'docker.exe' : 'docker';
const backendPort = Number(process.env.BACKEND_PORT || process.env.PORT || 5001);
const frontendPort = Number(process.env.FRONTEND_PORT || 3000);

const colors = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
};

const services = [];
let shuttingDown = false;

function log(prefix, color, message) {
  process.stdout.write(`${color}${prefix}${colors.reset} ${message}\n`);
}

function prefixStream(stream, prefix, color) {
  let buffer = '';
  stream.on('data', (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (line.trim().length === 0) {
        continue;
      }
      log(prefix, color, line);
    }
  });
  stream.on('end', () => {
    if (buffer.trim().length > 0) {
      log(prefix, color, buffer);
      buffer = '';
    }
  });
}

function spawnManaged(command, args, meta) {
  const child = spawn(command, args, {
    cwd,
    env: process.env,
    shell: false,
    windowsHide: false,
  });

  services.push({ child, ...meta });

  if (child.stdout) prefixStream(child.stdout, meta.prefix, meta.color);
  if (child.stderr) prefixStream(child.stderr, meta.prefix, meta.color);

  child.on('exit', (code, signal) => {
    if (shuttingDown) {
      return;
    }

    const detail = signal ? `signal ${signal}` : `code ${code}`;
    log(meta.prefix, colors.red, `${meta.name} exited unexpectedly (${detail})`);
    void shutdown(code || 1);
  });

  child.on('error', (error) => {
    if (shuttingDown) {
      return;
    }

    log(meta.prefix, colors.red, `${meta.name} failed to start: ${error.message}`);
    void shutdown(1);
  });

  return child;
}

function runOneShot(command, args, label, color) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      shell: false,
      windowsHide: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    if (child.stdout) prefixStream(child.stdout, label, color);
    if (child.stderr) prefixStream(child.stderr, label, color);

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${label} exited with code ${code}`));
    });
  });
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForPort(port, host = '127.0.0.1', timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;

  return new Promise((resolve, reject) => {
    const tryConnect = () => {
      const socket = new net.Socket();
      socket.setTimeout(1500);

      socket.once('connect', () => {
        socket.destroy();
        resolve();
      });

      const retry = () => {
        socket.destroy();
        if (Date.now() >= deadline) {
          reject(new Error(`Timed out waiting for ${host}:${port}`));
          return;
        }
        setTimeout(tryConnect, 1000);
      };

      socket.once('timeout', retry);
      socket.once('error', retry);
      socket.connect(port, host);
    };

    tryConnect();
  });
}

function waitForHealth(url, timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs;

  return new Promise((resolve, reject) => {
    const tryFetch = () => {
      const request = http.get(url, { headers: { 'x-jellyfsch-dev-probe': '1' } }, (response) => {
        response.resume();
        if (response.statusCode && response.statusCode >= 200 && response.statusCode < 500) {
          resolve();
          return;
        }

        if (Date.now() >= deadline) {
          reject(new Error(`Timed out waiting for ${url}`));
          return;
        }
        setTimeout(tryFetch, 1000);
      });

      request.on('error', () => {
        if (Date.now() >= deadline) {
          reject(new Error(`Timed out waiting for ${url}`));
          return;
        }
        setTimeout(tryFetch, 1000);
      });

      request.setTimeout(1500, () => {
        request.destroy();
      });
    };

    tryFetch();
  });
}

function waitForBackendReady(child, timeoutMs = 90000) {
  return new Promise((resolve, reject) => {
    const healthPromise = waitForHealth(`http://127.0.0.1:${backendPort}/api/health`, timeoutMs)
      .then(() => {
        cleanup();
        resolve();
      })
      .catch((error) => {
        cleanup();
        reject(error);
      });

    const onExit = (code, signal) => {
      cleanup();
      reject(new Error(`Backend exited before readiness (${signal || code})`));
    };

    const onStdout = (chunk) => {
      const text = chunk.toString();
      if (text.includes('jellyfsch backend running on port')) {
        // keep health polling as the final gate, but announce earlier progress
        log('[backend]', colors.dim, 'Backend startup banner detected, confirming health endpoint...');
      }
    };

    const cleanup = () => {
      child.stdout && child.stdout.off('data', onStdout);
      child.off('exit', onExit);
    };

    child.stdout && child.stdout.on('data', onStdout);
    child.on('exit', onExit);

    void healthPromise;
  });
}

async function shutdown(exitCode = 0) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;

  log('[dev]', colors.yellow, 'Shutting down local dev services...');

  const kills = services.map(({ child }) => {
    if (child.killed || child.exitCode !== null) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      child.once('exit', () => resolve());
      if (isWindows) {
        const killer = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
          cwd,
          stdio: 'ignore',
          windowsHide: true,
        });
        killer.once('exit', () => resolve());
        killer.once('error', () => resolve());
      } else {
        child.kill('SIGTERM');
        setTimeout(() => {
          if (child.exitCode === null) {
            child.kill('SIGKILL');
          }
          resolve();
        }, 3000);
      }
    });
  });

  await Promise.allSettled(kills);
  process.exit(exitCode);
}

async function main() {
  log('[dev]', colors.cyan, 'Preparing jellyfsch local development environment');
  log('[dev]', colors.dim, `Workspace: ${cwd}`);

  await runOneShot(dockerCommand, ['compose', 'up', '-d', 'mongo'], '[setup]', colors.blue);
  log('[setup]', colors.green, 'Mongo container requested, waiting for port 27017...');
  await waitForPort(27017);
  log('[setup]', colors.green, 'MongoDB is reachable on 127.0.0.1:27017');

  log('[backend]', colors.green, 'Starting backend first...');
  const backend = spawnManaged(npmRunnerCommand, isWindows ? ['/d', '/s', '/c', 'npm run --silent dev -w backend'] : ['run', '--silent', 'dev', '-w', 'backend'], {
    name: 'backend',
    prefix: '[backend]',
    color: colors.green,
  });

  await waitForBackendReady(backend);
  await wait(300);
  log('[backend]', colors.green, `Backend is ready on http://127.0.0.1:${backendPort}`);

  log('[frontend]', colors.magenta, 'Starting frontend after backend readiness...');
  spawnManaged(npmRunnerCommand, isWindows ? ['/d', '/s', '/c', 'npm run --silent dev -w frontend'] : ['run', '--silent', 'dev', '-w', 'frontend'], {
    name: 'frontend',
    prefix: '[frontend]',
    color: colors.magenta,
  });

  log('[dev]', colors.cyan, 'Startup complete');
  log('[dev]', colors.dim, `Frontend: http://127.0.0.1:${frontendPort}`);
  log('[dev]', colors.dim, `Backend:  http://127.0.0.1:${backendPort}`);
}

process.on('SIGINT', () => {
  void shutdown(0);
});

process.on('SIGTERM', () => {
  void shutdown(0);
});

main().catch((error) => {
  log('[dev]', colors.red, error.message || String(error));
  void shutdown(1);
});


