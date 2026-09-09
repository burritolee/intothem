#!/usr/bin/env node

import { createHash, createHmac, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = path.resolve(SCRIPT_DIR, "..");
const LEGACY_NOTES_PATH = path.join(PROJECT_DIR, "writers-public-notes.js");
const PIN_DIGEST_PREFIX = "writer-pin:v1:";
const CONFIGURE_PIN_RPC = "configure_writer_pin";
const CLAIM_PIN_RPC = "claim_writer_pin";
const SYNTHETIC_EMAIL_DOMAIN = "writers.intothem.invalid";

const WRITERS = [
  { slot: 1, defaultName: "브리또", publicSlug: "burrito-static", bio: "브리또의 공개 습작" },
  { slot: 2, defaultName: "하나로 샴푸", publicSlug: "writer-02", bio: "" },
  { slot: 3, defaultName: "작가 03", publicSlug: "writer-03", bio: "" },
  { slot: 4, defaultName: "작가 04", publicSlug: "writer-04", bio: "" },
  { slot: 5, defaultName: "작가 05", publicSlug: "writer-05", bio: "" }
];

const LEGACY_MANIFEST = new Map([
  ["burrito-project-hail-mary", {
    title: "프로젝트 헤일메리를 읽고",
    createdAt: "2026-08-15T00:00:00+09:00",
    contentSha256: "c0b81fee0bfb83c50178520d742a5f49bcbf335f16d6b90b93709935a56cb02a"
  }],
  ["burrito-abandonment-anxiety", {
    title: "유기불안, 그 깊은 외로움에 대하여...",
    createdAt: "2026-07-31T00:00:00+09:00",
    contentSha256: "c6f5f61571735627e04cc4ccb67127d895f7363f4162022702242e391a2e23db"
  }],
  ["burrito-love-and-be-loved", {
    title: "사랑하고 사랑받자",
    createdAt: "2024-09-10T00:00:00+09:00",
    contentSha256: "9d5b003a73faa82125bb36f944b406ecdb127470d2e4a01d830217e771d19012"
  }],
  ["burrito-inner-child", {
    title: "내 안에 어린 ‘나’",
    createdAt: "2024-06-03T00:00:00+09:00",
    contentSha256: "2f0935ba949cfb4ba40f24cdd3ab1988f24857e7fa61a2dd310cb48eb3ed6a2c"
  }]
]);

const secretValues = new Set();

function usage() {
  console.log(`사용법: node scripts/writers-bootstrap.mjs <check|setup|import>

  check   로컬 입력, Supabase 관리자 연결, 스키마와 기존 이관 상태를 읽기 전용으로 검사
  setup   숨은 Auth 사용자 5명 생성/재사용, 프로필 upsert, PIN digest 설정
  import  writers-public-notes.js의 브리또 글 4편을 충돌 무시 방식으로 이관 후 정확 검증

환경 변수는 셸에서 주입하거나 WRITERS_ENV_FILE로 저장소 밖 env 파일을 지정하세요.`);
}

function fail(message) {
  throw new Error(message);
}

function envValue(name) {
  return process.env[name]?.trim() || "";
}

function codePointLength(value) {
  return [...value].length;
}

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function pinDigest(pin, pepper) {
  return createHmac("sha256", Buffer.from(pepper, "utf8"))
    .update(`${PIN_DIGEST_PREFIX}${pin}`, "utf8")
    .digest("hex");
}

function isLegacyServiceRoleJwt(value) {
  const parts = value.split(".");
  if (parts.length !== 3) return false;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    return payload?.role === "service_role";
  } catch {
    return false;
  }
}

function redact(value) {
  let output = String(value);
  for (const secret of secretValues) {
    if (secret.length >= 4) output = output.split(secret).join("[비밀값 숨김]");
  }
  return output.replace(/\b[a-f0-9]{64}\b/gi, "[digest 숨김]");
}

