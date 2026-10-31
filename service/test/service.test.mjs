import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { createApplication } from '../dist/bootstrap.js';
import { authenticate } from '../dist/auth/auth.guard.js';
import { normalizeExtract, normalizeMedia, platforms } from '../dist/media/platforms.js';
import { buildArguments } from '../dist/media/media.service.js';
import { DownloadsService } from '../dist/downloads/downloads.service.js';
import { resolveTool } from '../dist/media/media-tools.js';
import { mediaFailure } from '../dist/media/media-error.js';

const apiKey = 'test-direct-key-'.repeat(3);
const rapidSecret = 'test-proxy-secret-'.repeat(3);
const input = { url: 'https://www.youtube.com/watch?v=abcdefghijk', format: 'mp4', quality: 720 };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check) {
  for (let i = 0; i < 100; i++) { if (await check()) return; await sleep(20); }
  assert.fail('State did not settle');
}
const blockedRunner = async (_input, _directory, signal) => new Promise((_resolve, reject) => {
  if (signal.aborted) reject(new Error('aborted'));
  else signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
});
const rapidHeaders = user => ({ Authorization: '', 'x-rapidapi-proxy-secret': rapidSecret, 'x-rapidapi-user': user });

test('provider errors are actionable without exposing stderr secrets', () => {
  assert.match(mediaFailure('ERROR: Sign in to confirm you are not a bot. secret=123').message, /requires authentication/);
  assert.match(mediaFailure('Requested format is not available').message, /format or resolution/);
  assert.ok(!mediaFailure('/private/path SECRET').message.includes('SECRET'));
});

async function setup(t, options = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ytd-nest-'));
  const runner = async (data, dir) => {
    await writeFile(path.join(dir, `media.${data.format}`), 'test-media');
    return { filename: `media.${data.format}`, size: 10 };
  };
  const extractRunner = async (url, platform) => {
    const formats = [
      { formatId: '137', type: 'video', quality: '1080p', resolution: '1920x1080', ext: 'mp4', height: 1080, width: 1920, fps: 30, filesize: 15482900, filesizeFormatted: '14.8 MB', hasVideo: true, hasAudio: false, url: 'https://cdn.example.com/1080p.mp4' },
      { formatId: '140', type: 'audio', quality: '128kbps', resolution: null, ext: 'm4a', height: null, width: null, fps: null, filesize: 1048576, filesizeFormatted: '1.0 MB', hasVideo: false, hasAudio: true, url: 'https://cdn.example.com/audio.m4a' },
    ];
    return {
      id: 'test-id',
      platform,
      title: 'Test Video',
      description: 'A test video description',
      thumbnail: 'https://cdn.example.com/thumb.jpg',
      duration: 120,
      durationFormatted: '02:00',
      author: { name: 'Test Creator', username: '@testcreator', url: 'https://example.com/creator' },
      uploader: 'Test Creator',
      download: { video: 'https://cdn.example.com/1080p.mp4', audio: 'https://cdn.example.com/audio.m4a' },
      medias: formats,
      formats,
      bestVideo: formats[0],
      bestAudio: formats[1],
    };
  };
  const { app, document } = await createApplication({ directory, apiKey, rapidSecret, runner, extractRunner, ...options }, false);
  await app.listen(0, '127.0.0.1');
  const base = await app.getUrl();
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  const request = (url, options = {}) => fetch(base + url, { ...options, headers: { Authorization: `Bearer ${apiKey}`, ...options.headers } });
  const create = (payload = input, headers = {}) => request('/v1/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(payload) });
  const extract = (payload = { url: input.url }, headers = {}) => request('/v1/extract', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(payload) });
  const fallback = (payload = input, headers = {}) => request('/v1/fallback', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(payload) });
  return { app, document, jobs: app.get(DownloadsService), directory, request, create, extract, fallback };
}

