const $ = id => document.getElementById(id);
let count = 0;


fetch('/v1/platforms').then(response => {
  if (!response.ok) throw new Error('Platform list unavailable.');
  return response.json();
}).then(platforms => {
  for (const platform of platforms) {
    const badge = document.createElement('span');
    badge.className = 'platform'; badge.textContent = platform.name; badge.title = platform.notes;
    $('platforms').append(badge);
  }
}).catch(() => { $('platforms').textContent = 'See the API documentation for supported platforms.'; });

async function request(url, key, options = {}) {
  const response = await fetch(url, { ...options, headers: { Authorization: `Bearer ${key}`, ...(options.body ? { 'Content-Type': 'application/json' } : {}) } });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || `Request failed (${response.status}).`);
  }
  return response;
}

$('service-type').addEventListener('change', () => {
  const isJobs = $('service-type').value === 'jobs';
  $('format-wrapper').style.display = isJobs ? 'block' : 'none';
  $('quality-row').style.display = isJobs ? 'flex' : 'none';
  $('service-hint').textContent = isJobs
    ? 'Server processes media: merges video+audio or extracts MP3. Stored for 1 hour.'
    : 'Instant extraction: returns direct CDN stream URLs and all available qualities without using server storage.';
});

$('format').addEventListener('change', () => {
  const isMp4 = $('format').value === 'mp4';
  $('quality-wrapper').style.display = isMp4 ? 'block' : 'none';
  $('audio-quality-wrapper').style.display = isMp4 ? 'none' : 'block';
});

function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (bytes >= 1024 && i < units.length - 1) { bytes /= 1024; i++; }
  return ` · ${bytes.toFixed(1)} ${units[i]}`;
}

