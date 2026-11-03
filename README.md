# 정산은 비서끼리 (agent-settlement)

## 로그인·위치 근거 개발 안내 (#2 / #7)

Google 로그인, 토큰 검증, 계정·탈퇴 화면과 브라우저 체크인·체크아웃 요약을 추가했어요. 처음 실행할 때 `npm ci --ignore-scripts`가 필요해요. Firebase 미설정 상태에서도 기존 데모는 열려요. 프로젝트 연결, 실제 OAuth 검증 및 영구 저장소 연결은 아직 남아 있어요. 설정과 완료 범위는 [auth-location-setup.md](docs/auth-location-setup.md)를 보세요.

돈 얘기는 각자의 AI 비서끼리 하고, 사람은 **확인과 승인만** 하는 정산 웹 앱입니다. 단톡방에 정산 요청을 올리고 재촉하는 대신, 내 비서가 상대의 비서에게 청구서를 보내요. 그러면 상대의 비서는 주인이 맡긴 규칙대로 수락하거나, 주인에게 묻거나, 이의를 제기합니다.

- 데모: https://orca-svg.github.io/agent-settlement/
- GDGoC DevFest 2026 「Tell the Vision」 · Team 06 Money is Our Life · 주제 경제 · 소통
- 상태: low-fi 프로토타입이에요. 금액·환율·기록은 모두 가상의 샘플이고, 송금은 모의 송금이라 실제 돈은 움직이지 않습니다.

## 왜 만들었나

정산에서 가장 피곤한 건 계산이 아니라 **돈 얘기를 꺼내는 일**입니다. 요청을 올리면 관계가 어색해질까 걱정되고, 늦게 보내는 친구에게 다시 말하기는 더 어렵습니다. 게다가 현실의 정산은 1/N로 끝나지 않습니다.

| 기획서의 문제 | 이 앱에서의 해결 |
| --- | --- |
| 정산하기로 관계가 상할까 걱정됨 | 요청·수락·재촉을 비서끼리 백채널에서 처리. 단톡방에는 아무것도 올라가지 않음 |
| 정산을 올리는 걸 잊음 | 비서가 카드 승인 알림·영수증·대화에서 지출을 먼저 모음 |
| 메뉴가 달랐는데 반영하기 힘듦 | 각자의 비서가 공유한 기억(예: "술을 마시지 않아요")으로 영수증 줄마다 누구 몫인지 배분 |
| 여행 환율을 언제 기준으로 할지 애매함 | 여행 전에 환율 정책을 합의하고, 지출마다 계산 근거를 보여 줌 |
| 돈 보낼 시기를 놓침 | 비서에게 맡긴 보낼 시기(바로, 월급날 등)대로 송금 예약 |
| 내 몫에 이의가 있음 | 중립 중재 비서가 양쪽 근거와 영수증 주문 시각으로 중재안을 냄 |

## 핵심 기능

| 기능 | 하는 일 |
| --- | --- |
| 지출 수집 | 오사카 2박 3일 동안의 지출 7건. 출처(카드 알림, 영수증 사진, 대화)를 함께 보여 줍니다 |
| 메뉴별 배분 | Gemini가 비서들의 기억으로 영수증 줄을 배분합니다. 근거가 없는 줄은 짐작하지 않고 사람에게 묻습니다 |
| 비서의 기억 편집 | 기억을 지우거나 더하고 다시 나누면 배분이 어떻게 바뀌는지 바로 보입니다(무료 요금제는 사람당 5개) |
| 환율 정책 | 실제 낸 원화 / 결제일 기준율 / 정산일 기준율을 미리보기로 비교합니다. 다만 바꾸려면 4명의 비서가 모두 다시 동의해야 합니다 |
| 비서끼리 채널 | 청구서, 규칙 확인, 자동 수락, 이의 제기, 중재가 오가는 기록입니다. 사람에게는 확인할 일만 올라옵니다 |
| 이의 중재 | 민수의 비서가 "22:55에 먼저 귀가"라는 근거로 이의를 내면, 중재 비서(Gemini)가 주문 시각별로 다시 나눕니다 |
| 송금 경로 줄이기 | 지출마다 따로 보내면 21번 오갈 송금을 3번으로 줄입니다 |
| 밀어서 보내기 | 자동 수락 한도를 넘은 사람만 자기 화면에서 끝까지 밀어 승인합니다. 지금 보내거나 월급날로 예약할 수 있습니다 |

## 사용한 경제학 개념

