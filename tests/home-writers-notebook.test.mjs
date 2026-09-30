import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(join(repoRoot, "index.html"), "utf8");
const css = readFileSync(join(repoRoot, "home-overrides.css"), "utf8");
const imagePath = join(repoRoot, "assets", "writers-notebook-home.jpg");

test("home page links directly to the writers' notebook", () => {
  assert.match(html, /<section class="home-writers-notebook"/);
  assert.match(html, /<h2 id="home-writers-notebook-title">작가의<br>습작노트<\/h2>/);
  assert.match(html, /<a href="writers-notebook\.html">작가의 습작노트 가기/);
  assert.ok(
    html.indexOf('<div class="now-books-showcase">') < html.indexOf('<section class="home-writers-notebook"'),
    "writers' notebook must follow the book showcase"
  );
  assert.ok(
    html.indexOf('<section class="home-writers-notebook"') < html.indexOf('<div class="now-community-row">'),
    "writers' notebook must sit directly before the community cards"
  );
});

test("writers' notebook photo is local, descriptive, and lazy loaded", () => {
  assert.match(html, /<img src="assets\/writers-notebook-home\.jpg"[^>]*width="1600"[^>]*height="2400"/);
  assert.match(html, /alt="창가의 원목 테이블 위에 펼쳐진 노트와 펜"/);
  assert.match(html, /loading="lazy"/);
  assert.ok(existsSync(imagePath), "home notebook photo must exist");
  assert.ok(statSync(imagePath).size > 20_000, "home notebook photo must not be an empty placeholder");
});

test("writers' notebook callout has desktop and mobile styling", () => {
  assert.match(css, /\.home-writers-notebook\s*\{/);
  assert.match(css, /\.home-writers-notebook-copy a\s*\{/);
  assert.match(css, /@media \(max-width:650px\)[\s\S]*\.home-writers-notebook\s*\{\s*grid-template-columns:1fr/);
});
