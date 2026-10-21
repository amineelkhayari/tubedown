import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApplication } from './bootstrap';
async function exportDocument() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ytd-openapi-'));
  try {
    const { app, document } = await createApplication({ apiKey: 'documentation-only-not-a-live-key-123456', directory }, false);
    try { await writeFile(path.resolve(__dirname, '../openapi.json'), JSON.stringify(document, null, 2) + '\n'); }
    finally { await app.close(); }
  } finally { await rm(directory, { recursive: true, force: true }); }
}
exportDocument().catch(error => { console.error(error); process.exitCode = 1; });
