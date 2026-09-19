export default async function inspect(page, ui) {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('http://127.0.0.1:4310');
  await page.getByRole('button', { name: 'Start investigation' }).waitFor();
  await page.screenshot({ path: '.data/acceptance/ui-new-run.png', fullPage: true });
  const runs = await page.evaluate(async () => (await fetch('/api/runs')).json());
  const run = runs.find(run => run.findings.some(f => f.status === 'Confirmed') && run.verifications.some(v => v.variant === 'corrected' && v.status === 'passed'));
  if (!run) throw new Error('No real confirmed run with before/after evidence to inspect. Run npm run verify:demo first.');
  await page.goto(`http://127.0.0.1:4310/#run/${run.id}`);
  await page.getByRole('heading', { name: 'Two sides of the same action' }).waitFor();
  await page.locator('.actor-snapshot img').first().waitFor();
  await page.waitForFunction(() => [...document.querySelectorAll('.actor-snapshot img')].every(image => image.complete && image.naturalWidth > 0));
  await page.screenshot({ path: '.data/acceptance/ui-run.png', fullPage: false });
  const desktopOverflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  // Long real agent transcripts can exceed the snapshot tool's text limit.
  // Assert on the actual finding element rather than a truncated accessibility dump.
  const findingLink = page.getByRole('link', { name: /Revoked editor can still export/ });
  await findingLink.getByText('Confirmed', { exact: true }).waitFor();
  await findingLink.click();
  await page.getByRole('heading', { name: 'The expectation gap' }).waitFor();
  await page.screenshot({ path: '.data/acceptance/ui-finding.png', fullPage: false });
  if (!await page.getByText('Both results use the same test hash.').isVisible()) await page.getByText('Both results use the same test hash.').scrollIntoViewIfNeeded();
  await page.locator('.verification-section').screenshot({ path: '.data/acceptance/ui-verification.png' });
  await page.reload();
  await page.getByRole('heading', { name: 'The expectation gap' }).waitFor();
  const persisted = await page.getByText('Both results use the same test hash.').count() === 1;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`http://127.0.0.1:4310/#run/${run.id}`);
  await page.getByRole('heading', { name: 'Two sides of the same action' }).waitFor();
  const mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  await page.screenshot({ path: '.data/acceptance/ui-mobile.png', fullPage: false });
  if (desktopOverflow || mobileOverflow) throw new Error('Page overflows viewport');
  const images = await page.locator('.actor-snapshot img').count();
  return { runId: run.id, desktop: '1440x1000', mobile: '390x844', desktopOverflow, mobileOverflow, persistedAfterRefresh: persisted, actualActorSnapshots: images, source: 'Real backend runs and artifacts; no API fixtures' };
}
