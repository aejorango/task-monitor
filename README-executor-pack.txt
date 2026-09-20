Task Monitor — executor pack (v0.1, 2026-09-20)

WHAT THIS IS
Everything Claude Code needs to work through your task sheet, row by row, on your own computer.

STEPS
1. Move these files into /Users/aldenrayejorango/Developer/PROJECTS/task-monitor, next to package.json:
   02-audit-2026-09-20.md · audit-and-task-2026-09-20.xlsx · 03-claude-code-prompt-2026-09-20.md · task-status.md
   (No Implementation_plan.md in this pack: your app keeps its own plan file, and this pack never overwrites it.)
2. Open a terminal in that folder:  cd /Users/aldenrayejorango/Developer/PROJECTS/task-monitor
3. Type: claude   and press Enter (install once with: npm install -g @anthropic-ai/claude-code, then sign in).
4. Open 03-claude-code-prompt-2026-09-20.md, copy the block under "The prompt", paste it into Claude Code, press Enter.
5. Answer Yes when it asks to run commands or edit files. After every finished row it appends one YES or BLOCKED line
   (with its own estimated AI cost in USD) to task-status.md (open that file any time to watch progress) and skips
   On-Hold rows. The Excel file is rewritten once, at the end of the run.
6. When it prints the totals: start the app the way you normally do → test it → in Ideon → Tasks press "Sync from Claude Code"
   and pick task-status.md to mark the same rows there → then Ideon → Iterate.

Full guide with troubleshooting: 03-claude-code-prompt-2026-09-20.md (section "How to run this").
