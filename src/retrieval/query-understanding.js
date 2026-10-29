import { normalizeQuery, tokenize } from './text.js';

// Expanded tokens are retrieval hints, not evidence: they are blended into the
// lexical score at reduced weight and never on their own make an answer
// "supported". See docs/adr/0001-query-expansion-is-a-retrieval-hint.md.
export const EXPANSION_WEIGHT = 0.45;

// Stems of the terms that only show up in text about bidirectional layout.
// Kept in stemmed form because chunk and query tokens have both been stemmed.
const DIRECTION_TERMS = ['right-to-left', 'rtl', 'bidi'];
export const DIRECTION_TERM_SET = new Set(DIRECTION_TERMS);

// Only right-to-left languages are expanded: for LTR locales a direction term
// adds nothing a plain keyword search would not already find.
const RTL_LANGUAGE_NAMES = {
  ar: 'arabic',
  he: 'hebrew',
  fa: 'persian',
  ur: 'urdu',
  ps: 'pashto',
  ku: 'kurdish',
  sd: 'sindhi',
  ug: 'uyghur',
  dv: 'dhivehi',
  yi: 'yiddish'
};

const REGION_ALIASES = {
  EG: ['egypt', 'egyptian', '埃及'],
  SA: ['saudi arabia', '沙特阿拉伯'],
  AE: ['united arab emirates', 'uae', '阿联酋'],
  QA: ['qatar', '卡塔尔'],
  KW: ['kuwait', '科威特'],
  BH: ['bahrain', '巴林'],
  OM: ['oman', '阿曼'],
  JO: ['jordan', '约旦'],
  LB: ['lebanon', '黎巴嫩'],
  SY: ['syria', '叙利亚'],
  IQ: ['iraq', '伊拉克'],
  IL: ['israel', '以色列'],
  PS: ['palestine', 'palestinian territories', '巴勒斯坦'],
  IR: ['iran', '伊朗'],
  PK: ['pakistan', '巴基斯坦'],
  AF: ['afghanistan', '阿富汗'],
  MA: ['morocco', '摩洛哥'],
  DZ: ['algeria', '阿尔及利亚'],
  TN: ['tunisia', '突尼斯'],
  LY: ['libya', '利比亚'],
  SD: ['sudan', '苏丹'],
  CN: ['china', '中国'],
  TW: ['taiwan', '台湾'],
  JP: ['japan', '日本'],
  KR: ['korea', 'south korea', '韩国'],
  IN: ['india', '印度'],
  BD: ['bangladesh', '孟加拉国'],
  LK: ['sri lanka', '斯里兰卡'],
  TH: ['thailand', '泰国'],
  GR: ['greece', '希腊'],
  TR: ['turkey', 'türkiye', '土耳其'],
  RU: ['russia', '俄罗斯']
};

const LANGUAGE_ALIASES = {
  ar: ['arabic', '阿拉伯语', '阿拉伯文'],
  he: ['hebrew', '希伯来语', '希伯来文'],
  fa: ['persian', 'farsi', '波斯语'],
  ur: ['urdu', '乌尔都语'],
  ps: ['pashto', '普什图语'],
  ku: ['kurdish', '库尔德语'],
  sd: ['sindhi', '信德语'],
  ug: ['uyghur', 'uighur', '维吾尔语'],
  dv: ['dhivehi', 'divehi', '迪维希语'],
  yi: ['yiddish', '意第绪语'],
  zh: ['chinese', 'mandarin', '中文', '汉语'],
  ja: ['japanese', '日语'],
  ko: ['korean', '韩语', '朝鲜语'],
  ru: ['russian', '俄语'],
  el: ['greek', '希腊语'],
  th: ['thai', '泰语'],
  hi: ['hindi', '印地语'],
  bn: ['bengali', '孟加拉语'],
  ta: ['tamil', '泰米尔语']
};

const SCRIPT_ALIASES = {
  Arab: ['arabic script', 'arabic alphabet'],
  Hebr: ['hebrew script', 'hebrew alphabet'],
  Cyrl: ['cyrillic', 'cyrillic script'],
  Deva: ['devanagari']
};

const ALIAS_ENTRIES = [
  ...Object.entries(REGION_ALIASES).flatMap(([region, aliases]) => aliases.map((alias) => ({ alias, kind: 'region', value: region }))),
  ...Object.entries(LANGUAGE_ALIASES).flatMap(([language, aliases]) => aliases.map((alias) => ({ alias, kind: 'language', value: language }))),
  ...Object.entries(SCRIPT_ALIASES).flatMap(([script, aliases]) => aliases.map((alias) => ({ alias, kind: 'script', value: script })))
].map((entry) => ({ ...entry, pattern: aliasPattern(entry.alias) }));

// Detect locales, languages, and scripts mentioned in a query and derive the
// retrieval terms they imply: "Egypt" implies Arabic, a right-to-left script,
// and therefore bidi layout guidance.
export function analyzeQuery(query = '') {
  const normalized = normalizeQuery(query);
  const detections = [];

  for (const entry of ALIAS_ENTRIES) {
    if (!entry.pattern.test(normalized)) continue;
    const detection = resolveAlias(entry);
    if (detection) detections.push(detection);
  }

  const unique = dedupeDetections(detections);
  return { detections: unique, terms: expansionTerms(unique) };
}

function resolveAlias({ kind, value }) {
  try {
    if (kind === 'region') {
      const locale = new Intl.Locale(`und-${value}`).maximize();
      return detection(kind, value, locale, locale.language, locale.script);
    }
    if (kind === 'language') {
      const locale = new Intl.Locale(value).maximize();
      return detection(kind, value, locale, locale.language, locale.script);
    }
    // Script-only detections have no language: ask CLDR for the script itself.
    const locale = new Intl.Locale(`und-${value}`);
    return { kind, value, locale: '', language: '', script: value, direction: textDirection(locale) };
  } catch {
    return null;
  }
}

function detection(kind, value, locale, language, script) {
  return {
    kind,
    value,
    locale: locale.toString(),
    language: language || '',
    script: script || '',
    direction: textDirection(locale)
  };
}

function textDirection(locale) {
  try {
    return locale.getTextInfo().direction === 'rtl' ? 'rtl' : 'ltr';
  } catch {
    return 'ltr';
  }
}

function expansionTerms(detections) {
  const terms = new Map();
  const add = (value) => {
    const token = tokenize(value)[0];
    if (token && !terms.has(token)) terms.set(token, EXPANSION_WEIGHT);
  };

  for (const item of detections) {
    if (item.direction !== 'rtl') continue;
    if (item.language && RTL_LANGUAGE_NAMES[item.language]) add(RTL_LANGUAGE_NAMES[item.language]);
    for (const term of DIRECTION_TERMS) add(term);
  }

  return [...terms].map(([token, weight]) => ({ token, weight }));
}

function dedupeDetections(detections) {
  const seen = new Set();
  const unique = [];
  for (const item of detections) {
    const key = `${item.kind}:${item.value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }
  return unique;
}

function aliasPattern(alias) {
  const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // CJK aliases have no word boundaries to anchor on: substring matching is
  // the only option, and CJK queries rarely embed one place name in another.
  if (/\p{Script=Han}/u.test(alias)) return new RegExp(escaped, 'u');
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'u');
}
