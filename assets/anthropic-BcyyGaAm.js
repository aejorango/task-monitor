import{_ as e,g as t}from"./useKnowledgeStatus-DiJD5wDa.js";async function n({system:e,user:n,maxTokens:r=2048,web:i=!1,meta:a={},ground:o=null}){let s=await t(e,n,{maxTokens:r,web:i,meta:a,ground:o});return s.degraded&&console.warn(`[ai] degraded (${s.provider}): ${s.reason}`),s.text}async function r({system:e,user:n,maxTokens:r=2048,web:i=!1,meta:a={},ground:o=null}){let s=await t(e,n,{maxTokens:r,web:i,meta:a,ground:o});return s.degraded&&console.warn(`[ai] degraded (${s.provider}): ${s.reason}`),s}async function i({system:t,user:n,maxTokens:r=2048,web:i=!1,meta:a={},ground:o=null}){let s=await e(t,n,{maxTokens:r,web:i,meta:a,ground:o});return s.degraded&&console.warn(`[ai] degraded (${s.provider}): ${s.reason}`),s.data}async function a({system:t,user:n,maxTokens:r=2048,web:i=!1,meta:a={},ground:o=null}){let s=await e(t,n,{maxTokens:r,web:i,meta:a,ground:o});return s.degraded&&console.warn(`[ai] degraded (${s.provider}): ${s.reason}`),s}async function o({projectName:e,projectDescription:t,phaseNames:n,count:r=8}){let a=n?.length?`\n\nThe project has these phases: ${n.join(`, `)}. Distribute tasks across phases as appropriate.`:``,o=await i({system:`You are a project-management assistant. You break a project down into concrete, actionable tasks.
Respond ONLY with a JSON array of task objects. Each task has these fields:
- title (string, 6-90 chars, imperative tense, specific)
- description (string, 1-3 sentences explaining what to do)
- priority ("low" | "medium" | "high")
- estimatedDays (integer, 1-30, realistic duration in working days)
- phase (string, optional — must match one of the project's phase names if provided)

Do NOT include any prose, markdown, or explanations outside the JSON array. The response must start with [ and end with ].`,user:`Project: ${e}

Description:
${t||`(no description provided)`}
${a}

Generate ${r} tasks that, together, would deliver this project. Order them logically (earliest/foundational first).`,maxTokens:2048,meta:{kind:`task-drafts`}});if(!Array.isArray(o))throw Error(`Model did not return a JSON array.`);return o.map((e,t)=>({id:`draft-${t}`,title:String(e.title||``).slice(0,200).trim()||`Task ${t+1}`,description:String(e.description||``).slice(0,500).trim(),priority:[`low`,`medium`,`high`].includes(String(e.priority).toLowerCase())?String(e.priority).toLowerCase():`medium`,estimatedDays:Math.max(1,Math.min(30,Math.round(Number(e.estimatedDays)||3))),phase:e.phase?String(e.phase).trim():``}))}async function s({task:e,projectName:t,count:n=6}){let r=await i({system:`You are a project-management assistant. You decompose a task into 4-10 concrete subtasks (checklist items).
Respond ONLY with a JSON array of strings. Each string is one subtask, 4-80 characters, written in imperative voice (verb-first).
No markdown, no commentary, no numbering. The response must start with [ and end with ].`,user:`Project: ${t||`(none)`}
Task title: ${e.title}
Task description: ${e.description||`(none)`}
Priority: ${e.priority||`medium`}
${e.requestedBy?`Requested by: ${e.requestedBy}`:``}
${e.tags?.length?`Tags: ${e.tags.join(`, `)}`:``}

Suggest ${n} subtasks that, completed in order, would deliver this task.`,maxTokens:800,meta:{kind:`subtasks`}});if(!Array.isArray(r))throw Error(`Model did not return an array.`);return r.map((e,t)=>({id:`${Date.now()}-${t}`,text:String(e).slice(0,200).trim(),done:!1})).filter(e=>e.text)}async function c(e){return(await u(e)).text}function l({task:e,projectName:t,projectDescription:n,subtasks:r=[]}){let i=r.length?`\nKnown subtasks (the steps to deliver this):\n${r.map((e,t)=>`${t+1}. ${e.text}${e.done?` (done)`:``}`).join(`
`)}`:``;return{system:`You write prompts for someone else to give to Claude. Your job is to produce a single, well-structured prompt that, when pasted into Claude, will produce the actual deliverable described.

Output ONLY the prompt itself (no preamble like "Here is the prompt:" and no markdown code fences). The prompt should:
- Start with a one-sentence role assignment for Claude ("You are…")
- State the deliverable clearly with concrete output requirements (format, length, sections)
- Include all the context Claude needs from the task metadata
- End with a brief checklist Claude can use to self-verify

Keep the prompt under 400 words. Use plain text with light Markdown headings (## only). Do not include any wrapper or commentary outside the prompt.`,user:`I need a prompt that I can paste into Claude to get the deliverable for this task.

Task: ${e.title}
${e.description?`Description: ${e.description}`:``}
Project: ${t||`(no project)`}
${n?`Project context: ${n}`:``}
${e.requestedBy?`Requested by: ${e.requestedBy}`:``}
${e.tags?.length?`Tags: ${e.tags.join(`, `)}`:``}
${e.plan?.endDate?`Due: ${e.plan.endDate}`:``}
${i}

Now write the prompt I'll paste into Claude. The prompt should make it unambiguous what deliverable Claude must produce.`}}async function u(e){let{task:t,projectName:n,projectDescription:i,subtasks:a=[],ground:o=null}=e,{system:s,user:c}=l({task:t,projectName:n,projectDescription:i,subtasks:a}),u=await r({system:s,user:c,maxTokens:1024,ground:o,meta:{kind:`claude-prompt`,taskId:t.id,projectId:t.projectId}});return{text:u.text.trim(),grounding:u.grounding||null,degraded:!!u.degraded,reason:u.reason||null}}async function d({activities:e,tasks:t,projects:r}){let i={};r.forEach(e=>{i[e.id]=e.name});let a=e.map(e=>{let t=i[e.projectId]||e.taskCategory||`—`;return`- ${e.date} · ${t} · ${e.taskTitle||``}${e.comment?`: ${e.comment.slice(0,120)}`:``}${e.hoursSpent?` (${e.hoursSpent}h)`:``}${e.bottleneckRemarks?` [⚠ ${e.bottleneckRemarks.slice(0,60)}]`:``}`});return(await n({system:`You write concise, accurate weekly summaries for a single operator. You are NOT a hype-machine — you describe what happened and what the next focus should be.

Respond in Markdown with these sections in this order:
## Highlights
3-6 bullets — the most consequential things that moved.
## Hours by project
A short bullet list (project: total hours).
## Blockers & risks
Pull from bottleneck remarks. If none, say "None recorded."
## Next focus
2-4 bullets — what deserves attention next week, with reasoning.

Stay under 350 words. No emojis. No celebratory framing.`,user:`Activities this period (${e.length} entries):\n${a.join(`
`)}\n\nWrite the summary.`,maxTokens:1200,meta:{kind:`weekly-summary`}})).trim()}async function f({tasks:e,projects:t,today:r}){let i={};return t.forEach(e=>{i[e.id]=e}),(await n({system:`You help an operator prioritize. Given a list of open tasks, recommend what to tackle TODAY in order. Consider: due dates, priority, dependencies (a task blocked by an incomplete dep should rank lower), and whether it unblocks others.

Respond in Markdown. Top of response: a "Today's focus" header listing 3 specific tasks in order with one-line rationale each. Below: "Stretch" with 1-2 secondary picks. Below: "Skip for now" with 1-2 picks and why. Be specific — quote the task title.

Under 200 words total. No emojis.`,user:`Today is ${r}.\nOpen tasks:\n${e.filter(e=>e.status!==`done`).slice(0,40).map(e=>{let t=i[e.projectId];return`- ${e.title} [${e.status}/${e.priority||`medium`}] ${t?`· ${t.name}`:``} ${e.plan?.endDate?`· due ${e.plan.endDate}`:``}${e.dependsOn?.length?` · blocked by ${e.dependsOn.length}`:``}`}).join(`
`)}\n\nWhat should I tackle today?`,maxTokens:800,meta:{kind:`next-task`}})).trim()}async function p({activities:e,audience:t=`a teammate`}){let r=e.map(e=>`- ${e.date} · ${e.taskTitle||``}${e.comment?`: ${e.comment}`:``}`);return(await n({system:`You draft brief, factual status updates. The audience is ${t}.

Output Markdown with three sections:
## Progress
3-5 bullets, plain factual past-tense.
## Open items
What's in flight or awaiting input.
## Asks
Anything the recipient needs to act on. If none, say "Nothing right now."

Under 250 words. Plain professional voice. No emojis. No celebratory framing.`,user:`Activities to summarize:\n${r.join(`
`)}\n\nWrite the status update.`,maxTokens:800,meta:{kind:`status-update`}})).trim()}export{u as a,f as c,c as i,d as l,a as n,s as o,p as r,o as s,i as t};