| 개념 | 이 앱에서의 역할 |
| --- | --- |
| Transaction Cost (거래비용) | 정산의 비용은 계산보다 요청·재촉·눈치에 드는 심리적 비용이 큽니다. 그래서 그 비용을 사람 대신 비서가 집니다 |
| Principal–Agent Relationship (본인-대리인 관계) | 비서(대리인)는 주인이 정한 규칙(자동 수락 한도, 보낼 시기, 이의 처리)대로만 움직이고, 한도 밖의 일은 주인에게 묻습니다 |
| Ex-ante Commitment (사전 약정) | 환율 기준을 여행 전에 정해 두면, 정산할 때 각자 유리한 기준을 고르려는 다툼이 생기지 않습니다 |
| Exchange Rate Types (환율의 종류) | Basic Exchange Rate (매매기준율), Cardholder Billing Rate (카드 청구 환율, 해외 이용 수수료 1.4% 가정), Cash Exchange Rate (현찰을 살 때의 환율)이 다릅니다. 정책에 따라 같은 지출의 원화 금액이 달라집니다 |
| Free-Rider Problem (1/N의 무임승차 유인) · Unscrupulous Diner's Dilemma | 똑같이 나누면 비싼 메뉴를 고른 사람의 비용이 모두에게 퍼집니다. 그래서 먹은 만큼 나눕니다 |
| Multilateral Netting (다자간 상계·청산) | 사람별 낸 돈과 몫의 차액만 남기고, 가장 많이 보낼 사람이 가장 많이 받을 사람에게 보내도록 묶어 송금 횟수를 줄입니다 |
| Third-Party Mediation (제3자 중재) | 이해관계가 없는 중재자가 양쪽 근거로 판단합니다. 위치 기록은 원본이 아니라 요약만 공유합니다 |

## 구조

팀원이 맞춰 개발할 계약(데이터 타입, Store, 확장 지점, API)은 [ARCHITECTURE.md](ARCHITECTURE.md)에 있어요.

```
브라우저 (GitHub Pages: public/)
   │  POST /api/allocate  영수증 줄 배분 (기억 기반)
   │  POST /api/mediate   이의 중재
   ▼
API 서버 (Cloud Run: server.mjs)  ── GEMINI_API_KEY·PAYOUT_ENC_KEY는 Secret Manager에서만 주입
   │  구조화 출력(responseSchema)
   ▼
Gemini API
```

LLM은 "줄마다 누구 몫인가"만 추정합니다. 반면 환율 적용, 나누기, 끝전 처리, 송금 경로는 모두 `public/core.js`의 코드가 정합니다. 게다가 서버는 모델 출력을 영수증 줄 단위로 검증합니다. 예를 들어 이미 떠난 사람이 떠난 뒤의 주문에 배정되면 규칙 배분으로 대신합니다.

| 파일 | 역할 |
| --- | --- |
| `public/data.js` | 시나리오: 사람, 지출 7건, 환율, 비서의 기억과 규칙, 이의 제기 |
| `public/core.js` | 환율 정책, 사람별 몫, 차액, 송금 경로, Gemini가 없을 때의 규칙 배분 |
| `public/app.js` | 화면 상태: 수집 → 배분 → 확인 → 청구 → 이의 → 중재 → 승인 |
| `public/motion.js` | 스프링(damping ratio + response), 속도 추적, 관성 투사, 러버밴드 |
| `public/api.js` | API 주소. github.io에서는 Cloud Run, 로컬에서는 같은 서버 |
| `server.mjs` | 정적 파일 + `/api/config`, `/api/allocate`, `/api/mediate`. CORS와 IP당 호출 제한 포함 |
| `test/sanity.mjs` | 몫의 합 = 결제액, 차액의 합 = 0, 송금 뒤 잔액 0, 규칙 배분이 시나리오대로인지 |

### 디자인

Apple의 인터페이스 원칙을 웹으로 옮겼습니다.
- **재질:** 반투명 내비게이션, 인셋 그룹 목록, 시스템 글꼴, 라이트·다크 모드.
- **움직임:** 시트와 분할 컨트롤, 밀어서 보내기는 CSS 전환이 아니라 스프링으로 움직입니다. 그래서 중간에 붙잡아 되돌릴 수 있고, 놓을 때의 손 속도를 이어받습니다. 시트는 손잡이를 끌어 내리면 관성 투사로 닫힐지를 정하고, 경계 밖으로는 러버밴드처럼 버팁니다.
- **접근성 설정:** `prefers-reduced-motion`에서는 스프링 대신 페이드로 바꿉니다. `prefers-reduced-transparency`와 `prefers-contrast`도 따릅니다.

## 로컬 실행

Node 22.9 이상이 필요합니다. Firebase Admin SDK 의존성을 먼저 설치합니다.

```bash
npm ci --ignore-scripts
# .env.example을 .env로 복사하여 Firebase 설정을 채웁니다.
# Gemini를 쓴다면 .env에 GEMINI_API_KEY도 추가합니다.
npm start          # http://localhost:4500
npm test           # 계산 sanity check
```

