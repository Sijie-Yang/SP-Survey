/** Text response statistics: word frequency and length. */

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with',
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does',
  'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must', 'shall', 'can',
  'this', 'that', 'these', 'those', 'it', 'its', 'they', 'them', 'their', 'we', 'our',
  'you', 'your', 'i', 'my', 'me', 'he', 'she', 'his', 'her', 'not', 'no', 'yes', 'so',
  'if', 'then', 'than', 'when', 'where', 'what', 'which', 'who', 'how', 'why', 'all',
  'each', 'every', 'both', 'few', 'more', 'most', 'other', 'some', 'such', 'only', 'own',
  'same', 'too', 'very', 'just', 'also', 'now', 'here', 'there', 'about', 'into', 'through',
  'during', 'before', 'after', 'above', 'below', 'from', 'up', 'down', 'out', 'off', 'over',
  'under', 'again', 'further', 'once', '的', '了', '在', '是', '我', '有', '和', '就', '不',
  '人', '都', '一', '一个', '上', '也', '很', '到', '说', '要', '去', '你', '会', '着', '没有',
  '看', '好', '自己', '这', '那', '他', '她', '它', '们', '什么', '怎么', '为什么', '因为',
  '所以', '但是', '如果', '可以', '这个', '那个', '一些', '非常', '比较', '还是', '已经',
]);

function tokenize(text) {
  if (!text || typeof text !== 'string') return [];
  const normalized = text.toLowerCase()
    .replace(/[^\w\u4e00-\u9fff\s'-]/g, ' ')
    .trim();
  if (!normalized) return [];

  const tokens = [];
  const latin = normalized.match(/[a-z0-9'-]+/g) || [];
  latin.forEach((w) => {
    if (w.length >= 2 && !STOP_WORDS.has(w)) tokens.push(w);
  });

  const cjk = normalized.match(/[\u4e00-\u9fff]{2,}/g) || [];
  cjk.forEach((w) => {
    if (!STOP_WORDS.has(w)) tokens.push(w);
    for (let i = 0; i < w.length - 1; i += 1) {
      const bi = w.slice(i, i + 2);
      if (!STOP_WORDS.has(bi)) tokens.push(bi);
    }
  });

  return tokens;
}

export function wordFrequency(texts, topN = 20) {
  const freq = {};
  for (const text of texts) {
    const seen = new Set();
    for (const token of tokenize(String(text))) {
      if (seen.has(token)) continue;
      seen.add(token);
      freq[token] = (freq[token] || 0) + 1;
    }
  }
  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([word, count]) => ({ word, count }));
}

export function textLengthStats(texts) {
  const lengths = texts.map((t) => String(t || '').trim().length).filter((l) => l > 0);
  if (!lengths.length) return { n: 0, mean: null, median: null };
  const sorted = [...lengths].sort((a, b) => a - b);
  const mean = lengths.reduce((a, b) => a + b, 0) / lengths.length;
  const mid = Math.floor(sorted.length / 2);
  const med = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return { n: lengths.length, mean, median: med };
}