function decodeEnvValue(rawValue, lineNumber) {
  const value = rawValue.trim();
  if (!value) return "";
  if (value.startsWith('"')) {
    if (!value.endsWith('"')) fail(`env 파일 ${lineNumber}행의 큰따옴표가 닫히지 않았습니다.`);
    try {
      return JSON.parse(value);
    } catch {
      fail(`env 파일 ${lineNumber}행의 큰따옴표 값을 읽지 못했습니다.`);
    }
  }
  if (value.startsWith("'")) {
    if (!value.endsWith("'")) fail(`env 파일 ${lineNumber}행의 작은따옴표가 닫히지 않았습니다.`);
    return value.slice(1, -1);
  }
  return value;
}

async function loadExplicitEnvFile() {
  const envPath = envValue("WRITERS_ENV_FILE");
  if (!envPath) return;

  const absolutePath = path.resolve(process.cwd(), envPath);
  const contents = await readFile(absolutePath, "utf8");
  const lines = contents.replace(/^\uFEFF/, "").split(/\r?\n/);

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const assignment = trimmed.startsWith("export ") ? trimmed.slice(7).trim() : trimmed;
    const match = assignment.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) fail(`env 파일 ${index + 1}행은 KEY=VALUE 형식이어야 합니다.`);
    const [, key, rawValue] = match;
    if (!(key in process.env)) process.env[key] = decodeEnvValue(rawValue, index + 1);
  });
}

function loadConfig({ requirePins }) {
  const supabaseUrl = envValue("SUPABASE_URL");
  const secretKey = envValue("SUPABASE_SECRET_KEY") || envValue("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl) fail("SUPABASE_URL이 필요합니다.");
  if (!secretKey) fail("SUPABASE_SECRET_KEY 또는 SUPABASE_SERVICE_ROLE_KEY가 필요합니다.");

  let parsedUrl;
  try {
    parsedUrl = new URL(supabaseUrl);
  } catch {
    fail("SUPABASE_URL이 올바른 URL이 아닙니다.");
  }
  if (!["http:", "https:"].includes(parsedUrl.protocol)) fail("SUPABASE_URL은 http 또는 https URL이어야 합니다.");

  secretValues.add(secretKey);
  const config = {
    supabaseUrl: parsedUrl.href.replace(/\/$/, ""),
    secretKey,
    pepper: "",
    writers: []
  };

  if (!requirePins) return config;

  const pepper = envValue("WRITER_PIN_PEPPER");
  if (codePointLength(pepper) < 32) fail("WRITER_PIN_PEPPER는 최소 32자여야 합니다.");
  config.pepper = pepper;
  secretValues.add(pepper);

  const seenCodes = new Set();
  config.writers = WRITERS.map((writer) => {
    const number = String(writer.slot).padStart(2, "0");
    const codeName = `WRITER_${number}_CODE`;
    const code = envValue(codeName);
    if (!/^\d{4}$/.test(code)) fail(`${codeName}는 leading zero를 포함할 수 있는 정확한 4자리 숫자여야 합니다.`);
    if (seenCodes.has(code)) fail("다섯 작가 코드는 서로 달라야 합니다.");
    seenCodes.add(code);
    secretValues.add(code);

    const displayName = envValue(`WRITER_${number}_NAME`) || writer.defaultName;
    if (codePointLength(displayName) < 1 || codePointLength(displayName) > 30) {
      fail(`WRITER_${number}_NAME은 1~30자여야 합니다.`);
    }
    return { ...writer, displayName, code };
  });

  return config;
}

async function loadLegacyNotes() {
  const source = await readFile(LEGACY_NOTES_PATH, "utf8");
  const sandbox = { window: {} };
  vm.runInNewContext(source, sandbox, { filename: LEGACY_NOTES_PATH, timeout: 1_000 });
  const rawNotes = sandbox.window.BURRITO_PUBLIC_NOTES;
  if (!Array.isArray(rawNotes)) fail("writers-public-notes.js에서 BURRITO_PUBLIC_NOTES 배열을 찾지 못했습니다.");
  if (rawNotes.length !== LEGACY_MANIFEST.size) fail(`정적 브리또 글은 정확히 ${LEGACY_MANIFEST.size}편이어야 합니다.`);

  const seenSlugs = new Set();
  const normalized = rawNotes.map((note, index) => {
    const position = index + 1;
    if (!note || typeof note !== "object") fail(`정적 글 ${position}번이 객체가 아닙니다.`);
    const slug = note.id;
    const manifest = LEGACY_MANIFEST.get(slug);
    if (!manifest) fail(`정적 글 ${position}번의 slug가 승인된 이관 목록에 없습니다.`);
    if (seenSlugs.has(slug)) fail(`정적 글 slug가 중복됩니다: ${slug}`);
    seenSlugs.add(slug);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 120) fail(`정적 글 slug가 올바르지 않습니다: ${slug}`);
    if (note.author_id !== "burrito-static") fail(`${slug}의 기존 author_id가 예상값과 다릅니다.`);
    if (note.writer_profiles?.display_name !== "브리또") fail(`${slug}의 작가명이 브리또가 아닙니다.`);
    if (note.title !== manifest.title) fail(`${slug}의 제목이 승인된 원본과 다릅니다.`);
    if (note.created_at !== manifest.createdAt) fail(`${slug}의 created_at이 승인된 원본과 다릅니다.`);
    if (note.is_public !== true) fail(`${slug}는 공개 글이어야 합니다.`);
    if (typeof note.content !== "string" || codePointLength(note.content.trim()) < 1 || codePointLength(note.content) > 5_000) {
      fail(`${slug}의 본문 길이가 허용 범위를 벗어납니다.`);
    }
    if (sha256(note.content) !== manifest.contentSha256) fail(`${slug}의 본문 checksum이 승인된 원본과 다릅니다.`);

    return {
      slug,
      title: note.title,
      content: note.content,
      is_public: true,
      is_hidden: false,
      created_at: note.created_at,
      updated_at: note.created_at,
      published_at: note.created_at
    };
  });

  for (const slug of LEGACY_MANIFEST.keys()) {
    if (!seenSlugs.has(slug)) fail(`승인된 정적 글이 누락되었습니다: ${slug}`);
  }
  return normalized;
}

