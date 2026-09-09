# 작가의 습작노트 초기 설정

이 문서는 작가 5명의 숨은 Supabase Auth 계정과 PIN 인증 정보를 설정하고, 기존 브리또 글 4편을 `writer_notes`로 이관하는 로컬 운영 절차입니다. 스크립트 실행은 Supabase 데이터를 변경할 수 있지만 웹사이트 배포, Git push, 커밋은 수행하지 않습니다.

## 안전 원칙

- 실제 PIN, Supabase secret key, pepper를 Git 저장소 파일에 기록하지 않습니다.
- `SUPABASE_SECRET_KEY`는 브라우저 코드나 Vercel 정적 환경 변수에 넣지 않습니다.
- PIN 원문은 브라우저에서 Edge Function으로만 전달됩니다. 초기 설정 스크립트는 PIN을 `HMAC-SHA-256(pepper, "writer-pin:v1:<PIN>")`으로 계산해 digest만 설정합니다.
- 동일 slug가 이미 있으면 import는 그 행을 갱신하지 않습니다. 기존 행이 원본과 다르면 실패하며, 작가가 수정한 글을 덮어쓰지 않습니다.
- `writers-public-notes.js`는 DB 이관 및 화면 검증이 끝날 때까지 백업 원본으로 보존합니다.

## 1. 준비

필요 조건:

- Node.js 20 이상
- Supabase 프로젝트의 secret key 또는 legacy service-role key
- 서로 다른 작가별 4자리 숫자 코드 5개
- 최소 32자의 임의 pepper. Edge Function의 `WRITER_PIN_PEPPER`와 반드시 같은 값이어야 합니다.

먼저 Supabase SQL Editor에서 `supabase-writers-notebook.sql`을 적용합니다. SQL에는 다음 항목이 포함되어 있어야 합니다.

- `writer_profiles.public_slug`
- `writer_notes.slug`, `writer_notes.published_at`
- `configure_writer_pin(uuid, text, boolean)` RPC
- `claim_writer_pin(text, text)` RPC

`.env.writers.example`을 참고해 **저장소 밖**에 비밀 env 파일을 만듭니다. 예를 들어 `/안전한/경로/intothem-writers.env`에 실제 값을 넣습니다. 예제 파일 자체에는 값을 채우지 않습니다.

```sh
chmod 600 /안전한/경로/intothem-writers.env
export WRITERS_ENV_FILE=/안전한/경로/intothem-writers.env
```

`SUPABASE_SECRET_KEY` 대신 기존 JWT 형식의 `SUPABASE_SERVICE_ROLE_KEY`도 사용할 수 있습니다. pepper는 다음처럼 별도로 생성할 수 있습니다.

```sh
openssl rand -hex 32
```

출력값은 안전한 env 파일과 Supabase Edge Function secret에만 저장합니다. 다섯 PIN은 leading zero를 포함할 수 있는 정확한 4자리여야 하고 서로 달라야 합니다.

## 2. 읽기 전용 사전 점검

```sh
node scripts/writers-bootstrap.mjs check
```

`check`는 Supabase URL과 secret key만 필요하며 다음을 검사합니다. PIN과 pepper를 요구하거나 PIN 설정에 사용하지 않으며, 쓰기 작업도 하지 않습니다.

- `writers-public-notes.js`의 승인된 글 4편, slug, 작성일, 본문 SHA-256 검사
- Supabase Admin API 접근 권한 검사
- writer 테이블의 필수 컬럼과 PIN RPC 노출 여부 검사
- 기존 이관 행이 있으면 원본과 정확히 같은지 검사

SQL을 방금 적용했다면 PostgREST schema cache 갱신에 잠시 시간이 필요할 수 있습니다. RPC를 찾지 못한다는 오류가 계속되면 Supabase Dashboard에서 SQL 적용 결과를 먼저 확인합니다.

## 3. 작가 계정과 PIN 설정

```sh
node scripts/writers-bootstrap.mjs setup
```

`setup`은 슬롯별 기존 프로필에 연결된 Auth 사용자가 있으면 재사용합니다. 없으면 외부 메일이 발송되지 않는 synthetic email로 숨은 사용자를 생성합니다. 이어서 프로필을 upsert하고 PIN digest를 `configure_writer_pin`으로 설정합니다.

이 명령을 시작할 때만 다섯 PIN의 형식과 중복 여부 및 pepper 길이를 검사합니다. 값은 로그에 출력하지 않습니다.

기본 프로필은 다음과 같습니다.

| 슬롯 | 이름 | public slug |
| --- | --- | --- |
| 1 | 브리또 | `burrito-static` |
| 2 | 하나로 샴푸 | `writer-02` |
| 3 | 작가 03 | `writer-03` |
| 4 | 작가 04 | `writer-04` |
| 5 | 작가 05 | `writer-05` |

이름은 env의 `WRITER_01_NAME`부터 `WRITER_05_NAME`까지로 바꿀 수 있습니다. `public_slug`는 공유 주소의 안정성을 위해 setup 재실행 시에도 고정됩니다.

설정 후 다시 확인합니다.

```sh
node scripts/writers-bootstrap.mjs check
```

