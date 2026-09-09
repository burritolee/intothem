const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  SUPABASE_URL,
  SUPABASE_KEY,
  COMMUNITY_AUTH_STORAGE_KEY,
  COMMUNITY_AUTO_JOIN_RPC,
  createCommunityAuthOptions,
  getCommunityRedirectTo,
  getLoginErrorMessage,
  ensureCommunityMembership,
  createSessionLoadCoordinator
} = require("../school-community.js");

test("나는학교 세션은 기존 전용 저장 키에 영속된다", () => {
  const storage = {};
  const options = createCommunityAuthOptions(storage);

  assert.equal(COMMUNITY_AUTH_STORAGE_KEY, "sb-rjkzlpdoaldwbgjpicrv-auth-token");
  assert.equal(options.storage, storage);
  assert.equal(options.storageKey, COMMUNITY_AUTH_STORAGE_KEY);
  assert.equal(options.persistSession, true);
  assert.equal(options.autoRefreshToken, true);
  assert.equal(options.detectSessionInUrl, true);
});

test("운영 및 로컬 파일 환경의 인증 복귀 주소를 만든다", () => {
  assert.equal(
    getCommunityRedirectTo({ protocol: "https:", origin: "https://www.intothem.co.kr", pathname: "/naneun-school-community" }),
    "https://www.intothem.co.kr/naneun-school-community"
  );
  assert.equal(
    getCommunityRedirectTo({ protocol: "file:", origin: "null", pathname: "/naneun-school-community.html" }),
    "http://127.0.0.1:4173/naneun-school-community.html"
  );
});

test("Supabase 인증 오류를 사용자가 이해할 수 있는 문구로 변환한다", async (t) => {
  await t.test("가입 비활성화", () => {
    assert.equal(
      getLoginErrorMessage({ status: 422, code: "otp_disabled", message: "Signups not allowed for otp" }),
      "이메일 가입이 현재 비활성화되어 있습니다. 관리자에게 문의해주세요."
    );
  });

  await t.test("발송 한도", () => {
    assert.equal(
      getLoginErrorMessage({ status: 429, message: "Email rate limit exceeded" }),
      "로그인 메일 발송 한도에 도달했습니다. 잠시 후 다시 시도해주세요."
    );
    assert.equal(
      getLoginErrorMessage({ status: 422, code: "over_email_send_rate_limit", message: "Too many requests" }),
      "로그인 메일 발송 한도에 도달했습니다. 잠시 후 다시 시도해주세요."
    );
  });

  await t.test("잘못된 이메일 형식", () => {
    assert.equal(
      getLoginErrorMessage({ code: "email_address_invalid", message: "Email address is invalid" }),
      "이메일 주소 형식을 확인해주세요."
    );
  });

  await t.test("발송이 허용되지 않은 이메일", () => {
    assert.equal(
      getLoginErrorMessage({ code: "email_address_not_authorized", message: "Email address not authorized" }),
      "현재 인증 메일을 보낼 수 없는 주소입니다. 관리자에게 문의해주세요."
    );
  });

  await t.test("이메일 공급자 비활성화", () => {
    assert.equal(
      getLoginErrorMessage({ code: "email_provider_disabled", message: "Email provider is disabled" }),
      "이메일 로그인 설정을 확인할 수 없습니다. 관리자에게 문의해주세요."
    );
  });

  await t.test("알 수 없는 서버 오류", () => {
    assert.equal(
      getLoginErrorMessage({ status: 500, message: "Internal implementation detail" }),
      "로그인 링크를 보내지 못했습니다. 잠시 후 다시 시도하거나 관리자에게 문의해주세요."
    );
  });
});

