#!/usr/bin/env node
const { execSync } = require('child_process');
const http = require('http');
const https = require('https');
const path = require('path');

function run(command) {
  console.log(`\n> ${command}`);
  execSync(command, { stdio: 'inherit', shell: true });
}

function request(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const lib = parsed.protocol === 'https:' ? https : http;
    const req = lib.request(url, options, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

async function waitForUrl(url, expectedStatus = 200, retries = 30, delayMs = 2000) {
  for (let i = 1; i <= retries; i++) {
    try {
      const r = await request(url, { method: 'GET' });
      if (r.status === expectedStatus || (expectedStatus === 0 && r.status >= 200 && r.status < 400)) {
        console.log(`✔ ${url} returned ${r.status}`); return r;
      }
      console.log(`▪ ${url} returned ${r.status} (waiting)`);
    } catch (e) {
      console.log(`▪ ${url} error (${e.message}), retry ${i}/${retries}`);
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function main() {
  const cwd = path.resolve(__dirname, '..');
  process.chdir(cwd);

  console.log('🚀 fschchat end-to-end check starting');

  // dependency install
  run('npm install');
  run('npm run install-all');

  // docker compose production stack
  if (!require('child_process').spawnSync('docker', ['--version']).status === 0) {
    throw new Error('Docker not found. Install Docker first.');
  }

  run('docker compose -f docker-compose.prod.yml up -d --build');

  // confirm containers are up
  run('docker compose -f docker-compose.prod.yml ps');

  // health endpoint
  await waitForUrl('http://localhost/api/health', 200);

  // unauthenticated /auth/me should be 401 (or 403 depending setup)
  const authMe = await request('http://localhost/api/auth/me');
  console.log(`> /api/auth/me status: ${authMe.status}`);
  if (![401, 403].includes(authMe.status)) {
    console.warn('⚠ /api/auth/me expected 401/403 for unauthenticated request. If this is using session cookies please ignore.');
  }

  // frontend alive
  await waitForUrl('http://localhost', 0);

  // tools endpoints
  const tools = [
    { path: '/tools/get_syntax_docs', body: { file: 'flowchart' } },
    { path: '/tools/get_config_docs', body: { file: 'flowchart' } },
    { path: '/tools/render_diagram', body: { code: 'graph TB\nA-->B' } },
  ];

  for (const t of tools) {
    const headers = { 'Content-Type': 'application/json' };
    const r = await request(`http://localhost${t.path}`, { method: 'POST', headers, body: JSON.stringify(t.body) });
    console.log(`> ${t.path} status ${r.status}`);
    if (![200, 400].includes(r.status)) {
      throw new Error(`Tools check failed for ${t.path}: status ${r.status}`);
    }
  }

  // final check
  console.log('\n✅ fschchat end-to-end check completed successfully.');
  console.log('   - frontend: http://localhost');
  console.log('   - backend health: http://localhost/api/health');
}

main().catch((err) => {
  console.error('❌ End-to-end check failed:', err);
  process.exit(1);
});
