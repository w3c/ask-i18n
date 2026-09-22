export const UI_LANGUAGE_OPTIONS = [
  { code: 'en', label: 'English' },
  { code: 'zh-hans', label: '简体中文' }
];

// Infrastructure for languages added later; keep entries in sync with MESSAGES.
const RTL_LANGUAGES = new Set(['ar', 'he']);
const HTML_LANG_TAGS = {
  'zh-hans': 'zh-Hans'
};

export const MESSAGES = {
  en: {
    skipLink: 'Skip to content',
    projectStatusLabel: 'Project status',
    projectNoticeStrong: 'Experimental tool.',
    projectNoticeText: 'This is an experimental tool from the W3C Internationalization Activity.',
    searchAriaLabel: 'Ask W3C Internationalization sources',
    questionLabel: 'Question',
    sampleQuestion: 'How should I declare UTF-8 character encoding in HTML?',
    questionHelp: 'Answers are grounded only in indexed W3C Internationalization sources.',
    shortcutHintBefore: '',
    shortcutHintAfter: ' to ask.',
    answerLanguageLabel: 'Answer language',
    statusLegend: 'Source status',
    statusPublished: 'Published',
    statusReview: 'Review',
    statusDraft: 'Draft',
    advancedLegend: 'Advanced',
    includeObsolete: 'Include obsolete content',
    voiceInputStart: 'Voice input',
    voiceInputStop: 'Stop voice input',
    voiceInputError: 'Voice input is unavailable. Check your microphone access and try again.',
    submitButton: 'Ask from sources',
    answerHeading: 'Answer',
    answerPlaceholder: 'Ask a question to see an answer with source citations.',
    citationsAriaLabel: 'Cited sources',
    previewNotice: 'This is a PR preview.',
    uiLanguageLabel: 'Language: ',
    headerLink: 'W3C i18n',
    githubLinkLabel: 'View project on GitHub',
    validationMinLength: 'Enter at least 3 characters.',
    healthIndexed: 'Indexed {documents} documents and {chunks} chunks.',
    healthNoIndex: 'No index is loaded. Run npm run index before asking questions.',
    healthCheckFailed: 'Health check failed: {message}',
    loadingMessage: 'Retrieving W3C i18n sources and composing a cited answer…',
    asking: 'Asking...',
    noSupportedAnswer: 'No supported answer was found.',
    noAnswerGenerated: 'No answer could be generated from the selected sources.',
    warning: 'Warning',
    openSource: 'Open source: {label}',
    languageLabel: 'Language: {value}',
    languageUnknown: 'Language unknown',
    statusNotReviewed: 'Not reviewed',
    statusObsolete: 'Obsolete',
    statusUnknown: 'Unknown',
    translationCurrent: 'Current translation',
    translationOutOfDate: 'Out-of-date translation',
    translationUpdated: 'Updated translation',
    translationUnlinked: 'Unlinked translation',
    translationUnknown: 'Translation state unknown',
    requestFailed: 'Request failed with HTTP {status}'
  },
  'zh-hans': {
    skipLink: '跳到主要内容',
    projectStatusLabel: '项目状态',
    projectNoticeStrong: '实验性工具：',
    projectNoticeText: '本项目是W3C国际化标准计划的实验性工具。',
    searchAriaLabel: '向W3C国际化提问',
    questionLabel: '问题',
    sampleQuestion: '如何在HTML中设置内容的语言？',
    questionHelp: '回答仅基于已索引的W3C国际化来源。',
    shortcutHintBefore: '',
    shortcutHintAfter: ' 提问',
    answerLanguageLabel: '回答语言',
    statusLegend: '来源状态',
    statusPublished: '已发布',
    statusReview: '审阅中',
    statusDraft: '草稿',
    advancedLegend: '高级',
    includeObsolete: '包含已废弃的内容',
    voiceInputStart: '语音输入',
    voiceInputStop: '停止语音输入',
    voiceInputError: '语音输入不可用，请检查麦克风权限后重试。',
    submitButton: '提问',
    answerHeading: '回答',
    answerPlaceholder: '提问后即可查看带来源引用的回答。',
    citationsAriaLabel: '引用来源',
    previewNotice: '这是拉取请求的预览。',
    uiLanguageLabel: '界面语言',
    headerLink: 'W3C i18n',
    githubLinkLabel: '在GitHub上查看项目',
    validationMinLength: '请输入至少 3 个字符。',
    healthIndexed: '已索引{documents}个文档和{chunks}个片段',
    healthNoIndex: '未加载索引。提问前请先运行 npm run index。',
    healthCheckFailed: '健康检查失败：{message}',
    loadingMessage: '正在检索W3C国际化的相关材料并撰写带引用的回答……',
    asking: '正在提问……',
    noSupportedAnswer: '未找到受支持的答案。',
    noAnswerGenerated: '无法根据所选来源生成答案。',
    warning: '警告',
    openSource: '打开来源：{label}',
    languageLabel: '语言：{value}',
    languageUnknown: '语言未知',
    statusNotReviewed: '未评审',
    statusObsolete: '已废弃',
    statusUnknown: '未知',
    translationCurrent: '翻译为当前翻译',
    translationOutOfDate: '过期翻译',
    translationUpdated: '已更新翻译',
    translationUnlinked: '未关联翻译',
    translationUnknown: '翻译状态未知',
    requestFailed: '请求失败，HTTP状态码{status}'
  }
};