class SupabaseAdmin {
  constructor(config) {
    this.baseUrl = config.supabaseUrl;
    this.secretKey = config.secretKey;
    this.authorizationHeaders = isLegacyServiceRoleJwt(config.secretKey)
      ? { Authorization: `Bearer ${config.secretKey}` }
      : {};
  }

  async request(resource, { method = "GET", body, headers = {} } = {}) {
    const url = new URL(resource, `${this.baseUrl}/`);
    let response;
    try {
      response = await fetch(url, {
        method,
        headers: {
          apikey: this.secretKey,
          ...this.authorizationHeaders,
          Accept: "application/json",
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          ...headers
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(20_000)
      });
    } catch (error) {
      fail(`${method} ${url.pathname} 요청 실패: ${error.message}`);
    }

    const text = await response.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }

    if (!response.ok) {
      const detail = typeof data === "object" && data
        ? data.message || data.error_description || data.error || data.details || JSON.stringify(data)
        : data || response.statusText;
      fail(`${method} ${url.pathname} 실패 (${response.status}): ${detail}`);
    }
    return data;
  }

  async listUsers() {
    const users = [];
    const perPage = 1_000;
    let page = 1;
    while (true) {
      const data = await this.request(`/auth/v1/admin/users?page=${page}&per_page=${perPage}`);
      const batch = Array.isArray(data) ? data : data?.users;
      if (!Array.isArray(batch)) fail("Supabase Admin Users 응답 형식을 확인하지 못했습니다.");
      users.push(...batch);
      const nextPage = Number(data?.next_page || 0);
      if (batch.length < perPage || !nextPage || nextPage === page) break;
      page = nextPage;
    }
    return users;
  }

  async createSyntheticUser(writer) {
    const number = String(writer.slot).padStart(2, "0");
    const email = `writer-${number}@${SYNTHETIC_EMAIL_DOMAIN}`;
    const password = `${randomBytes(30).toString("hex")}Aa1!`;
    secretValues.add(password);
    return this.request("/auth/v1/admin/users", {
      method: "POST",
      body: {
        email,
        password,
        email_confirm: true,
        user_metadata: { writers_notebook_slot: writer.slot },
        app_metadata: { writers_notebook: true, writer_slot: writer.slot }
      }
    });
  }