test('all ten platform examples normalize; hostile destinations and unsupported link types fail', () => {
  const enabled = platforms();
  assert.equal(enabled.length, 10);
  for (const platform of enabled) {
    const normalized = normalizeMedia({ ...input, url: platform.example, format: platform.formats[0] });
    assert.equal(normalized.platform, platform.id);
    assert.equal(new URL(normalized.url).protocol, 'https:');
  }
    assert.equal(normalizeMedia({ ...input, url: 'https://www.snapchat.com/@mfahad-farooq/spotlight/W7_EDlXWTBiXAEEniNoMPwAAYbW12dXV2dXJpAaFOdyJoAaFOc0e5AAAAAQ' }).platform, 'snapchat');
  assert.equal(normalizeExtract('https://www.twitch.tv/caedrel').url, 'https://www.twitch.tv/caedrel');
  assert.equal(normalizeExtract('https://www.twitch.tv/caedrel').platform, 'twitch');
  assert.throws(() => normalizeMedia({ ...input, url: 'https://www.twitch.tv/caedrel' }), /Twitch live streams cannot be downloaded/);
  assert.equal(normalizeMedia({ ...input, url: 'https://youtu.be/abcdefghijk?t=4' }).url, input.url);
  for (const url of ['http://youtube.com/watch?v=abcdefghijk', 'https://127.0.0.1/a', 'https://youtube.com.evil.test/watch?v=abcdefghijk', 'https://youtube.com@evil.test/watch?v=abcdefghijk', 'https://youtube.com:444/watch?v=abcdefghijk', 'file:///etc/passwd', 'https://youtube.com/playlist?list=abcdefghijk', 'https://soundcloud.com/artist/sets/album', 'https://vm.tiktok.com/example', 'https://www.instagram.com/stories/person/123']) {
    assert.throws(() => normalizeMedia({ ...input, url }));
  }
  assert.throws(() => normalizeMedia({ ...input, url: 'https://soundcloud.com/artist/track' }));
  const args = buildArguments(normalizeMedia(input), '/tmp/output');
  assert.deepEqual(args.slice(-2), ['--', input.url]);
  assert.ok(args.includes('--ignore-config'));
  assert.ok(args.includes('--no-playlist'));
});

test('RapidAPI identity requires a valid proxy secret', () => {
  assert.throws(() => authenticate({ 'x-rapidapi-user': 'alice', 'x-rapidapi-key': 'fake' }, { rapidSecret }), { status: 401 });
  assert.throws(() => authenticate({ 'x-rapidapi-proxy-secret': rapidSecret }, { rapidSecret }), { status: 401 });
  assert.equal(authenticate(rapidHeaders('alice'), { rapidSecret }), 'rapid:alice');
});

test('missing executable is rejected before creating a job', async t => {
  const previous = process.env.YTDLP_PATH;
  process.env.YTDLP_PATH = path.join(os.tmpdir(), `missing-ytdlp-${randomUUID()}.exe`);
  t.after(() => { if (previous === undefined) delete process.env.YTDLP_PATH; else process.env.YTDLP_PATH = previous; });
  assert.equal(resolveTool('yt-dlp'), process.env.YTDLP_PATH);
  const { create, jobs } = await setup(t, { runner: undefined });
  const response = await create();
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /yt-dlp/);
  assert.equal(jobs.items.size, 0);
});

test('Nest HTTP lifecycle, customer isolation, listing, file download and Swagger contract', async t => {
  const { request, create, jobs } = await setup(t);
  assert.equal((await request('/')).status, 200);
  const docs = await request('/docs');
  assert.equal(docs.status, 200);
  assert.match(await docs.text(), /swagger-ui/);
  const spec = await (await request('/openapi.json')).json();
  assert.equal(spec.info.version, '1.1.0');
  assert.ok(spec.paths['/v1/jobs/{id}'].delete);
  assert.ok(spec.paths['/v1/jobs'].post.requestBody.content['application/json']);
  assert.ok(spec.paths['/v1/extract'].post.requestBody.content['application/json']);
  assert.deepEqual(spec.paths['/v1/jobs'].post.security, [{ 'direct-key': [] }]);
  assert.equal(spec.components.schemas.CreateDownloadDto.properties.url.maxLength, 2048);
  assert.equal((await (await request('/v1/platforms')).json()).length, 10);
  assert.equal((await request('/health')).status, 200);
  assert.equal((await request('/v1/jobs', { headers: { Authorization: '' } })).status, 401);
  const headers = rapidHeaders('alice');
  const response = await create(input, headers);
  assert.equal(response.status, 202);
  const job = await response.json();
  assert.ok(!('owner' in job));
  assert.equal(job.platform, 'youtube');
  await until(() => jobs.get(job.id, 'rapid:alice').status === 'completed');
  assert.equal((await request(`/v1/jobs/${job.id}`)).status, 404);
  for (const suffix of ['', '/file']) assert.equal((await request(`/v1/jobs/${job.id}${suffix}`, { headers: rapidHeaders('bob') })).status, 404);
  assert.equal((await request(`/v1/jobs/${job.id}`, { method: 'DELETE', headers: rapidHeaders('bob') })).status, 404);
  assert.equal((await (await request('/v1/jobs', { headers: rapidHeaders('bob') })).json()).length, 0);
  const result = await (await request(`/v1/jobs/${job.id}`, { headers })).json();
  assert.equal(result.status, 'completed');
  const file = await request(result.downloadPath, { headers });
  assert.equal(file.headers.get('content-type'), 'video/mp4');
  assert.equal(await file.text(), 'test-media');
  assert.equal((await request(`/v1/jobs/${job.id}`, { method: 'DELETE', headers })).status, 409);
});

