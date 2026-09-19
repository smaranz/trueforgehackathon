export default async function inspect(page) {
  const origin = 'http://127.0.0.1:4310';
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
  const runs = await (await page.request.get(`${origin}/api/runs`)).json();
  const run = runs.find(run => run.scenario === 'full-audit' && run.findings.length && run.audit.agents.some(agent => agent.coverage.length > 10));
  if (!run) throw new Error('Need a real full audit with findings and long coverage to verify the layout');
  const longest = [...run.audit.agents].sort((a, b) => b.coverage.join('').length - a.coverage.join('').length)[0];
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${origin}/#run/${run.id}`);
  await page.locator('.audit-agent-card').first().waitFor();
  await page.locator('.audit-agent-card').filter({ has: page.getByText(longest.name, { exact: true }) }).click();
  await page.locator('.audit-inspector h3').filter({ hasText: longest.name }).waitFor();
  const measures = [];
  for (const width of [1440, 1920, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    const result = await page.evaluate(() => {
      const layout = document.querySelector('.audit-pool-layout').getBoundingClientRect();
      const main = document.querySelector('.audit-pool-main').getBoundingClientRect();
      const panel = document.querySelector('.audit-inspector');
      const findings = document.querySelector('.audit-findings-section').getBoundingClientRect();
      return { width: innerWidth, layoutHeight: layout.height, mainHeight: main.height, panelHeight: panel.getBoundingClientRect().height, panelContentHeight: panel.scrollHeight, findingsGap: findings.top - layout.bottom, horizontalOverflow: document.documentElement.scrollWidth > innerWidth };
    });
    if (result.panelHeight > 761 || result.horizontalOverflow || result.findingsGap > 60) throw new Error(`Layout failed: ${JSON.stringify(result)}`);
    if (width >= 1024 && Math.abs(result.mainHeight - result.panelHeight) > 2) throw new Error('Desktop agent grid and inspector must align in height');
    measures.push(result);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator('.audit-pool-section').scrollIntoViewIfNeeded();
  await page.screenshot({ path: '.data/acceptance/audit-layout-fixed.png', fullPage: false });
  await page.locator('.audit-inspector').evaluate(panel => { panel.scrollTop = panel.scrollHeight; });
  if (!(await page.locator('.audit-inspector').evaluate(panel => panel.scrollTop > 0))) throw new Error('Long inspector details must remain scrollable');
  await page.locator('.audit-agent-card').nth(1).click();
  await page.locator('.audit-agent-card').first().click();
  await page.waitForFunction(() => document.querySelector('.audit-inspector').scrollTop === 0);

  const card = page.locator('.audit-finding').first();
  const title = await card.locator('h3').innerText();
  const beforeUrl = page.url();
  await card.getByRole('button', { name: 'Copy fix prompt', exact: true }).click();
  await card.getByRole('button', { name: 'Prompt copied', exact: true }).waitFor();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  for (const text of [title.trim(), '## Expected behavior', '## Observed behavior', '## Reproduction steps', '## Evidence', 'Verification status:', run.id]) if (!copied.includes(text)) throw new Error(`Missing from copied prompt: ${text}`);
  if (page.url() !== beforeUrl) throw new Error('Copy button must not navigate to the finding');
  if (await page.locator('a button').count()) throw new Error('Interactive buttons must not be nested in links');
  await card.locator('.finding-card-link').click();
  await page.locator('.finding-detail-actions').getByRole('button', { name: 'Copy fix prompt', exact: true }).click();
  await page.locator('.finding-detail-actions').getByRole('button', { name: 'Prompt copied', exact: true }).waitFor();
  const detail = await page.evaluate(() => navigator.clipboard.readText());
  if (!detail.includes(title.trim())) throw new Error('Detail prompt does not describe the selected finding');
  await page.screenshot({ path: '.data/acceptance/finding-copy-prompt.png', fullPage: false });

  const erroredRun = runs.find(run => run.error && run.scenario === 'full-audit');
  if (erroredRun) {
    await page.goto(`${origin}/#run/${erroredRun.id}`);
    const button = page.locator('.audit-run > .copy-fix-prompt').getByRole('button', { name: 'Copy fix prompt', exact: true });
    await button.click();
    const errorPrompt = await page.evaluate(() => navigator.clipboard.readText());
    if (!errorPrompt.includes('execution error, not automatically a product defect') || !errorPrompt.includes(erroredRun.id)) throw new Error('Error prompt must distinguish execution failure from a verified product bug');
  }
  return { runId: run.id, longCoverageAgent: longest.name, measures, realClipboardCopy: true, copiedFinding: title.trim(), findingDetailCopy: true, copyDoesNotNavigate: true, runErrorCopy: Boolean(erroredRun) };
}
