import { highlightCode } from './syntax-highlight.js';
import { MESSAGES, applyUILanguage, detectUILanguage, getUILanguage, onUILanguageChange, t } from './i18n.js';

// Resolve API calls against this module's own URL so the UI works both at the
// site root and under a subpath such as /ask-i18n/ behind a reverse proxy.
const APP_BASE_URL = new URL('./', import.meta.url);

function apiUrl(path) {
  return new URL(path.replace(/^\/+/, ''), APP_BASE_URL).href;
}

const form = typeof document === 'undefined' ? null : document.querySelector('#ask-form');
const questionField = form?.elements.namedItem('question') || null;
const submitButton = typeof document === 'undefined' ? null : document.querySelector('#submit-button');
const uiLanguageSelect = typeof document === 'undefined' ? null : document.querySelector('#ui-language');
const answerLanguageSelect = form?.elements.namedItem('language') || null;
const messageArea = typeof document === 'undefined' ? null : document.querySelector('#message-area');
const warningsEl = typeof document === 'undefined' ? null : document.querySelector('#warnings');
const answerEl = typeof document === 'undefined' ? null : document.querySelector('#answer');
const citationsEl = typeof document === 'undefined' ? null : document.querySelector('#citations');
const healthStatus = typeof document === 'undefined' ? null : document.querySelector('#health-status');
const previewNotice = typeof document === 'undefined' ? null : document.querySelector('#preview-notice');
const voiceButton = typeof document === 'undefined' ? null : document.querySelector('#voice-input');

let lastHealth = null;
let lastResponse = null;
let lastPayload = null;
let answerLanguageTouched = false;
let voiceRecognition = null;

const DEFAULT_ANSWER_LANGUAGE = {
  en: 'en',
  'zh-hans': 'zh-hans'
};

const SPEECH_RECOGNITION_LANGUAGES = {
  en: 'en-US',
  'zh-hans': 'zh-CN'
};

export function defaultAnswerLanguageForUI(uiLanguage) {
  return DEFAULT_ANSWER_LANGUAGE[uiLanguage] ?? null;
}

function syncAnswerLanguageToUI(uiLanguage) {
  if (!answerLanguageSelect || answerLanguageTouched) return;
  const defaultLanguage = defaultAnswerLanguageForUI(uiLanguage);
  if (defaultLanguage) answerLanguageSelect.value = defaultLanguage;
}

if (form) {
  applyUILanguage(detectUILanguage());
  syncAnswerLanguageToUI(getUILanguage());
  updateQuestionSample();
  if (uiLanguageSelect) {
    uiLanguageSelect.value = getUILanguage();
    uiLanguageSelect.addEventListener('change', () => {
      applyUILanguage(uiLanguageSelect.value);
      syncAnswerLanguageToUI(getUILanguage());
      updateQuestionSample();
      rerenderTranslatedState();
    });
  }
  if (answerLanguageSelect) {
    answerLanguageSelect.addEventListener('change', () => {
      answerLanguageTouched = true;
    });
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    stopVoiceInput();
    validateQuestion();
    if (!form.reportValidity()) {
      setMessage(questionField.validationMessage, 'error');
      questionField.focus();
      return;
    }
    await ask();
  });

  questionField.addEventListener('input', () => {
    questionField.setCustomValidity('');
    if (messageArea.classList.contains('error')) setMessage('', '');
  });

  questionField.addEventListener('keydown', (event) => {
    if (!isSendShortcut(event) || submitButton.disabled) return;
    event.preventDefault();
    form.requestSubmit(submitButton);
  });

  initVoiceInput();
  loadHealth();
}

function updateQuestionSample() {
  if (!questionField) return;
  const sample = t('sampleQuestion');
  const isSample = isSampleQuestion(questionField.value);
  if (isSample && questionField.value !== sample) {
    questionField.value = sample;
  }
}

export function isSendShortcut(event) {
  return !event.defaultPrevented &&
    event.key === 'Enter' &&
    !event.isComposing &&
    !event.altKey &&
    !event.shiftKey &&
    (event.ctrlKey || event.metaKey);
}

function validateQuestion() {
  const question = questionField.value.trim();
  questionField.setCustomValidity(question.length >= 3 ? '' : t('validationMinLength'));
}

