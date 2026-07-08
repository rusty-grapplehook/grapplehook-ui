/* global grapplehook */
'use strict';

const $ = (id) => document.getElementById(id);
const els = {
  url: $('url'),
  fetch: $('fetch'),
  fetchError: $('fetch-error'),
  info: $('info'),
  thumb: $('thumb'),
  title: $('title'),
  subtitle: $('subtitle'),
  quality: $('quality'),
  mode: $('mode'),
  outdir: $('outdir'),
  chooseDir: $('choose-dir'),
  filename: $('filename'),
  start: $('start'),
  downloads: $('downloads'),
  tools: $('tools'),
  template: $('task-template'),
};
const STAGE_LABEL = { info: 'Preparing…', download: 'Downloading', transcode: 'Transcoding', done: 'Done' };

// ---------------------------------------------------------------------------
// Tool availability pills
// ---------------------------------------------------------------------------
grapplehook.checkTools().then((t) => {
  for (const pill of els.tools.querySelectorAll('.pill')) {
    const ok = t[pill.dataset.tool];

    pill.classList.add(ok ? 'ok' : 'bad');
    pill.title = ok ? 'Found' : 'Not found on PATH';
  }
});

// ---------------------------------------------------------------------------
// Fetch info
// ---------------------------------------------------------------------------
let currentInfo = null;

async function fetchInfo() {
  const url = els.url.value.trim();

  if (!url) {
    return;
  }

  els.fetchError.hidden = true;
  els.fetch.disabled = true;
  els.fetch.textContent = 'Fetching…';

  try {
    currentInfo = await grapplehook.getInfo(url);
    renderInfo(currentInfo);
  } catch (err) {
    currentInfo = null;
    els.info.hidden = true;
    els.fetchError.textContent = String(err.message || err).replace(/^Error invoking remote method [^:]+:\s*/, '');
    els.fetchError.hidden = false;
  } finally {
    els.fetch.disabled = false;
    els.fetch.textContent = 'Fetch info';
  }
}

function renderInfo(info) {
  els.title.textContent = info.title || 'Untitled';

  const bits = [];

  if (info.uploader) {
    bits.push(info.uploader);
  }

  if (info.durationSeconds != null) {
    bits.push(formatDuration(info.durationSeconds));
  }

  els.subtitle.textContent = bits.join(' · ');

  if (info.thumbnail) {
    els.thumb.src = info.thumbnail;
    els.thumb.hidden = false;
  } else {
    els.thumb.hidden = true;
  }

  els.quality.replaceChildren(new Option('Best available', 'best'));

  for (const h of info.heights) {
    els.quality.add(new Option(`${h}p`, `${h}p`));
  }

  els.quality.add(new Option('Worst (smallest)', 'worst'));

  els.info.hidden = false;
}

els.fetch.addEventListener('click', fetchInfo);
els.url.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    fetchInfo();
  }
});

// ---------------------------------------------------------------------------
// Output directory
// ---------------------------------------------------------------------------
els.chooseDir.addEventListener('click', async () => {
  const dir = await grapplehook.chooseDir();

  if (dir) {
    els.outdir.value = dir;
  }
});

// ---------------------------------------------------------------------------
// Start download
// ---------------------------------------------------------------------------
const taskViews = new Map(); // taskId -> { root, fill, hook, cable, stage, stats, cancelBtn, openBtn }

els.start.addEventListener('click', async () => {
  if (!currentInfo) {
    return;
  }

  if (!els.outdir.value) {
    els.outdir.focus();
    els.outdir.placeholder = 'Pick a folder first';

    return;
  }

  const mode = els.mode.value;
  const opts = {
    url: els.url.value.trim(),
    outputDir: els.outdir.value,
    quality: els.quality.value,
    audioOnly: mode === 'audio',
    toMp4: mode === 'mp4',
    filename: els.filename.value.trim() || undefined,
  };
  const taskId = await grapplehook.start(opts);

  addTaskView(taskId, currentInfo.title || opts.url);
});