- 키가 없거나 서버에 닿지 않으면 **규칙 모드**로 동작합니다. 이때 화면 상단에도 그렇게 표시합니다.
- 모델은 `GEMINI_MODEL`로 고를 수 있습니다. 생략하면 이 키로 쓸 수 있는 최신 Flash 모델을 자동으로 고릅니다.
- 받을 계좌와 이의에 붙인 위치 요약은 저장소에 넣을 때 잠급니다(#7, #8, #10). 열쇠는 `PAYOUT_ENC_KEY`(base64, 32바이트)입니다. 로컬에서는 없어도 개발용 열쇠로 잠그고 경고만 띄웁니다. 직접 정하려면 `.env`에 추가합니다(bash·Git Bash 기준. 앞의 줄바꿈은 `.env` 마지막 줄에 붙지 않게 하려는 것).
  ```bash
  printf '\nPAYOUT_ENC_KEY=%s\n' "$(node -e "process.stdout.write(require('crypto').randomBytes(32).toString('base64'))")" >> .env
  ```

### 실제 방 화면

```bash
DEV_SEED=1 npm start   # http://localhost:4500/room.html → '데모 방 만들기' → 보는 사람 고르기
```

- 지출 남기기 → 줄마다 나누기 → 청구서 보내기 → 이의·중재 → 송금 → 보냈어요·받았어요까지 한 방에서 이어집니다. 사람을 바꿔 가며(나·철수·영희·민수) 각자의 할 일을 확인합니다.
- 중재안이 나오면 이의의 당사자는 동의하거나 거부할 수 있습니다. 둘 다 동의하면 지출을 중재안대로 다시 나누고 청구서를 다시 보내고, 한쪽이라도 거부하면 이의가 끝나고 지금 배분 그대로 송금으로 넘어갑니다. 지출을 고치거나 지우면 그 지출의 열린 이의도 함께 닫힙니다. 진행 중인 이의와 끝난 이의는 방 화면의 '이의' 목록에서 다시 열 수 있습니다.
- 보낼 때가 된 송금은 서버가 30초마다 확인해 알립니다. 배포에서는 Cloud Scheduler가 `x-cron-secret: $CRON_SECRET`을 붙여 `POST /api/cron/tick`을 부릅니다.
- 휴대폰에서는 밀어서 보내기를 놓는 순간 토스 송금 화면(`supertoss://send?…`)을 엽니다. 앱이 없으면 1.5초 뒤 계좌번호를 복사했다고 안내합니다. 컴퓨터(마우스로 가리키는 기기)에서는 토스가 열리지 않으니 슬라이더 대신 QR만 보여 주고, 그 QR을 휴대폰으로 찍어 넘깁니다. 토스 링크가 없는 은행이면 컴퓨터에서도 계좌 복사 슬라이더를 남깁니다. 링크의 경로·파라미터는 실기기에서 확인했습니다(#8).

## 배포와 키 관리

- **화면:** `main`에 push하면 `.github/workflows/pages.yml`이 `public/`을 GitHub Pages에 올립니다. 올리기 전에 `scripts/stamp-version.mjs`가 화면 파일 주소에 커밋 버전(`?v=`)을 붙입니다. Pages는 파일을 10분 캐시해서, 버전이 없으면 배포 직후 새 파일과 캐시에 남은 옛 파일이 섞여 화면이 빌 수 있기 때문입니다.
- **API 서버:** Cloud Run에 배포합니다. 키는 Secret Manager에 두고 환경변수로만 주입합니다.

지금은 **데모용 배포**입니다. 저장소가 메모리(`MemoryStore`)라서 인스턴스를 최대 1대로 묶어야 방이 여러 서버에 흩어지지 않습니다. 따라서 가상의 데모 데이터만 넣습니다. 운영 모드에서는 개발용 신원과 시드 API를 막고, 실제 방은 Firebase 설정과 검증된 로그인 토큰이 있어야 접근할 수 있습니다. Firebase 환경변수·서비스 계정은 [설정 안내](docs/auth-location-setup.md)에 따라 연결합니다. #3 Firestore 전에는 영구 데이터 저장을 보장하지 않습니다.

```bash
gcloud run deploy agent-settlement --source . --region asia-northeast1 \
  --allow-unauthenticated --min-instances 0 --max-instances 1 --memory 1Gi \
  --set-secrets GEMINI_API_KEY=gemini-api-key:latest,PAYOUT_ENC_KEY=payout-enc-key:1 \
  --set-env-vars NODE_ENV=production,CRON_SECRET=<임의의 긴 문자열>
```

- 계좌·위치 요약 암호화 열쇠(`PAYOUT_ENC_KEY`)는 **위 배포 명령을 처음 실행하기 전에** 한 번만 Secret Manager에 만들고, Cloud Run 서비스 계정이 읽을 수 있게 합니다(bash·Git Bash 기준). 배포(`NODE_ENV=production`, `Dockerfile`이 넣어 줌)에서 이 열쇠가 없으면 서버가 시작하지 않고 이전 버전이 계속 동작합니다. **열쇠를 잃거나 바꾸면 이미 저장된 계좌와 위치 요약을 풀 수 없으니**(#3 Firestore 이후 특히) 한 번 만든 열쇠는 그대로 둡니다. 그래서 배포 명령은 `latest` 대신 버전 `1`로 고정합니다.
  ```bash
  # 0) 서비스 계정 확인: 비어 있거나 …-compute@developer.gserviceaccount.com이면 2)를 그대로, 다른 계정이면 2)의 --member를 그 계정으로 바꾼다
  gcloud run services describe agent-settlement --region asia-northeast1 --format='value(spec.template.spec.serviceAccountName)'
  # 1) 열쇠를 만들어 Secret Manager에 넣기(버전 1이 된다)
  node -e "process.stdout.write(require('crypto').randomBytes(32).toString('base64'))" \
    | gcloud secrets create payout-enc-key --data-file=-
  # 2) Cloud Run이 열쇠를 읽을 수 있게 권한 주기
  gcloud secrets add-iam-policy-binding payout-enc-key \
    --member=serviceAccount:1081397156656-compute@developer.gserviceaccount.com \
    --role=roles/secretmanager.secretAccessor
  ```
- 리전은 도쿄(`asia-northeast1`)입니다. Cloud Run 가격표에서 Tier 1이라 서울(`asia-northeast3`, Tier 2)보다 CPU·메모리 단가가 낮습니다. 화면이 부르는 서버 주소는 `public/api.js`에 있습니다.
- 때가 된 송금 알림은 Cloud Scheduler 작업 `agent-settlement-tick`이 1분마다 `POST /api/cron/tick`을 `x-cron-secret` 헤더와 함께 부릅니다. Cloud Run은 요청이 없을 때 CPU를 거의 주지 않아 서버 안의 30초 타이머만으로는 부족하기 때문입니다.
- 상시 인스턴스(`--min-instances 1`)는 두지 않습니다. 대신 1분마다 오는 스케줄러 요청이 인스턴스를 깨워 두어 메모리의 방이 대부분 유지되고, 요청 기반 과금이라 Cloud Run 무료 한도 안에 들어갑니다. 다만 Cloud Run이 인스턴스를 교체하면 방이 사라질 수 있으니, 시연 직전에는 데모 방을 새로 만듭니다.
- `.env`와 작업 기록(`.superpowers/`)은 `.gitignore`·`.gcloudignore`·`.dockerignore`에서 모두 제외되어 저장소와 이미지에 들어가지 않습니다.
- 서버는 `https://orca-svg.github.io`에서 온 요청만 브라우저에 허용(CORS)합니다. 또 Gemini 호출은 IP당 10분에 30회로 제한하고, 요청 본문은 비서의 기억(사람당 5개, 60자)만 받습니다.

## 3분 데모 스크립트

| 시간 | 방문자가 하는 일 | 보여줄 포인트 |
| --- | --- | --- |
| 0:00 | 지출 7건을 훑어본다 | 정산을 올리지 않았는데도 비서가 카드 알림·영수증에서 모아 둠 |
| 0:20 | **비서에게 나누기 맡기기** | 오른쪽 채널에 비서끼리 주고받는 기록이 쌓임. 영희는 술값에서, 민수는 사시미에서 빠짐 |
| 0:50 | '오차즈케' 확인 | 근거가 없는 줄은 비서가 짐작하지 않고 사람에게 물음 |
| 1:10 | 환율 정책을 바꿔 본다 | 정책에 따라 사람별 금액이 달라짐. 그래서 여행 전에 합의해 둠 |
| 1:30 | **비서들에게 청구서 보내기** | 철수는 자동 수락 후 월급날 예약, 민수의 비서는 이의 제기 |
| 2:00 | **중재 비서에게 맡기기** → 동의 | 주문 시각 기준으로 다시 나눈 중재안. 민수 몫이 줄어듦 |
| 2:30 | **민수의 화면 보기** → 밀어서 보내기 | 한도를 넘은 사람만 직접 승인. "아무도 단톡방에서 돈 얘기를 꺼내지 않았어요" |

## 한계

- 비서끼리의 통신은 한 브라우저 안에서 흉내 낸 것입니다. 실제 계정, 기기 간 메시지, 카드사·은행 연동은 없습니다.
- 송금은 모의 송금입니다. 실제 서비스라면 송금 앱 딥링크나 오픈뱅킹 같은 별도 연동과 인증이 필요합니다.
- Gemini 호출 한 번에 4~11초 걸립니다. 따라서 현장 데모에서는 응답 캐시나 규칙 모드 대비가 필요합니다.
