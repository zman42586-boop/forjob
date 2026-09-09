const STORAGE_KEY = 'autumn-job-board-v1';
const SYNC_KEY = 'autumn-job-board-sync-v1';
const stages = ['未投递', '已投递', '测评', '笔试', '一面', '二面', '三面', 'HR 面', 'Offer'];
const outcomes = ['已挂', '已拒绝', '已接受'];
const progressOptions = [...stages, ...outcomes];
let jobs = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
let filter = 'all';
let searchTerm = '';
let sort = 'recent';
const $ = (selector, root = document) => root.querySelector(selector);
const dialog = $('#job-dialog');
const syncDialog = $('#sync-dialog');

function getSyncConfig() { return JSON.parse(localStorage.getItem(SYNC_KEY) || 'null'); }
function base64Encode(value) { return btoa(String.fromCharCode(...new TextEncoder().encode(value))); }
function base64Decode(value) { return new TextDecoder().decode(Uint8Array.from(atob(value.replace(/\n/g, '')), char => char.charCodeAt(0))); }

function normalizeUrl(value) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    [...url.searchParams.keys()].forEach(key => {
      if (/^(utm_.+|share_token|recommendCode)$/i.test(key)) url.searchParams.delete(key);
    });
    return url.toString();
  } catch { return ''; }
}

function sameJob(left, right) {
  const leftUrl = normalizeUrl(left.url);
  const rightUrl = normalizeUrl(right.url);
  if (leftUrl && rightUrl && leftUrl === rightUrl) return true;
  if (!left.company || !left.role || !right.company || !right.role) return false;
  return left.company.trim().toLowerCase() === right.company.trim().toLowerCase()
    && left.role.trim().toLowerCase() === right.role.trim().toLowerCase();
}

function readImport() {
  if (!location.hash.startsWith('#import=')) return null;
  const encoded = location.hash.slice('#import='.length);
  history.replaceState(null, '', `${location.pathname}${location.search}`);
  try {
    if (encoded.length > 12000) return null;
    const payload = JSON.parse(base64Decode(decodeURIComponent(encoded)));
    const company = String(payload.company || '').trim().slice(0, 40);
    const role = String(payload.role || '').trim().slice(0, 60);
    const url = normalizeUrl(String(payload.url || ''));
    if (!company && !role && !url) return null;
    return { company, role, url, status: '进行中', stage: '已投递', nextAction: '', nextDate: '', notes: '' };
  } catch { return null; }
}