test('POST /v1/extract returns direct CDN streaming formats, qualities and metadata without creating server jobs', async t => {
  const { extract, jobs } = await setup(t);
  const response = await extract({ url: input.url });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.id, 'test-id');
  assert.equal(data.title, 'Test Video');
  assert.equal(data.platform, 'youtube');
  assert.equal(data.duration, 120);
  assert.equal(data.durationFormatted, '02:00');
  assert.equal(data.author.name, 'Test Creator');
  assert.equal(data.download.video, 'https://cdn.example.com/1080p.mp4');
  assert.equal(data.download.audio, 'https://cdn.example.com/audio.m4a');
  assert.equal(data.medias.length, 2);
  assert.equal(data.medias[0].type, 'video');
  assert.equal(data.medias[0].quality, '1080p');
  assert.equal(data.medias[0].resolution, '1920x1080');
  assert.equal(data.medias[0].filesizeFormatted, '14.8 MB');
  assert.equal(data.medias[1].type, 'audio');
  assert.equal(data.formats.length, 2);
  assert.ok(data.formats[0].url.startsWith('https://'));
  assert.equal(jobs.items.size, 0);
});


test('DTO validation rejects null, unknown fields, nonnumeric quality and unsupported formats', async t => {
  const { create, request, jobs } = await setup(t);
  const invalid = [{ ...input, quality: '720' }, { ...input, format: 'exe' }, { ...input, cookies: 'secret' }, { ...input, format: null }];
  for (let i = 0; i < invalid.length; i++) assert.equal((await create(invalid[i], rapidHeaders(`test-${i}`))).status, 400);
  assert.equal((await create(null)).status, 400);
  assert.equal((await request('/v1/jobs/not-a-uuid')).status, 400);
  const valid = await create({ url: input.url }, rapidHeaders('defaults'));
  assert.equal(valid.status, 202);
  const job = await valid.json();
  assert.equal(job.format, 'mp4');
  assert.equal(jobs.items.get(job.id).input.quality, 720);
});

