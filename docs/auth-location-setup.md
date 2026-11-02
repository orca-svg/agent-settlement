# #2 / #7 구현과 연결 안내

## 현재 범위

- #2: Google 로그인·로그아웃 화면, 프로필 이름·색, 내 방 목록, ID 토큰 및 폐기 여부 검증, 방 멤버 접근 제어, 기존 사용자별 AI 호출 제한 유지. 비로그인 데모 API 유지.
- #7: 브라우저 단발 위치 측정 → 기기 안에서 장소와 거리 비교 → 시각·결과 한 줄만 서버 전송. 동의는 최대 24시간이며 철회·만료 시 요약과 연결된 미확정 중재안을 삭제. 원본 좌표·이동 경로를 서버나 Gemini에 보내지 않음.
- 체크아웃 요약은 수동 이의와 기존 `onDispute: evidence` 규칙에 연결. 기기 보고는 위변조 가능한 보조 근거여서 `left_at`으로 바꾸지 않음. 중재 확신도는 0.49 이하이고 자동 동의하지 않음. 양 당사자가 확인해야 금액이 바뀜.
- 탈퇴: 최근 재인증 후 프로필·비서 설정·위치 요약·본인 지출 영수증 원본을 삭제. 공동 정산 금액은 유지하고 방마다 독립된 익명 UID로 바꿔 계정 연결을 제거. 과거 문구에 복제된 개인정보와 송금 링크·QR·모델 캐시도 정리. 원 계정에 대한 접근 차단 표식은 삭제 재시도용으로만 유지.
- 기준: [Epic #1의 팀 가이드](https://github.com/orca-svg/agent-settlement/issues/1#issuecomment-6557374656), `ARCHITECTURE.md`. Firebase/GCP 프로젝트 생성·실제 OAuth·배포는 수행하지 않음.

## 아직 완료되지 않은 항목

1. **Firebase 프로젝트 연결 및 실제 Google OAuth 검증.** 아래 순서로 팀 프로젝트 설정 필요.
2. **#3 영구 저장소 연결.** 현재 MemoryStore이므로 서버 재시작 시 프로필·방·요약이 사라짐. 새 컬렉션 `users`, `deletedUsers`, `locationConsents`, `locationEvidence`를 같은 Store 계약으로 지원해야 함. 운영에서는 TTL 삭제, 요청/삭제 경쟁에 대한 트랜잭션도 필요.
3. **#3 탈퇴 계약 연결.** MemoryStore의 `eraseUser(uid)` 구현 및 테스트를 제공. FirestoreStore에도 같은 원자적 삭제·익명화 기능을 연결해야 함. 지원하지 않는 저장소는 503으로 탈퇴를 막음. 삭제 도중 Auth API가 실패하면 tombstone으로 일반 접근을 막고 삭제 상태 화면에서 재시도 가능. 익명화는 채무 면제가 아니며, 탈퇴자의 미정산 금액은 앱이 임의로 송금·탕감하지 않음.
4. **실제 기기 위치 권한·정확도 검증.** 현재 지출 날짜는 프로젝트의 기존 날짜 계약에 맞춰 한국 시각 기준. 해외 시차·자정 넘는 모임은 별도 설계 필요. 자동 백그라운드 추적, Google 타임라인 직접 연동, Places 장소 검색은 구현하지 않음.
5. 방 생성·초대는 #4 담당 범위. 신규 계정에는 빈 방 목록을 표시함. #5의 비서 규칙 설정을 연결하면 사전에 맡긴 범위에서 이의가 자동 생성됨.

## 프로젝트 없이 먼저 실행

Node 22.9 이상에서:

```sh
npm ci --ignore-scripts
npm test
npm start
```

- `http://localhost:4500/` — 기존 데모.
- `/account.html` — 프로젝트 미설정 안내. 로그인 성공을 가짜로 표시하지 않음.
- 개발용 방이 필요하면 `.env`에 `DEV_SEED=1` 후 재시작하여 `/room.html` 사용. 개발용 신원은 로컬 프로토타입 전용. Firebase 설정 또는 운영 모드에서는 비활성화.
- 로그인·권한 테스트는 Firebase 검증기를 주입하고 HTTP API를 실제 호출함. 실제 Google OAuth 테스트를 대체하지 않음.

## Firebase를 처음 만들 때

1. [Firebase Console](https://console.firebase.google.com/)에서 팀 프로젝트 생성. 기존 GCP 프로젝트가 확인되면 그 프로젝트에 Firebase를 추가할 수도 있음.
2. 프로젝트 설정 → 웹 앱 등록. 웹 앱 설정의 `projectId`, `apiKey`, `authDomain`, `appId`를 `.env.example`에 대응하여 `.env` 작성. 이 값들은 공개 클라이언트 설정이며 서비스 계정 비밀키가 아님.
3. Authentication → Sign-in method → Google 활성화 및 지원 이메일 선택.
4. Authentication → Settings → Authorized domains에 로컬 테스트의 `localhost`와 배포 화면의 `orca-svg.github.io` 추가. 다른 배포 도메인은 실제 도메인으로 등록.
5. 로컬 서버 자격 증명은 `gcloud auth application-default login`. 해당 프로젝트의 Firebase Auth 사용자 조회·삭제 권한 필요. Cloud Run은 서비스 계정과 Application Default Credentials 사용. 비밀키 JSON을 public 폴더·저장소에 넣지 않음.
6. 서버 환경변수에 네 Firebase 설정을 주입하고 재시작. `/account.html`에서 Google 팝업 로그인 → 이름·색 저장 → 로그아웃 후 데모 복귀 확인.
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

1. 방에서 오늘 날짜의 지출을 만들고 내 UID를 참여자에 포함.
2. `location.html?room=방ID`에서 동의 체크박스와 공유 기간 선택.
3. 해당 장소의 위도·경도와 반경 입력. 장소 좌표는 페이지 메모리에만 존재. 위치 버튼을 누를 때 브라우저 권한 요청.
4. 체크인 또는 체크아웃. 원본 좌표 없이 `expenseId`, `action`, `observedAt`, `relation`만 전송. 정확도 200m 초과는 불확실 처리. 위치 기록 없음은 불참을 뜻하지 않음.
5. 체크아웃 요약을 이의 제기와 중재에 사용. 상대방 이의 화면에는 한 줄 요약만 표시. 영구 이벤트에는 요약을 복제하지 않음.
6. 철회하면 요약 삭제 및 관련 미확정 제안을 재검토 상태로 되돌림. 이미 양쪽이 합의한 금액은 유지. 동의 만료는 API 접근·서버 tick에서 정리. 이미 상대방이 읽거나 별도로 복사한 내용까지 회수하지는 못함.

## #7 공식 경로 조사 (2026-11-01)

| 경로 | 확인한 내용 / 결정 |
| --- | --- |
| Google Maps Timeline | 기기별 저장 및 Android 설정에서 내보내기 안내. 현재 API에서 개인 타임라인을 직접 읽는 공식 경로는 확인하지 못함. Google 로그인만으로 접근 가능하다고 가정하지 않음. |
| Data Portability API | Maps 스키마는 기여·저장 장소·설정 등. 타임라인 방문 이력 지원을 확인하지 못해 이 기능의 기반으로 채택하지 않음. |
| 파일 내보내기/Takeout | 사용자가 확보한 내보내기 파일을 로컬에서 읽는 대안은 가능. 장치별 JSON 형식·실제 샘플 확인 전에는 파서 지원을 약속하지 않음. |
| Geolocation | 사용자 허용과 보안 컨텍스트가 필요한 현재 위치 측정. 이번 MVP에서 선택. 백그라운드 추적이나 과거 방문 증명으로 사용하지 않음. |
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