export function speechRecognitionLanguage(uiLanguage) {
  return SPEECH_RECOGNITION_LANGUAGES[uiLanguage] ?? 'en-US';
}

function isSampleQuestion(value) {
  return Object.values(MESSAGES)
    .some((messages) => messages.sampleQuestion === value);
}

function initVoiceInput() {
  if (!voiceButton) return;
  const SpeechRecognitionImpl = typeof window === 'undefined'
    ? null
    : window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognitionImpl) return;

  voiceButton.hidden = false;
  onUILanguageChange(() => renderVoiceInputButton());
  window.addEventListener('pagehide', stopVoiceInput);

  voiceButton.addEventListener('click', () => {
    if (voiceRecognition) {
      stopVoiceInput();
      questionField?.focus();
      return;
    }
    startVoiceInput(SpeechRecognitionImpl);
  });
}

function startVoiceInput(SpeechRecognitionImpl) {
  if (!questionField || !voiceButton || voiceRecognition) return;
  if (messageArea.classList.contains('error')) setMessage('', '');

  if (isSampleQuestion(questionField.value) || !questionField.value.trim()) {
    questionField.value = '';
  }
  const prefix = questionField.value;
  let finalTranscript = '';

  const recognition = new SpeechRecognitionImpl();
  voiceRecognition = recognition;
  recognition.lang = speechRecognitionLanguage(getUILanguage());
  recognition.continuous = false;
  recognition.interimResults = true;

  recognition.onresult = (event) => {
    let interimTranscript = '';
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const result = event.results[index];
      const transcript = result?.[0]?.transcript || '';
      if (result.isFinal) finalTranscript += transcript;
      else interimTranscript += transcript;
    }
    questionField.value = `${prefix}${finalTranscript}${interimTranscript}`;
    questionField.dispatchEvent(new Event('input', { bubbles: true }));
  };

  recognition.onerror = (event) => {
    if (event?.error === 'aborted') return;
    setMessage(t('voiceInputError'), 'error');
    resetVoiceRecognition();
  };

  recognition.onend = () => {
    if (voiceRecognition === recognition) resetVoiceRecognition();
  };

  renderVoiceInputButton();
  questionField.focus();
  try {
    recognition.start();
  } catch {
    setMessage(t('voiceInputError'), 'error');
    resetVoiceRecognition();
  }
}

function stopVoiceInput() {
  if (!voiceRecognition) return;
  voiceRecognition.onend = null;
  voiceRecognition.onerror = null;
  try {
    voiceRecognition.abort();
  } catch {
    // The recognition session may already have ended.
  }
  resetVoiceRecognition();
}

function resetVoiceRecognition() {
  voiceRecognition = null;
  renderVoiceInputButton();
}

function renderVoiceInputButton() {
  if (!voiceButton) return;
  const active = Boolean(voiceRecognition);
  voiceButton.setAttribute('aria-pressed', String(active));
  voiceButton.textContent = t(active ? 'voiceInputStop' : 'voiceInputStart');
}

async function loadHealth() {
  try {
    const health = await fetchJson(apiUrl('api/health'));
    lastHealth = health;
    renderHealth(health);
  } catch (error) {
    lastHealth = { error: error.message };
    healthStatus.textContent = t('healthCheckFailed', { message: error.message });
  }
}

function renderHealth(health) {
  if (previewNotice) {
    previewNotice.hidden = !health.is_pull_request;
    document.body.classList.toggle('has-preview-notice', Boolean(health.is_pull_request));
  }
  if (health.ok) {
    healthStatus.textContent = t('healthIndexed', {
      documents: health.indexed_documents,
      chunks: health.indexed_chunks
    });
  } else {
    healthStatus.textContent = t('healthNoIndex');
  }
}

async function ask() {
  setLoading(t('loadingMessage'));
  form.setAttribute('aria-busy', 'true');
  answerEl.setAttribute('aria-busy', 'true');
  submitButton.disabled = true;
  submitButton.textContent = t('asking');

  try {
    const payload = formPayload();
    const response = await fetchJson(apiUrl('api/ask'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });

    lastResponse = response;
    lastPayload = payload;
    renderAnswer(response, payload.language);
    setMessage(response.evidence_status === 'insufficient_evidence' ? t('noSupportedAnswer') : '', '');
  } catch (error) {
    setMessage(error.message, 'error');
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = t('submitButton');
    form.setAttribute('aria-busy', 'false');
    answerEl.setAttribute('aria-busy', 'false');
  }
}

