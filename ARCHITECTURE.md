# 아키텍처: 정산은 비서끼리

> #2/#7 확장: 실제 API는 Firebase Bearer ID 토큰과 폐기 여부를 검증해요. `x-demo-user`는 Firebase가 설정되지 않은 비운영 `DEV_SEED=1`에서만 사용해요. 설정은 [연결 안내](docs/auth-location-setup.md), 계약 변경은 아래 표를 참고해 주세요.

팀원이 각자 이슈를 맡아 개발할 때 맞춰야 하는 **계약**을 정리한 문서예요. 코드의 기준은 `src/domain/types.mjs`이고, 이 문서와 그 파일은 함께 고쳐요.

## 한눈에 보기

```
브라우저
  ├─ public/index.html + app.js   데모 화면(로그인 없이 보는 오사카 시나리오). 동작을 바꾸지 않아요
  ├─ public/room.html + room.js   실제 방 화면
  │     │  room-api.js: api(), subscribeRoom(), currentUid()
  └─ public/log-pop.js            좁은 화면(920px 이하)에서 비서끼리 기록을 상단바 종으로 여는 패널. 두 화면이 함께 씀
        │
        ▼
API 서버 (server.mjs → src/app.mjs)
  ├─ src/identity.mjs     Firebase 신원 검증 (#2)
  ├─ src/store/           Store 인터페이스. MemoryStore(기본) 또는 FirestoreStore(STORE=firestore, #3). encryptedStore가 계좌 칸을 잠가 저장
  ├─ src/gemini.mjs       Gemini 호출 (키는 Secret Manager·로컬 .env에만)
  ├─ src/agents/          메뉴 배분·중재, 이후 규칙 판단·청구·송금 안내
  └─ public/core.js       돈 계산(환율·몫·차액·송금 경로). 화면·서버·테스트가 같은 코드를 씀
```

## 지키는 원칙

- **LLM은 금액을 계산하지 않아요.** Gemini는 '줄마다 누구 몫인가', '영수증에 뭐가 있나', '중재안'만 내고, 금액은 `public/core.js`가 계산해요. 모델 출력은 스키마로 제한하고 서버가 다시 검증해요. 실패하면 규칙으로 대신하고 화면에 `규칙`이라고 표시해요.
- **LLM은 필요할 때만 불러요.** 함께 있던 사람이 한 명이거나 줄이 하나뿐인 영수증은 묻지 않고 똑같이 나눠요(`obviousAlloc`). 모델에 보낼 내용이 이전과 같으면 이전 답을 다시 써요(`src/agents/cache.mjs`, 서버 메모리). 응답의 `how`(`obvious`·`cache`·`gemini`·`rules`)로 어떻게 나눴는지 화면에 보여요.
- **비서는 사람이 정한 범위 안에서만 움직여요.** 자동 수락 한도를 넘거나 근거가 없는 일은 반드시 주인에게 물어요.
- **우리 서비스는 돈을 보관하거나 이체하지 않아요.** 송금은 사용자의 송금 앱에서 일어나요. 우리는 금액이 채워진 송금 화면을 승인하는 순간 열어 줄 뿐이에요.
- **비서 기록(이벤트)은 서버만 써요.** 화면은 읽기만 해요.
- **민감 정보는 최소로 다뤄요.** 위치는 원본 대신 요약만, 계좌번호는 송금 당사자에게만 보여요. 저장소에는 계좌를 잠근 채로 넣어요(`src/store/encrypted.mjs`).

## 확장 지점

