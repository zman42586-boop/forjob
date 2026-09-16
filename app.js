const STORAGE_KEY = 'autumn-job-board-v1';
const SYNC_KEY = 'autumn-job-board-sync-v1';
const stages = ['未投递', '已投递', '测评', '笔试', '一面', '二面', '三面', 'HR 面', 'Offer'];
const outcomes = ['已挂', '已拒绝', '已接受'];
const progressOptions = [...stages, ...outcomes];
const cities = ['上海', '深圳', '杭州', '苏州', '南京'];
const baseOptions = [...cities, '深圳、上海'];
const industries = ['互联网', '制造业', '智能汽车', '消费电子/智能硬件', '半导体', 'AI/企业软件', '金融科技', '新能源', '其他'];
const jobTracks = ['AI Agent/大模型', 'AI 应用开发', '后端研发', '产品经理', '通用研发', '其他'];
const companyIndustries = {
  '深圳传音控股股份有限公司': '消费电子/智能硬件', '传音': '消费电子/智能硬件',
  '理想汽车': '智能汽车', '小鹏': '智能汽车', '蔚来': '智能汽车',
  '华为': '消费电子/智能硬件', '韶音': '消费电子/智能硬件', '联想': '消费电子/智能硬件',
  'vivo': '消费电子/智能硬件', 'oppo': '消费电子/智能硬件',
  '科大讯飞': 'AI/企业软件', '帆软': 'AI/企业软件', '长鑫存储': '半导体',
  '腾讯音乐': '互联网', '京东': '互联网', '网易互娱': '互联网', 'bilibili': '互联网',
  '字节跳动': '互联网', '携程': '互联网', '沐瞳科技': '互联网', 'SHEIN': '互联网', '同花顺': '互联网',
  '滴滴': '互联网', '得物': '互联网', '去哪儿': '互联网', '虾皮': '互联网',
  '影石': '制造业', 'Insta360': '制造业',
  '招银科技': '金融科技', '远景能源': '新能源'
};
let jobs = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
let filter = 'all';
let searchTerm = '';
let sort = 'recent';
let currentView = 'manage';
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

function inferIndustry(company = '') {
  const normalized = company.trim().toLowerCase();
  const matched = Object.entries(companyIndustries).find(([name]) => normalized.includes(name.toLowerCase()));
  return matched?.[1] || '';
}

function inferJobTrack(role = '') {
  const normalized = role.toLowerCase();
  if (/agent|智能体|大模型/.test(normalized)) return 'AI Agent/大模型';
  if (/产品/.test(normalized)) return '产品经理';
  if (/后端/.test(normalized)) return '后端研发';
  if (/ai|算法|智能/.test(normalized)) return 'AI 应用开发';
  if (/研发|开发|工程师|通软/.test(normalized)) return '通用研发';
  return '其他';
}

function getIndustry(job) { return industries.includes(job.industry) ? job.industry : inferIndustry(job.company) || '其他'; }
function getBases(job) {
  const values = Array.isArray(job.base) ? job.base : String(job.base || '').split(/[、,，/]/);
  return [...new Set(values.map(value => value.trim()).filter(value => cities.includes(value)))];
}
function getBase(job) { return getBases(job).join('、'); }
function getJobTrack(job) { return jobTracks.includes(job.jobTrack) ? job.jobTrack : inferJobTrack(job.role); }

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
  return [job.company, job.role, job.notes, job.nextAction, getIndustry(job), getBase(job), getJobTrack(job)]
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

