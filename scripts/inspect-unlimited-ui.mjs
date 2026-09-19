export default async function inspect(page) {
  const origin = 'http://localhost:4310';
  const report = { origin, checkedAt: new Date().toISOString(), setup: [], historical: null, latestRun: null, errors: [], failedRequests: [] };
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); });
  page.on('requestfailed', request => {
    if (!request.failure()?.errorText.includes('ERR_ABORTED')) report.failedRequests.push({ url: request.url(), error: request.failure()?.errorText });
  });
  page.setDefaultTimeout(12000);
  const viewports = [{ width: 1440, height: 1000 }, { width: 390, height: 844 }];
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await page.goto(`${origin}/#new/audit`);
    await page.waitForFunction(() => document.querySelectorAll('.audit-assignment').length === 30);
    const result = await page.evaluate(() => ({
      width: innerWidth, height: innerHeight,
      unlimited: document.querySelector('.audit-setup')?.innerText.includes('Unlimited token budget.'),
      totalBudgetInputCount: document.querySelectorAll('#audit-maxTotalTokens').length,
      agentCount: document.querySelector('#audit-agentCount')?.value,
      includedAssignments: document.querySelectorAll('.audit-assignment[data-included="true"]').length,
      horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
    }));
    report.setup.push(result);
    if (viewport.width === 1440) {
      await page.locator('.audit-inline-note').first().scrollIntoViewIfNeeded();
      await page.screenshot({ path: '.data/acceptance/unlimited-setup.png' });
    }
    if (!result.unlimited || result.totalBudgetInputCount || result.agentCount !== '30' || result.includedAssignments !== 30 || result.horizontalOverflow) throw new Error(`Setup failed: ${JSON.stringify(report)}`);
  }
  console.log('SETUP VERIFIED: desktop 1440x1000 and mobile 390x844; unlimited, no budget input, 30 agents.');
  const listRuns = async () => {
    const response = await page.request.get(`${origin}/api/runs`);
    if (!response.ok()) throw new Error(`Run API HTTP ${response.status()}`);
    return response.json();
  };
  let runs = await listRuns();
  const historical = runs.find(run => run.id.startsWith('99') && Number.isFinite(run.audit?.maxTotalTokens));
  if (historical) {
    await page.setViewportSize(viewports[0]);
    await page.goto(`${origin}/#run/${historical.id}`);
    await page.locator('.audit-metrics').waitFor();
    const text = await page.locator('.audit-metrics').innerText();
    const label = await page.evaluate(cap => `${cap.toLocaleString()} historical budget`, historical.audit.maxTotalTokens);
    report.historical = { id: historical.id, maxTotalTokens: historical.audit.maxTotalTokens, label, passed: text.includes(label) && !text.includes('Unlimited token budget') };
    if (!report.historical.passed) throw new Error(`Historical label failed: ${JSON.stringify(report)}`);
  }
  runs = await listRuns();
  const latest = runs.filter(run => run.scenario === 'full-audit' && run.audit?.maxTotalTokens === null).sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))[0];
  if (latest) {
    report.latestRun = { id: latest.id, status: latest.status, maxTotalTokens: latest.audit.maxTotalTokens, apiAgentCount: latest.audit.agents.length, viewports: [] };
    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      await page.goto(`${origin}/#run/${latest.id}`);
      await page.waitForFunction(() => document.querySelectorAll('.audit-agent-card').length === 30);
      const result = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, unlimited: document.querySelector('.audit-metrics')?.innerText.includes('Unlimited token budget'), cards: document.querySelectorAll('.audit-agent-card').length, horizontalOverflow: document.documentElement.scrollWidth > innerWidth }));
      report.latestRun.viewports.push(result);
      if (viewport.width === 1440) await page.screenshot({ path: '.data/acceptance/latest-run.png' });
      if (!result.unlimited || result.cards !== 30 || result.horizontalOverflow || latest.audit.agents.length !== 30) throw new Error(`Run failed: ${JSON.stringify(report)}`);
    }
  } else {
    report.latestRun = { verified: false, reason: 'No unlimited full-audit run available in the live API at inspection time.' };
  }
  report.passed = report.errors.length === 0 && report.failedRequests.length === 0;
  return report;
}