test('body limits and authentication are enforced; rate limiting returns Retry-After', async t => {
  const { request, create } = await setup(t);
  assert.equal((await request('/v1/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' })).status, 400);
  assert.equal((await request('/v1/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: ' '.repeat(5000) })).status, 413);
  for (let i = 0; i < 5; i++) assert.equal((await create({ ...input, url: 'https://localhost' })).status, 400);
  const limit = await create(); assert.equal(limit.status, 429); assert.ok(limit.headers.get('retry-after'));
});

test('processing failures are sanitized and incomplete files cannot be retrieved', async t => {
  const { create, jobs, request } = await setup(t, { runner: async () => { throw new Error('/private/path SECRET'); } });
  const job = await (await create()).json();
  await until(() => jobs.items.get(job.id).status === 'failed');
  const result = await (await request(`/v1/jobs/${job.id}`)).json();
  assert.equal(result.status, 'failed');
  assert.ok(!result.error.includes('SECRET'));
  assert.equal((await request(`/v1/jobs/${job.id}/file`)).status, 409);
});

test('concurrent admission limits, active/queued cancellation and process slots', async t => {
  const { create, jobs, request } = await setup(t, { runner: blockedRunner, concurrency: 1 });
  const responses = await Promise.all(Array.from({ length: 4 }, () => create()));
  assert.deepEqual(responses.map(r => r.status).sort(), [202, 202, 202, 429]);
  assert.equal(jobs.running.size, 1);
  const queued = [...jobs.items.values()].find(job => job.status === 'queued');
  assert.equal((await request(`/v1/jobs/${queued.id}/file`)).status, 409);
  const cancelled = await request(`/v1/jobs/${queued.id}`, { method: 'DELETE' });
  assert.equal(cancelled.status, 200); assert.equal((await cancelled.json()).status, 'cancelled');
  assert.equal((await request(`/v1/jobs/${queued.id}`, { method: 'DELETE' })).status, 200);
  const processing = [...jobs.items.values()].find(job => job.status === 'processing');
  const stopped = await request(`/v1/jobs/${processing.id}`, { method: 'DELETE' });
  assert.equal((await stopped.json()).status, 'cancelled');
  assert.equal(JSON.parse(await readFile(path.join(jobs.config.directory, processing.id, 'job.json'))).status, 'cancelled');
});

test('timeouts terminate processing and release worker slots', async t => {
  const { create, jobs } = await setup(t, { runner: blockedRunner, timeout: 50 });
  const job = await (await create()).json();
  await until(() => jobs.items.get(job.id).status === 'failed' && jobs.running.size === 0);
});

test('restart preserves completed files, fails interrupted jobs, and cleans expired output', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ytd-recovery-'));
  const old = Date.now() - 1000;
  const makeJob = async status => {
    const job = { id: randomUUID(), owner: 'alice', input: normalizeMedia(input), status, createdAt: old, expiresAt: Date.now() + 60000 };
    if (status === 'completed') job.output = { filename: 'media.mp4', size: 4 };
    await mkdir(path.join(directory, job.id));
    await writeFile(path.join(directory, job.id, 'job.json'), JSON.stringify(job));
    await writeFile(path.join(directory, job.id, 'media.mp4'), 'test');
    return job;
  };
  const interrupted = await makeJob('processing'); const completed = await makeJob('completed');
  const { app } = await createApplication({ directory, apiKey }, false);
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  const jobs = app.get(DownloadsService);
  assert.equal(jobs.get(interrupted.id, 'alice').status, 'failed');
  assert.equal(jobs.get(completed.id, 'alice').status, 'completed');
  assert.equal(await readFile(path.join(directory, completed.id, 'media.mp4'), 'utf8'), 'test');
  jobs.items.get(completed.id).expiresAt = Date.now() - 1;
  assert.throws(() => jobs.get(completed.id, 'alice'), { status: 404 });
  await jobs.cleanup();
  await assert.rejects(readFile(path.join(directory, completed.id, 'job.json')), { code: 'ENOENT' });
});


test('FallbackController provides SPA routing, 404 handling, and smart extraction/job fallback', async t => {
  const { app, request, fallback, jobs } = await setup(t);
  
  // 1. GET /v1/fallback metadata info
  const infoRes = await request('/v1/fallback');
  assert.equal(infoRes.status, 200);
  const info = await infoRes.json();
  assert.equal(info.status, 'ready');
  assert.deepEqual(info.strategies, ['extract', 'job', 'stream-proxy']);

  // 2. SPA client navigation fallback returns 200 with HTML
  const spaRes = await request('/downloads');
  assert.equal(spaRes.status, 200);
  const html = await spaRes.text();
  assert.ok(html.includes('YTDownloader'));

  // 3. Unhandled /v1 API routes throw 404 JSON
  const notFoundRes = await request('/v1/unknown-endpoint');
  assert.equal(notFoundRes.status, 404);
  const notFoundJson = await notFoundRes.json();
  assert.equal(notFoundJson.statusCode, 404);

  // 4. POST /v1/fallback requires authentication
  const unauthRes = await request('/v1/fallback', { method: 'POST', headers: { Authorization: '' } });
  assert.equal(unauthRes.status, 401);

  // 5. POST /v1/fallback attempts instant direct extraction
  const extractFallback = await fallback({ url: input.url, format: 'mp4' });
  assert.equal(extractFallback.status, 200);
  const extractData = await extractFallback.json();
  assert.equal(extractData.mode, 'extract');
  assert.equal(extractData.extract.id, 'test-id');
  assert.ok(extractData.extract.download.video);

  // 6. POST /v1/fallback with TikTok MP4 falls back to server transcode job
  const tiktokFallback = await fallback({ url: 'https://www.tiktok.com/@creator/video/1234567890', format: 'mp4' });
  assert.equal(tiktokFallback.status, 200);
  const tiktokData = await tiktokFallback.json();
  assert.equal(tiktokData.mode, 'job');
  assert.ok(tiktokData.job.id);
  assert.equal(tiktokData.job.platform, 'tiktok');

  // 7. GET /v1/stream parameter validation and SSRF prevention
  const noUrlRes = await request('/v1/stream');
  assert.equal(noUrlRes.status, 400);

  const localRes = await request('/v1/stream?url=' + encodeURIComponent('http://127.0.0.1/secret'));
  assert.equal(localRes.status, 400);

  const invalidProto = await request('/v1/stream?url=' + encodeURIComponent('file:///etc/passwd'));
  assert.equal(invalidProto.status, 400);

});
