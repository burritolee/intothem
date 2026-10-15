import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const home = readFileSync(join(repoRoot, "index.html"), "utf8");
const books = readFileSync(join(repoRoot, "books.html"), "utf8");
const nadasal = readFileSync(join(repoRoot, "naneun-dasi-saraya-handa.html"), "utf8");
const oseonji = readFileSync(join(repoRoot, "oseonji-poem.html"), "utf8");
const css = readFileSync(join(repoRoot, "book-detail.css"), "utf8");

const nadasalUrl = "https://ebook-product.kyobobook.co.kr/dig/epd/ebook/E000013561711";
const oseonjiUrl = "https://ebook-product.kyobobook.co.kr/dig/epd/ebook/E000013561948";
const safeLink = (url) => new RegExp(`href="${url}"[^>]*target="_blank"[^>]*rel="noopener noreferrer"`, "g");

test("나는 다시 살아야 한다 is shown as published and no longer takes reservations", () => {
  assert.doesNotMatch(nadasal, /PRE-ORDER OPEN|예약 판매|예약하기/);
  assert.match(nadasal, /PUBLISHED · CAMINO DEL NORTE/);
  assert.match(nadasal, /<dt>판매<\/dt><dd>판매 중 · 18,000원<\/dd>/);
  assert.equal(nadasal.match(safeLink(nadasalUrl))?.length, 2);
  assert.match(books, /class="book-item published-book"[^>]*>[\s\S]*?나는 다시 살아야 한다[\s\S]*?<p class="meta">PUBLISHED<\/p>/);
  assert.match(home, /NOW ON SALE · 18,000원/);
  assert.doesNotMatch(home, /PRE-ORDER OPEN|예약 판매 신청하기/);
});

test("오선지에 쓰는 시 is published and links directly to Kyobo eBook", () => {
  assert.doesNotMatch(oseonji, /COMING SOON|발간 예정/);
  assert.match(oseonji, /PUBLISHED · INTOTHEM BOOKS/);
  assert.equal(oseonji.match(safeLink(oseonjiUrl))?.length, 2);
  assert.equal(books.match(safeLink(oseonjiUrl))?.length, 1);
  assert.match(books, /class="book-item published-book"[^>]*>[\s\S]*?오선지에 쓰는 시[\s\S]*?<p class="meta">PUBLISHED<\/p>/);
  assert.match(home, /<p>PUBLISHED<\/p><h3>오선지에 쓰는 시<\/h3>/);
});

test("오선지 eBook hero link has button styling and cache-busted CSS", () => {
  assert.match(css, /\.poem-hero \.poem-ebook\s*\{/);
  assert.match(oseonji, /book-detail\.css\?v=20261008-2/);
});

test("책 소개 목록에서 전구사람은 노출하지 않는다", () => {
  assert.doesNotMatch(books, /전구사람|lamp-man\.html|jeongu-saram/);
});