| 이슈 | 바꿀 곳 | 지금 구현 | 바꿀 구현 |
| --- | --- | --- | --- |
| #2 로그인 | `src/identity.mjs`의 `identify(req, store, roomId)` | Firebase ID 토큰·폐기 확인, 서버가 넣은 `req.identityContext` 사용. 방 조회는 멤버일 때만 통과 | 프로젝트 자격 증명 연결 |
| #2 로그인 | `public/room-api.js`의 `currentUid()`·`api()` | Firebase 사용자·Bearer ID 토큰. 신원 헤더는 이 모듈 한 곳에서만 설정 | `initAuth()` 완료 후 사용 |
| #3 Firestore | `src/store/`의 Store | `STORE=firestore`면 `FirestoreStore`(`src/store/firestore.mjs`), 아니면 `MemoryStore`. 연결은 [Firestore 안내](docs/firestore-setup.md) | 팀 프로젝트 연결 |
| #3 Firestore | `public/room-api.js`의 `subscribeRoom()` | 서버가 Firestore이고 로그인했으면 `rooms/{roomId}/events`를 `onSnapshot`, 아니면 2초 폴링. 호출 방식은 같아요 | — |
| #4 방 | `rooms` 문서와 방 API | 개발용 시드 `POST /api/dev/seed` | 방 만들기·참가하기(환율 표 입력 포함) |
| #5 비서 설정 | `agents` 문서의 `memory`·`rules` | 시드 기본값 | 설정 화면과 저장 |
| #7 위치 | `src/agents/evidence.mjs`의 provider | `createEvidenceProvider()`가 동일한 `(uid, expense, room)` 계약으로 위치 요약 반환. 고정 근거는 개발용 시드에서만 사용 | 타임라인 파일 파서는 장치별 형식 확인 후 별도 연동 |
| #8 송금 | `agents` 문서의 `payout`, `src/payments/toss.mjs`, `public/banks.js` | 받는 계좌 설정 화면(은행 선택 목록), `supertoss://send?…` 링크(실기기 검증 완료, 은행은 실기기로 확인한 표기로 바꿔 넣음), 데스크톱 QR 핸드오프(`src/payments/qr.mjs`), 계좌 칸 암호화 저장(`src/store/encrypted.mjs`), 송금 확인(받는 사람의 "아직 안 들어왔어요", 다시 알림 1일·3일) | iPhone 은행 표기 확인 |
| #10 보안 | `src/http.mjs`, `src/store/encrypted.mjs`, Firestore 보안 규칙 | 신원당 호출 제한, 계좌 칸 암호화 저장(`PAYOUT_ENC_KEY`) | 토큰 필수, 보안 규칙 테스트 |

## Store 인터페이스

모든 메서드는 `async`이고, 돌려주는 문서는 복사본이에요. 그래서 돌려받은 객체를 고쳐도 저장본은 바뀌지 않아요.

| 메서드 | 하는 일 |
| --- | --- |
| `get(col, id)` | 문서 하나, 없으면 `null` |
| `put(col, doc)` | `doc.id`로 저장(덮어쓰기) |
| `delete(col, id)` | 문서 지우기(없어도 오류 아님) |
| `list(col, where = {})` | 필드 동등 비교로 거르기(Firestore의 `==`와 같은 범위) |
| `appendEvent(roomId, ev)` | 비서 기록 추가. `seq`(방마다 1부터)와 `at`(ISO 시각)을 채워서 돌려줌 |
| `listEvents(roomId, afterSeq = 0)` | `seq > afterSeq`인 기록 |
| `eraseUser(uid)` (선택 확장) | 탈퇴 기능을 제공하는 저장소에서 구현. 개인정보 삭제·방별 무작위 익명 UID 치환을 원자적으로 수행하고 `{ removedLinks }` 반환. 없으면 탈퇴 API는 데이터 변경 없이 503 |

계약 테스트는 `test/store.test.mjs`예요. `FirestoreStore`도 에뮬레이터가 있으면 같은 테스트를 돌려요(`npm run test:emulators`). Firestore에서만 생기는 일(동시 seq, 영수증 사진, 탈퇴 트랜잭션, 보안 규칙)은 `test/firestore.test.mjs`가 봐요.

`FirestoreStore`만의 약속:

