import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const htmlPath = join(repoRoot, "writers-notebook.html");
const clientPath = join(repoRoot, "writers-notebook.js");
const legacyPath = join(repoRoot, "writers-public-notes.js");
const bootstrapPath = join(repoRoot, "scripts", "writers-bootstrap.mjs");

const read = (path) => readFileSync(path, "utf8");
const html = read(htmlPath);
const clientSource = read(clientPath);
const legacySource = read(legacyPath);
const bootstrapSource = existsSync(bootstrapPath) ? read(bootstrapPath) : "";
const writerSqlPaths = readdirSync(repoRoot)
  .filter((name) => /^supabase-writers.*\.sql$/i.test(name))
  .map((name) => join(repoRoot, name));
const sqlSource = writerSqlPaths.map(read).join("\n");

function assertMatches(source, pattern, message) {
  pattern.lastIndex = 0;
  assert.ok(pattern.test(source), message || `expected source to match ${pattern}`);
}

function assertDoesNotMatch(source, pattern, message) {
  pattern.lastIndex = 0;
  assert.ok(!pattern.test(source), message || `expected source not to match ${pattern}`);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function tagWithId(source, id) {
  const escapedId = escapeRegExp(id);
  return source.match(new RegExp(`<([a-z][\\w-]*)\\b(?=[^>]*\\bid\\s*=\\s*["']${escapedId}["'])[^>]*>`, "i"))?.[0] || "";
}

function attribute(tag, name) {
  const match = tag.match(new RegExp(`\\b${escapeRegExp(name)}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return match ? (match[1] ?? match[2] ?? match[3]) : undefined;
}

function walkFiles(directory) {
  if (!existsSync(directory)) return [];
  const paths = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) paths.push(...walkFiles(path));
    else if (entry.isFile()) paths.push(path);
  }
  return paths;
}

function gitVisibleFiles() {
  try {
    return execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
      cwd: repoRoot,
      encoding: "utf8"
    }).split("\0").filter(Boolean).map((path) => join(repoRoot, path));
  } catch {
    return [];
  }
}

function securityRelevantFiles() {
  const candidates = new Set([
    htmlPath,
    clientPath,
    legacyPath,
    bootstrapPath,
    ...writerSqlPaths,
    join(repoRoot, "vercel.json"),
    ...walkFiles(join(repoRoot, "supabase", "functions")),
    ...gitVisibleFiles().filter((path) => {
      const name = relative(repoRoot, path).replaceAll("\\", "/");
      return name === "vercel.json"
        || name === ".openai/hosting.json"
        || name === "supabase/config.toml"
        || name.startsWith("supabase/functions/")
        || /(^|\/)\.env(?:\.|$)/.test(name);
    })
  ]);
  return [...candidates].filter((path) => existsSync(path) && statSync(path).isFile() && path !== fileURLToPath(import.meta.url));
}

function lineNumberAt(source, index) {
  return source.slice(0, index).split("\n").length;
}

function quotedFourDigitFindings(path, source) {
  // A four-digit literal is suspicious in JS/TS/SQL/config. In HTML, length and
  // placeholder attributes are presentation constraints rather than credentials.
  const scanned = path.endsWith(".html")
    ? source.replace(/\b(?:minlength|maxlength|placeholder)\s*=\s*(["'])\d{4}\1/gi, "")
    : source;
  const findings = [];
  for (const match of scanned.matchAll(/(["'`])\d{4}\1/g)) {
    findings.push(lineNumberAt(scanned, match.index));
  }
  return findings;
}

function barePinLiteralFindings(source) {
  const findings = [];
  const patterns = [
    /(?:pin|code)[\w.]*\s*(?:===?|!==?|=|:)\s*\d{4}\b/gi,
    /\b\d{4}\s*(?:===?|!==?)\s*[\w.]*?(?:pin|code)/gi,
    /(?:const|let|var)\s+\w*(?:pin|code)\w*\s*=\s*(?:(?:new\s+(?:Map|Set)|Object\.freeze)\s*\(\s*)?[\[{][\s\S]{0,3000}?[\]}]\s*\)?\s*;?/gi,
    /(?:pin|code|crypt)[^;\n]{0,200}\b\d{4}\b/gi
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      if (/\b\d{4}\b/.test(match[0])) findings.push(lineNumberAt(source, match.index));
    }
  }
  return [...new Set(findings)];
}