function rerenderTranslatedState() {
  if (uiLanguageSelect) uiLanguageSelect.value = getUILanguage();
  validateQuestion();
  if (lastHealth) {
    if (lastHealth.error) {
      healthStatus.textContent = t('healthCheckFailed', { message: lastHealth.error });
    } else {
      renderHealth(lastHealth);
    }
  }
  if (lastResponse && lastPayload) {
    renderAnswer(lastResponse, lastPayload.language);
  }
  submitButton.textContent = t('submitButton');
}

function formPayload() {
  const data = new FormData(form);
  return {
    question: String(data.get('question') || '').trim(),
    language: String(data.get('language') || 'en'),
    statuses: data.getAll('statuses'),
    includeObsolete: Boolean(data.get('includeObsolete'))
  };
}

function renderAnswer(response, language) {
  warningsEl.replaceChildren(...(response.warnings || []).map(renderWarning));
  answerEl.lang = language;
  renderMarkdownInto(answerEl, response.answer || t('noAnswerGenerated'));
  citationsEl.replaceChildren(...(response.citations || []).map(renderCitation));
}

function renderWarning(warning) {
  const element = document.createElement('div');
  element.className = 'warning';
  const label = document.createElement('strong');
  label.textContent = t('warning');
  const message = document.createElement('span');
  message.textContent = warning.message;
  element.append(label, message);
  return element;
}

function renderCitation(citation, index) {
  const card = document.createElement('li');
  card.className = 'citation';
  card.id = `citation-${index + 1}`;

  const heading = document.createElement('h3');
  heading.textContent = `[${index + 1}] ${citation.label}`;

  const meta = document.createElement('div');
  meta.className = 'meta-row';
  const badges = [badge(statusLabel(citation.status), citation.status)];
  if (!isEnglishLanguage(citation.language)) {
    badges.push(badge(translationLabel(citation.translation_state), citation.translation_state));
  }
  badges.push(languageNode(citation.language));
  meta.append(...badges);

  const link = document.createElement('a');
  link.href = citation.url;
  link.target = '_blank';
  link.setAttribute('aria-label', t('openSource', { label: citation.label }));
  link.textContent = citation.url;

  card.append(heading, meta, link);
  return card;
}

function badge(label, className = '') {
  const element = document.createElement('span');
  element.className = `badge ${className || ''}`.trim();
  element.textContent = label;
  return element;
}

function languageNode(value) {
  const element = document.createElement('span');
  element.className = 'source-language';
  element.textContent = value ? t('languageLabel', { value }) : t('languageUnknown');
  return element;
}

function statusLabel(status) {
  const labels = {
    published: t('statusPublished'),
    review: t('statusReview'),
    draft: t('statusDraft'),
    notreviewed: t('statusNotReviewed'),
    obsolete: t('statusObsolete')
  };
  return labels[status] || status || t('statusUnknown');
}

function translationLabel(state) {
  const labels = {
    current: t('translationCurrent'),
    out_of_date: t('translationOutOfDate'),
    updated: t('translationUpdated'),
    unlinked: t('translationUnlinked'),
    unknown: t('translationUnknown')
  };
  return labels[state] || state || t('translationUnknown');
}

export function isEnglishLanguage(language) {
  const normalized = String(language || '').toLowerCase().replace(/_/g, '-');
  return normalized === 'en' || normalized.startsWith('en-');
}

function setLoading(message) {
  setMessage(message, 'loading');
}

function setMessage(message, className) {
  messageArea.className = `message-area ${className || ''}`.trim();
  messageArea.setAttribute('role', className === 'error' ? 'alert' : 'status');
  messageArea.textContent = message;
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || t('requestFailed', { status: response.status }));
  }
  return data;
}

export function renderMarkdownInto(element, markdown) {
  const template = document.createElement('template');
  template.innerHTML = markdownToHtml(markdown);
  element.replaceChildren(template.content.cloneNode(true));
}