function addTaskView(taskId, title) {
  const frag = els.template.content.cloneNode(true);
  const root = frag.querySelector('.task');
  const view = {
    root,
    cable: frag.querySelector('.cable'),
    fill: frag.querySelector('.cable-fill'),
    hook: frag.querySelector('.cable-hook'),
    stage: frag.querySelector('.task-stage'),
    stats: frag.querySelector('.task-stats'),
    cancelBtn: frag.querySelector('.task-cancel'),
    openBtn: frag.querySelector('.task-open'),
  };

  frag.querySelector('.task-title').textContent = title;
  view.stage.textContent = STAGE_LABEL.info;
  view.cable.classList.add('indeterminate');
  view.cancelBtn.addEventListener('click', () => {
    view.cancelBtn.disabled = true;
    view.cancelBtn.textContent = 'Cancelling…';
    grapplehook.cancel(taskId);
  });
  taskViews.set(taskId, view);
  els.downloads.prepend(frag);
}

// ---------------------------------------------------------------------------
// Progress / done streams from main
// ---------------------------------------------------------------------------
grapplehook.onProgress((p) => {
  const v = taskViews.get(p.taskId);

  if (!v || v.root.classList.contains('settled')) {
    return;
  }

  v.stage.textContent = STAGE_LABEL[p.stage] ?? p.stage;

  if (p.percent == null) {
    v.cable.classList.add('indeterminate');
    v.cable.removeAttribute('aria-valuenow');
  } else {
    v.cable.classList.remove('indeterminate');
    v.cable.setAttribute('aria-valuenow', String(Math.round(p.percent)));
    v.fill.style.width = `${p.percent}%`;
    v.hook.style.left = `${p.percent}%`;
  }

  const bits = [];

  if (p.percent != null) {
    bits.push(`${p.percent.toFixed(0)}%`);
  }

  if (p.downloadedBytes != null && p.totalBytes != null) {
    bits.push(`${formatBytes(p.downloadedBytes)} / ${formatBytes(p.totalBytes)}`);
  }

  if (p.speed != null) {
    bits.push(`${formatBytes(p.speed)}/s`);
  }

  if (p.eta != null) {
    bits.push(`ETA ${formatDuration(p.eta)}`);
  }

  v.stats.textContent = bits.join('  ·  ');
});

grapplehook.onDone((d) => {
  const v = taskViews.get(d.taskId);

  if (!v) {
    return;
  }

  v.root.classList.add('settled');
  v.cable.classList.remove('indeterminate');
  v.cancelBtn.hidden = true;

  if (d.ok) {
    v.root.classList.add('done');
    v.stage.textContent = 'Done';
    v.fill.style.width = '100%';
    v.hook.style.left = '100%';
    v.stats.textContent = d.outputPath;
    v.openBtn.hidden = false;
    v.openBtn.addEventListener('click', () => grapplehook.openPath(d.outputPath));
  } else if (d.cancelled) {
    v.stage.textContent = 'Cancelled';
    v.stats.textContent = '';
  } else {
    v.root.classList.add('failed');
    v.stage.textContent = 'Failed';
    v.stats.textContent = d.error ?? 'Unknown error';
  }
});

grapplehook.checkUpdate().then((u) => {
  if (!u.updateAvailable) {
    return;
  }

  const pill = document.createElement('button');

  pill.className = 'pill update';
  pill.textContent = `v${u.latestVersion} available`;
  pill.title = 'Open the releases page';
  pill.addEventListener('click', () => grapplehook.openReleases());
  els.tools.prepend(pill);
});

// ---------------------------------------------------------------------------
function formatBytes(n) {
  if (!Number.isFinite(n) || n < 0) {
    return '?';
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];

  let v = n,
    i = 0;

  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }

  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

function formatDuration(sec) {
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');

  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}