$('download-form').addEventListener('submit', async event => {
  event.preventDefault();
  const key = $('key').value.trim();
  const url = $('url').value.trim();
  const serviceType = $('service-type').value;

  $('submit').disabled = true;
  $('message').textContent = '';

  try {
    if (serviceType === 'extract') {
      const result = await (await request('/v1/extract', key, {
        method: 'POST',
        body: JSON.stringify({ url })
      })).json();

      if (!count++) $('jobs').replaceChildren();
      $('count').textContent = `${count} result${count === 1 ? '' : 's'}`;

      const row = document.createElement('article'); row.className = 'job';
      const content = document.createElement('div');
      content.style.maxWidth = '100%';

      const title = document.createElement('strong');
      title.textContent = `[${result.platform.toUpperCase()}] ${result.title || 'Media Info'}`;
      content.append(title);

      const authorName = result.author?.name || result.uploader || '';
      const meta = document.createElement('p');
      meta.textContent = `${result.durationFormatted || '00:00'} · ${authorName}`;
      content.append(meta);

      if (result.platform === 'tiktok') {
        const note = document.createElement('div');
        note.style.margin = '8px 0';
        note.style.padding = '8px 12px';
        note.style.background = '#451a03';
        note.style.color = '#fed7aa';
        note.style.borderRadius = '6px';
        note.style.fontSize = '12px';
        note.style.lineHeight = '1.4';
        note.innerHTML = '⚠️ <strong>TikTok CDN Note:</strong> TikTok protects raw stream links with anti-hotlinking tokens and Akamai security, which blocks direct browser clicks with "Access Denied". Use <strong>"⚡ Convert &amp; Download via Server"</strong> below for a direct 1-click browser download, or fetch direct links using the provided HTTP headers.';
        content.append(note);
      }

      const shortcuts = document.createElement('div');
      shortcuts.style.margin = '8px 0';
      shortcuts.style.display = 'flex';
      shortcuts.style.flexWrap = 'wrap';
      shortcuts.style.gap = '8px';

      const serverBtn = document.createElement('button');
      serverBtn.type = 'button';
      serverBtn.textContent = '⚡ Convert & Download via Server (MP4)';
      serverBtn.style.padding = '6px 12px';
      serverBtn.style.background = '#ea580c';
      serverBtn.style.color = '#fff';
      serverBtn.style.border = 'none';
      serverBtn.style.borderRadius = '6px';
      serverBtn.style.fontWeight = 'bold';
      serverBtn.style.fontSize = '13px';
      serverBtn.style.cursor = 'pointer';
      serverBtn.onclick = () => {
        $('service-type').value = 'jobs';
        $('format').value = 'mp4';
        $('format-wrapper').style.display = 'block';
        $('quality-row').style.display = 'flex';
        $('download-form').dispatchEvent(new Event('submit'));
      };
      shortcuts.append(serverBtn);

      if (result.download?.video) {
        const btnV = document.createElement('a');
        btnV.href = result.download.video;
        btnV.target = '_blank';
        btnV.rel = 'noreferrer';
        btnV.referrerPolicy = 'no-referrer';
        btnV.textContent = '★ Best Direct Video ↓';
        btnV.style.padding = '6px 12px';
        btnV.style.background = '#16a34a';
        btnV.style.color = '#fff';
        btnV.style.borderRadius = '6px';
        btnV.style.textDecoration = 'none';
        btnV.style.fontWeight = 'bold';
        btnV.style.fontSize = '13px';
        shortcuts.append(btnV);
      }

      if (result.download?.audio) {
        const btnA = document.createElement('a');
        btnA.href = result.download.audio;
        btnA.target = '_blank';
        btnA.rel = 'noreferrer';
        btnA.referrerPolicy = 'no-referrer';
        btnA.textContent = '★ Best Direct Audio ↓';
        btnA.style.padding = '6px 12px';
        btnA.style.background = '#9333ea';
        btnA.style.color = '#fff';
        btnA.style.borderRadius = '6px';
        btnA.style.textDecoration = 'none';
        btnA.style.fontWeight = 'bold';
        btnA.style.fontSize = '13px';
        shortcuts.append(btnA);
      }

      content.append(shortcuts);

      const streams = document.createElement('div');
      streams.style.marginTop = '8px';
      streams.style.display = 'flex';
      streams.style.flexWrap = 'wrap';
      streams.style.gap = '6px';

      const mediaItems = result.medias || result.formats || [];
      for (const fmt of mediaItems) {
        const link = document.createElement('a');
        link.href = fmt.url;
        link.target = '_blank';
        link.rel = 'noreferrer';
        link.referrerPolicy = 'no-referrer';
        const sizeText = fmt.filesizeFormatted ? ` · ${fmt.filesizeFormatted}` : (fmt.filesize ? formatBytes(fmt.filesize) : '');
        link.textContent = `${fmt.quality} (${fmt.ext})${sizeText} ↓`;
        link.style.display = 'inline-block';
        link.style.padding = '4px 8px';
        link.style.background = fmt.type === 'video' ? '#2563eb' : '#475569';
        link.style.color = '#fff';
        link.style.borderRadius = '4px';
        link.style.textDecoration = 'none';
        link.style.fontSize = '12px';
        streams.append(link);
      }

      content.append(streams);
      row.append(content);
      $('jobs').prepend(row);

    } else {
      const format = $('format').value;
      const quality = Number($('quality').value);
      const audioQuality = $('audio-quality').value;

      const job = await (await request('/v1/jobs', key, {
        method: 'POST',
        body: JSON.stringify({ url, format, quality, audioQuality })
      })).json();

      if (!count++) $('jobs').replaceChildren();
      $('count').textContent = `${count} job${count === 1 ? '' : 's'}`;

      const row = document.createElement('article'); row.className = 'job';
      const content = document.createElement('div');
      const title = document.createElement('strong');
      title.textContent = `${job.format.toUpperCase()} (${job.format === 'mp4' ? quality + 'p' : audioQuality}) download`;
      const status = document.createElement('p');
      content.append(title, status); row.append(content); $('jobs').prepend(row);

      const cancel = document.createElement('button'); cancel.textContent = 'Cancel'; row.append(cancel);
      cancel.addEventListener('click', async () => {
        cancel.disabled = true;
        try { await request(`/v1/jobs/${job.id}`, key, { method: 'DELETE' }); }
        catch (error) { status.textContent = error.message; cancel.disabled = false; }
      });

      const poll = async () => {
        try {
          const current = await (await request(`/v1/jobs/${job.id}`, key)).json();
          status.textContent = current.error || `${current.status} · ${job.id.slice(0, 8)}`;
          if (['completed', 'failed', 'cancelled'].includes(current.status)) cancel.remove();
          if (current.status === 'completed') {
            const button = document.createElement('button'); button.textContent = 'Save file ↓';
            button.addEventListener('click', async () => {
              button.disabled = true;
              try {
                const blob = await (await request(current.downloadPath, key)).blob();
                const href = URL.createObjectURL(blob);
                const link = document.createElement('a'); link.href = href; link.download = `${job.id}.${job.format}`; link.click();
                setTimeout(() => URL.revokeObjectURL(href), 60000);
              } catch (error) { status.textContent = error.message; }
              finally { button.disabled = false; }
            });
            row.append(button);
          } else if (!['failed', 'cancelled'].includes(current.status)) setTimeout(poll, 3000);
        } catch (error) { status.textContent = error.message; }
      };
      await poll();
    }
  } catch (error) { $('message').textContent = error.message; }
  finally { $('submit').disabled = false; }
});
