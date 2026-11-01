# 아키텍처: 정산은 비서끼리

팀원이 각자 이슈를 맡아 개발할 때 맞춰야 하는 **계약**을 정리한 문서예요. 코드의 기준은 `src/domain/types.mjs`이고, 이 문서와 그 파일은 함께 고쳐요.

## 한눈에 보기

```
브라우저
  ├─ public/index.html + app.js   데모 화면(로그인 없이 보는 오사카 시나리오). 동작을 바꾸지 않아요
  └─ public/room.html + room.js   실제 방 화면
        │  room-api.js: api(), subscribeRoom(), currentUid()
        ▼
API 서버 (server.mjs → src/app.mjs)
  ├─ src/identity.mjs     누가 요청했나 (#2가 교체)
  ├─ src/store/           Store 인터페이스, 지금은 MemoryStore (#3이 교체)
  ├─ src/gemini.mjs       Gemini 호출 (키는 Secret Manager·로컬 .env에만)
  ├─ src/agents/          메뉴 배분·중재, 이후 규칙 판단·청구·송금 안내
  └─ public/core.js       돈 계산(환율·몫·차액·송금 경로). 화면·서버·테스트가 같은 코드를 씀
```

## 지키는 원칙

- **LLM은 금액을 계산하지 않아요.** Gemini는 '누가 먹었나', '영수증에 뭐가 있나', '중재안'만 내고, 금액은 `public/core.js`가 계산해요. 모델 출력은 스키마로 제한하고 서버가 다시 검증해요. 실패하면 규칙으로 대신하고 화면에 `규칙`이라고 표시해요.
- **비서는 사람이 정한 범위 안에서만 움직여요.** 자동 수락 한도를 넘거나 근거가 없는 일은 반드시 주인에게 물어요.
- **우리 서비스는 돈을 보관하거나 이체하지 않아요.** 송금은 사용자의 송금 앱에서 일어나요. 우리는 금액이 채워진 송금 화면을 승인하는 순간 열어 줄 뿐이에요.
- **비서 기록(이벤트)은 서버만 써요.** 화면은 읽기만 해요.
- **민감 정보는 최소로 다뤄요.** 위치는 원본 대신 요약만, 계좌번호는 송금 당사자에게만 보여요.

## 확장 지점

| 이슈 | 바꿀 곳 | 지금 구현 | 바꿀 구현 |
| --- | --- | --- | --- |
| #2 로그인 | `src/identity.mjs`의 `identify(req, store, roomId)` | `x-demo-user` 헤더의 uid가 방 멤버면 통과 | Firebase ID 토큰 검증 → `{ uid, name }` |
| #2 로그인 | `public/room-api.js`의 `currentUid()` | localStorage에 고른 uid | 로그인한 사용자 |
| #3 Firestore | `src/store/`의 Store | `MemoryStore` | 같은 메서드를 가진 `FirestoreStore` |
| #3 Firestore | `public/room-api.js`의 `subscribeRoom()` | 2초 폴링 | `onSnapshot` |
| #4 방 | `rooms` 문서와 방 API | 개발용 시드 `POST /api/dev/seed` | 방 만들기·참가하기(환율 표 입력 포함) |
| #5 비서 설정 | `agents` 문서의 `memory`·`rules` | 시드 기본값 | 설정 화면과 저장 |
| #7 위치 | `src/agents/evidence.mjs`의 `evidenceFor()` | 빈 배열 | 위치 요약 → `Evidence` |
| #8 송금 | `agents` 문서의 `payout`, `src/payments/toss.mjs` | 시드 값, 딥링크 생성기(#9) | 받는 계좌 설정 화면, 실기기 검증 반영 |
| #10 보안 | `src/http.mjs`, Firestore 보안 규칙 | 신원당 호출 제한 | 토큰 필수, 보안 규칙 테스트, 계좌 암호화 |

## Store 인터페이스

모든 메서드는 `async`이고, 돌려주는 문서는 복사본이에요. 그래서 돌려받은 객체를 고쳐도 저장본은 바뀌지 않아요.

| 메서드 | 하는 일 |
| --- | --- |
| `get(col, id)` | 문서 하나, 없으면 `null` |
| `put(col, doc)` | `doc.id`로 저장(덮어쓰기) |
| `list(col, where = {})` | 필드 동등 비교로 거르기(Firestore의 `==`와 같은 범위) |
| `appendEvent(roomId, ev)` | 비서 기록 추가. `seq`(방마다 1부터)와 `at`(ISO 시각)을 채워서 돌려줌 |
| `listEvents(roomId, afterSeq = 0)` | `seq > afterSeq`인 기록 |

계약 테스트는 `test/store.test.mjs`예요. 따라서 `FirestoreStore`도 이 테스트를 그대로 통과해야 해요.

## 컬렉션과 Firestore 경로

| 컬렉션 | 문서 타입 | Firestore 경로(제안) |
| --- | --- | --- |
| `rooms` | `Room` | `rooms/{roomId}` |
| `expenses` | `Expense` | `rooms/{roomId}/expenses/{expenseId}` |
| `agents` | `AgentSettings` | `agents/{uid}` |
| `invoices` | `Invoice` | `rooms/{roomId}/invoices/{invoiceId}` |
| `disputes` | `Dispute` | `rooms/{roomId}/disputes/{disputeId}` |
| `transfers` | `Transfer` | `rooms/{roomId}/transfers/{transferId}` |
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
| POST | `/api/rooms/:id/expenses` | 지출 남기기(직접 입력, 또는 확인을 마친 영수증 줄). 방 `version`이 올라가요 |
| POST | `/api/rooms/:id/receipts/extract` | 영수증 사진(긴 변 1600px JPEG, base64) → 초안. **저장하지 않아요** |
| POST | `/api/rooms/:id/expenses/:eid/allocate` | 비서들이 공유한 기억으로 영수증 줄 배분. 근거 없는 줄은 지출을 남긴 사람에게 물어요 |
| POST | `/api/rooms/:id/expenses/:eid/lines/:itemId` | 줄 하나를 사람이 확정(`{ consumers }`) |

`actions`는 이벤트 기록에서 세지 않고 서버가 현재 상태에서 계산해요(`src/actions.mjs`). 그래서 처리한 일은 자동으로 빠져요. 지금은 `confirm_line`만 있고, 다음 작업(#9)에서 청구서 답하기·이의 동의·송금 승인·받았어요 확인이 더해져요.

다음 작업(#9)에서 더해질 것: 청구서 보내기·답하기, 이의 제기·중재·동의, 송금 승인·보냈어요·받았어요, 일정 처리(`/api/cron/tick`).

## 로컬에서 실행

```bash
npm start                      # 데모 화면: http://localhost:4500
DEV_SEED=1 npm start           # 실제 방 화면을 시드 데이터로 열어 볼 때
npm test                       # 계약·계산 테스트
```

키가 없으면 규칙 모드로 동작해요. Gemini가 필요하면 `.env`에 `GEMINI_API_KEY`를 넣으세요(`.env`는 저장소에 올라가지 않아요).