- `list` 순서는 처음 넣은 순서예요(`MemoryStore`와 같음). 이를 위해 문서에 `_order`를 붙이고, `rooms`에는 보안 규칙용 `_memberUids`(탈퇴하지 않은 멤버 uid)를 붙여요. 둘 다 읽을 때 빼서 돌려줘요.
- `appendEvent`의 `seq`는 방마다 카운터 문서(`rooms/{roomId}/meta/events`)를 트랜잭션으로 올려 매겨요. 경합에서 지면 seq를 건너뛰지 않고 오류를 내요.
- 값이 `undefined`인 칸은 빼고 저장해요. id에 `/`가 있으면 오류예요.
- `receipts`는 Cloud Storage에 있어서 `list`를 지원하지 않아요.

탈퇴 확장 계약은 `test/account-erasure.test.mjs`로 확인해요. 프로필·비서 설정·위치 요약·본인이 등록/결제한 영수증 사진을 삭제하고, 공동 금액·분담·환율·이벤트 순번은 유지해요. `Member.deleted=true`인 익명 참여자는 새 지출에 넣을 수 없어요. 배분 사유·이의 근거·이벤트 문구에 복제된 개인정보는 지우고 열린 중재안은 다시 확인하게 해요. 원 계정과 익명 UID의 역매핑을 저장하지 않아요. 이미 발급한 QR은 무효화하고 AI 응답 캐시도 비워요. 최소 `deletedUsers/{uid}` 표식은 접근 차단·삭제 재시도용으로 유지해요. 이미 다른 참여자가 별도로 복사한 기록은 회수할 수 없어요.

방·계정 API와 tick은 서버 안의 줄(`src/state-locks.mjs`)에 세워요. 한 방의 일은 그 방의 줄에 서고, 탈퇴·프로필 변경·tick처럼 여러 방에 걸친 일은 진행 중인 방의 일이 끝난 뒤 혼자 돌아요. 그래서 AI 요청 도중 탈퇴/철회로 데이터가 되살아나는 경쟁을 막아요. `FirestoreStore`의 `eraseUser`와 `appendEvent`는 트랜잭션이지만, 다른 API의 '읽고 고쳐 쓰기'는 여전히 이 줄에 기대요. 그래서 Cloud Run은 `--max-instances 1`을 유지해요(QR 토큰·AI 캐시·호출 제한도 서버 메모리라 같은 조건이에요). 인스턴스를 늘리려면 이 경로들을 트랜잭션으로 옮겨야 해요. 해당 능력이 없는 저장소에 탈퇴 기능을 조용히 활성화하지 않아요.

### 계좌 칸 암호화 (`src/store/encrypted.mjs`)

`server.mjs`는 Store를 `encryptedStore(store, key)`로 감싸요. 계좌번호가 들어가는 칸(`agents.payout`, `transfers.link`, `transfers.fallback`)은 넣을 때 AES-256-GCM으로 잠그고(`enc:v1:…`, `src/security/seal.mjs`) 꺼낼 때 풀어요. 그래서 다른 코드는 평문을 넣고 평문을 받고, 저장소에는 잠긴 글자만 남아요.

