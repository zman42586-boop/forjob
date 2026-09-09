const BOARD_URL = 'https://zman42586-boop.github.io/forjob/';

function encodePayload(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = '';
  bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  return encodeURIComponent(btoa(binary));
}

function extractJob() {
  const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
  const firstText = selectors => {
    for (const selector of selectors) {
      const value = clean(document.querySelector(selector)?.textContent);
      if (value) return value;
    }
    return '';
  };
  const findJobPosting = value => {
    if (!value || typeof value !== 'object') return null;
    if (value['@type'] === 'JobPosting') return value;
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = findJobPosting(item);
        if (found) return found;
      }
    }
    if (value['@graph']) return findJobPosting(value['@graph']);
    return null;
  };

  let posting = null;
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      posting = findJobPosting(JSON.parse(script.textContent));
      if (posting) break;
    } catch { /* 忽略页面中损坏的结构化数据 */ }
  }

  const organization = posting?.hiringOrganization;
  let company = clean(typeof organization === 'string' ? organization : organization?.name);
  let role = clean(posting?.title);

  if (!role) role = firstText([
    '[data-testid*="job-title" i]', '[class*="job-title" i]',
    '[class*="position-name" i]', '[class*="position-title" i]',
    'main h1', 'h1'
  ]);
  if (!company) company = firstText([
    '[data-testid*="company" i]', '[class*="company-name" i]',
    '[class*="companyName" i]', '[class*="employer" i]'
  ]);

  const title = clean(document.querySelector('meta[property="og:title"]')?.content || document.title);
  const titleParts = title.split(/\s*(?:[-_|\u2013\u2014\uff5c]\s*)/).filter(Boolean);
  if (!role && titleParts.length) role = titleParts[0];
  if (!company && titleParts.length > 1) company = titleParts[titleParts.length - 1];

  const generic = /^(?:校园招聘|社会招聘|职位详情|职位申请|个人中心|投递记录|招聘|官网)$/i;
  if (generic.test(role)) role = '';
  if (generic.test(company)) company = '';

  return {
    company: company.slice(0, 40),
    role: role.slice(0, 60),
    url: location.href
  };
}

chrome.action.onClicked.addListener(async tab => {
  if (!tab.id || !/^https?:/i.test(tab.url || '')) return;
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractJob
    });
    const payload = result || { company: '', role: tab.title || '', url: tab.url };
    await chrome.tabs.create({ url: `${BOARD_URL}#import=${encodePayload(payload)}` });
  } catch {
    await chrome.tabs.create({
      url: `${BOARD_URL}#import=${encodePayload({ company: '', role: tab.title || '', url: tab.url || '' })}`
    });
  }
});
