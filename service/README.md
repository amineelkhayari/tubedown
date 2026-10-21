# YTDownloader NestJS media API

This folder contains a NestJS 11 + TypeScript API alongside the Electron application, with Swagger UI, validated DTOs, authentication guards, asynchronous downloads, persistent job records, cancellation, retention cleanup, and a browser client. Outputs are MP4 up to 1080p and MP3 at 128 kbps. No Electron code runs in the browser.

## Structure

- `src/bootstrap.ts`, `src/main.ts`, `src/app.module.ts`: application setup, Swagger, validation, security headers and module composition.
- `src/auth/`: direct bearer and RapidAPI proxy authentication, plus submission rate limiting.
- `src/downloads/`: DTOs, REST controller, persisted queue, cancellation and file streaming.
- `src/media/`: platform URL rules, yt-dlp arguments, subprocess handling and executable discovery.
- `src/health/`: liveness and media-tool/disk readiness checks.
- `public/`: browser download interface and enabled-platform list.
- `test/`: Node test runner integration tests against real Nest HTTP endpoints with fake media execution.

## Enabled media platforms

| Platform | Accepted content | Output |
| --- | --- | --- |
| YouTube | Individual videos and Shorts | MP4, MP3 |
| Vimeo | Public individual videos | MP4, MP3 |
| Dailymotion | Individual video links, including dai.ly | MP4, MP3 |
| TikTok | Full @creator/video/id links | MP4, MP3 |
| Instagram | Public reel and video-post links | MP4, MP3 |
| Facebook | Public watch, videos and reel links | MP4, MP3 |
| X / Twitter | Public status links containing video | MP4, MP3 |
| Twitch | Public VOD and clip links | MP4, MP3 |
| SoundCloud | Individual public track links | MP3 only |

`GET /v1/platforms` is the source of truth for enabled hosts, URL examples and limitations. Enabled means that URL validation and yt-dlp routing are implemented; it does not guarantee extraction of every video. No arbitrary URL forwarding, playlists, private content, user cookies, DRM bypass, live streams, Instagram stories, or TikTok shortened links are provided. Platform entries remain `liveVerified: false` until separately qualified on the deployment host. yt-dlp's own broader [supported-site list](https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md) does not expand this API's allowlist.

## Run locally

Node.js 22+ is required. Install dependencies with `npm --prefix service ci`. On Windows, run `npm --prefix service run tools:install`: this downloads yt-dlp, FFmpeg and FFprobe into `service/tools`, verifies publisher SHA-256 checksums, and leaves the system PATH unchanged. Binaries and licenses stay local and are ignored by Git. On Linux/macOS, install yt-dlp with its default dependencies and FFmpeg/FFprobe on PATH, or use Docker. `YTDLP_PATH`, `FFMPEG_PATH` and `FFPROBE_PATH` override discovery; paths may be absolute or relative to the service folder. Explicit paths take precedence over the bundled executables. Node's current executable is passed to yt-dlp as its JavaScript runtime.

PowerShell, from the repository root:

```powershell
$env:API_KEY = node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
npm --prefix service start
```

Open http://127.0.0.1:3000 for the web client or http://127.0.0.1:3000/docs for Swagger UI. In Swagger, select Authorize and enter the direct API key without the `Bearer` prefix. Alternatively, put configuration in `service/.env` (see `.env.example`); `npm start` loads it. Do not replace an existing key just to install media tools. `npm run start:dev` watches TypeScript using Nest CLI and requires environment variables to be set in the shell.

The web page is a private operator/developer interface: no public signup, password reset or direct billing. Keys are not embedded in frontend assets or persisted in localStorage. Do not share the operator key with customers. RapidAPI consumers use the gateway instead.

Run automated tests with `npm --prefix service test`. They use isolated temporary directories and fake media processing; they do not download media.

## API

- `POST /v1/extract` — JSON `{ "url": "https://..." }`; returns HTTP 200 immediately with standardized metadata, direct streaming CDN links, and available resolutions (no server storage).
- `POST /v1/jobs` — JSON `{ "url": "https://www.youtube.com/watch?v=VIDEO_ID", "format": "mp4", "quality": 1080, "audioQuality": "320k" }`; returns HTTP 202 and a job ID for server-side merging.
- `GET /v1/jobs` — latest 100 unexpired jobs for the authenticated consumer.
- `GET /v1/jobs/{id}` — poll every three seconds for queued, processing, completed, failed, or cancelled state.
- `DELETE /v1/jobs/{id}` — cancel queued/running work; repeated cancellation is idempotent.
- `GET /v1/jobs/{id}/file` — authenticated binary output after completion.
- `GET /v1/platforms` — public media-platform registry.
- `GET /health` — process liveness.
- `GET /health/ready` — checks yt-dlp, FFmpeg, FFprobe and at least 512 MiB of free disk space; it does not check provider availability.
- `GET /docs` — interactive Swagger UI.
- `GET /openapi.json` and `/openapi.yaml` — generated specifications. Set `PUBLIC_API_URL` for the public server URL; defaults to the same origin.

