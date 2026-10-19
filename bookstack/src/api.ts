import { getPreferenceValues, Keyboard } from "@raycast/api";
import { NodeHtmlMarkdown } from "node-html-markdown";

export type ContentType = "page" | "chapter" | "book" | "bookshelf";

export interface SearchResult {
  id: number;
  name: string;
  slug: string;
  type: ContentType;
  url: string;
  book_id?: number;
  chapter_id?: number | null;
  draft?: boolean;
  created_at: string;
  updated_at: string;
  book?: { id: number; name: string; slug: string };
  chapter?: { id: number; name: string; slug: string };
  preview_html: { name: string; content: string };
  tags: { name: string; value: string }[];
}

export interface PageListItem {
  id: number;
  book_id: number;
  chapter_id: number | null;
  name: string;
  slug: string;
  draft: boolean;
  updated_at: string;
  book_slug: string;
}

export interface Page {
  id: number;
  book_id: number;
  chapter_id: number | null;
  name: string;
  slug: string;
  html: string;
  markdown: string;
  updated_at: string;
  created_at: string;
  revision_count: number;
  created_by: { name: string };
  updated_by: { name: string };
  tags?: { name: string; value: string }[];
}

export interface Book {
  id: number;
  name: string;
  slug: string;
  description: string;
  updated_at: string;
  cover: { url: string } | null;
}

export interface BookContentPage {
  id: number;
  name: string;
  slug: string;
  draft: boolean;
  updated_at: string;
  url: string;
}

export interface BookContentChapter {
  id: number;
  name: string;
  slug: string;
  type: "chapter";
  url: string;
  updated_at: string;
  pages: BookContentPage[];
}

export interface BookDetails extends Book {
  contents: (BookContentChapter | (BookContentPage & { type: "page" }))[];
}

export interface Shelf {
  id: number;
  name: string;
  slug: string;
  description: string;
  updated_at: string;
  cover: { url: string } | null;
}

export interface ShelfDetails extends Shelf {
  books: Book[];
}

export function getBaseUrl(): string {
  const { baseUrl } = getPreferenceValues<Preferences>();
  return baseUrl.trim().replace(/\/+$/, "");
}

export async function api<T>(path: string, params?: Record<string, string>): Promise<T> {
  const { tokenId, tokenSecret } = getPreferenceValues<Preferences>();
  const url = new URL(`${getBaseUrl()}/api/${path}`);
  for (const [key, value] of Object.entries(params ?? {})) url.searchParams.set(key, value);
  const response = await fetch(url, {
    headers: { Authorization: `Token ${tokenId.trim()}:${tokenSecret.trim()}`, Accept: "application/json" },
  });
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const body = (await response.json()) as { error?: { message?: string } };
      if (body.error?.message) message = body.error.message;
    } catch {
      // keep status text
    }
    throw new Error(message);
  }
  return (await response.json()) as T;
}

export function bookUrl(slug: string) {
  return `${getBaseUrl()}/books/${slug}`;
}

export function shelfUrl(slug: string) {
  return `${getBaseUrl()}/shelves/${slug}`;
}

export function pageUrl(bookSlug: string, pageSlug: string) {
  return `${getBaseUrl()}/books/${bookSlug}/page/${pageSlug}`;
}

export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/** Returns markdown for a page, converting from HTML for WYSIWYG pages. */
export function pageMarkdown(page: Page): string {
  const body = page.markdown?.trim() ? page.markdown : NodeHtmlMarkdown.translate(page.html ?? "");
  // make relative links/images absolute
  return body.replace(/\]\((\/[^)\s]+)/g, (_, path) => `](${getBaseUrl()}${path}`);
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "";
  return new Date(value).toLocaleString();
}

/** Cmd+key on macOS, Ctrl+key on Windows. */
export function primaryShortcut(key: Keyboard.KeyEquivalent): Keyboard.Shortcut {
  return { macOS: { modifiers: ["cmd"], key }, Windows: { modifiers: ["ctrl"], key } };
}
