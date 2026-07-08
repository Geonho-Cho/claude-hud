#!/usr/bin/env node
/**
 * 자작 HUD — OMC HUD 오마주 (OMC 배지 제외), 하네스 1호 부품.
 *
 * 동작 원리: Claude Code가 statusLine 갱신 때마다 이 스크립트를 실행하고,
 * stdin으로 현재 상태 JSON을 건네준다. 여기서 출력한 한 줄이 상태줄에 표시된다.
 *
 * 표시 형식 (OMC 'focused' 프리셋 모방):
 *   Fable 5 | repo:skillset branch:main | ctx:[███░░░░░░░]34% | 5h:45%(3h42m) wk:12%(2d5h) | session:12m | $0.42
 *
 * 색 규칙 (OMC 기본 임계값): ctx <70% 초록, ≥70% 노랑, ≥80% 노랑+"COMPRESS?", ≥85% 빨강+"CRITICAL"
 *            rate limit(5h/wk)은 ≥70% 노랑, ≥90% 빨강
 * 참고 표본: docs/archive/omc-hud/ (MIT, Yeachan Heo)
 *
 * 5h/wk 사용량 출처: macOS 키체인의 Claude Code 로그인 토큰으로
 * api.anthropic.com/api/oauth/usage 조회 (OMC HUD와 동일 방식), 60초 파일 캐시.
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir, userInfo } from 'node:os';

// ── 색상 (ANSI 코드 — 터미널에 색을 입히는 특수 문자열) ──
const RESET = '\x1b[0m';
const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const DIM = '\x1b[2m';

// ── stdin 읽기 ──
let input = '';
try {
  input = await new Promise((resolve) => {
    let data = '';
    process.stdin.on('data', (c) => (data += c));
    process.stdin.on('end', () => resolve(data));
    setTimeout(() => resolve(data), 500); // stdin이 안 닫혀도 0.5초 후 진행
  });
} catch { /* 입력 없으면 빈 HUD */ }

let s = {};
try { s = JSON.parse(input); } catch { /* 파싱 실패 시 빈 객체로 진행 */ }

const parts = [];

// ── 1. 모델명 (cyan) — display_name 우선, 없으면 id에서 조립 ──
{
  const fromId = (s.model?.id || '')
    .replace(/^claude-/, '')
    .replace(/-\d{8}$/, '')
    .split('-')
    .filter(Boolean)
    .map((w) => (/^\d/.test(w) ? w : w[0].toUpperCase() + w.slice(1)))
    .join(' ')
    .replace(/(\d) (\d)/g, '$1.$2'); // "Haiku 4 5" → "Haiku 4.5"
  const name = s.model?.display_name || fromId;
  if (name) parts.push(`${CYAN}${name}${RESET}`);
}

// ── 2. git repo:branch (cyan) — git 폴더가 아니면 조용히 생략 ──
{
  const dir = s.workspace?.current_dir || s.cwd;
  if (dir) {
    try {
      const opts = { cwd: dir, timeout: 800, stdio: ['ignore', 'pipe', 'ignore'] };
      const top = execSync('git rev-parse --show-toplevel', opts).toString().trim();
      const branch = execSync('git rev-parse --abbrev-ref HEAD', opts).toString().trim();
      const repo = top.split('/').pop();
      parts.push(`repo:${CYAN}${repo}${RESET} branch:${CYAN}${branch}${RESET}`);
    } catch { /* git 아님 */ }
  }
}

// ── 3. ctx 바 + % — Claude Code가 계산해준 used_percentage 사용 ──
{
  const cw = s.context_window;
  let pct = cw?.used_percentage;
  if (typeof pct !== 'number' && cw?.context_window_size > 0) {
    // 폴백: 토큰 수로 직접 계산 (OMC와 같은 방식)
    const u = cw.current_usage;
    const total = (u?.input_tokens ?? 0) + (u?.cache_creation_input_tokens ?? 0) + (u?.cache_read_input_tokens ?? 0);
    pct = (total / cw.context_window_size) * 100;
  }
  if (typeof pct === 'number' && !Number.isNaN(pct)) {
    const p = Math.min(100, Math.max(0, Math.round(pct)));
    const color = p >= 85 ? RED : p >= 70 ? YELLOW : GREEN;
    const suffix = p >= 85 ? ' CRITICAL' : p >= 80 ? ' COMPRESS?' : '';
    const width = 10;
    const filled = Math.round((p / 100) * width);
    const bar = `${color}${'█'.repeat(filled)}${DIM}${'░'.repeat(width - filled)}${RESET}`;
    parts.push(`ctx:[${bar}]${color}${p}%${suffix}${RESET}`);
  }
}