Run `npm --prefix service run openapi:export` to refresh the committed OpenAPI snapshot. The live documentation is always generated from Nest decorators.

### Missing media tools

HTTP 503 on submission with `Unavailable media tools` means the server cannot execute one of the required binaries. Install the tools, restart the service, and verify `/health/ready` returns `{"status":"ready"}`. Then submit a new `POST /v1/jobs`; an existing failed job is not retried automatically. Successful readiness does not guarantee provider access or downloadable formats.

Direct access uses `Authorization: Bearer <API_KEY>`. Each RapidAPI consumer has separate job ownership. Missing jobs, other customers' jobs, and expired jobs all return 404. Submission limits: five attempts/minute/consumer, three active jobs/consumer, twenty active jobs globally, two concurrent workers. Failed submission attempts count toward the minute limit. Polls/file downloads are not locally metered. Jobs time out after fifteen minutes; output retention is one hour after completion/failure. Startup marks interrupted jobs failed, preserving completed jobs.

## Docker

From the repository root, after setting API_KEY:

```powershell
docker compose -f service/compose.yaml up --build -d
```

The container runs without root privileges, drops capabilities, has CPU/memory/PID limits and a read-only root filesystem. A volume persists jobs and output. Its port binds only to host loopback; put an HTTPS reverse proxy in front for deployment. Run ONE replica against each data directory: the queue and rate limits are process-local. No Redis or external database is required for this first version. For multiple replicas, migrate job state, queue, quotas, and file storage to shared services.

The image installs yt-dlp at build time. Record/pin a tested yt-dlp version before a release and periodically rebuild after compatibility testing.

## RapidAPI setup

1. Deploy on a Linux host with HTTPS and working outbound access to the media provider.
2. Set PUBLIC_API_URL, import the generated specification, and configure the base URL in the provider dashboard.
3. Configure RapidAPI Auth for customers. Remove the imported `direct-key` bearer requirement in the RapidAPI listing; it is for the private direct-access interface only.
4. Copy the provider dashboard's proxy secret into the server-only `RAPIDAPI_PROXY_SECRET` environment variable. The server verifies `X-RapidAPI-Proxy-Secret` before trusting `X-RapidAPI-User`. Customers send their own gateway key and host headers to RapidAPI, never your proxy secret or operator key.
5. Test with two separate consumer identities: job creation, status, file retrieval, quota rejection, and cross-customer access denial.
6. Configure plans and quotas in RapidAPI. Explicitly decide whether polling and file requests count toward the plan. Measure processing, bandwidth, and storage costs before setting paid allowances.

Official references: [authentication](https://docs.rapidapi.com/docs/configuring-api-security), [proxy protection](https://docs.rapidapi.com/v2.0/docs/security-threat-protection), [additional gateway headers](https://docs.rapidapi.com/v2.0/docs/additional-request-headers), [plans](https://docs.rapidapi.com/v1.0/docs/plans-pricing).

## Remaining work before a paid launch

- Run real downloads on the deployment host. Media providers can reject datacenter traffic, require sign-in, or change extraction behavior. This implementation does not bypass those restrictions or accept cookies.
- Verify RapidAPI's actual file-size/response-time behavior for your listing. Large binary downloads may require a private object store and short-lived, consumer-authorized download URLs instead of proxying files.
- Enforce outbound network rules blocking private, loopback, link-local, metadata, and internal networks, including IPv6. Input URLs are restricted to a fixed platform/URL allowlist; this is not a complete egress sandbox for extractor requests and redirects.
- Apply a hard filesystem quota to the data volume. yt-dlp's source size checks and the final 200 MiB check do not cap aggregate temporary files, unknown-length downloads, or transcoding disk usage. Add monitoring, disk alarms, per-customer usage accounting, bounded retention for corrupted/orphan directories, and a support process.
- Add idempotency keys before enabling automatic client retries on charged job submissions. Local rate counters reset on restart; RapidAPI billing quotas must be configured independently.
- If offering a public SaaS website, add customer authentication, per-user keys, billing/entitlements and persistent user history. The current browser page is a private API client.
- This repository includes a GPL-3.0 license. Preserve license/attribution notices and review the distribution model and media providers' terms before commercial launch.

No hosting account, RapidAPI listing, subscription plan, or payment configuration is created by these files.
