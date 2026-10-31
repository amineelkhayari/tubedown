// YTDownloader Studio Client Application
const $ = id => document.getElementById(id);

let activeJobs = new Map();
let currentKey = localStorage.getItem('ytd_api_key') || '';

// Initialize UI on DOMContentLoaded
document.addEventListener('DOMContentLoaded', () => {
  initAuth();
  initHealthCheck();
  initPlatforms();
  initFormInteractions();
  initJobsList();
});

// Helper for HTTP requests
async function apiRequest(url, options = {}) {
  const key = $('key').value.trim() || currentKey;
  const headers = {
    ...(options.headers || {}),
    ...(key ? { Authorization: `Bearer ${key}` } : {}),
  };

  if (options.body && typeof options.body === 'string') {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(url, { ...options, headers });
  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    const message = errorBody.error || `HTTP ${response.status}: ${response.statusText}`;
    throw new Error(message);
  }
  return response;
}

// Format bytes into human-readable text
function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let val = bytes;
  while (val >= 1024 && i < units.length - 1) {
    val /= 1024;
    i++;
  }
  return `${val.toFixed(1)} ${units[i]}`;
}

// Show alert message
function showAlert(message, type = 'info') {
  const alert = $('alert-box');
  alert.className = `alert ${type}`;
  alert.textContent = message;
  alert.style.display = 'block';
}

function clearAlert() {
  const alert = $('alert-box');
  alert.textContent = '';
  alert.style.display = 'none';
}

// Authentication handling
function initAuth() {
  const keyInput = $('key');
  if (currentKey) {
    keyInput.value = currentKey;
    $('auth-status-text').textContent = 'Key saved in localStorage';
    $('auth-status-text').style.color = '#10b981';
  }

  $('toggle-key').addEventListener('click', () => {
    const isPassword = keyInput.type === 'password';
    keyInput.type = isPassword ? 'text' : 'password';
    $('toggle-key').textContent = isPassword ? '🔒 Hide' : '👁️ Show';
  });

  $('test-key').addEventListener('click', async () => {
    const key = keyInput.value.trim();
    if (!key) {
      localStorage.removeItem('ytd_api_key');
      currentKey = '';
      $('auth-status-text').textContent = 'Key cleared';
      $('auth-status-text').style.color = 'var(--text-muted)';
      showAlert('API key cleared.', 'info');
      return;
    }

    $('auth-status-text').textContent = 'Validating key...';
    try {
      await apiRequest('/v1/jobs', { method: 'GET', headers: { Authorization: `Bearer ${key}` } });
      localStorage.setItem('ytd_api_key', key);
      currentKey = key;
      $('auth-status-text').textContent = '✓ Authenticated successfully';
      $('auth-status-text').style.color = '#10b981';
      showAlert('API key verified and saved.', 'success');
      loadRecentJobs();
    } catch (err) {
      $('auth-status-text').textContent = '✕ Invalid API Key';
      $('auth-status-text').style.color = '#ef4444';
      showAlert(`Authentication check failed: ${err.message}`, 'error');
    }
  });
}

// Service readiness & health probe
async function initHealthCheck() {
  const dot = document.querySelector('.status-dot');
  const label = $('health-label');

  try {
    const res = await fetch('/health/ready');
    if (res.ok) {
      dot.className = 'status-dot online';
      label.textContent = 'Online · yt-dlp & FFmpeg Ready';
    } else {
      dot.className = 'status-dot offline';
      label.textContent = 'Degraded · Tools Missing';
    }
  } catch {
    dot.className = 'status-dot offline';
    label.textContent = 'Server Offline';
  }
}