// ── 4. rate limit 사용량 (5h/wk) — 키체인 토큰 → usage API, 60초 캐시 ──
{
  const CACHE_PATH = join(dirname(fileURLToPath(import.meta.url)), '.usage-cache.json');
  const TTL_OK = 60_000, TTL_FAIL = 120_000;

  function readToken() {
    // 1순위: macOS 키체인 (Claude Code가 로그인 토큰을 보관하는 곳)
    for (const account of [userInfo().username, null]) {
      try {
        const cmd = account
          ? `security find-generic-password -s "Claude Code-credentials" -a "${account}" -w`
          : `security find-generic-password -s "Claude Code-credentials" -w`;
        const raw = execSync(cmd, { timeout: 1500, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
        const t = JSON.parse(raw)?.claudeAiOauth?.accessToken;
        if (t) return t;
      } catch { /* 다음 후보 */ }
    }
    // 2순위: 파일 폴백 (리눅스 등)
    try {
      return JSON.parse(readFileSync(join(homedir(), '.claude', '.credentials.json'), 'utf8'))?.claudeAiOauth?.accessToken;
    } catch { return null; }
  }

  function fmtReset(iso) {
    const diff = new Date(iso).getTime() - Date.now();
    if (!iso || Number.isNaN(diff) || diff <= 0) return null;
    const m = Math.floor(diff / 60_000), h = Math.floor(m / 60), d = Math.floor(h / 24);
    return d > 0 ? `${d}d${h % 24}h` : `${h}h${m % 60}m`;
  }

  async function getUsage() {
    try { // 캐시가 신선하면 API 호출 생략
      const c = JSON.parse(readFileSync(CACHE_PATH, 'utf8'));
      if (Date.now() - c.at < (c.ok ? TTL_OK : TTL_FAIL)) return c.data;
    } catch { /* 캐시 없음 */ }
    let data = null;
    const token = readToken();
    if (token) {
      try {
        const res = await fetch('https://api.anthropic.com/api/oauth/usage', {
          headers: { Authorization: `Bearer ${token}`, 'anthropic-beta': 'oauth-2025-04-20' },
          signal: AbortSignal.timeout(1500),
        });
        if (res.ok) data = await res.json();
      } catch { /* 네트워크 실패 → 캐시에 실패 기록 */ }
    }
    try { writeFileSync(CACHE_PATH, JSON.stringify({ at: Date.now(), ok: !!data, data })); } catch { /* 캐시 저장 실패는 무시 */ }
    return data;
  }

  const u = await getUsage();
  if (u) {
    const buckets = [
      ['5h', u.five_hour], ['wk', u.seven_day],
      ['sn', u.seven_day_sonnet], ['op', u.seven_day_opus],
    ];
    const segs = [];
    for (const [label, b] of buckets) {
      if (typeof b?.utilization !== 'number') continue;
      const p = Math.min(100, Math.max(0, Math.round(b.utilization)));
      const color = p >= 90 ? RED : p >= 70 ? YELLOW : GREEN;
      const reset = fmtReset(b.resets_at);
      segs.push(`${label}:${color}${p}%${RESET}${reset ? `${DIM}(${reset})${RESET}` : ''}`);
    }
    if (segs.length) parts.push(segs.join(' '));
  }
}

// ── 5. 세션 경과 시간 ──
{
  const ms = s.cost?.total_duration_ms;
  if (typeof ms === 'number' && ms > 0) {
    const min = Math.floor(ms / 60000);
    const label = min >= 60 ? `${Math.floor(min / 60)}h${min % 60}m` : `${min}m`;
    parts.push(`session:${GREEN}${label}${RESET}`);
  }
}

// ── 6. 세션 비용 ──
{
  const usd = s.cost?.total_cost_usd;
  if (typeof usd === 'number' && usd > 0) {
    parts.push(`${DIM}$${usd.toFixed(2)}${RESET}`);
  }
}

process.stdout.write(parts.join(' | '));
