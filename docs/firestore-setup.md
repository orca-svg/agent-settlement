# #3 Firestore 연결 안내

## 지금 된 것

- `src/store/firestore.mjs`의 `FirestoreStore`가 `MemoryStore`와 같은 Store 계약을 지켜요. 서버는 `STORE=firestore`일 때만 이걸 쓰고, 아니면 지금처럼 메모리에 둬요. 어느 쪽이든 `encryptedStore`로 계좌 칸을 잠가요.
- 비서 기록 `seq`는 방마다 트랜잭션으로 매기고, 탈퇴(`eraseUser`)도 한 트랜잭션으로 써요. 결과는 `MemoryStore`와 같아요(`eraseUserSnapshot`을 같이 씀).
- 영수증 사진은 Firestore 문서 한도(1MiB)를 넘을 수 있어서 Cloud Storage `receipts/{지출 id}`에 둬요.
- 보안 규칙: `firestore.rules`(방 멤버만 읽기, 송금은 당사자만, 쓰기는 모두 서버만), `storage.rules`(전부 서버만).
- 방 화면은 서버가 Firestore이고 로그인한 상태면 비서 기록을 `onSnapshot`으로 받아요. 그 밖에는 2초 폴링이에요. 실시간 연결이 거부되면 폴링으로 이어 가요.
- 돈 계산은 원래 서버가 해요. 화면은 지출 입력(줄·단가·함께한 사람)만 보내고, 몫·차액·청구서·송금은 서버가 `public/core.js`로 계산해요. Firestore 위에서도 "몫의 합 = 결제액, 차액의 합 = 0"을 테스트로 확인했어요.
- 비로그인 데모(`index.html`)는 저장소를 쓰지 않아서 그대로예요.

## 팀 Firebase 프로젝트에 붙일 때

#2 안내(`docs/auth-location-setup.md`)대로 프로젝트와 로그인을 먼저 준비한 뒤:

1. **Firestore 만들기.** Console → Firestore Database → 데이터베이스 만들기 → Native 모드. 위치는 Cloud Run과 같은 `asia-northeast1`(도쿄)을 권장해요. 위치는 나중에 못 바꿔요.
2. **Storage 만들기.** Console → Storage. 2026-02-03부터 Cloud Storage for Firebase는 **Blaze 요금제**가 필요해요(무료 사용량은 그대로 있어요). 버킷 이름(`<project>.firebasestorage.app` 또는 예전 `<project>.appspot.com`)을 적어 둬요.
3. **규칙 배포.** `firebase deploy --only firestore:rules,storage --project <project>`
4. **서버 권한.** Cloud Run 서비스 계정에 `Cloud Datastore 사용자`(roles/datastore.user)와 버킷의 `Storage 개체 관리자`(roles/storage.objectAdmin)를 줘요. 로컬은 `gcloud auth application-default login`.
5. **환경변수.** #2의 Firebase 값 네 개에 더해:

   ```dotenv
   STORE=firestore
   FIREBASE_STORAGE_BUCKET=<버킷 이름>
   ```

6. **배포.** `--max-instances 1`은 그대로 둬요. 서버 안의 요청 큐, QR 토큰, AI 캐시가 인스턴스 하나를 전제로 해요(`ARCHITECTURE.md` 참고).
7. **`PAYOUT_ENC_KEY`는 Firestore에 계좌가 들어간 뒤로 절대 바꾸지 않아요.** 바뀌면 잠긴 계좌를 못 풀어서 `tick()`이 멈추고, 모든 방의 송금 알림이 멈춰요.

## 프로젝트 없이 에뮬레이터로

Java 21 이상과 firebase-tools가 필요해요.

```sh
npm run test:emulators   # 에뮬레이터를 띄우고 전체 테스트(Firestore 계약·규칙 포함)를 돌린 뒤 내림
```

서버를 에뮬레이터에 붙여 화면까지 보려면 `firebase emulators:start --only auth,firestore,storage --project demo-agent-settlement`를 띄우고, `.env`에 #2 안내의 에뮬레이터 값과 아래를 더해요.

```dotenv
STORE=firestore
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080
FIREBASE_STORAGE_EMULATOR_HOST=127.0.0.1:9199
FIREBASE_STORAGE_BUCKET=demo-agent-settlement.appspot.com
```

운영(`NODE_ENV=production`)에서는 에뮬레이터 값이 있으면 서버가 시작하지 않아요.

## 아직 남은 것

- **방이 생기는 길이 없어요.** Firebase가 켜지면 #2 규칙상 개발용 시드(`/api/dev/seed`)가 꺼져요. 그래서 #4 방 만들기·참가하기 전까지는 실제 계정으로 방을 열 방법이 없어요. 오사카 시드(`src/dev/seed.mjs`)는 어떤 Store에도 그대로 쓸 수 있어요.
- **`_memberUids`.** #4가 방을 만들 때도 Store의 `put('rooms', …)`을 거치면 자동으로 채워져요. Firestore에 직접 쓰면 규칙이 멤버를 못 알아봐요.
- **#5 비서 설정**은 `agents/{uid}`에 그대로 쓰면 돼요. 화면에서 직접 읽지 못하게 막아 뒀어요(공유 기억·잠긴 계좌).
- 메모리에 있던 데이터를 Firestore로 옮기는 작업은 없어요(지금 배포 서버의 데이터는 원래 재시작하면 사라져요).
- 위치 동의 만료는 지금처럼 요청·tick 때 `sweep()`이 정리해요. 동의가 많아지면 Firestore TTL로 바꾸는 게 좋아요.
- 실제 Firebase 프로젝트, 실제 Google 로그인으로는 아직 확인하지 않았어요. 에뮬레이터로만 확인했어요.
