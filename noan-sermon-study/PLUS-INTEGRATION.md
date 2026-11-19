# ChatGPT Plus 포함 사용량 연동 — 등록 승인 전 변경안

이 변경안은 기존 설교연구실의 작성 화면에서 초안 작성, 원고 검토, 검토 반영 수정, 문장 다듬기, 완성본 표시를 제공한다. 현재 운영 브랜치에는 적용하지 않는다. Plus 포함 사용량을 쓰는 공식 웹앱 등록 승인을 확인하기 전에는 AI 기능을 활성화하지 않는다. 버튼·단위 검사만으로 실제 계정 연동을 검증했다고 말하지 않는다.

## 등록 조건

현재 Cloudflare에 게시된 웹앱을 위한 등록이 필요하다. 로컬 프로그램용 `dynamic_agent_client`와 `127.0.0.1` 콜백을 이 공개 웹사이트의 콜백으로 바꾸어 사용하지 않는다. 다른 앱의 client ID·로그인 세션·인증 파일을 재사용하지 않는다.

- 앱: 노안 설교연구실 / Noan Sermon Study
- 원본 주소: https://black-feather-52eb.noan-central-3354fde.workers.dev/
- 등록할 콜백: https://black-feather-52eb.noan-central-3354fde.workers.dev/auth/openai/callback
- 요청 기능: Sign in and ChatGPT plan use for AI requests
- 등록할 클라이언트: 공개 OAuth 클라이언트, PKCE 및 사용자별 포함 사용량 권한. 제공받은 등록 방식이 이 코드와 다르면 활성화 전에 그 계약에 맞게 수정한다.
- 필요한 범위: `openid profile email offline_access resource.invoke chatgpt.tokens.use.direct`
- 개인정보·등록 신청 연락처는 공개 저장소에 넣지 않는다. 신청 초안은 해당 Codex 대화의 outputs 폴더에 별도 보관한다.

신청: https://openai.com/form/sign-in-with-chatgpt-interest/

공식 근거:
- https://developers.openai.com/siwc/quickstart
- https://developers.openai.com/siwc/token-sharing-open-source
- https://developers.openai.com/siwc/website
- https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference
- https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations

## 활성화 전 필수 확인

1. OpenAI가 이 웹앱과 위 콜백에 대해 발급한 client ID, 토큰 교환 방식, 포함 사용량 권한을 확인한다. 등록 승인 없이 `PLUS_HOSTED_APPROVED`를 켜지 않는다. 그 플래그는 승인 절차나 권한을 대체하지 않는다.
2. `PLUS_CLIENT_ID`에 발급받은 ID를 설정한다. `PLUS_STORAGE_KEY`에는 별도로 생성한 AES-256 보관 키를 Cloudflare 서버 비밀값으로 설정한다. 소스·로그·브라우저·공개 저장소에 쓰지 않는다. 서버 비밀값을 새로 생성·저장하는 승인을 먼저 확인한다.
3. 현재 앱 주소를 `PUBLIC_ORIGIN`으로 정확히 설정한다. 임의의 원격 주소나 콜백 입력을 받지 않는다. Cloudflare Durable Object 저장소와 ASSETS 바인딩을 확인한다. 운영 배포는 진행하지 않았다. 별도 미리보기는 `previews` 설정으로 배포하며 세션 저장소는 운영 환경과 격리한다. 미리보기의 승인·포함 사용량 전용 확인 값은 항상 false로 유지한다. 비활성 경로는 세션 객체에 접근하기 전에 중단한다. 실제 OAuth 자격과 원고 생성은 미리보기에 넣지 않는다.
4. 실제 사용자 로그인과 별도 Plus 포함 사용량 권한 승인을 완료한다. ID 토큰의 서명·발급자·수신자·만료·nonce와 발급 범위를 검사한다. 로그인만 된 계정은 생성 요청을 실행하지 않는다.
5. 실제 계정의 모델 목록 조회, 짧은 시험 원고 생성, 취소·사용량 제한·세션 만료, 모바일 화면을 검증한다. 모델 목록은 계정이 돌려준 값만 사용하며 고정된 모델 이용 가능성을 약속하지 않는다.
6. 사용자의 요구는 추가 유료 전환 금지다. API 키 전환·크레딧 구매·재충전·유료 옵션을 구현하지 않는다. OpenAI 공식 도움말에 따르면 개인 계정에서 앱의 주간 사용 한도가 100% 미만이면 해당 앱은 크레딧을 사용할 수 없으며, 별도 크레딧 사용 허용도 기본적으로 꺼져 있다. 활성화 전에 이 앱의 한도를 100% 미만으로 설정하고 크레딧 사용 및 자동 구매가 꺼져 있는지 저장된 값을 확인한다. 기존 다른 앱의 설정을 임의로 변경하지 않는다. https://help.openai.com/en/articles/20001542-using-your-chatgpt-plan-in-other-apps-and-sites
7. 현재 공개 문서에서는 요청별 included-only 매개변수나 계정 과금 정책 조회 방법을 확인하지 못했다. 따라서 `PLUS_INCLUDED_ONLY_VERIFIED`도 기본 false로 두고 GPT 경로 전체를 차단한다. 이 설정은 공급자의 결제 제한을 대신하지 않는다. OpenAI 등록 과정에서 이 앱/계정에 포함 사용량 전용 제한을 강제·확인할 공식 방법을 받고 검증하기 전에는 true로 바꾸지 않는다. 이를 보장할 수 없으면 직접 생성을 활성화하지 않는다. 사용자에게 크레딧 구매를 해결책으로 안내하지 않는다. 새 유료 호스팅이나 서비스도 개설하지 않는다.