  async getProfiles() {
    const params = new URLSearchParams({
      select: "user_id,display_name,slot_number,public_slug,bio,created_at",
      order: "slot_number.asc"
    });
    return this.request(`/rest/v1/writer_profiles?${params}`);
  }

  async getLegacyNotes(slugs) {
    const params = new URLSearchParams({
      select: "id,slug,author_id,title,content,is_public,is_hidden,created_at,updated_at,published_at",
      slug: `in.(${slugs.join(",")})`,
      order: "created_at.desc"
    });
    return this.request(`/rest/v1/writer_notes?${params}`);
  }

  async inspectRpcSchema() {
    return this.request("/rest/v1/", { headers: { Accept: "application/openapi+json" } });
  }

  async upsertProfiles(profiles) {
    return this.request("/rest/v1/writer_profiles?on_conflict=user_id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: profiles
    });
  }

  async configurePin(writerId, digest) {
    return this.request(`/rest/v1/rpc/${CONFIGURE_PIN_RPC}`, {
      method: "POST",
      body: { p_writer_id: writerId, p_pin_digest: digest, p_is_enabled: true }
    });
  }

  async insertLegacyNotes(notes) {
    return this.request("/rest/v1/writer_notes?on_conflict=slug", {
      method: "POST",
      headers: { Prefer: "resolution=ignore-duplicates,return=representation" },
      body: notes
    });
  }
}

function sameTimestamp(left, right) {
  return Number.isFinite(Date.parse(left)) && Date.parse(left) === Date.parse(right);
}

function validateRemoteLegacyNotes(remoteNotes, sourceNotes, writerId, { requireAll }) {
  if (!Array.isArray(remoteNotes)) fail("writer_notes 조회 결과가 배열이 아닙니다.");
  const sourceBySlug = new Map(sourceNotes.map((note) => [note.slug, note]));
  const seen = new Set();

  for (const remote of remoteNotes) {
    const expected = sourceBySlug.get(remote.slug);
    if (!expected) fail(`예상하지 않은 이관 slug가 조회되었습니다: ${remote.slug}`);
    if (seen.has(remote.slug)) fail(`DB에 동일 slug가 중복되었습니다: ${remote.slug}`);
    seen.add(remote.slug);
    const differences = [];
    if (remote.author_id !== writerId) differences.push("author_id");
    if (remote.title !== expected.title) differences.push("title");
    if (remote.content !== expected.content) differences.push("content");
    if (sha256(remote.content || "") !== sha256(expected.content)) differences.push("content checksum");
    if (remote.is_public !== true) differences.push("is_public");
    if (remote.is_hidden !== false) differences.push("is_hidden");
    if (!sameTimestamp(remote.created_at, expected.created_at)) differences.push("created_at");
    if (!sameTimestamp(remote.updated_at, expected.updated_at)) differences.push("updated_at");
    if (!sameTimestamp(remote.published_at, expected.published_at)) differences.push("published_at");
    if (differences.length) {
      fail(`${remote.slug}가 승인된 원본과 다릅니다 (${differences.join(", ")}). 기존 행은 덮어쓰지 않았습니다.`);
    }
  }

  if (requireAll && seen.size !== sourceNotes.length) {
    const missing = sourceNotes.filter((note) => !seen.has(note.slug)).map((note) => note.slug);
    fail(`이관 후 글이 누락되었습니다: ${missing.join(", ")}`);
  }
  return seen.size;
}

async function checkSchema(client) {
  await client.getProfiles();
  await client.getLegacyNotes([...LEGACY_MANIFEST.keys()]);
  const spec = await client.inspectRpcSchema();
  const paths = spec?.paths || {};
  for (const rpc of [CONFIGURE_PIN_RPC, CLAIM_PIN_RPC]) {
    if (!paths[`/rpc/${rpc}`]) fail(`Supabase REST schema에서 ${rpc} RPC를 찾지 못했습니다. SQL 적용과 schema cache 갱신을 확인하세요.`);
  }
}

function profileBySlot(profiles, slot) {
  return profiles.find((profile) => Number(profile.slot_number) === slot);
}

