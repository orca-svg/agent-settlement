# #2 / #7 구현과 연결 안내

## 현재 범위

- #2: Google 로그인·로그아웃 화면, 프로필 이름·색, 내 방 목록, ID 토큰 및 폐기 여부 검증, 방 멤버 접근 제어, 기존 사용자별 AI 호출 제한 유지. 비로그인 데모 API 유지.
- #7(11/3 재설계): 미리 체크인하지 않고, **이의를 낼 때** 사용자가 고른 Google 지도 타임라인 내보내기 파일에서 그 지출 시간대(첫 주문~결제)의 방문만 브라우저 안에서 읽음(`public/timeline.js`). '첫 주문 때 머물던 곳을 떠난 시각'과 다음 장소 도착 시각, 또는 '결제까지 같은 곳에 있었음'만 서버로 보냄. 파일·좌표·장소 이름은 보내지 않음. 기록이 없거나 확신이 낮으면 아무것도 넣지 않고 사람이 직접 다룸.
- 요약은 사용자가 '이의에 붙이기' 스위치를 켜야만 붙고(그 순간 동의), 7일 뒤나 '내 위치 요약 지우기'로 지움. 떠난 시각은 중재가 이미 쓰는 `left_at`이 되어 그 뒤 주문에서 그 사람을 뺌. 본인이 낸 자료라 위변조할 수 있으므로 늘 `requiresHumanApproval=true`이고 자동 동의하지 않음. 중재가 근거 충돌을 보고한 줄만 확신도 0.49 이하로 제한.
- 탈퇴: 확인 창 한 번 뒤(다시 로그인 창 없음) 프로필·비서 설정·위치 요약·본인 지출 영수증 원본을 삭제. 공동 정산 금액은 유지하고 방마다 독립된 익명 UID로 바꿔 계정 연결을 제거. 과거 문구에 복제된 개인정보와 송금 링크·QR·모델 캐시도 정리. 원 계정에 대한 접근 차단 표식은 삭제 재시도용으로만 유지.
- 기준: [Epic #1의 팀 가이드](https://github.com/orca-svg/agent-settlement/issues/1#issuecomment-6557374656), `ARCHITECTURE.md`. Firebase/GCP 프로젝트 생성·실제 OAuth·배포는 수행하지 않음.

## 아직 완료되지 않은 항목

### 11/3 리뷰 반영

- 리뷰어의 방 단위 처리 큐와 당사자 전용 위치 요약 가림을 유지.
- `Evidence.requiresHumanApproval`, `LineAlloc.evidenceConflict`를 추가. 모델은 줄별 `evidenceConflict`를 반환하고, 서버는 그 줄만 0.49로 제한하며 나머지 확신도는 유지. 충돌 여부의 의미 판단은 모델에 맡기므로 완전한 충돌 검출 보장은 아님. 규칙 fallback은 충돌을 추정하지 않음.
- 위치 근거는 양 당사자의 승인이 필요하고 자동 동의하지 않음. 예전 체크인·체크아웃 기록(`source` 없음)은 근거로 쓰지 않음.
- 청구서는 방 사람 모두가 읽으므로 위치 요약 글을 담지 않음. 원래 이유는 그대로 두고 `hasLocationSummary`로 '위치 요약 · 확인 전' 회색 배지만 표시. 요약을 지우면 배지도 거둠.
- 로그인 설정 요청이 일시적으로 실패해도 다음 요청에서 다시 초기화(동시 호출은 한 요청 공유). `test/auth-browser-init.test.mjs`.
- #35 병합 시 `firestore.rules`의 `disputes` 직접 읽기를 차단해야 API 가림을 우회할 수 없음. 이 브랜치에는 Firestore 규칙 파일이 없으며 #35 담당 변경 사항임.

1. **Firebase 프로젝트 연결 및 실제 Google OAuth 검증.** 아래 순서로 팀 프로젝트 설정 필요.
2. **#3 영구 저장소 연결.** 현재 MemoryStore이므로 서버 재시작 시 프로필·방·요약이 사라짐. 새 컬렉션 `users`, `deletedUsers`, `locationConsents`, `locationEvidence`를 같은 Store 계약으로 지원해야 함. 운영에서는 TTL 삭제, 요청/삭제 경쟁에 대한 트랜잭션도 필요.
3. **#3 탈퇴 계약 연결.** MemoryStore의 `eraseUser(uid)` 구현 및 테스트를 제공. FirestoreStore에도 같은 원자적 삭제·익명화 기능을 연결해야 함. 지원하지 않는 저장소는 503으로 탈퇴를 막음. 삭제 도중 Auth API가 실패하면 tombstone으로 일반 접근을 막고 삭제 상태 화면에서 재시도 가능. 익명화는 채무 면제가 아니며, 탈퇴자의 미정산 금액은 앱이 임의로 송금·탕감하지 않음.
4. **실제 타임라인 파일 확인.** 파서는 휴대폰 내보내기(`semanticSegments`)와 예전 Takeout(`timelineObjects`)을 공개 분석 기준으로 읽음. Google 공식 스키마가 아니므로 실제 내보내기 파일(Android·iOS)로 확인 필요. 시각은 한국 시각 기준이며 해외 시차는 별도 설계 필요. 장소 좌표를 쓰지 않아 '첫 주문 때 머물던 곳'을 그 지출의 장소로 봄. Places 장소 매칭은 구현하지 않음.
5. 방 생성·초대는 #4 담당 범위. 신규 계정에는 빈 방 목록을 표시함. #5의 비서 규칙 설정을 연결하면 사전에 맡긴 범위에서 이의가 자동 생성됨.

## 2026-11-02 통합 확인

- 전체 193개 테스트 통과(공식 Auth Emulator 포함, skip 0). 실제 Google OAuth와 실제 기기 GPS는 별도 검증 대상.
- 최신 main의 계좌 암호화, 프롬프트 입력 방어, 재배분 중복 호출 방지, 영수증 촬영 및 배포 파일 버전 기능을 함께 유지.
- 실제 서버 조립과 같은 `encryptedStore(MemoryStore)`에서 탈퇴를 확인: 당사자의 QR과 계좌 복사본 삭제, 타인의 계좌 복호화 정상, 공유 금액 유지.
- 위치 동의 철회·만료와 프로필 변경은 개인정보 없는 이벤트로 다른 참여자의 화면 갱신을 유도. API 응답은 `Cache-Control: no-store`.
- PR과 브랜치 push에서 `.github/workflows/test.yml`이 Node 22의 `npm ci` 및 `npm test`를 실행.
- Firebase 프로젝트는 아직 없음. 이 브랜치만 merge해도 Google 로그인이나 Cloud Run API 배포가 자동으로 완료되지는 않음. #3/#4 담당자와 위 연결 계약을 맞춘 뒤 실제 계정 검증 필요.

## 프로젝트 없이 먼저 실행

Node 22.9 이상에서:

```sh
npm ci --ignore-scripts
npm test
npm start
```

- `http://localhost:4500/` — 첫 화면과 체험 데모.
- `/account.html` — 프로젝트 미설정 안내. 로그인 성공을 가짜로 표시하지 않음.
- 개발용 방이 필요하면 `.env`에 `DEV_SEED=1` 후 재시작하여 `/room.html` 사용. 개발용 신원은 로컬 개발 서버 전용. Firebase 설정 또는 운영 모드에서는 비활성화.
- 로그인·권한 테스트는 Firebase 검증기를 주입하고 HTTP API를 실제 호출함. 실제 Google OAuth 테스트를 대체하지 않음.

## Firebase를 처음 만들 때

1. [Firebase Console](https://console.firebase.google.com/)에서 팀 프로젝트 생성. 기존 GCP 프로젝트가 확인되면 그 프로젝트에 Firebase를 추가할 수도 있음.
2. 프로젝트 설정 → 웹 앱 등록. 웹 앱 설정의 `projectId`, `apiKey`, `authDomain`, `appId`를 `.env.example`에 대응하여 `.env` 작성. 이 값들은 공개 클라이언트 설정이며 서비스 계정 비밀키가 아님.
3. Authentication → Sign-in method → Google 활성화 및 지원 이메일 선택.
4. Authentication → Settings → Authorized domains에 로컬 테스트의 `localhost`와 배포 화면의 `orca-svg.github.io` 추가. 다른 배포 도메인은 실제 도메인으로 등록.
5. 로컬 서버 자격 증명은 `gcloud auth application-default login`. 해당 프로젝트의 Firebase Auth 사용자 조회·삭제 권한 필요. Cloud Run은 서비스 계정과 Application Default Credentials 사용. 비밀키 JSON을 public 폴더·저장소에 넣지 않음.
6. 서버 환경변수에 네 Firebase 설정을 주입하고 재시작. `/account.html`에서 Google 팝업 로그인 → 이름·색 저장 → 로그아웃하면 '내 계정' 로그인 화면으로 돌아오는지 확인.
7. 팀의 #3/#4 데이터에 Firebase UID를 사용하여 멤버십 연결. 기존 데모 UID(`me`, `ms` 등)는 실제 계정으로 자동 변환하지 않음.

## 비용·프로젝트 없이 Auth Emulator로 통합 확인

공식 Firebase CLI 설치 후:

```sh
firebase emulators:start --only auth --project demo-agent-settlement
```

별도 서버 `.env`:

```dotenv
FIREBASE_PROJECT_ID=demo-agent-settlement
FIREBASE_API_KEY=demo-api-key
FIREBASE_AUTH_DOMAIN=demo-agent-settlement.firebaseapp.com
FIREBASE_APP_ID=demo-app-id
FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099
```

`npm start` 후 localhost에서 Google 버튼의 에뮬레이터 흐름을 확인. 실제 OAuth가 아니며 운영 사용 금지. 서버는 운영 모드의 emulator 설정을 거부함. 에뮬레이터 로그 포트는 앱의 4500과 충돌하지 않게 4502로 설정함.

공식 Auth Emulator와 실제 Firebase Admin SDK로 토큰 검증 → 프로필 저장 → 내 방 조회 → 계정 삭제 → 기존 토큰 거절을 통합 테스트했음. 에뮬레이터가 실행 중일 때 재현:

```powershell
$env:FIREBASE_AUTH_EMULATOR_HOST='127.0.0.1:9099'
$env:RUN_FIREBASE_EMULATOR_TESTS='1'
node --test test/firebase-emulator.test.mjs
```

일반 `npm test`에서는 이 통합 테스트를 건너뛰며 나머지 계약·HTTP 테스트는 모두 실행함. 에뮬레이터 테스트는 실제 Google OAuth 검증을 대체하지 않음.

## 위치 근거 확인

1. 휴대폰 Google 지도의 타임라인 설정에서 '타임라인 데이터 내보내기'로 JSON 파일을 받음(메뉴 위치는 기기·버전마다 다를 수 있음).
2. 청구서가 '확인 필요'로 오면 '맞지 않는 지출이 있어요' → 지출을 고르고 맞지 않는 점을 적음.
3. '위치 기록으로 확인'에서 타임라인 파일을 고름. 그 지출 시간대만 브라우저 안에서 읽어 한 줄 미리보기를 보여 줌. 기록이 없으면 '찾지 못했어요'라고 알리고 근거 없이 보냄. 개발용 방에서는 '개발용 가짜 기록으로 해 보기'로 같은 흐름을 시험할 수 있음.
4. '이의에 붙이기' 스위치를 켜야만 붙음. 서버로는 `{ expenseId, leftAt, nextAt, nextHome }` 또는 `{ expenseId, stayedUntil }`만 가고, 서버가 그 지출 시간대 안의 시각인지 확인한 뒤 같은 규칙으로 요약을 다시 만듦.
5. 이의 상대(지출을 낸 사람)와 이의를 낸 사람만 요약을 보고, 같은 방의 다른 사람에게는 '위치 요약 첨부'만 보임. 영구 이벤트에는 요약을 복제하지 않음.
6. 이의 화면의 '내 위치 요약 지우기'나 7일 만료 시 요약을 지우고 관련 미확정 중재안을 재검토 상태로 되돌림. 이미 양쪽이 합의한 금액은 유지. 이미 상대방이 읽은 내용까지 회수하지는 못함.

## #7 공식 경로 조사 (2026-11-01)

| 경로 | 확인한 내용 / 결정 |
| --- | --- |
| Google Maps Timeline | 기기별 저장 및 Android 설정에서 내보내기 안내. 현재 API에서 개인 타임라인을 직접 읽는 공식 경로는 확인하지 못함. Google 로그인만으로 접근 가능하다고 가정하지 않음. |
| Data Portability API | Maps 스키마는 기여·저장 장소·설정 등. 타임라인 방문 이력 지원을 확인하지 못해 이 기능의 기반으로 채택하지 않음. |
| 파일 내보내기/Takeout | **11/3 채택.** 타임라인은 2025-06-09부터 기기 안에만 저장되므로, 사용자가 휴대폰에서 내보낸 파일을 이의 시점에 브라우저 안에서만 읽음. 휴대폰 형식과 예전 Takeout 형식을 지원하되 실제 파일로 계속 확인. |
| Geolocation | 11/2에 체크인·체크아웃으로 구현했으나 11/3에 제외. 미리 체크인해야 하는 선행 행동이 필요하고, 정산이 끝난 뒤에는 쓸 수 없음. |
| Places API | 상호 → 장소 찾기에 쓸 수 있는 별도 후속 연동. 사용자의 과거 방문 여부를 증명하지 않으므로 이번에는 수동 장소 지정 사용. |

공식 근거:

- [Firebase Google 로그인](https://firebase.google.com/docs/auth/web/google-signin)
- [Admin SDK 토큰 검증](https://firebase.google.com/docs/auth/admin/verify-id-tokens)
- [Admin SDK 초기화](https://firebase.google.com/docs/admin/setup)
- [Firebase CDN 모듈](https://firebase.google.com/docs/web/alt-setup)
- [Auth Emulator](https://firebase.google.com/docs/emulator-suite/connect_auth)
- [Google 타임라인·기기 내보내기](https://support.google.com/maps/answer/6258979?co=GENIE.Platform%3DAndroid&hl=en)
- [Data Portability Maps 스키마](https://developers.google.com/data-portability/schema-reference/maps)
- [Geolocation 표준](https://www.w3.org/TR/geolocation/)
- [Places Text Search](https://developers.google.com/maps/documentation/places/web-service/text-search)
