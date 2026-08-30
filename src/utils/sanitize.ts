/**
 * @file utils/sanitize.ts
 * @description HTML and markdown sanitization utilities.
 *
 * User-provided content (question text, option text) is stored as markdown
 * and rendered as HTML after being processed by the remark pipeline. This
 * creates an XSS risk: a maliciously crafted question file from a GitHub
 * repo could inject `<script>` tags or event handlers.
 *
 * Noledge's defense-in-depth approach:
 *   1. Sanitize markdown BEFORE parsing (strip raw HTML blocks)
 *   2. Sanitize rendered HTML AFTER the remark → HTML pipeline
 *   3. Use React's JSX (which escapes by default) for all dynamic content
 *   4. Use dangerouslySetInnerHTML ONLY for the sanitized rendered output,
 *      never for raw user input
 *
 * This file implements layers 1 and 2. Layer 3-4 are handled in the
 * component code.
 *
 * Note: This is a lightweight built-from-scratch sanitizer. For a production
 * system handling untrusted public content, consider DOMPurify. Noledge's
 * content comes from the user's own GitHub repos and Obsidian vaults, so
 * the threat model is lower (the user controls the content). But we still
 * sanitize as defense-in-depth — a compromised Git repo or malformed file
 * shouldn't be able to inject scripts.
 */

// =============================================================================
// Dangerous HTML patterns to strip
// =============================================================================

/**
 * DANGEROUS_TAG_PATTERN — matches any HTML tags that can execute scripts
 * or load external resources.
 *
 * Covers:
 *   <script ...>...</script>  — inline JavaScript
 *   <iframe ...>              — embedded documents
 *   <object ...>              — legacy plugin content
 *   <embed ...>               — media embeds
 *   <link ...>                — stylesheet injection
 *   <meta ...>                — meta-refresh redirects
 *   <base ...>                — base URL hijacking
 *
 * The `gi` flags make it global (all matches) and case-insensitive.
 */
const DANGEROUS_TAG_PATTERN = /<(script|iframe|object|embed|link|meta|base)[^>]*>[\s\S]*?<\/\1>|<(script|iframe|object|embed|link|meta|base)[^>]*\/?>/gi;

/**
 * EVENT_HANDLER_PATTERN — matches inline event handler attributes.
 *
 * Covers: onclick, onload, onerror, onmouseover, onfocus, etc.
 * The `on` prefix + any word characters = an event handler attribute.
 * Strips the entire attribute including its value.
 */
const EVENT_HANDLER_PATTERN = /\son\w+\s*=\s*["'][^"']*["']/gi;

/**
 * JAVASCRIPT_URL_PATTERN — matches javascript: pseudo-protocol URLs.
 *
 * Used in href="javascript:..." and src="javascript:..." to execute code.
 * Replaces with '#' (a safe no-op URL).
 */
const JAVASCRIPT_URL_PATTERN = /\bjavascript\s*:/gi;

/**
 * DATA_URL_PATTERN — matches data: URLs that could embed HTML or scripts.
 *
 * data:text/html is particularly dangerous. We allow data: URLs for images
 * (data:image/...) since those are commonly used for inline base64 images,
 * but block everything else.
 */
const DANGEROUS_DATA_URL_PATTERN = /\bdata:(?!image\/)(text|application|[^;,\s]+\/[^;,\s]+)/gi;

// =============================================================================
// Sanitize Functions
// =============================================================================

/**
 * sanitizeMarkdown — strip dangerous patterns from raw markdown before parsing.
 *
 * Operates on the raw markdown string. This catches threats before the
 * markdown parser even runs, preventing the parser from being used as
 * a vector (e.g., some parsers evaluate HTML blocks as-is).
 *
 * @param markdown Raw markdown string from file system or network
 * @returns Sanitized markdown string, safe to pass to the remark parser
 */
export function sanitizeMarkdown(markdown: string): string {
  return markdown
    .replace(DANGEROUS_TAG_PATTERN, '')          // Strip dangerous HTML tags
    .replace(EVENT_HANDLER_PATTERN, '')           // Strip event handlers
    .replace(JAVASCRIPT_URL_PATTERN, '#')         // Replace JS URLs
    .replace(DANGEROUS_DATA_URL_PATTERN, '');     // Strip dangerous data URLs
}