function validateWriterAuthUser(user, slot) {
  if (!user?.id) fail(`slot ${slot} Auth 사용자에 id가 없습니다.`);
  if (typeof user.email !== "string" || !user.email.includes("@")) {
    fail(`slot ${slot} Auth 사용자에 magic-link 발급용 email이 없습니다.`);
  }
}

async function commandCheck(config, sourceNotes) {
  const client = new SupabaseAdmin(config);
  await checkSchema(client);
  const [users, profiles] = await Promise.all([client.listUsers(), client.getProfiles()]);
  const userIds = new Set(users.map((user) => user.id));
  const usersById = new Map(users.map((user) => [user.id, user]));
  const configuredProfiles = WRITERS.filter((writer) => profileBySlot(profiles, writer.slot));
  for (const writer of configuredProfiles) {
    const profile = profileBySlot(profiles, writer.slot);
    if (!userIds.has(profile.user_id)) fail(`slot ${profile.slot_number} 프로필의 Auth 사용자를 찾지 못했습니다.`);
    validateWriterAuthUser(usersById.get(profile.user_id), writer.slot);
    if (profile.public_slug !== writer.publicSlug) {
      fail(`slot ${writer.slot} public_slug가 ${writer.publicSlug}가 아닙니다. setup을 실행해 초기값을 맞추세요.`);
    }
  }

  const burrito = profileBySlot(profiles, 1);
  const remoteNotes = await client.getLegacyNotes(sourceNotes.map((note) => note.slug));
  let exactCount = 0;
  if (remoteNotes.length) {
    if (!burrito) fail("브리또 이관 글은 있지만 slot 1 프로필이 없습니다.");
    exactCount = validateRemoteLegacyNotes(remoteNotes, sourceNotes, burrito.user_id, { requireAll: false });
  }

  console.log("✓ 로컬 정적 원본 4편과 checksum 확인");
  console.log("✓ Supabase 관리자 API와 writer 스키마/RPC 확인");
  console.log(`✓ Auth 사용자 ${users.length}명 조회, 작가 프로필 ${configuredProfiles.length}/5 슬롯 설정`);
  if (exactCount === 0) console.log("· 브리또 정적 글은 아직 DB에 이관되지 않았습니다.");
  else if (exactCount === sourceNotes.length) console.log("✓ 브리또 글 4편이 DB 원본과 정확히 일치합니다.");
  else console.log(`· 브리또 글 ${exactCount}/4편이 정확히 이관되어 있으며 import로 나머지를 채울 수 있습니다.`);
}

