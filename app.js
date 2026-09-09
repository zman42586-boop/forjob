const STORAGE_KEY = 'autumn-job-board-v1';
const SYNC_KEY = 'autumn-job-board-sync-v1';
const stages = ['未投递', '已投递', '测评', '笔试', '一面', '二面', '三面', 'HR 面', 'Offer'];
const statuses = ['未投递', '进行中', '已挂', '已拒绝', '已接受'];
let jobs = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
let filter = 'all';
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
    return { company, role, url, status: '进行中', stage: '已投递', notes: '' };
  } catch { return null; }
}
async function loadSharedData() {
  try {
    const response = await fetch(`./data.json?time=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) return;
    const sharedJobs = await response.json();
    if (Array.isArray(sharedJobs)) { jobs = sharedJobs; localStorage.setItem(STORAGE_KEY, JSON.stringify(jobs)); render(); }
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
  const response = await fetch(endpoint, { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ message: '更新投递看板数据', content: base64Encode(JSON.stringify(jobs, null, 2)), sha: previous?.sha }) });
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    throw new Error(detail.message || `GitHub 返回 HTTP ${response.status}`);
  }
}
function populateSelects() {
  $('#stage').innerHTML = stages.map(value => `<option>${value}</option>`).join('');
  $('#status').innerHTML = statuses.map(value => `<option>${value}</option>`).join('');
}
function isActive(job) { return job.status === '进行中' || job.stage === '已投递' || ['测评','笔试','一面','二面','三面','HR 面'].includes(job.stage); }
function visibleJobs() {
  if (filter === 'active') return jobs.filter(isActive);
  if (filter === 'offer') return jobs.filter(job => job.stage === 'Offer' || job.status === '已接受');
  if (filter === 'ended') return jobs.filter(job => job.status === '已挂' || job.status === '已拒绝');
  return jobs;
}
function render() {
  $('#total-count').textContent = jobs.length;
  $('#active-count').textContent = jobs.filter(isActive).length;
  $('#offer-count').textContent = jobs.filter(job => job.stage === 'Offer' || job.status === '已接受').length;
  const list = $('#job-list'); list.innerHTML = '';
  const shown = visibleJobs();
  $('#empty-state').hidden = jobs.length !== 0;
  shown.forEach(job => {
    const card = $('#job-template').content.firstElementChild.cloneNode(true);
    $('.company', card).textContent = job.company;
    $('.role', card).textContent = job.role;
    $('.status-badge', card).textContent = job.status;
    $('.stage-label', card).textContent = `当前：${job.stage}`;
    const index = stages.indexOf(job.stage);
    $('.progress-fill', card).style.width = `${Math.max(0, index) / (stages.length - 1) * 100}%`;
    $('.steps', card).innerHTML = stages.filter((_, i) => i === 0 || i === index || i === stages.length - 1).map(stage => `<span class="${stage === job.stage ? 'current' : ''}">${stage}</span>`).join('');
    $('.notes', card).textContent = job.notes || '';
    const link = $('.job-link', card);
    if (job.url) link.href = job.url; else link.hidden = true;
    $('.edit-button', card).addEventListener('click', () => openEditor(job));
    list.append(card);
  });
  if (jobs.length && !shown.length) list.innerHTML = '<p class="empty-state">这个筛选条件下还没有岗位。</p>';
}
function openEditor(job = null, imported = null) {
  const source = job || imported;
  $('#dialog-title').textContent = job ? '编辑岗位' : imported ? '确认导入' : '添加岗位';
  $('#job-id').value = job?.id || '';
  $('#company').value = source?.company || '';
  $('#role').value = source?.role || '';
  $('#url').value = source?.url || '';
  $('#status').value = source?.status || '未投递';
  $('#stage').value = source?.stage || '未投递';
  $('#notes').value = source?.notes || '';
  $('#delete-job').hidden = !job;
  const importState = $('#import-state');
  importState.hidden = !imported;
  if (imported) {
    const duplicate = jobs.find(item => sameJob(item, imported));
    importState.classList.toggle('is-warning', Boolean(duplicate));
    importState.textContent = duplicate
      ? `看板中可能已有相同岗位：${duplicate.company} · ${duplicate.role}。继续保存会新增一条记录。`
      : '已从当前招聘页读取信息，请确认后保存。';
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
$('#open-add').addEventListener('click', () => openEditor());
$('#empty-add').addEventListener('click', () => openEditor());
$('#close-dialog').addEventListener('click', closeEditor);
$('#open-sync').addEventListener('click', () => { updateSyncPanel(); syncDialog.showModal(); });
$('#close-sync').addEventListener('click', () => syncDialog.close());
$('#sync-form').addEventListener('submit', async event => {
  event.preventDefault();
  const repository = $('#repository').value.trim(); const token = $('#github-token').value.trim();
  if (!token) { $('#sync-state').textContent = '请先粘贴专用令牌。'; return; }
  localStorage.setItem(SYNC_KEY, JSON.stringify({ repository, token }));
  $('#sync-state').textContent = '正在同步…';
  try { await save(); $('#sync-state').textContent = '已同步，朋友刷新页面即可看到。'; setTimeout(() => syncDialog.close(), 700); }
  catch (error) { localStorage.removeItem(SYNC_KEY); $('#sync-state').textContent = `同步失败：${error.message}`; }
});
$('#disconnect').addEventListener('click', () => { localStorage.removeItem(SYNC_KEY); updateSyncPanel(); });
$('#job-form').addEventListener('submit', async event => {
  event.preventDefault();
  const id = $('#job-id').value;
  const job = { id: id || crypto.randomUUID(), company: $('#company').value.trim(), role: $('#role').value.trim(), url: $('#url').value.trim(), status: $('#status').value, stage: $('#stage').value, notes: $('#notes').value.trim() };
  jobs = id ? jobs.map(item => item.id === id ? job : item) : [job, ...jobs];
  try { await save(); closeEditor(); render(); } catch (error) { alert(`本机已保存，但同步失败：${error.message}`); closeEditor(); render(); }
});
$('#delete-job').addEventListener('click', async () => {
  if (confirm('确定删除这个岗位吗？')) { jobs = jobs.filter(job => job.id !== $('#job-id').value); try { await save(); } catch (error) { alert(`本机已删除，但同步失败：${error.message}`); } closeEditor(); render(); }
});
document.querySelectorAll('.filter').forEach(button => button.addEventListener('click', () => { filter = button.dataset.filter; document.querySelector('.filter.is-active').classList.remove('is-active'); button.classList.add('is-active'); render(); }));
populateSelects(); render();
loadSharedData().then(() => {
  const imported = readImport();
  if (imported) openEditor(null, imported);
});
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./service-worker.js');
