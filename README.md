# 라마 리밋 · Llama Limit

2~5명이 각자 기기에서 하는 폭신폭신 카드·칩 게임. 주사위가 정한 **한계 숫자**를 넘지 않게, 그래도 최대한 가깝게 카드 합을 맞추고, 칩을 걸거나 접으세요. 마지막까지 칩이 남은 라마가 이깁니다.

**▶ 바로 하기 / Play: https://allampaca-max.github.io/llama-limit/**

- 게임 서버가 필요 없습니다. 브라우저끼리 WebRTC(PeerJS)로 직접 연결됩니다.
- 같은 집 와이파이에서도, 서로 다른 곳에서도 **방 코드 4자리**만 있으면 됩니다.
- 방을 열 때 **2~5인**, 한 번 고르는 시간(20/40/60초), 기본 베팅이 오르는 속도(10/5/3라운드마다)를 고릅니다.
- 사람이 모자라면 대기실에서 **빈 자리에 봇**을 넣을 수 있고, **혼자 연습**(봇들과)도 됩니다.
- 끊김 후 자동 재연결, 방장 **이어하기**, 일시정지, 이모지, **지난 게임**(라운드별 칩 흐름 그래프와 승부 기록)을 지원합니다.
- **한국어 / English:** 첫 화면 오른쪽 위에서 바꿉니다(게임 중에는 ⋯ 메뉴). 처음에는 브라우저 언어를 따르고, 사람마다 다른 언어로 해도 됩니다.

## English

A cozy card-and-chip game for 2–5 players, each on their own device. Every round an eight-sided die (5–12) sets the **limit**. You get three cards (35-card deck: 7×1, 6×2, 5×3, 4×4, 3×5, 2×6, 1×7, −1×7), reveal one, bet, then take turns to **hit** (one more face-up card) or **stay**, bet again, and show down: the highest total not over the limit takes the pot, and more cards breaks a tie. Lose all your chips and you're out; the last llama standing wins.

One player taps **Create room** and sends the 4-character code or link; the others tap **Join room**. Empty seats can be filled with bots. No accounts or server needed, and each player can use their own language.

## 하는 법

1. 한 사람이 **방 만들기** → 인원(2~5), 시간, 기본 베팅 속도 → 방 열기.
2. 화면의 4자리 코드나 링크를 다른 사람들에게 보냅니다.
3. 모두 **참가하기**로 들어오면(또는 빈 자리에 봇을 넣으면) 방장이 **게임 시작**.

방장 브라우저가 판정을 맡습니다. 방장이 새로고침하거나 창을 닫았다면 로비의 **이어하기**로 같은 방을 다시 열면 되고, 참가자들은 자동으로 다시 붙습니다. 누군가 끊겨 있는 동안 시계는 멈춥니다. 참가자가 같은 기기로 같은 코드에 다시 들어오면 원래 자리와 손패로 돌아옵니다.

## 규칙 (이 구현 기준)

- 모두 칩 30개. 자리는 무작위, 첫 선은 추첨 볼. 다음 라운드부터는 선의 왼쪽(시계 방향 다음) 사람이 선.
- **기본 베팅**은 1칩에서 시작해 10라운드마다 1칩씩(설정으로 5·3라운드마다) 오릅니다.
- 주사위(5~12)로 **한계 숫자** → 3장씩 뒷면으로 → 각자 1장을 골라 **동시에 공개**.
- **1차 베팅:** 선부터 시계 방향으로 콜(체크)·레이즈·포기. 모두 같은 칩을 내면 끝.
- **히트/스테이:** 선부터 돌아가며 1장(앞면)을 더 받거나 그만. 모두 스테이하거나 카드가 떨어질 때까지.
- **2차 베팅** 뒤 공개. 한계 이하에서 합이 가장 큰 사람이 판돈 전부, 합이 같으면 카드가 많은 사람. 그것도 같거나 모두 넘쳤으면 똑같이 나누고 남는 칩은 선에 가까운 사람부터.
- 칩이 0이 되면 탈락. 먼저 탈락한 사람이 최하위, 같은 라운드에 함께 탈락하면 같은 순위.
- 원래 규칙에 없어서 정한 것:
  - **베팅 상한:** 한 라운드에 한 사람이 내는 칩(기본 베팅 포함)은, 아직 포기하지 않은 사람 중 라운드 시작 때 칩이 가장 적은 사람의 칩 수까지. 그래서 사이드 팟이 없습니다.
  - 기본 베팅이 가장 적은 칩보다 크면 모두 그만큼만 냅니다. 이미 상한이면 그 베팅 차례는 건너뜁니다.
  - 스테이하면 그 라운드에는 더 받을 수 없습니다. 넘쳐도 −1을 노리고 히트할 수 있습니다.
  - 시간 초과: 공개는 아무 카드나, 베팅은 낼 칩이 없으면 체크·있으면 포기, 히트 차례는 스테이.
  - 기권하면 남은 칩은 사라지고 바로 탈락합니다.

## 집에서 바로 하기 (GitHub 없이)

```bash
python3 -m http.server 8792 --bind 0.0.0.0 --directory llama-limit
```

- 맥: `http://localhost:8792`
- 같은 와이파이의 다른 기기: `http://<맥의 IP>:8792`

어느 주소로 열든 방 코드로 연결되므로 GitHub Pages 주소와 로컬 주소를 섞어 써도 됩니다. 연결 중개에 PeerJS 공개 서버를 쓰므로 인터넷 연결은 필요합니다.

## 파일

| 파일 | 내용 |
|---|---|
| `index.html`, `style.css` | 화면 |
| `engine.js` | 규칙 엔진(DOM 없음) |
| `bot.js` | 봇(몬테카를로로 지분을 어림하고, 남은 칩 대비 위험을 따져 베팅) |
| `app.js` | 진행·네트워크(방장 1 + 참가자 최대 4)·그리기 |
| `i18n.js` | 한/영 문구 |
| `assets/` | 로비 그림·인형 아바타·카드 뒷면·펠트(Codex로 생성, 원본 PNG와 프롬프트는 `assets/src/`), 아이콘 |
| `tests/` | 규칙 테스트. 브라우저로 `tests/index.html`을 열거나 아래 명령으로 실행 |

```bash
/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc engine.js bot.js tests/engine.test.js
```

## 알아 둘 점

- 남의 뒷면 카드와 덱 순서는 각자의 화면으로 보내지 않습니다. 다만 판정을 맡은 방장 브라우저는 전부 알고 있으니, 방장이 개발자 도구를 열면 볼 수는 있습니다.
- 원래 속도(10라운드마다)는 조심스럽게 두면 길어질 수 있습니다. 짧게 하려면 5·3라운드마다를 고르세요.
- 회사·학교 망처럼 막힌 네트워크에서는 WebRTC 연결이 안 될 수 있습니다.
