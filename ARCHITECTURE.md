# 아키텍처: 정산은 비서끼리

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
  ├─ src/identity.mjs     누가 요청했나 (#2가 교체)
  ├─ src/store/           Store 인터페이스, 지금은 MemoryStore (#3이 교체). encryptedStore가 계좌 칸을 잠가 저장
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
| #2 로그인 | `src/identity.mjs`의 `identify(req, store, roomId)` | `x-demo-user` 헤더의 uid가 방 멤버면 통과 | Firebase ID 토큰 검증 → `{ uid, name }` |
| #2 로그인 | `public/room-api.js`의 `currentUid()` | localStorage에 고른 uid | 로그인한 사용자 |
| #3 Firestore | `src/store/`의 Store | `MemoryStore` | 같은 메서드를 가진 `FirestoreStore` |
| #3 Firestore | `public/room-api.js`의 `subscribeRoom()` | 2초 폴링 | `onSnapshot` |
| #4 방 | `rooms` 문서와 방 API | 개발용 시드 `POST /api/dev/seed` | 방 만들기·참가하기(환율 표 입력 포함) |
| #5 비서 설정 | `agents` 문서의 `memory`·`rules` | 시드 기본값 | 설정 화면과 저장 |
| #7 위치 | `src/agents/evidence.mjs`의 `evidenceFor()`·`counterFor()` | 빈 배열(개발용 데모 방의 '2차 바'만 고정 근거) | 위치 요약 → `Evidence` |
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

계약 테스트는 `test/store.test.mjs`예요. 따라서 `FirestoreStore`도 이 테스트를 그대로 통과해야 해요.

### 계좌 칸 암호화 (`src/store/encrypted.mjs`)

`server.mjs`는 Store를 `encryptedStore(store, key)`로 감싸요. 계좌번호가 들어가는 칸(`agents.payout`, `transfers.link`, `transfers.fallback`)은 넣을 때 AES-256-GCM으로 잠그고(`enc:v1:…`, `src/security/seal.mjs`) 꺼낼 때 풀어요. 그래서 다른 코드는 평문을 넣고 평문을 받고, 저장소에는 잠긴 글자만 남아요.

- 잠긴 값에는 `컬렉션/문서id/칸` 이름표가 묶여 있어서 다른 문서로 옮겨 붙이면 풀리지 않아요. 그래서 잠긴 문서의 `id`를 바꾸는 코드는 이 래퍼로 풀었다가 다시 넣어야 해요.
- 잠긴 칸이 평문이거나 풀리지 않으면 오류를 내요. 잠긴 칸으로는 `list` 검색을 할 수 없어요.
- 열쇠는 `PAYOUT_ENC_KEY`(base64, 32바이트)예요. 배포(`NODE_ENV=production`, `Dockerfile`이 넣어 줌)에서 없으면 서버가 시작하지 않고, 로컬에서는 개발용 열쇠를 써요.
- 진짜 저장소에 `eraseUser`(#2 탈퇴)가 있으면 그대로 전달하고, 그 사람이 낀 송금의 링크만 평문으로 풀어서 돌려줘요(QR 토큰 무효화용). 풀리지 않는 링크는 어차피 지울 값이라 건너뛰어요.
- `FirestoreStore`(#3)도 같은 자리에서 감싸면 돼요. 다만 `tick()`은 모든 방의 송금을 풀어 보므로, 열쇠가 바뀌거나 값 하나가 망가지면 모든 방의 알림이 멈춰요. 그래서 열쇠는 바꾸지 않아요.

## 컬렉션과 Firestore 경로

| 컬렉션 | 문서 타입 | Firestore 경로(제안) |
| --- | --- | --- |
| `rooms` | `Room` | `rooms/{roomId}` |
| `expenses` | `Expense` | `rooms/{roomId}/expenses/{expenseId}` |
| `agents` | `AgentSettings` | `agents/{uid}` |
| `invoices` | `Invoice` | `rooms/{roomId}/invoices/{invoiceId}` |
| `disputes` | `Dispute` | `rooms/{roomId}/disputes/{disputeId}` |
| `transfers` | `Transfer` | `rooms/{roomId}/transfers/{transferId}` |
| `receipts` | 영수증 사진 `{ id(=지출 id), roomId, mimeType, data }` | Firebase Storage `receipts/{roomId}/{expenseId}.jpg` 권장 |
| 비서 기록 | `AgentEvent` | `rooms/{roomId}/events/{seq}` |

## 도메인 타입 요약

자세한 필드는 `src/domain/types.mjs`의 JSDoc을 보세요.

- **uid:** ASCII 문자열이에요(#2 이후 Firebase uid). 화면에는 `Member.name`만 보여요.
- **금액·날짜:** 금액은 정수예요(원·엔은 보조 단위가 없어요). 날짜는 `YYYY-MM-DD`, 시각은 `HH:MM`, 서버 일정은 `Asia/Seoul` 기준이에요.
- **`Room`:** 멤버, 환율 표 `fx`(원/100 단위, 결제일별 매매기준율·카드 수수료·사람별 현찰 환율), 합의한 환율 정책, `version`을 가져요. `version`은 지출이 바뀔 때마다 올라가고, 청구서·송금은 이 version에 묶여요.
- **`Expense`:** `split`이 `'items'`면 영수증 줄(`items`)마다 `alloc`의 `consumers`가 나눠 내요.
- **`AgentSettings`:**
  - `memory`: 정산에 쓰라고 공유한 기억이에요. 무료 요금제는 5개까지예요.
  - `rules`: 자동 수락 한도, 보낼 시기(`'now'` 또는 `{ payday: 25 }`), 이의 처리예요.
  - `payout`: 받는 계좌예요.
- **`AgentEvent.action`:** 사람이 할 일이에요. `type`은 `confirm_line`, `answer_invoice`, `agree_dispute`, `approve_transfer`, `confirm_receipt`, `set_payout` 중 하나이고, `for`가 그 일을 할 사람이에요.

## API

지금 있는 것이에요. 실제 방 API는 신원 헤더가 필요해요(#2 전까지는 `x-demo-user: <uid>`).

| 메서드 | 경로 | 하는 일 |
| --- | --- | --- |
| GET | `/api/config` | Gemini 연결 상태 |
| POST | `/api/allocate`, `/api/mediate` | 데모 화면용 메뉴 배분·중재 |
| POST | `/api/dev/seed` | 개발용 데모 방 만들기(`DEV_SEED=1`일 때만) |
| GET | `/api/rooms/:id` | 방, 지출, 청구서, 이의, 송금, 사람별 차액, 그리고 **내가 처리할 일(`actions`)** |
| GET | `/api/rooms/:id/events?after=n` | 비서 기록 |
| POST | `/api/rooms/:id/expenses` | 지출 남기기(직접 입력, 또는 확인을 마친 영수증 줄). 영수증 지출은 `receipt: { mimeType, data }`로 줄인 사진을 함께 저장해요. 방 `version`이 올라가요 |
| POST | `/api/rooms/:id/expenses/:eid/delete` | 지출 지우기. 영수증 사진도 함께 지워요 |
| GET | `/api/rooms/:id/expenses/:eid/receipt` | 저장된 영수증 사진 `{ mimeType, data }`(방 멤버만) |
| POST | `/api/rooms/:id/expenses/:eid` | 지출 고치기. 같은 검증을 거쳐 덮어써요. 영수증 줄이나 함께한 사람이 바뀌면 메뉴 배분을 지워 다시 나누게 해요 |
| POST | `/api/rooms/:id/receipts/extract` | 영수증 사진(긴 변 1600px JPEG, base64) → 초안. **저장하지 않아요** |
| POST | `/api/rooms/:id/expenses/:eid/allocate` | 비서들이 공유한 기억으로 영수증 줄 배분. 근거 없는 줄은 지출을 남긴 사람에게 물어요. 응답 `{ expense, source, how, latencyMs }` |
| POST | `/api/rooms/:id/expenses/:eid/lines/:itemId` | 줄 하나를 사람이 확정(`{ consumers }`) |

| POST | `/api/rooms/:id/invoices/send` | 지금 방 `version`으로 청구서 보내기. 같은 version이면 다시 만들지 않아요(멱등). 각자의 비서가 규칙대로 수락·질문·이의를 정해요 |
| POST | `/api/rooms/:id/invoices/:iid/answer` | 주인에게 물은 청구서에 답하기 `{ decision: 'accept'|'dispute', expenseId?, claim? }` |
| POST | `/api/rooms/:id/disputes` | 이의 제기 `{ expenseId, claim }` |
| POST | `/api/rooms/:id/disputes/:did/mediate` | 중재 비서에게 맡기기(당사자만) |
| POST | `/api/rooms/:id/disputes/:did/agree` | 중재안에 동의. 양쪽이 동의하면 지출을 다시 나누고 version을 올려 청구서를 다시 보내요 |
| POST | `/api/rooms/:id/payout` | 받을 계좌 `{ bank, accountNo, holder }`. 나에게 오는 송금에 토스 링크를 채워요 |
| POST | `/api/rooms/:id/transfers/:tid/approve` · `sent` · `confirm` · `not-received` | 송금 화면 열기·보냈어요(보내는 사람), 받았어요·아직 안 들어왔어요(받는 사람). `not-received`는 `sent`일 때만 되고, 송금을 `opened`로 되돌려(`notReceivedAt`) 보내는 사람에게 다시 물어요. 그 사이 돈이 들어왔으면 `confirm`도 돼요 |
| POST | `/api/rooms/:id/transfers/:tid/qr` | 컴퓨터 송금 화면에 띄울 QR 토큰 받기(보내는 사람만). 응답 `{ qrToken, expiresAt }`, 15분 뒤 만료. 받을 계좌가 없거나 이미 보낸 송금이면 409 |
| GET | `/api/qr/:token` | 휴대폰으로 QR을 찍으면 열리는 주소. 토큰을 토스 링크로 바꿔 302로 넘겨요. **신원 헤더 없이** 열려요(토큰이 곧 열쇠). 만료되었거나 잘못된 토큰은 404. 토큰은 서버 메모리에만 있어서 서버가 한 대일 때만 맞아요 |
| POST | `/api/cron/tick` | 때가 된 송금 알림, 보낸 뒤 미확인 알림(1일·3일 뒤 두 번). `x-cron-secret`이 `CRON_SECRET`과 같을 때만(로컬 서버는 30초마다 스스로 불러요) |

`actions`는 이벤트 기록에서 세지 않고 서버가 현재 상태에서 계산해요(`src/actions.mjs`). 그래서 처리한 일은 자동으로 빠져요. 종류는 `confirm_line`(줄 확인), `answer_invoice`(한도를 넘은 청구서), `agree_dispute`(중재 맡기기·중재안 동의), `approve_transfer`(보낼 때가 된 송금), `set_payout`(받을 계좌 없음), `confirm_receipt`(받았는지 확인)예요.

**송금 링크는 미리 만들어요.** 브라우저는 사용자 제스처 안에서만 앱을 열어 줘요. 그래서 송금을 만들 때 서버가 `link`(토스 송금 화면)와 `fallback`(계좌·금액 복사용)을 채워 두고, 화면은 밀어서 보내기를 놓는 그 순간 링크를 열어요.

## 로컬에서 실행

```bash
npm start                      # 데모 화면: http://localhost:4500
DEV_SEED=1 npm start           # 실제 방 화면을 시드 데이터로 열어 볼 때
npm test                       # 계약·계산 테스트
```

키가 없으면 규칙 모드로 동작해요. Gemini가 필요하면 `.env`에 `GEMINI_API_KEY`를 넣으세요(`.env`는 저장소에 올라가지 않아요).