export function markdownToHtml(markdown) {
  const lines = String(markdown || '').replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let index = 0;

  while (index < lines.length) {
    if (!lines[index].trim()) {
      index += 1;
      continue;
    }

    const fence = lines[index].match(/^```([A-Za-z0-9_-]+)?\s*$/);
    if (fence) {
      const languageName = fence[1] ? fence[1].toLowerCase() : '';
      const language = languageName ? ` class="language-${escapeAttribute(languageName)}"` : '';
      const codeLines = [];
      index += 1;
      while (index < lines.length && !/^```\s*$/.test(lines[index])) {
        codeLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push(`<pre><code${language}>${highlightCode(codeLines.join('\n'), languageName)}</code></pre>`);
      continue;
    }

    const heading = lines[index].match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      blocks.push(`<h${level}>${renderInline(heading[2].trim())}</h${level}>`);
      index += 1;
      continue;
    }

    if (/^\s*[-*+]\s+/.test(lines[index])) {
      const items = [];
      while (index < lines.length && /^\s*[-*+]\s+/.test(lines[index])) {
        items.push(`<li>${renderInline(lines[index].replace(/^\s*[-*+]\s+/, '').trim())}</li>`);
        index += 1;
      }
      blocks.push(`<ul>${items.join('')}</ul>`);
      continue;
    }

    if (/^\s*\d+[.)]\s+/.test(lines[index])) {
      const items = [];
      while (index < lines.length && /^\s*\d+[.)]\s+/.test(lines[index])) {
        items.push(`<li>${renderInline(lines[index].replace(/^\s*\d+[.)]\s+/, '').trim())}</li>`);
        index += 1;
      }
      blocks.push(`<ol>${items.join('')}</ol>`);
      continue;
    }

    if (/^\s*>\s?/.test(lines[index])) {
      const quoteLines = [];
      while (index < lines.length && /^\s*>\s?/.test(lines[index])) {
        quoteLines.push(lines[index].replace(/^\s*>\s?/, '').trim());
        index += 1;
      }
      blocks.push(`<blockquote>${renderParagraphs(quoteLines)}</blockquote>`);
      continue;
    }

    const paragraphLines = [];
    while (index < lines.length && lines[index].trim() && !isBlockStart(lines[index])) {
      paragraphLines.push(lines[index].trim());
      index += 1;
    }
    blocks.push(`<p>${renderInline(paragraphLines.join(' '))}</p>`);
  }

  return blocks.join('');
}

function renderParagraphs(lines) {
  return lines
    .join('\n')
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${renderInline(paragraph.replace(/\n/g, ' ').trim())}</p>`)
    .join('');
}

function isBlockStart(line) {
  return /^```/.test(line) ||
    /^(#{1,6})\s+/.test(line) ||
    /^\s*[-*+]\s+/.test(line) ||
    /^\s*\d+[.)]\s+/.test(line) ||
    /^\s*>\s?/.test(line);
}

function renderInline(text) {
  const codeTokens = [];
  const textWithTokens = String(text).replace(/`([^`]*)`/g, (_, code) => {
    const token = `\u0000CODE${codeTokens.length}\u0000`;
    codeTokens.push(`<code>${escapeHtml(code)}</code>`);
    return token;
  });

  return renderInlineText(textWithTokens).replace(/\u0000CODE(\d+)\u0000/g, (_, tokenIndex) => {
    return codeTokens[Number(tokenIndex)] || '';
  });
}

function renderInlineText(text) {
  const linkTokens = [];
  const textWithLinkTokens = String(text).replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+|mailto:[^)\s]+)\)/g, (_, label, href) => {
    const token = `\u0000LINK${linkTokens.length}\u0000`;
    linkTokens.push(`<a href="${escapeAttribute(href)}" target="_blank">${renderInlineText(label)}</a>`);
    return token;
  });

  return escapeHtml(textWithLinkTokens)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/_([^_]+)_/g, '<em>$1</em>')
    .replace(/\[((?:[1-9]\d*\s*,\s*)*[1-9]\d*)\]/g, (_, values) => {
      return values.split(',').map((value) => {
        const number = value.trim();
        return `<a href="#citation-${number}" class="citation-ref" aria-label="Citation ${number}">[${number}]</a>`;
      }).join(' ');
    })
    .replace(/\u0000LINK(\d+)\u0000/g, (_, tokenIndex) => linkTokens[Number(tokenIndex)] || '');
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/'/g, '&#39;');
}