- 잠긴 값에는 `컬렉션/문서id/칸` 이름표가 묶여 있어서 다른 문서로 옮겨 붙이면 풀리지 않아요. 그래서 잠긴 문서의 `id`를 바꾸는 코드는 이 래퍼로 풀었다가 다시 넣어야 해요.
- 잠긴 칸이 평문이거나 풀리지 않으면 오류를 내요. 잠긴 칸으로는 `list` 검색을 할 수 없어요.
- 열쇠는 `PAYOUT_ENC_KEY`(base64, 32바이트)예요. 배포(`NODE_ENV=production`, `Dockerfile`이 넣어 줌)에서 없으면 서버가 시작하지 않고, 로컬에서는 개발용 열쇠를 써요.
- 진짜 저장소에 `eraseUser`(#2 탈퇴)가 있으면 그대로 전달하고, 그 사람이 낀 송금의 링크만 평문으로 풀어서 돌려줘요(QR 토큰 무효화용). 풀리지 않는 링크는 어차피 지울 값이라 건너뛰어요.
- `FirestoreStore`(#3)도 `server.mjs`의 같은 자리에서 감싸요. `tick()`은 모든 방의 송금을 풀어 보므로, 열쇠가 바뀌거나 값 하나가 망가지면 모든 방의 알림이 멈춰요. 그래서 Firestore에 계좌가 쌓이기 시작한 뒤에는 `PAYOUT_ENC_KEY`를 절대 바꾸지 않아요.

**왜 잠그나.** 「개인정보의 안전성 확보조치 기준」(개인정보보호위원회고시 제2025-9호) 제7조제2항은 이용자의 계좌번호를 안전한 암호 알고리즘으로 암호화해서 저장하라고 정해요. 이 서비스에 받을 계좌를 등록하는 사람이 여기서 말하는 이용자예요. AES-256은 개인정보보호위원회 안내서(2024.10)가 권장 예시로 드는 알고리즘이에요. 조사한 내용은 PR #22 코멘트에 정리했어요.

- 지금 저장소는 서버 메모리라서 이 잠금이 실제로 막는 건 거의 없어요. 효과는 #3 Firestore에 계좌가 계속 남기 시작할 때부터예요. 그래도 먼저 넣은 건, 평문이 쌓인 뒤에 잠그면 기존 값을 다시 잠그는 이전 작업이 생기기 때문이에요.
- 인터넷 구간으로 주고받을 때의 암호화(같은 조 제4항)는 Cloud Run·GitHub Pages의 HTTPS가 맡아요. QR에도 계좌가 아니라 15분짜리 토큰만 담아요.
- 열쇠 관리 절차(같은 조 제6항)는 정보주체 10만 명 이상인 대기업·중견기업·공공기관, 100만 명 이상인 중소기업·단체의 의무라 지금 규모에는 해당하지 않아요. 그래도 열쇠는 Secret Manager에만 두고 버전 `1`로 고정해서 바꾸지 않아요.
- 인증은 #2의 Firebase ID 토큰 검증으로 보호해요. 운영에서는 개발용 신원 헤더를 받지 않아요. 암호화는 인증을 대체하지 않으며, 서버 권한으로 읽는 동안에는 필요한 계좌 정보가 복호화돼요.

## 컬렉션과 Firestore 경로

Store의 `get(col, id)`·`delete(col, id)`에는 `roomId`가 없고 `tick()`은 모든 방의 송금을 훑어요. 그래서 컬렉션은 최상위에 두고, 방에 속한 문서는 `roomId` 필드로 걸러요. 비서 기록만 방 아래에 있어요. 보안 규칙은 `firestore.rules`, `storage.rules`예요. **쓰기는 모두 서버(Admin SDK)만** 하고, 화면에서 직접 읽는 건 실시간 갱신용 비서 기록뿐이에요.

| 컬렉션 | 문서 타입 | Firestore 경로 | 화면에서 직접 읽기(규칙) |
| --- | --- | --- | --- |
| `rooms` | `Room` | `rooms/{roomId}` | 방 멤버 |
| `expenses` | `Expense` | `expenses/{expenseId}` | 방 멤버 |
| `agents` | `AgentSettings` | `agents/{uid}` | 안 됨(기억·잠긴 계좌) |
| `invoices` | `Invoice` | `invoices/{invoiceId}` | 방 멤버 |
| `disputes` | `Dispute` | `disputes/{disputeId}` | 안 됨(위치 요약은 API의 `redactDispute`로만 가림) |
| `transfers` | `Transfer` | `transfers/{transferId}` | 송금 당사자 |
| `receipts` | 영수증 사진 `{ id(=지출 id), roomId, mimeType, data }` | Cloud Storage `receipts/{expenseId}`(문서 1MiB 한도를 넘을 수 있어서) | 안 됨(API로만) |
| `users` | `UserProfile` | `users/{uid}` | 본인 |
| `deletedUsers` | `DeletedUser` | `deletedUsers/{uid}` | 안 됨 |
| `locationConsents` | `LocationConsent` | `locationConsents/{id}` | 안 됨 |
| `locationEvidence` | `LocationEvidence` | `locationEvidence/{id}` | 안 됨 |
| 비서 기록 | `AgentEvent` | `rooms/{roomId}/events/{seq}`, 카운터 `rooms/{roomId}/meta/events` | 방 멤버(기록만, 카운터는 안 됨) |

방 멤버는 `rooms` 문서의 `_memberUids`로 확인해요. 탈퇴로 익명 처리된 멤버는 여기서 빠져요.

### #7 위치 근거의 판단과 승인 (11/3 리뷰 반영)

위치 근거는 이의를 낼 때 사용자가 고른 Google 지도 타임라인 파일에서 브라우저가 찾은 시각만 받아요(`public/timeline.js`). `LocationEvidence`는 `leftAt`·`nextAt`·`nextHome` 또는 `stayedUntil`과 서버가 다시 만든 `summary`만 가져요. `Evidence`로는 떠난 시각이면 `left_at`(`time`), 결제까지 머물렀으면 `text`(`stayedUntil`)로, 늘 `requiresHumanApproval=true`와 함께 넘겨요. 파일·좌표·장소 이름은 서버로 보내지 않아요. 예전 체크인·체크아웃 기록(`source` 없음)은 근거로 쓰지 않아요.

중재 모델 출력의 줄별 `evidenceConflict`가 true인 경우만 서버가 그 줄의 confidence를 0.49 이하로 제한해요. 다른 줄의 확신도는 그대로예요. 모델의 의미 판단은 완전한 충돌 검출을 보장하지 않아요. 규칙 fallback에서는 충돌을 추측하지 않아요. 타임라인 요약은 본인이 낸 자료라 confidence와 별도로 `confirmed=false`이며 자동 동의를 하지 않아요. 두 당사자의 명시적 동의 후에만 배분을 확정해요.

위치 요약과 중재 설명은 이의 당사자만 API로 읽어요. Firestore 규칙도 `disputes` 직접 읽기를 막아 두었어요.

## 도메인 타입 요약

자세한 필드는 `src/domain/types.mjs`의 JSDoc을 보세요.

- **uid:** ASCII 문자열이에요(#2 이후 Firebase uid). 화면에는 `Member.name`만 보여요.
- **금액·날짜:** 금액은 정수예요(원·엔은 보조 단위가 없어요). 날짜는 `YYYY-MM-DD`, 시각은 `HH:MM`, 서버 일정은 `Asia/Seoul` 기준이에요.
- **`Room`:** 멤버, 환율 표 `fx`(원/100 단위, 결제일별 매매기준율·카드 수수료·사람별 현찰 환율), 합의한 환율 정책, `version`을 가져요. `version`은 지출이 바뀔 때마다 올라가고, 청구서·송금은 이 version에 묶여요.
- **`Expense`:** `split`이 `'items'`면 영수증 줄(`items`)마다 `alloc`의 `consumers`가 나눠 내요. `allocMemory`는 배분할 때 쓴 비서 기억의 지문이고, 방 응답의 `allocFresh`는 그 지문이 지금 기억과 같은지예요(같으면 화면이 '다시 나누기'를 막아요).
- **`AgentSettings`:**
  - `memory`: 정산에 쓰라고 공유한 기억이에요. 무료 요금제는 5개까지예요.
  - `rules`: 자동 수락 한도, 보낼 시기(`'now'` 또는 `{ payday: 25 }`), 이의 처리예요.
  - `payout`: 받는 계좌예요.
- **`AgentEvent.action`:** 사람이 할 일이에요. `type`은 `confirm_line`, `answer_invoice`, `agree_dispute`, `approve_transfer`, `confirm_receipt`, `set_payout` 중 하나이고, `for`가 그 일을 할 사람이에요.

## API

실제 데이터 API는 `Authorization: Bearer <Firebase ID token>`이 필요해요. 없거나 유효하지 않으면 401, 인증은 됐지만 방 멤버가 아니면 403이에요. 비로그인 데모 API는 그대로 열려 있어요.

| 메서드 | 경로 | 하는 일 |
| --- | --- | --- |
| GET | `/api/config` | 기존 `mode`·`model` 유지, `auth: { firebase, dev, emulator }` 추가. Firebase 값은 공개 웹 앱 설정이며 비밀키를 포함하지 않음. `STORE=firestore`이고 로그인이 켜져 있으면 `realtime: { firestore: true, emulator }`(#3) |
| GET / POST | `/api/me` | 내 프로필 읽기 / `{ name, color }` 저장 |
| GET | `/api/rooms` | 내 방 목록 `{ rooms: [{ id, name, dates }] }` |
| GET | `/api/me/deletion` | 삭제 재시도 상태 `{ pending }` |
| POST | `/api/me/delete` | 검증된 토큰 필요(다시 로그인 창 없음, 화면에서 한 번 확인). 개인정보 삭제·공동 기록 익명화·Firebase 계정 삭제 |
| GET | `/api/rooms/:id/location` | 내 동의와 위치 요약 목록 |
| POST | `/api/rooms/:id/location/timeline` | 이의를 낼 때 타임라인에서 찾은 결과 `{ agree: true, expenseId, leftAt, nextAt?, nextHome? }` 또는 `{ agree: true, expenseId, stayedUntil }`. 그 지출 시간대 밖의 시각·좌표·다른 필드는 거부, 지출당 한 번(409). 붙이는 순간 7일 동의 |
| POST | `/api/rooms/:id/location/revoke` | 내 동의와 요약, 연결된 미확정 중재안 삭제 |
| POST | `/api/allocate`, `/api/mediate` | 데모 화면용 메뉴 배분·중재 |
| POST | `/api/dev/seed` | 개발용 데모 방 만들기(`DEV_SEED=1`일 때만) |
| GET | `/api/rooms/:id` | 방, 지출, 청구서, 이의, 송금, 사람별 차액, 그리고 **내가 처리할 일(`actions`)** |
| GET | `/api/rooms/:id/events?after=n` | 비서 기록 |
| POST | `/api/rooms/:id/expenses` | 지출 남기기(직접 입력, 또는 확인을 마친 영수증 줄). 영수증 지출은 `receipt: { mimeType, data }`로 줄인 사진을 함께 저장해요. 방 `version`이 올라가요 |
| POST | `/api/rooms/:id/expenses/:eid/delete` | 지출 지우기. 영수증 사진도 함께 지워요 |
| GET | `/api/rooms/:id/expenses/:eid/receipt` | 저장된 영수증 사진 `{ mimeType, data }`(방 멤버만) |
| POST | `/api/rooms/:id/expenses/:eid` | 지출 고치기. 같은 검증을 거쳐 덮어써요. 영수증 줄이나 함께한 사람이 바뀌면 메뉴 배분을 지워 다시 나누게 해요 |
| POST | `/api/rooms/:id/receipts/extract` | 영수증 사진(긴 변 1600px JPEG, base64) → 초안. **저장하지 않아요** |
| POST | `/api/rooms/:id/expenses/:eid/allocate` | 비서들이 공유한 기억으로 영수증 줄 배분. 근거 없는 줄은 지출을 남긴 사람에게 물어요. 응답 `{ expense, source, how, latencyMs }`. 이미 나눴고 비서 기억이 그대로면 409이고 아무것도 바꾸지 않아요(버전·확인한 줄 유지) |
| POST | `/api/rooms/:id/expenses/:eid/lines/:itemId` | 줄 하나를 사람이 확정(`{ consumers }`) |

| POST | `/api/rooms/:id/invoices/send` | 지금 방 `version`으로 청구서 보내기. 같은 version이면 다시 만들지 않아요(멱등). 각자의 비서가 규칙대로 수락·질문·이의를 정해요 |
| POST | `/api/rooms/:id/invoices/:iid/answer` | 주인에게 물은 청구서에 답하기 `{ decision: 'accept'|'dispute', expenseId?, claim? }` |
| POST | `/api/rooms/:id/disputes` | 이의 제기 `{ expenseId, claim }` |
| POST | `/api/rooms/:id/disputes/:did/mediate` | 중재 비서에게 맡기기(당사자만) |
| POST | `/api/rooms/:id/disputes/:did/agree` | 중재안에 동의. 양쪽이 동의하면 지출을 다시 나누고 version을 올려 청구서를 다시 보내요 |
| POST | `/api/rooms/:id/payout` | 받을 계좌 `{ bank, accountNo, holder }`. 나에게 오는 송금에 토스 링크를 채워요 |
| POST | `/api/rooms/:id/transfers/:tid/approve` · `sent` · `confirm` · `not-received` | 송금 화면 열기·보냈어요(보내는 사람), 받았어요·아직 안 들어왔어요(받는 사람). `not-received`는 `sent`일 때만 되고, 상태는 `sent` 그대로 두고 `notReceivedAt`만 붙여 보내는 사람에게 다시 물어요. 보냈다고 한 돈이라 지출이 바뀌어도 대체되지 않고, 받는 사람이 계좌를 바꿔도 링크가 바뀌지 않아요. 보내는 사람이 송금 내역을 보고 `sent`를 다시 부르면 표시를 내리고 `recheckedAt`을 남겨요(지출이 바뀐 뒤여도 돼요). 그 사이 돈이 들어왔으면 `confirm`도 돼요 |
| POST | `/api/rooms/:id/transfers/:tid/qr` | 컴퓨터 송금 화면에 띄울 QR 토큰 받기(보내는 사람만). 응답 `{ qrToken, expiresAt }`, 15분 뒤 만료. 받을 계좌가 없거나 이미 보낸 송금이면 409(받는 사람이 안 들어왔다고 한 송금은 다시 보낼 수 있게 만들어 줘요) |
| GET | `/api/qr/:token` | 휴대폰으로 QR을 찍으면 열리는 주소. 토큰을 토스 링크로 바꿔 302로 넘겨요. **신원 헤더 없이** 열려요(토큰이 곧 열쇠). 만료되었거나 잘못된 토큰은 404. 토큰은 서버 메모리에만 있어서 서버가 한 대일 때만 맞아요 |
| POST | `/api/cron/tick` | 때가 된 송금 알림, 보낸 뒤 미확인 알림(1일·3일 뒤 두 번). `x-cron-secret`이 `CRON_SECRET`과 같을 때만(로컬 서버는 30초마다 스스로 불러요) |

`actions`는 이벤트 기록에서 세지 않고 서버가 현재 상태에서 계산해요(`src/actions.mjs`). 그래서 처리한 일은 자동으로 빠져요. 종류는 `confirm_line`(줄 확인), `answer_invoice`(한도를 넘은 청구서), `agree_dispute`(중재 맡기기·중재안 동의), `approve_transfer`(보낼 때가 된 송금, 보냈는지 다시 묻는 송금), `set_payout`(받을 계좌 없음), `confirm_receipt`(받았는지 확인)예요.

**송금 링크는 미리 만들어요.** 브라우저는 사용자 제스처 안에서만 앱을 열어 줘요. 그래서 송금을 만들 때 서버가 `link`(토스 송금 화면)와 `fallback`(계좌·금액 복사용)을 채워 두고, 화면은 밀어서 보내기를 놓는 그 순간 링크를 열어요.

## 로컬에서 실행

```bash
npm start                      # 데모 화면: http://localhost:4500
DEV_SEED=1 npm start           # 실제 방 화면을 시드 데이터로 열어 볼 때
npm test                       # 계약·계산 테스트(에뮬레이터가 필요한 테스트는 건너뜀)
npm run test:emulators         # Firebase 에뮬레이터(Firestore·Storage·Auth)를 띄워 전체 테스트. Java 21과 firebase-tools 필요
```

Firestore로 서버를 띄우는 방법은 [Firestore 안내](docs/firestore-setup.md)를 보세요.

키가 없으면 규칙 모드로 동작해요. Gemini가 필요하면 `.env`에 `GEMINI_API_KEY`를 넣으세요(`.env`는 저장소에 올라가지 않아요).