/**
 * sanitizeHtml — strip dangerous patterns from remark-rendered HTML output.
 *
 * This is the second pass, operating on the HTML string that remark
 * produced from the (already sanitized) markdown. It's a belt-and-suspenders
 * check — if sanitizeMarkdown missed anything, this catches it.
 *
 * @param html HTML string from the remark → html pipeline
 * @returns Sanitized HTML, safe to set via dangerouslySetInnerHTML
 */
export function sanitizeHtml(html: string): string {
  return html
    .replace(DANGEROUS_TAG_PATTERN, '')
    .replace(EVENT_HANDLER_PATTERN, '')
    .replace(JAVASCRIPT_URL_PATTERN, '#')
    .replace(DANGEROUS_DATA_URL_PATTERN, '');
}

/**
 * renderMarkdownToHtml — Converts markdown formatting (code blocks, inline code, bold,
 * italic, headings, blockquotes, lists, linebreaks) into sanitized HTML string.
 */
export function renderMarkdownToHtml(text: string): string {
  if (!text) return '';

  if (/<(p|div|h[1-6]|ul|ol|li|blockquote|pre|code|strong|em|br)[^>]*>/i.test(text)) {
    return sanitizeHtml(text);
  }

  let html = text;

  // 1. Code blocks (```lang ... ```)
  html = html.replace(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const escCode = code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return `<pre class="md-code-block"><code class="language-${lang}">${escCode.trim()}</code></pre>`;
  });

  // 2. Inline code (`code`)
  html = html.replace(/`([^`]+)`/g, (_, code) => {
    const escCode = code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return `<code class="md-inline-code">${escCode}</code>`;
  });

  // 3. Headings (# h1, ## h2, ### h3)
  html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
  html = html.replace(/^## (.*$)/gim, '<h2>$2</h2>');
  html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');

  // 4. Blockquotes (> quote)
  html = html.replace(/^> (.*$)/gim, '<blockquote>$1</blockquote>');

  // 5. Bold & Italic
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  html = html.replace(/_([^_]+)_/g, '<em>$1</em>');

  // 6. Unordered lists (- item, * item)
  html = html.replace(/^\s*[-*]\s+(.*$)/gim, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>)/gim, '<ul>$1</ul>');
  html = html.replace(/<\/ul>\s*<ul>/g, '');

  // 7. Line breaks
  html = html.replace(/\n\n/g, '<br/><br/>');

  return sanitizeHtml(html);
}

/**
 * sanitizePlainText — strip all HTML tags from a string, leaving plain text.
 *
 * Used for: voice question matching (compare spoken text to the plain-text
 * version of the answer), fuzzy matching for typing questions, accessibility
 * labels.
 *
 * @param html A string that may contain HTML tags
 * @returns Plain text with all tags removed
 */
export function sanitizePlainText(html: string): string {
  // Replace common block-level tags with spaces to preserve word boundaries.
  // Without this, "<p>hello</p><p>world</p>" → "helloworld" instead of "hello world".
  const withSpaces = html
    .replace(/<\/(p|div|h[1-6]|li|br|tr|td|th)>/gi, ' ')
    .replace(/<br\s*\/?>/gi, ' ');
  // Remove all remaining tags.
  const textOnly = withSpaces.replace(/<[^>]+>/g, '');
  // Decode common HTML entities.
  return decodeHtmlEntities(textOnly).replace(/\s+/g, ' ').trim();
}

/**
 * decodeHtmlEntities — replace common HTML entities with their characters.
 *
 * A minimal subset covering the most common entities in markdown-rendered HTML.
 * Not a full entity decoder — for full decoding, a DOM parser is needed.
 * But we avoid the DOM in server-side code (API routes run in Node.js).
 *
 * @param text Text containing HTML entities
 * @returns Text with entities decoded
 */
function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&mdash;/g, '\u2014')
    .replace(/&ndash;/g, '\u2013')
    .replace(/&hellip;/g, '\u2026');
}

/**
 * truncate — shorten a string to a maximum length with an ellipsis.
 *
 * Used for: preview text in deck cards, option previews in the management UI,
 * log messages that might contain very long content.
 *
 * Truncates at the nearest word boundary before `maxLength` to avoid
 * cutting a word in half (e.g., "biological" → "biolog…" looks wrong).
 *
 * @param text      The string to truncate
 * @param maxLength Maximum character count (including ellipsis)
 * @returns         Truncated string with ellipsis if truncation occurred
 */
export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  // Find the last space before the limit
  const cutAt = text.lastIndexOf(' ', maxLength - 1);
  const truncated = cutAt > 0 ? text.slice(0, cutAt) : text.slice(0, maxLength - 1);
  return truncated + '…';
}