// Load and render supported platforms
async function initPlatforms() {
  const container = $('platforms-grid');
  try {
    const res = await fetch('/v1/platforms');
    if (!res.ok) throw new Error('Platforms endpoint unavailable');
    const platforms = await res.json();

    container.innerHTML = '';
    for (const p of platforms) {
      const card = document.createElement('div');
      card.className = 'platform-card';
      card.title = `Click to test ${p.name} with sample URL`;

      const header = document.createElement('div');
      header.className = 'platform-card-header';
      header.innerHTML = `
        <span class="platform-card-name">${p.name}</span>
        <span class="platform-formats-badge">${(p.formats || []).join(' / ').toUpperCase()}</span>
      `;

      const notes = document.createElement('div');
      notes.className = 'platform-card-notes';
      notes.textContent = p.notes || '';

      const action = document.createElement('div');
      action.className = 'platform-card-action';
      action.textContent = 'Try sample URL ↗';

      card.append(header, notes, action);

      card.addEventListener('click', () => {
        $('url').value = p.example;
        if (p.id === 'soundcloud') {
          $('format').value = 'mp3';
          $('quality-wrapper').style.display = 'none';
          $('audio-quality-wrapper').style.display = 'block';
        } else {
          $('format').value = 'mp4';
          $('quality-wrapper').style.display = 'block';
          $('audio-quality-wrapper').style.display = 'none';
        }
        $('url').focus();
        $('url').scrollIntoView({ behavior: 'smooth', block: 'center' });
      });

      container.appendChild(card);
    }
  } catch {
    container.innerHTML = '<p class="empty-state">Unable to load platforms. Check API connection.</p>';
  }
}

// Form options switching
function initFormInteractions() {
  const serviceType = $('service-type');
  const format = $('format');
  const formatWrapper = $('format-wrapper');
  const qualityRow = $('quality-row');
  const qualityWrapper = $('quality-wrapper');
  const audioQualityWrapper = $('audio-quality-wrapper');
  const modeHint = $('mode-hint');

  function updateFormState() {
    const mode = serviceType.value;
    if (mode === 'extract') {
      formatWrapper.style.display = 'none';
      qualityRow.style.display = 'none';
      modeHint.textContent = 'Instant direct extraction: Returns direct CDN stream URLs, author, thumbnail, and all resolutions in 1–2s.';
    } else if (mode === 'jobs') {
      formatWrapper.style.display = 'block';
      qualityRow.style.display = 'grid';
      const isMp4 = format.value === 'mp4';
      qualityWrapper.style.display = isMp4 ? 'block' : 'none';
      audioQualityWrapper.style.display = isMp4 ? 'none' : 'block';
      modeHint.textContent = 'Server transcode: Asynchronous background worker downloads, merges, and converts files into single clean MP4/MP3.';
    } else {
      // 'fallback' (Smart Auto)
      formatWrapper.style.display = 'block';
      qualityRow.style.display = 'grid';
      const isMp4 = format.value === 'mp4';
      qualityWrapper.style.display = isMp4 ? 'block' : 'none';
      audioQualityWrapper.style.display = isMp4 ? 'none' : 'block';
      modeHint.textContent = 'Smart Auto Pipeline: Attempts instant CDN extraction first. If access is restricted (e.g. TikTok Akamai 403), seamlessly falls back to server transcode.';
    }
  }

  serviceType.addEventListener('change', updateFormState);
  format.addEventListener('change', updateFormState);
  updateFormState();

  // Submit Handler
  $('download-form').addEventListener('submit', handleFormSubmit);
}

// Form Submission
async function handleFormSubmit(event) {
  event.preventDefault();
  clearAlert();

  const url = $('url').value.trim();
  const serviceType = $('service-type').value;
  const format = $('format').value;
  const quality = Number($('quality').value);
  const audioQuality = $('audio-quality').value;

  if (!url) {
    showAlert('Please enter a valid media URL.', 'error');
    return;
  }

  const submitBtn = $('submit');
  submitBtn.disabled = true;
  $('submit-icon').textContent = '⏳';

  try {
    if (serviceType === 'fallback') {
      // Smart Auto Fallback Endpoint
      const response = await apiRequest('/v1/fallback', {
        method: 'POST',
        body: JSON.stringify({ url, format, quality, audioQuality }),
      });
      const data = await response.json();

      if (data.mode === 'extract' && data.extract) {
        showAlert(data.message || 'Direct media links extracted successfully!', 'success');
        renderExtractResult(data.extract);
      } else if (data.mode === 'job' && data.job) {
        showAlert(data.message || 'Fallback to server transcode job created.', 'info');
        trackJob(data.job);
      }
    } else if (serviceType === 'extract') {
      // Direct Extract Endpoint
      const response = await apiRequest('/v1/extract', {
        method: 'POST',
        body: JSON.stringify({ url }),
      });
      const data = await response.json();
      showAlert('Direct stream links extracted successfully!', 'success');
      renderExtractResult(data);
    } else {
      // Transcode Jobs Endpoint
      const response = await apiRequest('/v1/jobs', {
        method: 'POST',
        body: JSON.stringify({ url, format, quality, audioQuality }),
      });
      const job = await response.json();
      showAlert(`Transcode job #${job.id.slice(0, 8)} queued successfully.`, 'info');
      trackJob(job);
    }
  } catch (err) {
    showAlert(`Request failed: ${err.message}`, 'error');
  } finally {
    submitBtn.disabled = false;
    $('submit-icon').textContent = '↗';
  }
}