## 데이터와 작업 흐름

OpenAI OAuth 자격은 서버에서 암호화하고 브라우저에는 HttpOnly 세션 쿠키만 준다. 갱신 요청은 같은 세션에서 순서대로 처리한다. 로그아웃은 갱신 세션 해제를 시도하고, 확인되지 않으면 그 사실을 알린다. 원고 요청과 응답은 서버 세션 저장소에 보관하지 않는다. Responses 요청은 `store:false`, `stream:true`를 사용하고 필수 완료 이벤트가 오기 전에 기존 원고를 교체하지 않는다.

작성 결과는 사용자가 읽은 뒤 반영한다. 반영 전 원고 열 편까지와 검토 결과는 기존 개인 카드와 함께 이 기기에 보관한다. 요청 중 사용자가 원고를 수정했다면 자동 덮어쓰지 않는다. 완성본 표시는 사용자의 확정 표시이며 성경 해석의 무오류 검증이나 공개 게시가 아니다. 기존 공개 원고 피드·자동 동기화 예약은 수정하지 않는다. 전체 백업에는 선택적인 `plusWork` 필드를 추가하며 과거 백업도 계속 읽는다. 비밀값은 백업에 포함하지 않는다.

## 검증 범위

2026-11-19 배포 점검: Cloudflare의 `npx wrangler preview`가 요구하는 `previews` 블록 누락을 실제 실패 로그에서 확인해 수정했다. 설치된 Wrangler 4.165.0 이상을 사용하고, 미리보기 변수를 운영과 별도로 선언하며 미리보기 세션 바인딩을 분리했다. 수정 후 실제 Cloudflare 미리보기 빌드가 성공했다. 기존 운영 앱과 main은 그대로 보존한다.

`node --test --test-isolation=none tests/feed.test.cjs tests/plus.test.mjs`

기존 피드 검사 9개와 등록 미완료 차단, 암호화, 로그인 검증, CSRF, OAuth 취소, 범위 누락, 포함 사용량 생성 경로, 완료·실패 스트림, 세션 만료·동시성 등 11개 검사를 통과했다. 생성 응답과 로그인은 명시적인 시험 응답이며 실제 OpenAI 계정 승인을 뜻하지 않는다. 실서비스 활성화는 위 절차를 마친 뒤 진행한다.
