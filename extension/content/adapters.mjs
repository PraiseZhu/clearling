// X selectors verified on a public Article and its profile card, 2026-10-01.
export const ARTICLE_ROOT = '[data-testid="twitterArticleRichTextView"],[data-testid="longformRichTextComponent"]';
export const ARTICLE_TITLE = '[data-testid="twitter-article-title"]';
export const CARD_TEXT = '[data-testid="article-cover-image"] + div [dir="auto"]';
export const X_CANDIDATES = `[data-testid="tweetText"],${ARTICLE_TITLE},${CARD_TEXT},${ARTICLE_ROOT.split(',').map(s => `${s} [data-block="true"]`).join(',')}`;

export function xKind(element) {
  if (element.matches('[data-testid="tweetText"]')) return 'tweet';
  if (element.matches(ARTICLE_TITLE)) return 'article-title';
  if (element.matches(CARD_TEXT)) return 'article-card';
  if (element.matches('[data-block="true"]') && element.closest(ARTICLE_ROOT) && !element.querySelector('[data-testid="tweetText"],section,[data-block="true"]') && element.tagName !== 'SECTION') return 'article-paragraph';
  return null;
}