function countBy(list, getter) {
  return list.reduce((counts, item) => {
    const key = getter(item);
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function renderBarChart(element, entries, valueClass = '') {
  const max = Math.max(1, ...entries.map(([, value]) => value));
  element.innerHTML = entries.map(([label, value]) => `
    <div class="chart-row">
      <div class="bar-meta"><span>${label}</span><strong>${value}</strong></div>
      <div class="bar-track" role="img" aria-label="${label} ${value} 个岗位">
        <span class="bar-fill ${valueClass}" style="width:${value ? Math.max(5, value / max * 100) : 0}%"></span>
      </div>
    </div>`).join('');
}

function renderColumnChart(element, entries) {
  const max = Math.max(1, ...entries.map(([, value]) => value));
  const minWidth = entries.length > 5 ? 560 : 340;
  element.innerHTML = `
    <div class="column-bars" style="--column-count:${entries.length};--column-min-width:${minWidth}px">
      ${entries.map(([label, value]) => `
        <div class="column-item">
          <strong class="column-value">${value}</strong>
          <div class="column-track" role="img" aria-label="${label} ${value} 个岗位">
            <span class="column-fill" style="height:${value ? Math.max(4, value / max * 100) : 0}%"></span>
          </div>
          <span class="column-label">${label}</span>
        </div>`).join('')}
    </div>`;
}

function renderStageChart() {
  const counts = countBy(jobs, getProgress);
  const entries = progressOptions.filter(stage => counts[stage]).map(stage => [stage, counts[stage]]);
  const chart = $('#stage-chart');
  if (!entries.length) { chart.innerHTML = '<p class="chart-empty">添加岗位后会显示阶段分布。</p>'; return; }
  const max = Math.max(...entries.map(([, value]) => value));
  chart.innerHTML = entries.map(([label, value]) => {
    const group = label === 'Offer' || label === '已接受' ? 'offer' : outcomes.includes(label) ? 'ended' : 'active';
    return `
      <div class="chart-row">
        <div class="bar-meta"><span>${label}</span><strong>${value}</strong></div>
        <div class="bar-track" role="img" aria-label="${label} ${value} 个岗位">
          <span class="bar-fill is-${group}" style="width:${Math.max(5, value / max * 100)}%"></span>
        </div>
      </div>`;
  }).join('');
}

function renderIndustryChart() {
  const counts = countBy(jobs, getIndustry);
  const rows = industries.map(industry => [industry, counts[industry] || 0])
    .filter(([, total]) => total)
    .sort((left, right) => right[1] - left[1]);
  const chart = $('#industry-chart');
  if (!rows.length) { chart.innerHTML = '<p class="chart-empty">添加岗位后会显示行业分布。</p>'; return; }
  renderColumnChart(chart, rows);
}

function renderCityChart() {
  const counts = Object.fromEntries(cities.map(city => [city, 0]));
  jobs.forEach(job => getBases(job).forEach(city => { counts[city] += 1; }));
  renderColumnChart($('#city-chart'), cities.map(city => [city, counts[city] || 0]));
}

function renderAnalytics() {
  const located = jobs.filter(job => getBase(job)).length;
  const interviewStages = new Set(['一面', '二面', '三面', 'HR 面', 'Offer', '已接受']);
  $('#company-count').textContent = new Set(jobs.map(job => job.company.trim().toLowerCase()).filter(Boolean)).size;
  $('#interview-count').textContent = jobs.filter(job => interviewStages.has(getProgress(job))).length;
  $('#base-coverage').textContent = jobs.length ? `${Math.round(located / jobs.length * 100)}%` : '0%';
  $('#base-coverage-detail').textContent = `${located} / ${jobs.length}`;
  $('#coverage-chip').textContent = `Base 已填写 ${located} / ${jobs.length}`;
  renderStageChart();
  renderIndustryChart();
  renderCityChart();
}

function render() {
  updateCounts();
  renderAnalytics();
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
    $('.job-meta', card).textContent = [getIndustry(job), getBase(job), getJobTrack(job)].filter(Boolean).join(' · ');

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

function populateTaxonomy() {
  $('#industry').innerHTML = '<option value="">请选择行业</option>' + industries.map(value => `<option>${value}</option>`).join('');
  $('#base').innerHTML = '<option value="">请选择 Base 地</option>' + baseOptions.map(value => `<option>${value}</option>`).join('');
  $('#job-track').innerHTML = '<option value="">请选择岗位方向</option>' + jobTracks.map(value => `<option>${value}</option>`).join('');
}

function openEditor(job = null, imported = null) {
  const source = job || imported;
  $('#dialog-title').textContent = job ? '编辑岗位' : imported ? '确认导入' : '添加岗位';
  $('#job-id').value = job?.id || '';
  $('#company').value = source?.company || '';
  $('#role').value = source?.role || '';
  $('#industry').value = source?.industry || inferIndustry(source?.company || '');
  $('#base').value = source?.base || '';
  $('#job-track').value = source?.jobTrack || inferJobTrack(source?.role || '');
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

function selectView(view) {
  currentView = view === 'analytics' ? 'analytics' : 'manage';
  $('#manage-view').hidden = currentView !== 'manage';
  $('#analytics-view').hidden = currentView !== 'analytics';
  document.querySelectorAll('.view-tab').forEach(button => {
    const selected = button.dataset.view === currentView;
    button.classList.toggle('is-active', selected);
    button.setAttribute('aria-selected', String(selected));
  });
  if (currentView === 'analytics') renderAnalytics();
}

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
document.querySelectorAll('.view-tab').forEach(button => button.addEventListener('click', () => selectView(button.dataset.view)));
$('#close-dialog').addEventListener('click', closeEditor);
$('#open-sync').addEventListener('click', () => { updateSyncPanel(); syncDialog.showModal(); });
$('#close-sync').addEventListener('click', () => syncDialog.close());
$('#search').addEventListener('input', event => { searchTerm = event.target.value.trim().toLowerCase(); render(); });
$('#sort').addEventListener('change', event => { sort = event.target.value; render(); });
$('#clear-filters').addEventListener('click', () => { $('#search').value = ''; searchTerm = ''; selectFilter('all'); });
document.querySelectorAll('.filter').forEach(button => button.addEventListener('click', () => selectFilter(button.dataset.filter)));
$('#company').addEventListener('change', event => {
  if (!$('#industry').value) $('#industry').value = inferIndustry(event.target.value);
});
$('#role').addEventListener('change', event => {
  if (!$('#job-track').value) $('#job-track').value = inferJobTrack(event.target.value);
});

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
    industry: $('#industry').value,
    base: $('#base').value,
    jobTrack: $('#job-track').value,
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
populateTaxonomy();
render();
loadSharedData().then(() => {
  const imported = readImport();
  if (imported) openEditor(null, imported);
});
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./service-worker.js').catch(() => {});
