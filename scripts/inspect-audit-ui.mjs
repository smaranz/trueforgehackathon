import { tsImport } from 'tsx/esm/api';

// Run with the browser-automation skill runner. This never starts an audit.
// AUDIT_UI_FIXTURE=1 explicitly enables a setup-only catalog response fixture.
export default async function inspectAudit(page) {
  const origin = new URL(page.url()).origin;
  const fixture = process.env.AUDIT_UI_FIXTURE === '1';
  const screenshots = process.env.AUDIT_UI_SCREENSHOTS;
  if (fixture) {
    const { auditAssignments } = await tsImport('../src/server/audit/catalog.ts', import.meta.url);
    await page.route('**/api/audits/catalog', route => route.fulfill({ json: {
      assignments: auditAssignments, model: 'openai/gpt-5-6-sol', targetUrl: 'http://localhost:3000/signup',
      mailbox: { configured: true, address: 'fixture-mailbox@example.test', aliases: true },
    } }));
  }
  await page.goto(`${origin}/#new/audit`);
  await page.locator('.audit-assignment').nth(29).waitFor({ state: 'attached', timeout: 15000 });
  if (fixture) await page.locator('.audit-page').evaluate(root => {
    const label = document.createElement('p');
    label.textContent = 'SETUP-ONLY CATALOG FIXTURE · No agent execution verified';
    label.style.cssText = 'padding:10px 12px;margin-bottom:16px;border:1px dashed #87632a;color:#76501a;font-size:12px;overflow-wrap:anywhere';
    root.prepend(label);
  });
  const source = fixture ? 'setup-only catalog route fixture; real app shell and health; no agent execution verified' : 'actual catalog API; no response fixtures';
  const layoutChecks = [];
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.locator('.audit-assignment summary').first().click();
    const measurement = await page.evaluate(() => ({
      viewport: `${innerWidth}x${innerHeight}`,
      documentWidth: document.documentElement.scrollWidth,
      overflow: document.documentElement.scrollWidth > innerWidth,
      specialists: document.querySelectorAll('.audit-assignment').length,
      included: document.querySelectorAll('.audit-assignment[data-included="true"]').length,
      headings: [...document.querySelectorAll('h1')].map(node => node.textContent),
      numericFields: [...document.querySelectorAll('.audit-limits input')].map(input => ({
        id: input.id, value: input.value, valid: input.validity.valid,
        fits: input.getBoundingClientRect().right <= innerWidth,
      })),
    }));
    layoutChecks.push(measurement);
    if (screenshots) {
      await page.evaluate(() => scrollTo(0, 0));
      await page.screenshot({ path: `${screenshots}/audit-setup-${viewport.width}.png`, fullPage: true });
    }
    if (measurement.overflow || measurement.specialists !== 30 || measurement.included !== 30 || measurement.headings.length !== 1 || measurement.numericFields.some(field => !field.valid || !field.fits)) {
      throw new Error(JSON.stringify({ source, layoutChecks }));
    }
    await page.locator('.audit-assignment summary').first().click();
  }
  await page.locator('#audit-agentCount').fill('2');
  const constrainedConcurrency = await page.locator('#audit-concurrency').inputValue();
  const reducedAssignments = await page.locator('.audit-assignment[data-included="true"]').count();
  if (constrainedConcurrency !== '2' || reducedAssignments !== 2) throw new Error('Agent-count / concurrency controls did not stay consistent.');
  await page.locator('#audit-agentCount').fill('30');
  await page.locator('#audit-concurrency').fill('4');
  const mailboxDisplayed = await page.locator('.audit-mailbox').count() > 0;
  const runChecks = [];
  // Optional release-time inspection: only a saved, actual API run is accepted.
  // This checks rendering, never claims that the audit itself passed.
  const runId = process.env.AUDIT_UI_RUN_ID;
  if (runId) {
    if (fixture) throw new Error('Run inspection requires actual APIs; unset AUDIT_UI_FIXTURE.');
    const response = await page.request.get(`${origin}/api/runs/${encodeURIComponent(runId)}`);
    if (!response.ok()) throw new Error(`Actual run API returned ${response.status()}.`);
    const run = await response.json();
    if (run.scenario !== 'full-audit' || !run.audit) throw new Error('Expected an actual saved full-product audit.');
    await page.goto(`${origin}/#run/${encodeURIComponent(runId)}`);
    await page.locator('.audit-run').waitFor();
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      const measurement = await page.evaluate(() => ({
        viewport: `${innerWidth}x${innerHeight}`,
        documentWidth: document.documentElement.scrollWidth,
        overflow: document.documentElement.scrollWidth > innerWidth,
        agents: document.querySelectorAll('.audit-agent-card').length,
      }));
      runChecks.push(measurement);
      if (screenshots) await page.screenshot({ path: `${screenshots}/audit-run-${viewport.width}.png`, fullPage: true });
      if (measurement.overflow || measurement.agents !== run.audit.agents.length) throw new Error(JSON.stringify({ source: 'actual saved run API', runId, runChecks }));
    }
  }
  return { source, layoutChecks, mailboxDisplayed, countControlsPassed: true, runId: runId || null, runChecks, executionVerified: false };
}
