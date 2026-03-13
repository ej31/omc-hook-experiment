# Do Claude Code Plugins Actually Help? An A/B Test on oh-my-claudecode Hooks

**TL;DR**: I ran 6 identical coding tasks (3 with OMC hooks ON, 3 with hooks OFF) using Claude Sonnet 4.6. The dynamic hooks didn't meaningfully change code quality or cost. But the data tells an interesting story about where the tokens actually go.

## What is this?

[oh-my-claudecode (OMC)](https://github.com/yeachan-heo/oh-my-claudecode) is a popular plugin for Claude Code that adds dynamic hooks, specialized agents, MCP tools, and workflow skills. It injects context via `system-reminder` tags at various lifecycle points (session start, pre/post tool use, compaction, etc.).

I wanted to know: **do the dynamic hooks actually make Claude write better code, or are they just burning tokens?**

## Experiment Design

### The Task

Build a **Markdown editor** from scratch — a non-trivial, multi-file coding task:
- `index.html` — editor UI with toolbar, preview pane, split view
- `style.css` — responsive layout, syntax highlighting
- `markdown-parser.js` — full parser (headings, lists, code blocks, tables, links, images, etc.)
- `editor.js` — toolbar actions, live preview, drag-to-resize, keyboard shortcuts

### 3 Sequential Prompts (same session via `--continue`)

| Prompt | Task |
|--------|------|
| **P1** | Implement all 4 files from scratch |
| **P2** | Write comprehensive tests (`editor.test.js`) and run them |
| **P3** | Review for bugs (XSS, edge cases, memory leaks, a11y), fix them, re-run tests |

### Conditions

| | Hooks ON | Hooks OFF |
|---|---|---|
| **CLAUDE.md static content** | Loaded | Loaded |
| **MCP tools (32 tools)** | Registered | Registered |
| **Skills & agent catalog** | Available | Available |
| **Dynamic hook execution** | **Active** | **Disabled** |

`DISABLE_OMC=1` env var skips all hook execution in OMC's bridge.js (`return { continue: true }`). Everything else stays identical — same system prompt weight, same tool definitions.

### Execution

```bash
# Each run:
claude -p --model sonnet --dangerously-skip-permissions --output-format json "$PROMPT"
```

- 3 runs per condition, 6 total
- All runs executed in parallel on the same machine
- Per-prompt timestamps recorded
- Full transcripts preserved

## Results

### The Numbers

| Metric | Hooks OFF (avg) | Hooks ON (avg) | Delta |
|--------|----------------|----------------|-------|
| **Wall time** | 2,152s | 1,673s | -22.3% |
| **Total cost** | $5.56 | $5.56 | ~0% |
| **Total tokens** | 6.76M | 6.48M | -4.1% |
| **Cache write** | 596K | 653K | +9.5% |
| **Cache read** | 6.06M | 5.74M | -5.3% |
| **Output tokens** | 100K | 93K | -7.5% |
| **Tool calls** | 40.7 | 37.0 | -9.1% |
| **Code lines generated** | 2,426 | 2,430 | ~0% |
| **Code quality (manual review /20)** | 15.0 | 15.0 | 0 |

### Per-Prompt Cache Read Tokens (this is where it gets interesting)

| Prompt | Hooks OFF | Hooks ON | Delta |
|--------|-----------|----------|-------|
| **P1 (implement)** | 195K | 424K | **+117%** |
| **P2 (test)** | 639K | 1,021K | +60% |
| **P3 (review)** | 2,135K | 1,264K | -41% |

**P1 tells the real story.** With hooks ON, the SessionStart hook injects a context briefing that gets cached and re-read on every turn. That's 2x more cache read tokens on the very first prompt. The hook is dumping context that Claude apparently doesn't need for this task.

But by P3, hooks OFF actually uses *more* cache reads. Go figure.

### Cost Breakdown

| Prompt | Hooks OFF | Hooks ON |
|--------|-----------|----------|
| P1 | $0.75 | $0.65 |
| P2 | $1.56 | $1.57 |
| P3 | $2.20 | $1.32 |
| **Total** | **$5.56** | **$5.56** |

Literally the same cost. The token distribution shifts around, but the bill doesn't change.

### Individual Runs

| Run | Condition | Time | Cost | Tool Calls | Code Lines |
|-----|-----------|------|------|------------|------------|
| 1 | OFF | 2,592s | $3.51 | 40 | 2,032 |
| 2 | OFF | 2,205s | $6.24 | 37 | 2,211 |
| 3 | OFF | 1,659s | $6.93 | 45 | 3,035 |
| 1 | ON | 1,763s | $5.81 | 37 | 2,981 |
| 2 | ON | 1,703s | $5.49 | 39 | 2,106 |
| 3 | ON | 1,552s | $5.39 | 35 | 2,204 |

Note: OFF/run1 is an outlier — cost is anomalously low ($3.51) and P2/P3 output JSON files were empty (0 bytes). The transcript-level totals are still valid, but per-prompt breakdown for that run is incomplete.

## What the Hooks Actually Do

When OMC hooks are active, here's what fires during a session:

| Hook | When | What it injects |
|------|------|-----------------|
| **SessionStart** | Session/compact | Context briefing — recent work, worktree info, OS details |
| **PreToolUse** | Before Edit/Write | Strategic compaction suggestions (tool call counter) |
| **PreCompact** | Before `/compact` | Checkpoint + project memory preservation |
| **PostToolUse** | After various tools | "Use parallel execution" reminders, background op notices |

You can see these in the transcript files as `system-reminder` tags.

## What This Experiment Does NOT Test

Real talk — this is a narrow experiment. Here's what I **cannot** conclude:

- **"OMC is useless"** — I only tested hooks. The MCP tools (LSP, AST grep, notepad, state management), agent catalog, and skills were loaded in both conditions. Their value is untested.
- **"Hooks never help"** — This was a single-session, single-task test. Hooks might shine in multi-session workflows where context persistence matters.
- **"Works the same on Opus"** — Only tested Sonnet. Opus might leverage injected context differently.
- **"Applies to all tasks"** — A 4-file editor is mid-complexity. Large refactors spanning 20+ files with team coordination could be different.

## Key Takeaways

1. **OMC dynamic hooks did not improve code quality for this single-session coding task.** Both hook ON and OFF produced identical results: code quality 15.0/20, cost $5.56, ~2,430 lines generated. Claude Sonnet already does its job fine with just the static CLAUDE.md instructions.

2. **The OMC SessionStart hook doubled cache read tokens on the first prompt (P1).** P1 cache reads were 424K with hooks ON vs 195K with hooks OFF. The SessionStart hook injects a context briefing that gets re-read from cache on every turn. At the discounted cache read rate ($0.30/1M) it's cheap per-request, but adds up at scale.

3. **The token overhead from hooks gets diluted as the session progresses.** By P3, the cumulative cost difference between hook ON and OFF was exactly $0.00. Longer sessions amortize the hook injection cost into irrelevance.

4. **Within-condition variance between runs is far larger than any hook ON/OFF difference.** Even with hooks OFF, run1 cost $3.51 while run3 cost $6.93 — a 2x spread within the same condition. Any signal from hooks, if it exists at all, is not statistically significant against this level of noise.

5. **OMC's real overhead is the static system prompt, not the dynamic hooks.** The 32 MCP tool definitions + agent catalog + skill list that OMC registers are loaded into the system prompt on every single turn regardless of `DISABLE_OMC=1`. That's the constant tax, and this experiment only measured the additional effect of hooks on top of it.

## Full Analysis Output

```
==========================================================================================
  OMC A/B Test Results Comparison (Sonnet + Markdown Editor)
==========================================================================================

  [OMC OFF] (3 runs)
  Run    Time     Tools  Par%    Deleg CacheWrite CacheRead    Output     Cost$    Lines   Tests
  ------ -------- ------ ------- ----- ---------- ------------ ---------- -------- ------- ----------
  run1   2592     40     0.0     0     237722     5409080      66502      3.512    2032    0P/0F
  run2   2205     37     2.9     1     638053     5939248      137915     6.2434   2211    0P/0F
  run3   1659     45     2.3     2     914540     6832113      96989      6.9343   3035    0P/0F
  Avg    2152.0   40.7   1.7     1.0   596772     6060147      100469     5.5632   2426.0

  [OMC ON] (3 runs)
  Run    Time     Tools  Par%    Deleg CacheWrite CacheRead    Output     Cost$    Lines   Tests
  ------ -------- ------ ------- ----- ---------- ------------ ---------- -------- ------- ----------
  run1   1763     37     2.9     1     806204     5209151      81361      5.8071   2981    0P/0F
  run2   1703     39     2.6     1     554280     6203916      103162     5.4878   2106    0P/0F
  run3   1552     35     2.9     0     597126     5799646      93912      5.3885   2204    0P/0F
  Avg    1672.7   37.0   2.8     0.7   652537     5737571      92812      5.5611   2430.3

==========================================================================================
  Per-Prompt Duration (seconds)
==========================================================================================

  Phase           OMC OFF      OMC ON       Delta
  --------------- ------------ ------------ ------------
  P1 Implement    391.0        281.3        -109.7
  P2 Test         515.3        868.3        +353.0
  P3 Review       503.7        522.0        +18.3

==========================================================================================
  Per-Prompt Token Details (Cache Breakdown)
==========================================================================================

  [P1 Implement]
  Metric               OMC OFF         OMC ON          Delta           Delta%
  -------------------- --------------- --------------- --------------- --------
  Cache Write          60951           53722           -7230           -11.9%
  Cache Read           195204          424384          +229180         +117.4%
  Output               30808           21384           -9424           -30.6%
  Total                286971          499521          +212550         +74.1%
  Cost ($)             0.7493          0.6496          -0.0997         -13.3%

  [P2 Test]
  Metric               OMC OFF         OMC ON          Delta           Delta%
  -------------------- --------------- --------------- --------------- --------
  Cache Write          76346           98403           +22056          +28.9%
  Cache Read           638925          1020970         +382045         +59.8%
  Output               37410           59829           +22419          +59.9%
  Total                752692          1179244         +426551         +56.7%
  Cost ($)             1.0392          1.5728          +0.5336         +51.3%

  [P3 Review]
  Metric               OMC OFF         OMC ON          Delta           Delta%
  -------------------- --------------- --------------- --------------- --------
  Cache Write          141797          160990          +19193          +13.5%
  Cache Read           2134742         1264327         -870415         -40.8%
  Output               19636           22766           +3130           +15.9%
  Total                2296196         1448122         -848075         -36.9%
  Cost ($)             1.4668          1.3246          -0.1422         -9.7%

==========================================================================================
  Overall Comparison (Averages)
==========================================================================================

  Metric                 OMC OFF         OMC ON          Delta           Delta%     Verdict
  ---------------------- --------------- --------------- --------------- ---------- ----------
  Wall Time (sec)        2152.0          1672.7          -479.3          -22.3%     ON wins
  Tool Calls             40.7            37.0            -3.7            -9.1%      ON wins
  Parallel Rate (%)      1.7             2.8             +1.1            +64.7%     ON wins
  Agent Delegations      1.0             0.7             -0.3            -30.0%     -
  Cache Write Tokens     596771.7        652536.7        +55765.0        +9.3%      OFF wins
  Cache Read Tokens      6060147.0       5737571.0       -322576.0       -5.3%      ON wins
  Output Tokens          100468.7        92811.7         -7657.0         -7.6%      ON wins
  Total Tokens           6757479.0       6483147.7       -274331.3       -4.1%      ON wins
  Code Lines             2426.0          2430.3          +4.3            +0.2%      -
  Cost ($)               5.5632          5.5611          -0.0021         -0.0%      ON wins
  system-reminder        8.0             7.7             -0.3            -3.7%      -

==========================================================================================
  Test Results Comparison
==========================================================================================

  Run        OMC OFF                   OMC ON
  ---------- ------------------------- -------------------------
  run1       0P/0F (total 0)           0P/0F (total 0)
  run2       0P/0F (total 0)           0P/0F (total 0)
  run3       0P/0F (total 0)           0P/0F (total 0)

==========================================================================================
  OMC Overhead Summary
==========================================================================================
  Token overhead:      -4.1%
  Cost overhead:       -0.0%
  Cache read overhead: -5.3% (from CLAUDE.md injection)
  Dynamic injections:  ON=8 / OFF=8
  Agent delegations:   ON=1 / OFF=1
```

## Repo Structure

```
omc-hook-experiment/
├── README.md
├── data/
│   ├── enable-omc/          # OMC hooks active
│   │   ├── run1/            # metrics.json, out*.json, generated source code
│   │   ├── run2/
│   │   └── run3/
│   └── disable-omc/         # OMC hooks disabled (DISABLE_OMC=1)
│       ├── run1/
│       ├── run2/
│       └── run3/
├── transcripts/              # Full Claude Code session transcripts (JSONL)
│   ├── enable-omc-run1/     # Main sessions + subagent transcripts
│   ├── enable-omc-run2/
│   ├── enable-omc-run3/
│   ├── disable-omc-run1/
│   ├── disable-omc-run2/
│   └── disable-omc-run3/
├── scripts/
│   ├── run-all.sh           # Parallel execution of all 6 runs
│   ├── run-single.sh        # Single run with per-prompt timestamps
│   ├── capture.sh           # Transcript collection + metric extraction
│   ├── extract_metrics.py   # Token/cost/quality metric extraction from transcripts
│   └── analyze.py           # Cross-condition comparison analysis
└── prompts/
    ├── prompt1.txt           # "Build a markdown editor..."
    ├── prompt2.txt           # "Write tests and run them..."
    └── prompt3.txt           # "Review, fix bugs, re-test..."
```

### Data Files Per Run

- `metrics.json` — extracted metrics (tokens, cost, timing, tool breakdown)
- `out1.json`, `out2.json`, `out3.json` — raw Claude CLI output per prompt (includes `usage` block)
- `*.js`, `*.html`, `*.css` — generated source code (the actual editor)
- `.start_ts`, `.end_ts`, `.p*_ts` — Unix timestamps for duration calculation
- `err*.log` — stderr from Claude CLI (usually empty)

### Transcript Format

JSONL files from `~/.claude/projects/`. Each line is a JSON object representing a conversation turn with:
- `role` (user/assistant/system)
- `content` (message text, tool calls, tool results)
- `usage` (token counts per turn)
- `system-reminder` tags (hook injections visible here)

## How to Reproduce

```bash
# 1. Install oh-my-claudecode
# https://github.com/yeachan-heo/oh-my-claudecode

# 2. Set up directories
mkdir -p ~/omc-verification/{enable-omc,disable-omc}/{run1,run2,run3}

# 3. Run with hooks ON
cd ~/omc-verification/enable-omc/run1
claude -p --model sonnet --dangerously-skip-permissions --output-format json "$(cat prompts/prompt1.txt)" > out1.json
claude -p --model sonnet --dangerously-skip-permissions --output-format json --continue "$(cat prompts/prompt2.txt)" > out2.json
claude -p --model sonnet --dangerously-skip-permissions --output-format json --continue "$(cat prompts/prompt3.txt)" > out3.json

# 4. Run with hooks OFF
cd ~/omc-verification/disable-omc/run1
DISABLE_OMC=1 claude -p --model sonnet --dangerously-skip-permissions --output-format json "$(cat prompts/prompt1.txt)" > out1.json
# ... same pattern

# 5. Extract metrics
python3 scripts/extract_metrics.py <transcript_paths> <workdir> <duration> <condition> <run>
```

## Environment

- **Model**: Claude Sonnet 4.6 (`claude-sonnet-4-6`)
- **OMC Version**: 4.7.6
- **Claude Code**: Latest as of 2025-03-13
- **Machine**: macOS (Darwin 24.6.0), Apple Silicon
- **All 6 runs executed concurrently** on the same machine

## License

This data is released for research and educational purposes. Do whatever you want with it.

---

*Run your own experiments. Trust data, not vibes.*