async function commandSetup(config) {
  const client = new SupabaseAdmin(config);
  await checkSchema(client);
  const [users, existingProfiles] = await Promise.all([client.listUsers(), client.getProfiles()]);
  const usersById = new Map(users.map((user) => [user.id, user]));
  const usersByEmail = new Map(users.map((user) => [String(user.email || "").toLowerCase(), user]));
  const assignments = [];

  for (const writer of config.writers) {
    const number = String(writer.slot).padStart(2, "0");
    const existingProfile = profileBySlot(existingProfiles, writer.slot);
    let user = existingProfile ? usersById.get(existingProfile.user_id) : null;
    if (existingProfile && !user) fail(`slot ${writer.slot} 프로필에 연결된 Auth 사용자를 찾지 못했습니다.`);

    const syntheticEmail = `writer-${number}@${SYNTHETIC_EMAIL_DOMAIN}`;
    if (!user) user = usersByEmail.get(syntheticEmail) || null;
    let created = false;
    if (!user) {
      user = await client.createSyntheticUser(writer);
      if (!user?.id) fail(`slot ${writer.slot} Auth 사용자 생성 응답에 id가 없습니다.`);
      created = true;
      usersById.set(user.id, user);
      usersByEmail.set(syntheticEmail, user);
    }
    validateWriterAuthUser(user, writer.slot);

    const conflictingProfile = existingProfiles.find((profile) => profile.user_id === user.id && Number(profile.slot_number) !== writer.slot);
    if (conflictingProfile) fail(`Auth 사용자 ${user.id}가 이미 slot ${conflictingProfile.slot_number}에 연결되어 있습니다.`);
    const conflictingSlug = existingProfiles.find((profile) => profile.public_slug === writer.publicSlug && Number(profile.slot_number) !== writer.slot);
    if (conflictingSlug) fail(`${writer.publicSlug} public_slug가 이미 slot ${conflictingSlug.slot_number}에서 사용 중입니다.`);
    assignments.push({ writer, user, created });
  }

  const distinctIds = new Set(assignments.map(({ user }) => user.id));
  if (distinctIds.size !== WRITERS.length) fail("하나의 Auth 사용자가 둘 이상의 작가 슬롯에 배정되었습니다.");

  await client.upsertProfiles(assignments.map(({ writer, user }) => ({
    user_id: user.id,
    display_name: writer.displayName,
    slot_number: writer.slot,
    public_slug: writer.publicSlug,
    bio: writer.bio
  })));

  for (const { writer, user } of assignments) {
    await client.configurePin(user.id, pinDigest(writer.code, config.pepper));
  }

  const savedProfiles = await client.getProfiles();
  for (const { writer, user } of assignments) {
    const saved = profileBySlot(savedProfiles, writer.slot);
    if (!saved || saved.user_id !== user.id || saved.display_name !== writer.displayName || saved.public_slug !== writer.publicSlug) {
      fail(`slot ${writer.slot} 프로필 저장 후 검증에 실패했습니다.`);
    }
  }

  assignments.forEach(({ writer, user, created }) => {
    console.log(`✓ slot ${writer.slot} ${writer.displayName}: Auth 사용자 ${created ? "생성" : "재사용"} (${user.id}), PIN 설정`);
  });
  console.log("✓ 작가 5명 초기 설정을 검증했습니다. PIN 원문은 Supabase에 전송하지 않았습니다.");
}

async function commandImport(config, sourceNotes) {
  const client = new SupabaseAdmin(config);
  await checkSchema(client);
  const profiles = await client.getProfiles();
  const burrito = profileBySlot(profiles, 1);
  if (!burrito) fail("slot 1 브리또 프로필이 없습니다. setup을 먼저 실행하세요.");
  if (burrito.public_slug !== "burrito-static") {
    fail("slot 1 프로필의 public_slug가 burrito-static이 아닙니다. 기존 공유 주소 보존을 위해 setup을 먼저 확인하세요.");
  }

  const slugs = sourceNotes.map((note) => note.slug);
  const before = await client.getLegacyNotes(slugs);
  validateRemoteLegacyNotes(before, sourceNotes, burrito.user_id, { requireAll: false });

  const rows = sourceNotes.map((note) => ({ ...note, author_id: burrito.user_id }));
  const inserted = await client.insertLegacyNotes(rows);
  const after = await client.getLegacyNotes(slugs);
  validateRemoteLegacyNotes(after, sourceNotes, burrito.user_id, { requireAll: true });

  const insertedCount = Array.isArray(inserted) ? inserted.length : sourceNotes.length - before.length;
  console.log(`✓ 브리또 글 신규 ${insertedCount}편, 기존 동일 ${before.length}편 (slug 충돌은 덮어쓰지 않음)`);
  console.log("✓ 제목·본문·checksum·작성일·공개일·작성자·공개 상태가 원본과 정확히 일치합니다.");
}

async function main() {
  const command = process.argv[2];
  if (!command || command === "--help" || command === "-h") {
    usage();
    return;
  }
  if (!new Set(["check", "setup", "import"]).has(command)) {
    usage();
    fail(`알 수 없는 서브커맨드입니다: ${command}`);
  }
  if (process.argv.length > 3) fail("추가 위치 인수는 지원하지 않습니다.");

  await loadExplicitEnvFile();
  const config = loadConfig({ requirePins: command === "setup" });
  const sourceNotes = await loadLegacyNotes();

  if (command === "check") await commandCheck(config, sourceNotes);
  if (command === "setup") await commandSetup(config);
  if (command === "import") await commandImport(config, sourceNotes);
}

main().catch((error) => {
  console.error(`오류: ${redact(error?.message || error)}`);
  process.exitCode = 1;
});
