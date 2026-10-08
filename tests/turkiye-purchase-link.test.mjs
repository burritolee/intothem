import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const detail = readFileSync(join(repoRoot, "turkiye-yeah.html"), "utf8");
const books = readFileSync(join(repoRoot, "books.html"), "utf8");
const css = readFileSync(join(repoRoot, "book-detail.css"), "utf8");
const purchaseUrl = "https://ebook-product.kyobobook.co.kr/dig/epd/ebook/E000013410053";
const safePurchaseLink = new RegExp(`href="${purchaseUrl}"[^>]*target="_blank"[^>]*rel="noopener noreferrer"`, "g");

test("Turkiye book exposes the Kyobo eBook link like the featured book", () => {
  assert.equal(detail.match(safePurchaseLink)?.length, 2, "detail page must link from hero and book information");
  assert.equal(books.match(safePurchaseLink)?.length, 1, "books listing must include a direct purchase button");
  assert.match(detail, /class="turkiye-ebook"/);
  assert.match(detail, /class="book-contact"/);
  assert.match(detail, /교보문고 eBook 구매하기/);
});

test("Turkiye eBook hero link has button styling and cache-busted CSS", () => {
  assert.match(css, /\.turkiye-detail-page \.turkiye-ebook\s*\{/);
  assert.match(detail, /book-detail\.css\?v=20261008-1/);
});