## 4. Edge Function 운영 준비

작가 코드 인증은 `supabase/functions/writer-pin-login`에서 처리합니다. 이 함수에는 다음 설정이 필요합니다.

- `WRITER_PIN_PEPPER`: setup에 사용한 값과 정확히 같은 pepper
- `WRITER_ALLOWED_ORIGINS`: 기본 운영 주소 외에 추가로 허용할 origin이 있을 때만 쉼표로 구분해 설정

`https://intothem.co.kr`과 `https://www.intothem.co.kr`은 기본 허용됩니다. 로컬 인증 테스트가 필요하면 그때만 `http://127.0.0.1:4173`을 추가하고, 운영 secret에서는 다시 제거합니다. `SUPABASE_URL`과 서버용 secret key는 Supabase Edge Runtime의 기본 secret을 사용하므로 브라우저나 정적 호스팅 설정에 복사하지 않습니다.

`supabase/config.toml`은 인증 세션이 생기기 전 호출되는 이 함수에만 `verify_jwt = false`를 지정합니다. 함수 내부에서 origin, 입력 형식, HMAC 검증과 요청 횟수 제한을 모두 수행합니다.

운영 반영 승인을 받은 뒤 Supabase CLI가 연결된 환경에서 배포합니다.

```sh
supabase functions deploy writer-pin-login
```

현재 로컬 구현 단계에서는 secret 설정과 함수 배포를 실행하지 않습니다.

## 5. DB 백업과 브리또 글 이관

import 직전 Supabase Dashboard 또는 `pg_dump`로 최소한 `writer_profiles`, `writer_notes`를 내보냅니다. 기존 DB 행이 없다 하더라도 `writers-public-notes.js`와 다음 네 slug는 이관 검증이 끝날 때까지 삭제하지 않습니다.

- `burrito-project-hail-mary`
- `burrito-abandonment-anxiety`
- `burrito-love-and-be-loved`
- `burrito-inner-child`

이관을 실행합니다.

```sh
node scripts/writers-bootstrap.mjs import
```

import는 slot 1의 실제 Auth UUID를 `author_id`로 사용하고, 네 글을 한 번의 REST insert로 처리합니다. 각 행에는 기존 slug와 `created_at`을 그대로 넣고 `updated_at`과 `published_at`도 기존 작성일로 초기화합니다. `ON CONFLICT DO NOTHING`에 해당하는 PostgREST 옵션을 사용한 뒤 다음 값을 다시 읽어 원본과 정확히 비교합니다.

- 작가 UUID
- slug, 제목, 본문과 본문 SHA-256
- `created_at`, `updated_at`, `published_at`
- 공개 및 숨김 상태

명령을 반복 실행해도 동일한 4행은 추가되거나 갱신되지 않습니다. 같은 slug의 내용이 다르면 오류와 함께 멈추며 기존 DB 행은 유지됩니다.

## 6. 화면 전환 전 검증

최종 `check`를 실행한 뒤 다음을 브라우저에서 확인합니다.

1. 익명 상태에서 브리또 공개 글 4편과 날짜가 보입니다.
2. 기존 `?author=burrito-static&note=<기존-slug>` 주소가 해당 글을 엽니다.
3. 브리또 코드로 로그인하면 내 글 4편이 나타납니다.
4. 다른 작가 세션에서는 브리또 글을 수정하거나 삭제할 수 없습니다.
5. 새 비공개 글은 공개 목록에 보이지 않고, 공개 전환 후에만 나타납니다.

현재 프런트는 `writers-public-notes.js`를 임시 fallback으로 함께 로드하지만, 새 DB 스키마를 정상 조회한 뒤에는 정적 글을 섞지 않고 DB 결과만 표시합니다. 그래서 작가가 DB 글을 비공개로 바꾸거나 삭제해도 정적 글이 다시 공개되지 않습니다. 원격 import와 브라우저 화면 검증이 끝날 때까지 파일은 이관 원본으로 보존하고, 검증 후 별도 변경 묶음에서 정적 script 참조를 제거할 수 있습니다.

## 롤백

- import 도중 제약 또는 검증 오류가 나면 단일 insert 전체가 실패하거나 충돌 행이 그대로 유지됩니다. 먼저 오류 원인을 확인하고 import를 재실행합니다.
- 프런트 전환 뒤 문제가 나면 DB 행을 삭제하지 말고 정적 원본을 사용하는 이전 프런트로 되돌립니다.
- 작가가 이관 글을 수정한 뒤에는 아래 삭제 롤백을 사용하지 않습니다. 먼저 DB를 별도로 내보내야 합니다.
- 작가 수정 전 이관 자체만 되돌려야 할 때는 Supabase SQL Editor에서 slot 1의 작가와 위 네 slug를 모두 제한 조건으로 사용해 정확한 행만 확인한 뒤 삭제합니다. 범위를 확인하지 않은 광범위한 `delete`는 실행하지 않습니다.

초기 설정이 끝난 뒤에는 로컬 셸의 비밀 환경 변수를 해제하고, 저장소 밖 env 파일의 권한과 보관 위치를 다시 확인합니다.
