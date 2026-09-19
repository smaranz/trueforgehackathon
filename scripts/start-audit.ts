import 'dotenv/config';
const pilot = process.argv.includes('--pilot');
const response = await fetch(`http://127.0.0.1:${process.env.PORT || 4310}/api/audits`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ targetUrl: 'http://localhost:3000/signup', agentCount: pilot ? 1 : 30, concurrency: pilot ? 1 : 4, maxStepsPerAgent: 60, deadlineMinutes: pilot ? 15 : 60, goal: 'Create real synthetic accounts and test all reachable product areas with specialist assignments: onboarding, projects, persistence, applications, essays, SAT, settings, accessibility, confusing UI, failures and bounded security checks. Report observed evidence and independently reproduce objective suspected failures.' }) });
const run = await response.json();
if (!response.ok) throw new Error(run.error);
console.log(JSON.stringify({ id: run.id, status: run.status, model: run.audit.model, agents: run.audit.requestedAgents, concurrency: run.audit.concurrency, url: `http://127.0.0.1:4310/#run/${run.id}` }, null, 2));