// Render media extraction result
function renderExtractResult(result) {
  const area = $('extract-results-area');
  const container = $('extract-container');
  area.style.display = 'block';
  container.innerHTML = '';

  const card = document.createElement('div');
  card.className = 'media-card';

  // Resolve playable media stream
  const videoUrl = result.download?.video ||
                   result.bestVideo?.url ||
                   (result.medias && result.medias.find(m => m.type === 'video' && m.url)?.url) ||
                   (result.medias && result.medias[0]?.url);
  const audioUrl = result.download?.audio ||
                   result.bestAudio?.url ||
                   (result.medias && result.medias.find(m => m.type === 'audio' && m.url)?.url);
  const isAudioOnly = !videoUrl && !!audioUrl;
  const playableUrl = videoUrl || audioUrl;

  // Thumbnail Container with Click-to-Play Video
  const thumbDiv = document.createElement('div');
  thumbDiv.className = 'media-thumb-container';
  thumbDiv.title = playableUrl ? 'Click image to play video' : 'Media thumbnail';

  function renderThumbnailView() {
    thumbDiv.innerHTML = '';
    thumbDiv.classList.remove('is-playing');
    card.classList.remove('card-playing');

    if (result.thumbnail) {
      const img = document.createElement('img');
      img.src = result.thumbnail;
      img.alt = result.title || 'Media thumbnail';
      img.referrerPolicy = 'no-referrer';
      img.crossOrigin = 'anonymous';
      img.onerror = () => {
        img.style.display = 'none';
        thumbDiv.classList.add('no-image');
      };
      thumbDiv.appendChild(img);
    }

    if (playableUrl) {
      const playOverlay = document.createElement('div');
      playOverlay.className = 'thumb-play-overlay';
      playOverlay.innerHTML = `
        <div class="play-icon">▶</div>
        <span class="play-label">${isAudioOnly ? 'Play Audio' : 'Click to Play'}</span>
      `;
      thumbDiv.appendChild(playOverlay);
    }

    if (result.durationFormatted) {
      const dur = document.createElement('span');
      dur.className = 'thumb-duration';
      dur.textContent = result.durationFormatted;
      thumbDiv.appendChild(dur);
    }
  }

  function startPlayback() {
    if (!playableUrl) return;

    thumbDiv.innerHTML = '';
    thumbDiv.classList.add('is-playing');
    card.classList.add('card-playing');

    // Use backend proxy stream URL to eliminate CORS & provider hotlinking blocks
    const proxyStreamUrl = `/v1/stream?url=${encodeURIComponent(playableUrl)}&platform=${encodeURIComponent(result.platform || '')}`;

    if (isAudioOnly) {
      const audio = document.createElement('audio');
      audio.controls = true;
      audio.autoplay = true;
      audio.className = 'media-inline-player';
      audio.src = proxyStreamUrl;
      thumbDiv.appendChild(audio);
    } else {
      const video = document.createElement('video');
      video.controls = true;
      video.autoplay = true;
      video.playsInline = true;
      video.className = 'media-inline-player';
      video.src = proxyStreamUrl;

      // Handle stream errors with fallback attempt to direct URL
      let triedDirect = false;
      video.onerror = () => {
        if (!triedDirect) {
          triedDirect = true;
          console.warn('Proxy stream error, falling back to direct CDN stream URL...');
          video.src = playableUrl;
          return;
        }

        // Both proxy and direct CDN failed
        const errorBanner = document.createElement('div');
        errorBanner.className = 'player-error-banner';
        errorBanner.innerHTML = `
          <span>⚠️ Direct browser stream blocked by provider CDN (hotlink protection).</span>
          <button type="button" class="btn-sm btn-job-action">⚡ Transcode via Server</button>
        `;
        errorBanner.querySelector('button').onclick = (e) => {
          e.stopPropagation();
          $('service-type').value = 'jobs';
          $('format').value = 'mp4';
          $('service-type').dispatchEvent(new Event('change'));
          $('download-form').dispatchEvent(new Event('submit'));
        };
        thumbDiv.appendChild(errorBanner);
      };

      thumbDiv.appendChild(video);
    }

    // Close / Return to thumbnail button
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'btn-close-player';
    closeBtn.textContent = '✕ Close Video';
    closeBtn.onclick = (e) => {
      e.stopPropagation();
      renderThumbnailView();
    };
    thumbDiv.appendChild(closeBtn);
  }

  thumbDiv.addEventListener('click', (e) => {
    // Only trigger play if not already playing or clicking control
    if (!thumbDiv.classList.contains('is-playing')) {
      startPlayback();
    }
  });

  renderThumbnailView();
  card.appendChild(thumbDiv);

  // Info & Download Buttons
  const info = document.createElement('div');
  info.className = 'media-info';

  const title = document.createElement('h3');
  title.className = 'media-title';
  title.textContent = result.title || 'Untitled Media';

  const meta = document.createElement('div');
  meta.className = 'media-meta';
  const uploaderName = result.author?.name || result.uploader || '';
  meta.innerHTML = `
    <span class="platform-tag">${(result.platform || 'media').toUpperCase()}</span>
    <span>${uploaderName ? 'By ' + uploaderName : ''}</span>
    <span>${result.durationFormatted || ''}</span>
  `;

  // Shortcuts
  const shortcuts = document.createElement('div');
  shortcuts.className = 'download-shortcuts';

  if (result.download?.video) {
    const btnV = document.createElement('a');
    btnV.className = 'btn-download btn-video';
    btnV.href = result.download.video;
    btnV.target = '_blank';
    btnV.rel = 'noreferrer';
    btnV.referrerPolicy = 'no-referrer';
    btnV.textContent = '★ Best Direct Video ↓';
    shortcuts.appendChild(btnV);
  }

  if (result.download?.audio) {
    const btnA = document.createElement('a');
    btnA.className = 'btn-download btn-audio';
    btnA.href = result.download.audio;
    btnA.target = '_blank';
    btnA.rel = 'noreferrer';
    btnA.referrerPolicy = 'no-referrer';
    btnA.textContent = '★ Best Direct Audio ↓';
    shortcuts.appendChild(btnA);
  }

  // Fallback to server button
  const serverFallbackBtn = document.createElement('button');
  serverFallbackBtn.type = 'button';
  serverFallbackBtn.className = 'btn-download btn-job-action';
  serverFallbackBtn.textContent = '⚡ Transcode & Merge via Server';
  serverFallbackBtn.onclick = () => {
    $('service-type').value = 'jobs';
    $('format').value = 'mp4';
    $('service-type').dispatchEvent(new Event('change'));
    $('download-form').dispatchEvent(new Event('submit'));
  };
  shortcuts.appendChild(serverFallbackBtn);

  // Available stream formats chips
  const streamChips = document.createElement('div');
  streamChips.className = 'stream-chips';

  const formats = result.medias || result.formats || [];
  for (const fmt of formats) {
    const chip = document.createElement('a');
    chip.className = 'stream-chip';
    chip.href = fmt.url;
    chip.target = '_blank';
    chip.rel = 'noreferrer';
    chip.referrerPolicy = 'no-referrer';

    const sizeStr = fmt.filesizeFormatted || (fmt.filesize ? formatBytes(fmt.filesize) : '');
    chip.textContent = `${fmt.quality || 'Stream'} (${fmt.ext || 'bin'})${sizeStr ? ' · ' + sizeStr : ''} ↓`;
    streamChips.appendChild(chip);
  }

  info.append(title, meta, shortcuts, streamChips);
  card.appendChild(info);
  container.appendChild(card);

  area.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// Track and poll background job
function trackJob(job) {
  activeJobs.set(job.id, job);
  renderJobsList();
  pollJob(job.id);
}

async function pollJob(jobId) {
  try {
    const res = await apiRequest(`/v1/jobs/${jobId}`);
    const updated = await res.json();
    activeJobs.set(jobId, updated);
    renderJobsList();

    if (updated.status === 'queued' || updated.status === 'processing') {
      setTimeout(() => pollJob(jobId), 3000);
    }
  } catch (err) {
    console.warn(`Job poll error for ${jobId}:`, err);
  }
}

// Initialize jobs list and refresh button
function initJobsList() {
  $('refresh-jobs-btn').addEventListener('click', loadRecentJobs);
  loadRecentJobs();
}

async function loadRecentJobs() {
  try {
    const res = await apiRequest('/v1/jobs');
    const jobs = await res.json();
    for (const j of jobs) {
      if (!activeJobs.has(j.id)) {
        activeJobs.set(j.id, j);
      }
    }
    renderJobsList();
  } catch {
    // If unauthorized or empty, ignore
  }
}

// Render active jobs
function renderJobsList() {
  const container = $('jobs-container');
  const count = $('job-count');
  const jobs = Array.from(activeJobs.values()).reverse();

  count.textContent = `${jobs.length} job${jobs.length === 1 ? '' : 's'}`;

  if (jobs.length === 0) {
    container.innerHTML = '<p class="empty-state">No active transcode jobs. Submit a request above to track downloads.</p>';
    return;
  }

  container.innerHTML = '';
  for (const job of jobs) {
    const card = document.createElement('div');
    card.className = 'job-card';

    const details = document.createElement('div');
    details.className = 'job-details';

    const title = document.createElement('div');
    title.className = 'job-title';
    title.textContent = `${(job.format || 'MP4').toUpperCase()} Transcode · Job #${job.id.slice(0, 8)}`;

    const statusLine = document.createElement('div');
    statusLine.className = 'job-status-line';

    const badge = document.createElement('span');
    badge.className = `job-badge ${job.status}`;
    badge.textContent = job.status;

    const time = document.createElement('span');
    time.textContent = `Created: ${new Date(job.createdAt).toLocaleTimeString()}`;

    statusLine.append(badge, time);
    if (job.error) {
      const errSpan = document.createElement('span');
      errSpan.style.color = '#ef4444';
      errSpan.textContent = `Error: ${job.error}`;
      statusLine.appendChild(errSpan);
    }
    details.append(title, statusLine);
    card.appendChild(details);

    // Actions
    const actions = document.createElement('div');
    actions.style.display = 'flex';
    actions.style.gap = '8px';

    if (job.status === 'queued' || job.status === 'processing') {
      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'btn-sm';
      cancelBtn.style.color = '#ef4444';
      cancelBtn.textContent = 'Cancel';
      cancelBtn.onclick = async () => {
        cancelBtn.disabled = true;
        try {
          await apiRequest(`/v1/jobs/${job.id}`, { method: 'DELETE' });
          job.status = 'cancelled';
          renderJobsList();
        } catch (err) {
          showAlert(`Failed to cancel job: ${err.message}`, 'error');
          cancelBtn.disabled = false;
        }
      };
      actions.appendChild(cancelBtn);
    } else if (job.status === 'completed' && job.downloadPath) {
      const downloadBtn = document.createElement('button');
      downloadBtn.className = 'btn-sm';
      downloadBtn.style.background = '#10b981';
      downloadBtn.style.color = '#042f1a';
      downloadBtn.style.fontWeight = 'bold';
      downloadBtn.textContent = 'Save File ↓';
      downloadBtn.onclick = async () => {
        downloadBtn.disabled = true;
        downloadBtn.textContent = 'Downloading...';
        try {
          const res = await apiRequest(job.downloadPath);
          const blob = await res.blob();
          const blobUrl = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = blobUrl;
          link.download = `${job.id}.${job.format}`;
          document.body.appendChild(link);
          link.click();
          link.remove();
          setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
          downloadBtn.textContent = 'Saved ✓';
        } catch (err) {
          showAlert(`Download failed: ${err.message}`, 'error');
          downloadBtn.textContent = 'Save File ↓';
          downloadBtn.disabled = false;
        }
      };
      actions.appendChild(downloadBtn);
    }

    card.appendChild(actions);
    container.appendChild(card);
  }
}