function serviceSecretFindings(source) {
  const findings = [];
  for (const match of source.matchAll(/\bsb_secret_[A-Za-z0-9_-]+/g)) {
    findings.push(lineNumberAt(source, match.index));
  }
  for (const match of source.matchAll(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g)) {
    try {
      const payload = JSON.parse(Buffer.from(match[0].split(".")[1], "base64url").toString("utf8"));
      if (payload.role === "service_role") findings.push(lineNumberAt(source, match.index));
    } catch {
      // An undecodable JWT-shaped value is handled by the assignment check below.
    }
  }
  const assignment = /(?:SUPABASE_SERVICE_ROLE_KEY|\w*service[_-]?role\w*)\s*(?:=|:)\s*(["'`])([^"'`\n]+)\1/gi;
  for (const match of source.matchAll(assignment)) {
    const value = match[2].trim();
    const indirect = /^(?:\$\{|env\(|process\.env|Deno\.env|<|your[_-]|replace[_-]|example)/i.test(value)
      || value === "SUPABASE_SERVICE_ROLE_KEY";
    if (!indirect) findings.push(lineNumberAt(source, match.index));
  }
  return [...new Set(findings)];
}

function loadLegacyNotes() {
  const sandbox = { window: {} };
  vm.runInNewContext(legacySource, sandbox, { filename: legacyPath });
  return sandbox.window.BURRITO_PUBLIC_NOTES;
}

const legacyFixtures = [
  {
    id: "burrito-project-hail-mary",
    title: "프로젝트 헤일메리를 읽고",
    createdAt: "2026-08-15T00:00:00+09:00",
    length: 2102,
    sha256: "c0b81fee0bfb83c50178520d742a5f49bcbf335f16d6b90b93709935a56cb02a"
  },
  {
    id: "burrito-abandonment-anxiety",
    title: "유기불안, 그 깊은 외로움에 대하여...",
    createdAt: "2026-07-31T00:00:00+09:00",
    length: 3486,
    sha256: "c6f5f61571735627e04cc4ccb67127d895f7363f4162022702242e391a2e23db"
  },
  {
    id: "burrito-love-and-be-loved",
    title: "사랑하고 사랑받자",
    createdAt: "2024-09-10T00:00:00+09:00",
    length: 3481,
    sha256: "9d5b003a73faa82125bb36f944b406ecdb127470d2e4a01d830217e771d19012"
  },
  {
    id: "burrito-inner-child",
    title: "내 안에 어린 ‘나’",
    createdAt: "2024-06-03T00:00:00+09:00",
    length: 3114,
    sha256: "2f0935ba949cfb4ba40f24cdd3ab1988f24857e7fa61a2dd310cb48eb3ed6a2c"
  }
];

test("writers-notebook browser script has valid JavaScript syntax", () => {
  const result = spawnSync(process.execPath, ["--check", clientPath], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("writer page exposes only the four-digit PIN entry UI", async (t) => {
  await t.test("write trigger, dialog, form, and accessible status exist", () => {
    const trigger = tagWithId(html, "writer-write-button");
    const dialog = tagWithId(html, "writer-code-dialog");
    const form = tagWithId(html, "writer-code-form");
    assertMatches(trigger, /^<button\b/i, "#writer-write-button must be a button");
    assertMatches(html.slice(html.indexOf(trigger), html.indexOf(trigger) + 220), /작가\s*글쓰기/, "write trigger must be labelled 작가 글쓰기");
    assertMatches(dialog, /^<dialog\b/i, "#writer-code-dialog must be a native dialog");
    assertMatches(form, /^<form\b/i, "#writer-code-form must be a form");
    assertMatches(html, /id=["']writer-code-note["'][^>]*aria-live=["']polite["']/i, "PIN status must be announced with aria-live=polite");
  });

  await t.test("PIN field is masked, numeric, and exactly four digits", () => {
    const input = tagWithId(html, "writer-code");
    assertMatches(input, /^<input\b/i, "#writer-code must be an input");
    assert.equal(attribute(input, "type"), "password");
    assert.equal(attribute(input, "inputmode"), "numeric");
    assert.equal(attribute(input, "minlength"), "4");
    assert.equal(attribute(input, "maxlength"), "4");
    assertMatches(attribute(input, "pattern") || "", /^(?:\[0-9\]|\\d)\{4\}$/, "PIN pattern must accept exactly four digits");
    assert.ok(/\brequired\b/i.test(input));
    assert.ok(attribute(input, "aria-describedby"), "PIN field must reference status/help text");
  });

  await t.test("legacy email login and preview entry are gone", () => {
    assertDoesNotMatch(html, /<input\b[^>]*\btype\s*=\s*["']email["']/i, "email input must be removed");
    assertDoesNotMatch(html, /<[^>]+\bid\s*=\s*["']writer-login["']/i, "legacy #writer-login must be removed");
    assertDoesNotMatch(html, /<input\b[^>]*\bname\s*=\s*["']email["']/i, "legacy named email field must be removed");
    assertDoesNotMatch(html, /writers-studio-preview\.html/i, "legacy studio preview link must be removed");
  });

  await t.test("legacy note bundle remains a temporary runtime fallback", () => {
    assert.ok(existsSync(legacyPath));
    const legacyScriptIndex = html.search(/<script\b[^>]*src\s*=\s*["'][^"']*writers-public-notes\.js/i);
    const clientScriptIndex = html.search(/<script\b[^>]*src\s*=\s*["'][^"']*writers-notebook\.js/i);
    assert.ok(legacyScriptIndex >= 0, "legacy fallback bundle must remain loaded until remote import is complete");
    assert.ok(clientScriptIndex > legacyScriptIndex, "legacy fallback bundle must load before writers-notebook.js");
  });
});

test("writer client uses per-tab OTP authentication through an Edge Function", async (t) => {
  await t.test("Supabase auth persists only in sessionStorage", () => {
    assertMatches(clientSource, /storage\s*:\s*window\.sessionStorage/, "Supabase auth storage must be window.sessionStorage");
    assertMatches(clientSource, /persistSession\s*:\s*true/, "Supabase session persistence must be enabled for the current tab");
    assertDoesNotMatch(clientSource, /storage\s*:\s*window\.localStorage/, "Supabase auth must not persist in localStorage");
    assertDoesNotMatch(clientSource, /localStorage\s*\.\s*setItem\s*\(/, "client must not write credentials to localStorage");
    assertDoesNotMatch(clientSource, /sessionStorage\s*\.\s*setItem\s*\([^)]*(?:pin|code)/is, "client must not persist the PIN in sessionStorage");
    const withoutLegacyCleanup = clientSource.replace(/window\.localStorage\.removeItem\s*\(\s*["'][^"']+["']\s*\)/g, "");
    assertDoesNotMatch(withoutLegacyCleanup, /\blocalStorage\b/, "localStorage is allowed only to remove the obsolete writer auth key");
  });

  await t.test("PIN exchange invokes Edge and verifies the returned one-time token", () => {
    assertMatches(clientSource, /\.functions\s*\.\s*invoke\s*\(/, "PIN exchange must call a Supabase Edge Function");
    assertMatches(clientSource, /\.auth\s*\.\s*verifyOtp\s*\(/, "client must establish the session with verifyOtp");
    assertMatches(clientSource, /token_hash\s*:/, "verifyOtp must receive a token_hash returned by Edge");
    assertMatches(clientSource, /type\s*:\s*["']email["']/, "verifyOtp must verify the magic-link hash with type=email");
    assertDoesNotMatch(clientSource, /signInWithPassword/, "legacy email/password authentication must not return");
    assertDoesNotMatch(clientSource, /\.auth\s*\.\s*admin\b/, "admin auth APIs must never run in the browser");
  });

  await t.test("legacy fallback is limited to a pre-migration schema error", () => {
    assertMatches(clientSource, /from\s*\(\s*["']writer_notes["']\s*\)/, "public notes must be loaded from writer_notes");
    assertMatches(clientSource, /\.eq\s*\(\s*["']is_public["']\s*,\s*true\s*\)/, "public query must explicitly request public notes");
    assertMatches(clientSource, /BURRITO_PUBLIC_NOTES/, "legacy static notes must remain available as a temporary fallback");
    assertMatches(clientSource, /useLegacyFallback\s*=\s*Boolean\s*\(\s*noteError\s*&&\s*legacySchemaErrorCodes\.has\s*\(\s*noteError\.code\s*\)\s*\)/, "fallback must activate only for an expected missing-schema error");
    assertMatches(clientSource, /fallbackNotes\s*=\s*useLegacyFallback\s*\?\s*normalizeFallbackNotes\s*\([^)]*\)\s*:\s*\[\]/, "a successful DB query must never mix static notes back into the public list");
    assertMatches(clientSource, /remoteSlugs\s*=\s*new Set\s*\([^;]+noteKey/s, "remote note slugs must be indexed before fallback merge");
    assertMatches(clientSource, /\.\.\.remoteNotes[\s\S]{0,300}\.\.\.fallbackNotes\.filter\s*\([^;]+!remoteSlugs\.has\s*\(\s*noteKey\s*\(/, "remote notes must be listed first and suppress same-slug fallback notes");
  });

  await t.test("CRUD always scopes private work to the recognized writer", () => {
    assertMatches(clientSource, /function loadMyNotes[\s\S]{0,500}from\s*\(\s*["']writer_notes["']\s*\)[\s\S]{0,300}\.eq\s*\(\s*["']author_id["']\s*,\s*currentProfile\.user_id\s*\)/, "private note loading must filter by the current writer");
    assertMatches(clientSource, /const payload\s*=\s*\{[\s\S]{0,300}author_id\s*:\s*currentProfile\.user_id[\s\S]{0,300}is_public/, "new note payload must derive author_id from the authenticated profile");
    assertMatches(clientSource, /\.update\s*\([\s\S]{0,300}\.eq\s*\(\s*["']id["']\s*,\s*id\s*\)[\s\S]{0,120}\.eq\s*\(\s*["']author_id["']\s*,\s*currentProfile\.user_id\s*\)/, "updates must include an owner filter in addition to RLS");
    assertMatches(clientSource, /\.delete\s*\(\s*\)[\s\S]{0,160}\.eq\s*\(\s*["']id["']\s*,\s*note\.id\s*\)[\s\S]{0,120}\.eq\s*\(\s*["']author_id["']\s*,\s*currentProfile\.user_id\s*\)/, "deletes must include an owner filter in addition to RLS");
    assertMatches(clientSource, /Promise\.all\s*\(\s*\[\s*loadMyNotes\s*\(\s*\)\s*,\s*loadPublicData\s*\(\s*\)\s*\]\s*\)/, "successful mutations must refresh private and public lists");
  });
});

test("writer credentials and privileged Supabase secrets are not hardcoded", async (t) => {
  const files = securityRelevantFiles();

  await t.test("client never references a service-role credential", () => {
    assertDoesNotMatch(html + "\n" + clientSource, /service[_-]?role|SUPABASE_SERVICE_ROLE_KEY|\bsb_secret_/i, "browser assets must not reference a service-role credential");
  });

  await t.test("no four-digit credential literal appears in client, SQL, Edge, or tracked config", () => {
    const findings = [];
    for (const path of files) {
      const source = read(path);
      const lines = [...quotedFourDigitFindings(path, source), ...barePinLiteralFindings(source)];
      for (const line of new Set(lines)) findings.push(`${relative(repoRoot, path)}:${line}`);
    }
    assert.deepEqual(findings, [], `possible hardcoded four-digit credential at ${findings.join(", ")}`);
  });

  await t.test("no literal service-role secret appears in source or tracked config", () => {
    const findings = [];
    for (const path of files) {
      for (const line of serviceSecretFindings(read(path))) {
        findings.push(`${relative(repoRoot, path)}:${line}`);
      }
    }
    assert.deepEqual(findings, [], `possible hardcoded service-role secret at ${findings.join(", ")}`);
  });

  await t.test("credential scanners reject generated hardcoded samples", () => {
    const syntheticCode = ["12", "34"].join("");
    const hardcodedMap = `const writerCodes = new Map([[${syntheticCode}, "writer"]]);`;
    const hardcodedString = `const writerPin = "${syntheticCode}";`;
    assert.ok(barePinLiteralFindings(hardcodedMap).length > 0);
    assert.ok(quotedFourDigitFindings("sample.js", hardcodedString).length > 0);
    assert.ok(serviceSecretFindings(`const key = "${["sb", "secret", "sample"].join("_")}";`).length > 0);
  });
});

test("the four legacy Burrito notes remain byte-for-byte migration fixtures", () => {
  const notes = loadLegacyNotes();
  assert.ok(Array.isArray(notes));
  assert.equal(notes.length, legacyFixtures.length);
  assert.equal(new Set(notes.map((note) => note.id)).size, legacyFixtures.length);

  for (const fixture of legacyFixtures) {
    const note = notes.find((item) => item.id === fixture.id);
    assert.ok(note, `missing legacy note ${fixture.id}`);
    assert.equal(note.title, fixture.title, `${fixture.id} title changed`);
    assert.equal(note.created_at, fixture.createdAt, `${fixture.id} date changed`);
    assert.equal(note.content.length, fixture.length, `${fixture.id} content length changed`);
    assert.equal(
      createHash("sha256").update(note.content, "utf8").digest("hex"),
      fixture.sha256,
      `${fixture.id} content changed`
    );
    assert.equal(note.author_id, "burrito-static");
    assert.equal(note.writer_profiles?.display_name, "브리또");
    assert.equal(note.is_public, true);
  }
});

test("bootstrap tool imports the approved legacy manifest without overwriting conflicts", async (t) => {
  await t.test("bootstrap script exists and has valid JavaScript syntax", () => {
    assert.ok(existsSync(bootstrapPath), "scripts/writers-bootstrap.mjs is required");
    const result = spawnSync(process.execPath, ["--check", bootstrapPath], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  });

  await t.test("manifest pins every approved slug, date, and content checksum", () => {
    for (const fixture of legacyFixtures) {
      assert.ok(bootstrapSource.includes(fixture.id), `bootstrap manifest is missing ${fixture.id}`);
      assert.ok(bootstrapSource.includes(fixture.createdAt), `bootstrap manifest is missing ${fixture.createdAt}`);
      assert.ok(bootstrapSource.includes(fixture.sha256), `bootstrap manifest is missing the checksum for ${fixture.id}`);
    }
  });

  await t.test("import is slug-idempotent and validates existing rows before writing", () => {
    assertMatches(bootstrapSource, /writer_notes\?on_conflict=slug/, "legacy import must conflict on the stable slug");
    assertMatches(bootstrapSource, /resolution=ignore-duplicates/, "legacy import must not overwrite an existing slug");
    assertMatches(bootstrapSource, /validateRemoteLegacyNotes\s*\(\s*before[\s\S]{0,160}requireAll\s*:\s*false/, "existing legacy rows must be validated before insert");
    assertMatches(bootstrapSource, /validateRemoteLegacyNotes\s*\(\s*after[\s\S]{0,160}requireAll\s*:\s*true/, "all legacy rows must be validated after insert");
  });

  await t.test("only setup needs the five PIN values and pepper", () => {
    assertMatches(bootstrapSource, /loadConfig\s*\(\s*\{\s*requirePins\s*:\s*command\s*===\s*["']setup["']\s*\}\s*\)/, "read-only check/import commands must not require PIN secrets");
    for (let slot = 1; slot <= 5; slot += 1) {
      assertMatches(bootstrapSource, new RegExp(`slot\\s*:\\s*${slot}\\b`), `bootstrap must configure writer slot ${slot}`);
    }
    assertMatches(bootstrapSource, /`WRITER_\$\{number\}_CODE`[\s\S]{0,160}envValue\s*\(\s*codeName\s*\)/, "writer codes must be read from per-slot environment variables");
    assertMatches(bootstrapSource, /\^\\d\{4\}\$/, "bootstrap must validate every configured code as exactly four digits");
    assertMatches(bootstrapSource, /seenCodes\.has\s*\(/, "bootstrap must reject duplicate writer codes");
    assertMatches(bootstrapSource, /WRITER_PIN_PEPPER[\s\S]{0,300}(?:<\s*32|min(?:imum)?\s*32|최소\s*32)/i, "bootstrap must require a sufficiently long PIN pepper");
  });
});

test("writer SQL preserves ownership, public visibility, and private PIN verification", async (t) => {
  const normalized = sqlSource.replace(/--[^\n]*/g, " ").replace(/\s+/g, " ").toLowerCase();

  await t.test("schema keeps five auth-backed writers and bounded notes", () => {
    assertMatches(normalized, /create table if not exists public\.writer_profiles/, "writer_profiles table is required");
    assertMatches(normalized, /references auth\.users\s*\(\s*id\s*\)/, "writer profiles must be backed by Supabase Auth users");
    assertMatches(normalized, /slot_number[^,;]*unique[^,;]*between 1 and 5|slot_number[^,;]*between 1 and 5[^,;]*unique/, "writer slots must be unique and constrained to 1..5");
    assertMatches(normalized, /create table if not exists public\.writer_notes/, "writer_notes table is required");
    assertMatches(normalized, /author_id[^,;]*references public\.writer_profiles/, "writer notes must reference writer profiles");
    assertMatches(normalized, /title\s+varchar\s*\(\s*100\s*\)/, "writer note title must be bounded at 100 characters");
    assertMatches(normalized, /content\s+varchar\s*\(\s*5000\s*\)/, "writer note content must be bounded at 5000 characters");
    assertMatches(normalized, /is_public\s+boolean[^,;]*default false/, "new notes must default to private");
    assertMatches(normalized, /create unique index[^;]+writer_notes[^;]+\(\s*(?:legacy_)?slug\s*\)|unique\s*\([^)]*(?:legacy_)?slug/, "note slug must have a unique index or constraint");
  });

  await t.test("RLS exposes public notes and restricts writes to the authenticated owner", () => {
    assertMatches(normalized, /alter table public\.writer_profiles enable row level security/, "writer_profiles must enable RLS");
    assertMatches(normalized, /alter table public\.writer_notes enable row level security/, "writer_notes must enable RLS");
    assertMatches(normalized, /create policy[^;]+writer_notes[^;]+for select[^;]+is_public\s*=\s*true[^;]+auth\.uid\s*\(\s*\)\s*=\s*author_id/, "select policy must allow public notes or the owner");
    assertMatches(normalized, /create policy[^;]+writer_notes[^;]+for insert[^;]+with check[^;]+auth\.uid\s*\(\s*\)\s*=\s*author_id/, "insert policy must bind author_id to auth.uid()");
    assertMatches(normalized, /create policy[^;]+writer_notes[^;]+for update[^;]+using[^;]+auth\.uid\s*\(\s*\)\s*=\s*author_id[^;]+with check[^;]+auth\.uid\s*\(\s*\)\s*=\s*author_id/, "update policy must enforce ownership before and after update");
    assertMatches(normalized, /create policy[^;]+writer_notes[^;]+for delete[^;]+auth\.uid\s*\(\s*\)\s*=\s*author_id/, "delete policy must enforce ownership");
    assertDoesNotMatch(normalized, /grant\s+(?:all|insert|update|delete)[^;]*writer_notes[^;]*\bto\s+anon\b/, "anonymous users must not receive writer_notes write grants");
  });

  await t.test("PIN digests and rate-limit state are private and service-role-only", () => {
    assertMatches(normalized, /create schema if not exists private/, "PIN data must live in a private schema");
    assertMatches(normalized, /private\.writer_pin_credentials/, "private PIN credential table is required");
    assertMatches(normalized, /pin_digest[^,;]+\^\[0-9a-f\]\{64\}\$/, "PIN credentials must be fixed-length lowercase digests");
    assertMatches(normalized, /private\.writer_pin_rate_limits/, "server-side PIN rate-limit state is required");
    assertMatches(normalized, /create or replace function public\.claim_writer_pin[^$]+security definer[^$]+set search_path\s*=\s*''/, "PIN claim RPC must be SECURITY DEFINER with an empty search_path");
    assertMatches(normalized, /revoke all on function public\.claim_writer_pin[^;]+from public, anon, authenticated/, "PIN claim RPC must be revoked from browser roles");
    assertMatches(normalized, /grant execute on function public\.claim_writer_pin[^;]+to service_role/, "only service_role may call the PIN claim RPC");
  });
});

test("writer login Edge Function keeps privileged work server-side", async (t) => {
  const edgeFiles = walkFiles(join(repoRoot, "supabase", "functions")).filter((path) => /(?:^|\/)index\.ts$/.test(path.replaceAll("\\", "/")));
  assert.ok(edgeFiles.length > 0, "expected supabase/functions/<writer-function>/index.ts");
  const edgeSource = edgeFiles.map(read).join("\n");

  await t.test("frontend invokes one of the checked Edge functions", () => {
    const functionNames = edgeFiles.map((path) => relative(join(repoRoot, "supabase", "functions"), dirname(path)).replaceAll("\\", "/"));
    assert.ok(functionNames.some((name) => clientSource.includes(name)), `frontend invoke must name one of: ${functionNames.join(", ")}`);
  });

  await t.test("service role and writer mapping come only from Edge secrets", () => {
    assertMatches(edgeSource, /Deno\.env\.get\s*\(\s*["']SUPABASE_URL["']\s*\)/, "Edge must read SUPABASE_URL from its environment");
    assertMatches(edgeSource, /Deno\.env\.get\s*\(\s*["']SUPABASE_SECRET_KEY["']\s*\)/, "Edge must prefer SUPABASE_SECRET_KEY from its environment");
    const primaryKeyIndex = edgeSource.search(/Deno\.env\.get\s*\(\s*["']SUPABASE_SECRET_KEY["']\s*\)/);
    const fallbackKeyIndex = edgeSource.search(/Deno\.env\.get\s*\(\s*["']SUPABASE_SERVICE_ROLE_KEY["']\s*\)/);
    assert.ok(fallbackKeyIndex < 0 || primaryKeyIndex < fallbackKeyIndex, "legacy service-role fallback must come after SUPABASE_SECRET_KEY");
    assertMatches(edgeSource, /Deno\.env\.get\s*\(\s*["']WRITER_PIN_PEPPER["']\s*\)/, "Edge must read the PIN pepper from an environment secret");
    assertMatches(edgeSource, /(?:\\d|\[0-9\])\{4\}/, "Edge must accept only four-digit PIN input");
    assertMatches(edgeSource, /crypto\.subtle[\s\S]+HMAC[\s\S]+SHA-256/, "Edge must HMAC the PIN before server lookup");
    assertMatches(edgeSource, /\.rpc\s*\(\s*["']claim_writer_pin["']/, "Edge must use the rate-limited PIN claim RPC");
  });

  await t.test("Edge exchanges a valid code for a one-time magic-link hash", () => {
    assertMatches(edgeSource, /\.auth\.admin\.generateLink\s*\(/, "Edge must generate a one-time Auth link for the recognized writer");
    assertMatches(edgeSource, /type\s*:\s*["']magiclink["']/, "Edge generateLink must use type=magiclink");
    assertMatches(edgeSource, /hashed_token|token_hash/, "Edge must return only the one-time token hash needed by verifyOtp");
    assertDoesNotMatch(edgeSource, /signInWithPassword/, "Edge must not know or use writer passwords");
    assertDoesNotMatch(edgeSource, /type\s*:\s*["']signup["']/, "PIN login must not create public signups");
  });

  await t.test("auth endpoint rejects broad browser origins and non-POST mutations", () => {
    assertDoesNotMatch(edgeSource, /["']Access-Control-Allow-Origin["']\s*:\s*["']\*["']/, "PIN endpoint must not allow every browser origin");
    assertMatches(edgeSource, /request\.method\s*!==?\s*["']POST["']|req\.method\s*!==?\s*["']POST["']/, "PIN endpoint must reject non-POST requests");
    const edgeConfigPath = join(repoRoot, "supabase", "config.toml");
    assert.ok(existsSync(edgeConfigPath), "supabase/config.toml must configure unauthenticated PIN invocation");
    const edgeConfig = read(edgeConfigPath);
    assertMatches(edgeConfig, /\[functions\.writer-pin-login\][\s\S]*?verify_jwt\s*=\s*false/, "writer-pin-login must allow the pre-session PIN exchange");
  });
});