let currentLanguage = 'en';
const listeners = new Set();

export function isSupportedUILanguage(code) {
  return typeof code === 'string' && Object.hasOwn(MESSAGES, code.toLowerCase());
}

export function getUILanguage() {
  return currentLanguage;
}

export function uiTextDirection(code) {
  return RTL_LANGUAGES.has(code) ? 'rtl' : 'ltr';
}

export function detectUILanguage() {
  try {
    const stored = localStorage.getItem('ui-language');
    if (isSupportedUILanguage(stored)) return stored.toLowerCase();
  } catch {
    // localStorage unavailable (private mode or non-browser environment).
  }

  const candidates = typeof navigator === 'undefined'
    ? []
    : navigator.languages || [navigator.language];
  for (const candidate of candidates) {
    const code = normalizeCandidate(candidate);
    if (isSupportedUILanguage(code)) return code;
  }
  return 'en';
}

function normalizeCandidate(tag) {
  const lower = String(tag || '').toLowerCase().replace('_', '-');
  if (!lower) return '';
  const base = lower.split('-')[0];
  if (base !== 'zh') return base;
  if (/hant|tw|hk|mo/.test(lower)) return 'zh-hant';
  return 'zh-hans';
}

export function t(key, params = {}) {
  const template = MESSAGES[currentLanguage]?.[key] ?? MESSAGES.en[key] ?? key;
  return String(template).replace(/\{(\w+)\}/g, (_, name) => {
    return Object.hasOwn(params, name) ? String(params[name]) : `{${name}}`;
  });
}

export function applyUILanguage(code) {
  const language = isSupportedUILanguage(code) ? code.toLowerCase() : 'en';
  currentLanguage = language;

  const root = typeof document === 'undefined' ? null : document.documentElement;
  if (root) {
    root.lang = HTML_LANG_TAGS[language] ?? language;
    root.dir = uiTextDirection(language);
    for (const element of root.querySelectorAll('[data-i18n]')) {
      element.textContent = t(element.dataset.i18n);
    }
    for (const element of root.querySelectorAll('[data-i18n-placeholder]')) {
      element.placeholder = t(element.dataset.i18nPlaceholder);
    }
    for (const element of root.querySelectorAll('[data-i18n-aria-label]')) {
      element.setAttribute('aria-label', t(element.dataset.i18nAriaLabel));
    }
    for (const element of root.querySelectorAll('[data-i18n-title]')) {
      element.title = t(element.dataset.i18nTitle);
    }
  }

  try {
    localStorage.setItem('ui-language', language);
  } catch {
    // Persisting the choice is best-effort.
  }

  for (const listener of listeners) listener(language);
  return language;
}

export function onUILanguageChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