test("인증된 사용자의 나는학교 기본 회원권을 멱등 RPC로 보장한다", async (t) => {
  await t.test("자동 가입 후 활동 회원권을 조회한다", async () => {
    const membership = { id:"membership-1", status:"active" };
    let readCalls = 0;
    let joinCalls = 0;
    const result = await ensureCommunityMembership(
      async () => { readCalls += 1; return { data:[membership], error:null }; },
      async () => { joinCalls += 1; return { error:null }; }
    );

    assert.deepEqual(result, { data:[membership], error:null });
    assert.equal(readCalls, 1);
    assert.equal(joinCalls, 1);
  });

  await t.test("자동 가입 실패 시 회원권을 조회하지 않는다", async () => {
    const joinError = { code:"42501", message:"verified email required" };
    let readCalls = 0;
    const result = await ensureCommunityMembership(
      async () => { readCalls += 1; return { data:[], error:null }; },
      async () => ({ error:joinError })
    );

    assert.deepEqual(result, { data:[], error:joinError });
    assert.equal(readCalls, 0);
  });

  await t.test("자동 가입 후 조회 오류를 그대로 전달한다", async () => {
    const readError = { code:"PGRST", message:"membership read failed" };
    const result = await ensureCommunityMembership(
      async () => ({ data:null, error:readError }),
      async () => ({ error:null })
    );

    assert.deepEqual(result, { data:null, error:readError });
  });
});

test("중복 인증 이벤트를 합치고 로그아웃·계정 전환 뒤의 오래된 결과를 버린다", async () => {
  const resolvers = new Map();
  const currentChecks = [];
  let loadCalls = 0;
  const coordinator = createSessionLoadCoordinator((user, isCurrent) => {
    loadCalls += 1;
    return new Promise((resolve) => {
      resolvers.set(user.id, () => {
        currentChecks.push([user.id, isCurrent()]);
        resolve(true);
      });
    });
  });

  const first = coordinator.load({ id:"user-a" });
  const duplicate = coordinator.load({ id:"user-a" });
  assert.strictEqual(duplicate, first);
  await Promise.resolve();
  assert.equal(loadCalls, 1);

  const second = coordinator.load({ id:"user-b" });
  await Promise.resolve();
  assert.equal(loadCalls, 2);
  resolvers.get("user-a")();
  assert.equal(await first, false);
  resolvers.get("user-b")();
  assert.equal(await second, true);
  assert.deepEqual(currentChecks, [["user-a", false], ["user-b", true]]);

  const cached = await coordinator.load({ id:"user-b" });
  assert.equal(cached, true);
  assert.equal(loadCalls, 2);

  coordinator.reset();
  assert.equal(coordinator.isCurrentUser("user-b"), false);
});

test("이전 인증 요청의 예외가 같은 사용자로 돌아온 최신 화면을 덮지 않는다", async () => {
  const pending = [];
  const coordinator = createSessionLoadCoordinator((user, isCurrent) => new Promise((resolve, reject) => {
    pending.push({ userId:user.id, isCurrent, resolve, reject });
  }));

  const oldUserA = coordinator.load({ id:"user-a" });
  await Promise.resolve();
  const userB = coordinator.load({ id:"user-b" });
  await Promise.resolve();
  const currentUserA = coordinator.load({ id:"user-a" });
  await Promise.resolve();

  pending[0].reject(new Error("stale request failed"));
  assert.equal(await oldUserA, false);
  pending[1].resolve(true);
  assert.equal(await userB, false);
  pending[2].resolve(true);
  assert.equal(await currentUserA, true);
  assert.deepEqual(pending.map((item) => item.isCurrent()), [false, false, true]);
});

test("현재 인증 요청의 예외는 재시도 처리를 위해 전달한다", async () => {
  const coordinator = createSessionLoadCoordinator(async () => {
    throw new Error("current request failed");
  });

  await assert.rejects(
    coordinator.load({ id:"user-current" }),
    /current request failed/
  );
});

