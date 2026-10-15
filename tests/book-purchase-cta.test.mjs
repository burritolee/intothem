import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const home = readFileSync(join(repoRoot, "index.html"), "utf8");
const books = readFileSync(join(repoRoot, "books.html"), "utf8");
const homeCss = readFileSync(join(repoRoot, "home-overrides.css"), "utf8");
const booksCss = readFileSync(join(repoRoot, "books-overrides.css"), "utf8");
const kakaoUrl = "https://open.kakao.com/o/s3QVW2se";

test("첫 페이지 책 소개에 구매 문의 영역이 노출된다", () => {
  assert.match(home, /<section class="home-book-purchase-cta" aria-label="책 구매 문의">/);
  assert.match(home, /책 구매를 원하시면 카카오 오픈채팅으로 문의해주세요\./);
  assert.match(home, new RegExp(`href="${kakaoUrl}"[^>]*target="_blank"[^>]*rel="noopener noreferrer"`));
  assert.ok(
    home.indexOf('class="home-book-purchase-cta"') < home.indexOf('class="now-book-feature"'),
    "구매 문의 영역은 첫 페이지 책 소개보다 먼저 보여야 한다"
  );
});

test("인투뎀 북스 페이지의 구매 문의 영역은 책 목록 위에 있다", () => {
  assert.equal(books.match(/class="book-purchase-cta"/g)?.length, 1);
  assert.ok(
    books.indexOf('class="book-purchase-cta"') < books.indexOf('class="book-grid"'),
    "구매 문의 영역은 책 카드보다 먼저 보여야 한다"
  );
  assert.doesNotMatch(booksCss, /book-purchase-cta[^{}]*margin:\s*-/);
});

test("구매 문의 영역은 데스크톱과 모바일에 맞게 배치된다", () => {
  assert.match(homeCss, /\.home-book-purchase-cta\s*\{[^}]*grid-template-columns:1fr auto/);
  assert.match(homeCss, /\.home-book-purchase-cta a\s*\{[^}]*background:#68764d/);
  assert.match(homeCss, /@media \(max-width:650px\)[\s\S]*\.home-book-purchase-cta\s*\{[^}]*grid-template-columns:1fr/);
  assert.match(booksCss, /@media \(max-width: 760px\)[\s\S]*\.books-page \.book-purchase-cta\s*\{[^}]*flex-direction:column/);
});
