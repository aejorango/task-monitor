var e=`task-monitor.anthropic-api-key.v1`,t=`task-monitor.anthropic-model.v1`;function n(){try{return localStorage.getItem(e)||``}catch{return``}}function r(t){try{t?localStorage.setItem(e,t):localStorage.removeItem(e)}catch{}}function i(){try{return localStorage.getItem(t)||`claude-sonnet-4-5-20250929`}catch{return`claude-sonnet-4-5-20250929`}}function a(e){try{localStorage.setItem(t,e)}catch{}}async function o({system:e,user:t,maxTokens:r=2048}){let a=n();if(!a){let e=Error(`No Anthropic API key set. Add one in Settings → AI.`);throw e.code=`no-api-key`,e}let o=i(),s=await fetch(`https://api.anthropic.com/v1/messages`,{method:`POST`,headers:{"content-type":`application/json`,"x-api-key":a,"anthropic-version":`2023-06-01`,"anthropic-dangerous-direct-browser-access":`true`},body:JSON.stringify({model:o,max_tokens:r,system:e,messages:[{role:`user`,content:t}]})});if(!s.ok){let e=await s.text().catch(()=>``),t=Error(`Anthropic API error ${s.status}: ${e.slice(0,400)}`);throw t.code=`http-${s.status}`,t}return((await s.json()).content||[]).filter(e=>e.type===`text`).map(e=>e.text).join(`
`)}async function s({projectName:e,projectDescription:t,phaseNames:n,count:r=8}){let i=n?.length?`\n\nThe project has these phases: ${n.join(`, `)}. Distribute tasks across phases as appropriate.`:``,a=await o({system:`You are a project-management assistant. You break a project down into concrete, actionable tasks.
Respond ONLY with a JSON array of task objects. Each task has these fields:
- title (string, 6-90 chars, imperative tense, specific)
- description (string, 1-3 sentences explaining what to do)
- priority ("low" | "medium" | "high")
- estimatedDays (integer, 1-30, realistic duration in working days)
- phase (string, optional — must match one of the project's phase names if provided)

Do NOT include any prose, markdown, or explanations outside the JSON array. The response must start with [ and end with ].`,user:`Project: ${e}

Description:
${t||`(no description provided)`}
${i}

Generate ${r} tasks that, together, would deliver this project. Order them logically (earliest/foundational first).`,maxTokens:2048}),s=a.indexOf(`[`),c=a.lastIndexOf(`]`);if(s===-1||c===-1)throw Error(`Could not find JSON array in model response:\n${a.slice(0,400)}`);let l=a.slice(s,c+1),u;try{u=JSON.parse(l)}catch(e){throw Error(`Could not parse JSON: ${e.message}\nResponse:\n${a.slice(0,400)}`)}if(!Array.isArray(u))throw Error(`Model did not return a JSON array.`);return u.map((e,t)=>({id:`draft-${t}`,title:String(e.title||``).slice(0,200).trim()||`Task ${t+1}`,description:String(e.description||``).slice(0,500).trim(),priority:[`low`,`medium`,`high`].includes(String(e.priority).toLowerCase())?String(e.priority).toLowerCase():`medium`,estimatedDays:Math.max(1,Math.min(30,Math.round(Number(e.estimatedDays)||3))),phase:e.phase?String(e.phase).trim():``}))}export{a,r as i,n,i as r,s as t};