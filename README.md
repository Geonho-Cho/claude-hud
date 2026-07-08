# claude-hud

Claude Code 상태줄(statusline)에 붙이는 단일 파일 HUD. 외부 패키지 의존성 0.

```
Fable 5 | repo:my-project branch:main | ctx:[████░░░░░░]42% | 5h:37%(2h10m) wk:12%(4d2h) | session:1h15m | $0.37
```

| 표시 | 의미 |
|---|---|
| `Fable 5` | 현재 모델 |
| `repo: / branch:` | git 저장소·브랜치 (git 폴더가 아니면 자동 생략) |
| `ctx:[바]%` | 컨텍스트 사용률 — 70%↑ 노랑, 80%↑ `COMPRESS?`, 85%↑ 빨강 `CRITICAL` |
| `5h: / wk:` | 구독 요금제의 5시간·주간 사용량 한도 (괄호는 리셋까지 남은 시간) |
| `session:` | 현재 세션 경과 시간 |
| `$` | 이번 세션의 API 환산 비용 추정치 (구독제면 참고용) |

## 설치 — Claude Code에 이 한 줄만 붙여넣으세요

```
https://github.com/Geonho-Cho/claude-hud 저장소의 hud.mjs를 받아서
~/.claude/hud/hud.mjs 로 저장하고, ~/.claude/settings.json 의 statusLine을
"node $HOME/.claude/hud/hud.mjs" 명령으로 설정해줘. 기존 statusLine이 있으면
뭐였는지 알려주고 교체해줘. 설치 후 동작 테스트하고 재시작하라고 알려줘.
```

## 수동 설치

```bash
mkdir -p ~/.claude/hud
curl -o ~/.claude/hud/hud.mjs https://raw.githubusercontent.com/Geonho-Cho/claude-hud/main/hud.mjs
```

`~/.claude/settings.json`에 추가:

```json
"statusLine": { "type": "command", "command": "node $HOME/.claude/hud/hud.mjs" }
```

Claude Code 재시작하면 끝.

## 요구사항·참고

- Claude Code + Node.js 18 이상 (Claude Code 사용자면 대부분 이미 있음)
- `5h:/wk:` 사용량은 **본인의** macOS 키체인에 저장된 Claude Code 로그인 토큰으로 **본인 계정** 사용량을 조회합니다. 계정 정보가 파일에 담겨 있지 않습니다. 60초 캐시라 API는 분당 최대 1회 호출.
- 키체인이 없는 환경(리눅스)은 `~/.claude/.credentials.json` 폴백, 그것도 없으면 `5h:/wk:` 부분만 조용히 생략됩니다.
- 커스터마이즈: 파일 하나가 전부라서, Claude Code에 "hud.mjs에서 $ 표시 빼줘" 같은 식으로 시키면 됩니다.

## 크레딧

표시 형식은 [oh-my-claudecode](https://github.com/Yeachan-Heo/oh-my-claudecode)의 HUD(MIT)에서 영감을 받아 처음부터 다시 작성한 것입니다. MIT License.