test("나는학교와 습작노트 인증 저장소 및 로그아웃 범위가 분리되어 있다", () => {
  const communitySource = fs.readFileSync(path.join(__dirname, "..", "school-community.js"), "utf8");
  const communityHtml = fs.readFileSync(path.join(__dirname, "..", "naneun-school-community.html"), "utf8");
  const writersSource = fs.readFileSync(path.join(__dirname, "..", "writers-notebook.js"), "utf8");
  const writerKey = writersSource.match(/const WRITERS_AUTH_STORAGE_KEY = "([^"]+)"/)?.[1];

  assert.ok(writerKey);
  assert.notEqual(writerKey, COMMUNITY_AUTH_STORAGE_KEY);
  assert.equal(COMMUNITY_AUTO_JOIN_RPC, "ensure_naneun_school_membership");
  assert.match(communitySource, /shouldCreateUser\s*:\s*true/);
  assert.doesNotMatch(communitySource, /shouldCreateUser\s*:\s*false/);
  assert.match(communitySource, /client\.rpc\("update_own_school_profile"/);
  assert.doesNotMatch(communitySource + writersSource, /auth\.signOut\(\s*\)/);
  assert.ok((communitySource.match(/scope\s*:\s*"local"/g) || []).length >= 2);
  assert.ok((writersSource.match(/scope\s*:\s*"local"/g) || []).length >= 2);
  assert.match(communityHtml, /school-community\.js\?v=20260909-3/);
  assert.match(communityHtml, /이메일 인증을 마치면 누구나/);
  assert.doesNotMatch(communityHtml, /초대받은 이메일|초대된 이메일/);
  assert.match(communityHtml, /id="pending-retry"/);
  assert.match(communityHtml, /class="admin-only-option" hidden disabled/);
});

test("공개 가입 SQL은 인증 사용자만 안전하게 기본 그룹에 등록한다", () => {
  const migration = fs.readFileSync(path.join(__dirname, "..", "supabase-naneun-school-open-signup.sql"), "utf8");

  assert.match(migration, /create or replace function public\.ensure_naneun_school_membership\(\)/i);
  assert.match(migration, /security definer[\s\S]*set search_path\s*=\s*''/i);
  assert.match(migration, /users\.email_confirmed_at is not null/i);
  assert.match(migration, /projects\.slug\s*=\s*'naneun-school'/i);
  assert.match(migration, /groups\.slug\s*=\s*'cohort-1'/i);
  assert.match(migration, /where memberships\.status\s*=\s*'invited'/i);
  assert.match(migration, /revoke all on function public\.ensure_naneun_school_membership\(\) from public, anon/i);
  assert.match(migration, /grant execute on function public\.ensure_naneun_school_membership\(\) to authenticated/i);
  assert.match(migration, /create or replace function public\.update_own_school_profile/i);
  assert.doesNotMatch(migration, /create\s+trigger[\s\S]*auth\.users/i);
  assert.match(migration, /category\s*<>\s*'notice'[\s\S]*is_pinned\s*=\s*false/i);
  assert.match(migration, /create trigger enforce_school_post_system_fields/i);
  assert.match(migration, /create trigger enforce_school_comment_system_fields/i);
  assert.match(migration, /posts\.id::text\s*=\s*\(storage\.foldername\(name\)\)\[2\]/i);
  assert.match(migration, /pg_catalog\.cardinality\(storage\.foldername\(name\)\)\s*=\s*2/i);
  assert.doesNotMatch(migration, /storage\.foldername\(name\)[^\n]*::uuid/i);
});

const liveEmail = process.env.INTOTHEM_SCHOOL_AUTH_E2E_EMAIL;
const liveSendConfirmed = process.env.INTOTHEM_SCHOOL_AUTH_E2E_CONFIRM_SEND === "1";

test("지정한 테스트 이메일로 실제 가입 링크를 발송한다", {
  skip: liveEmail && liveSendConfirmed
    ? false
    : "실제 발송은 INTOTHEM_SCHOOL_AUTH_E2E_EMAIL과 INTOTHEM_SCHOOL_AUTH_E2E_CONFIRM_SEND=1을 함께 지정할 때만 실행됩니다."
}, async () => {
  const requestUrl = new URL("/auth/v1/otp", SUPABASE_URL);
  requestUrl.searchParams.set("redirect_to", "https://www.intothem.co.kr/naneun-school-community");
  const response = await fetch(requestUrl, {
    method: "POST",
    signal: AbortSignal.timeout(15000),
    headers: {
      apikey: SUPABASE_KEY,
      authorization: `Bearer ${SUPABASE_KEY}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({ email: liveEmail, data: {}, create_user: true })
  });
  const body = await response.json().catch(() => ({}));

  assert.equal(response.status, 200, JSON.stringify({
    status: response.status,
    error_code: body.error_code,
    message: body.msg || body.message
  }));
});