async function loadSharedData() {
  try {
    const response = await fetch(`./data.json?time=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) return;
    const sharedJobs = await response.json();
    if (Array.isArray(sharedJobs)) {
      jobs = sharedJobs;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(jobs));
      render();
    }
  } catch { /* 未发布或离线时继续使用本机数据 */ }
}

async function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(jobs));
  const config = getSyncConfig();
  if (!config?.token || !config?.repository) return;
  const endpoint = `https://api.github.com/repos/${config.repository}/contents/data.json`;
  const headers = { Accept: 'application/vnd.github+json', Authorization: `Bearer ${config.token}`, 'X-GitHub-Api-Version': '2022-11-28' };
  const current = await fetch(endpoint, { headers });
  const previous = current.ok ? await current.json() : null;
  const response = await fetch(endpoint, {
    method: 'PUT',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: '更新投递看板数据', content: base64Encode(JSON.stringify(jobs, null, 2)), sha: previous?.sha })
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    throw new Error(detail.message || `GitHub 返回 HTTP ${response.status}`);
  }
}

function getProgress(job) {
  if (outcomes.includes(job.status)) return job.status;
  return stages.includes(job.stage) ? job.stage : '未投递';
}

function getGroup(job) {
  const progress = getProgress(job);
  if (progress === 'Offer' || progress === '已接受') return 'offer';
  if (progress === '已挂' || progress === '已拒绝') return 'ended';
  if (progress === '未投递') return 'undelivered';
  return 'active';
}

function progressToFields(progress, existing) {
  if (progress === '已挂' || progress === '已拒绝') {
    const lastStage = stages.includes(existing?.stage) && existing.stage !== '未投递' ? existing.stage : '已投递';
    return { status: progress, stage: lastStage };
  }
  if (progress === '已接受') return { status: '已接受', stage: 'Offer' };
  if (progress === '未投递') return { status: '未投递', stage: '未投递' };
  return { status: '进行中', stage: progress };
}

function formatDate(value, includeTime = false) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const options = includeTime
    ? { month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit' }
    : { month: 'numeric', day: 'numeric' };
  return new Intl.DateTimeFormat('zh-CN', options).format(date);
}

function matchesSearch(job) {
  if (!searchTerm) return true;
  return [job.company, job.role, job.notes, job.nextAction]
    .some(value => String(value || '').toLowerCase().includes(searchTerm));
}

function sortedJobs(list) {
  return [...list].sort((left, right) => {
    if (sort === 'company') return left.company.localeCompare(right.company, 'zh-CN');
    if (sort === 'stage') return stages.indexOf(getProgress(right)) - stages.indexOf(getProgress(left));
    return new Date(right.updatedAt || 0) - new Date(left.updatedAt || 0);
  });
}

function visibleJobs() {
  const filtered = jobs.filter(job => filter === 'all' || getGroup(job) === filter).filter(matchesSearch);
  return sortedJobs(filtered);
}

function updateCounts() {
  const groups = { undelivered: 0, active: 0, offer: 0, ended: 0 };
  jobs.forEach(job => { groups[getGroup(job)] += 1; });
  $('#total-count').textContent = jobs.length;
  $('#active-count').textContent = groups.active;
  $('#offer-count').textContent = groups.offer;
  $('#ended-count').textContent = groups.ended;
  $('#all-filter-count').textContent = jobs.length;
  $('#undelivered-filter-count').textContent = groups.undelivered;
  $('#active-filter-count').textContent = groups.active;
  $('#offer-filter-count').textContent = groups.offer;
  $('#ended-filter-count').textContent = groups.ended;
}

function render() {
  updateCounts();
  const shown = visibleJobs();
  const list = $('#job-list');
  list.innerHTML = '';
  $('.workspace').hidden = jobs.length === 0;
  $('#empty-state').hidden = jobs.length !== 0;
  $('#list-empty').hidden = jobs.length === 0 || shown.length !== 0;
  $('#result-count').textContent = `显示 ${shown.length} / ${jobs.length}`;

  shown.forEach(job => {
    const card = $('#job-template').content.firstElementChild.cloneNode(true);
    const progress = getProgress(job);
    const group = getGroup(job);
    $('.company', card).textContent = job.company;
    $('.role', card).textContent = job.role;

    const updatedAt = $('.updated-at', card);
    const updatedText = formatDate(job.updatedAt || job.createdAt);
    updatedAt.textContent = updatedText ? `更新于 ${updatedText}` : '';
    updatedAt.hidden = !updatedText;

    const badge = $('.stage-badge', card);
    badge.textContent = progress;
    badge.classList.add(`is-${group}`);

    const plan = $('.job-plan', card);
    const nextAction = $('.next-action', card);
    const nextDate = $('.next-date', card);
    nextAction.textContent = job.nextAction || '待补充';
    nextDate.textContent = formatDate(job.nextDate, true);
    nextDate.hidden = !job.nextDate;
    plan.classList.toggle('is-empty', !job.nextAction && !job.nextDate);

    $('.notes', card).textContent = job.notes || '';
    const link = $('.job-link', card);
    if (job.url) {
      link.href = job.url;
      link.setAttribute('aria-label', `打开 ${job.company} ${job.role} 的招聘页面`);
    } else {
      link.hidden = true;
    }
    $('.edit-button', card).addEventListener('click', () => openEditor(job));
    list.append(card);
  });
}

function populateProgress() {
  $('#progress').innerHTML = progressOptions.map(value => `<option>${value}</option>`).join('');
}

function openEditor(job = null, imported = null) {
  const source = job || imported;
  $('#dialog-title').textContent = job ? '编辑岗位' : imported ? '确认导入' : '添加岗位';
  $('#job-id').value = job?.id || '';
  $('#company').value = source?.company || '';
  $('#role').value = source?.role || '';
  $('#url').value = source?.url || '';
  $('#progress').value = source ? getProgress(source) : '未投递';
  $('#next-action').value = source?.nextAction || '';
  $('#next-date').value = source?.nextDate || '';
  $('#notes').value = source?.notes || '';
  $('#delete-job').hidden = !job;

  const importState = $('#import-state');
  importState.hidden = !imported;
  importState.classList.remove('is-warning');
  importState.textContent = '';
  if (imported) {
    const duplicate = jobs.find(item => sameJob(item, imported));
    importState.classList.toggle('is-warning', Boolean(duplicate));
    importState.textContent = duplicate
      ? `看板中可能已有相同岗位：${duplicate.company} · ${duplicate.role}。继续保存会新增一条记录。`
      : '已从招聘页面读取信息，请确认后保存。';
  }
  dialog.showModal();
}

function closeEditor() { dialog.close(); }

function updateSyncPanel() {
  const config = getSyncConfig();
  $('#repository').value = config?.repository || 'zman42586-boop/forjob';
  $('#github-token').value = config?.token || '';
  $('#disconnect').hidden = !config?.token;
  $('#sync-state').textContent = config?.token ? `已连接 ${config.repository}。保存岗位时会同步。` : '尚未连接共享数据。';
}

function selectFilter(nextFilter) {
  filter = nextFilter;
  document.querySelectorAll('.filter').forEach(button => {
    const selected = button.dataset.filter === filter;
    button.classList.toggle('is-active', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
  render();
}

$('#open-add').addEventListener('click', () => openEditor());
$('#empty-add').addEventListener('click', () => openEditor());
$('#close-dialog').addEventListener('click', closeEditor);
$('#open-sync').addEventListener('click', () => { updateSyncPanel(); syncDialog.showModal(); });
$('#close-sync').addEventListener('click', () => syncDialog.close());
$('#search').addEventListener('input', event => { searchTerm = event.target.value.trim().toLowerCase(); render(); });
$('#sort').addEventListener('change', event => { sort = event.target.value; render(); });
$('#clear-filters').addEventListener('click', () => { $('#search').value = ''; searchTerm = ''; selectFilter('all'); });
document.querySelectorAll('.filter').forEach(button => button.addEventListener('click', () => selectFilter(button.dataset.filter)));

$('#sync-form').addEventListener('submit', async event => {
  event.preventDefault();
  const repository = $('#repository').value.trim();
  const token = $('#github-token').value.trim();
  if (!token) { $('#sync-state').textContent = '请先粘贴专用令牌。'; return; }
  localStorage.setItem(SYNC_KEY, JSON.stringify({ repository, token }));
  $('#sync-state').textContent = '正在同步…';
  try {
    await save();
    $('#sync-state').textContent = '已同步。';
    setTimeout(() => syncDialog.close(), 700);
  } catch (error) {
    localStorage.removeItem(SYNC_KEY);
    $('#sync-state').textContent = `同步失败：${error.message}`;
  }
});

$('#disconnect').addEventListener('click', () => {
  localStorage.removeItem(SYNC_KEY);
  updateSyncPanel();
});

$('#job-form').addEventListener('submit', async event => {
  event.preventDefault();
  const id = $('#job-id').value;
  const existing = jobs.find(item => item.id === id);
  const now = new Date().toISOString();
  const progressFields = progressToFields($('#progress').value, existing);
  const job = {
    ...existing,
    id: id || crypto.randomUUID(),
    company: $('#company').value.trim(),
    role: $('#role').value.trim(),
    url: $('#url').value.trim(),
    ...progressFields,
    nextAction: $('#next-action').value.trim(),
    nextDate: $('#next-date').value,
    notes: $('#notes').value.trim(),
    createdAt: existing?.createdAt || now,
    updatedAt: now
  };
  jobs = id ? jobs.map(item => item.id === id ? job : item) : [job, ...jobs];
  try {
    await save();
    closeEditor();
    render();
  } catch (error) {
    alert(`本机已保存，但同步失败：${error.message}`);
    closeEditor();
    render();
  }
});

$('#delete-job').addEventListener('click', async () => {
  if (!confirm('确定删除这个岗位吗？删除后无法恢复。')) return;
  jobs = jobs.filter(job => job.id !== $('#job-id').value);
  try { await save(); }
  catch (error) { alert(`本机已删除，但同步失败：${error.message}`); }
  closeEditor();
  render();
});

populateProgress();
render();
loadSharedData().then(() => {
  const imported = readImport();
  if (imported) openEditor(null, imported);
});
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./service-worker.js');
