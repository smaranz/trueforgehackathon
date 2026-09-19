export default async function inspect(page) {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('http://127.0.0.1:4310/#new/signup');
  const start = page.getByRole('button', { name: 'Start signup check', exact: true });
  await start.waitFor();
  if (await page.locator('#signup-target').inputValue() !== 'http://localhost:3000/signup') throw new Error('Signup profile target is wrong');
  if (await page.getByRole('button', { name: 'Start investigation', exact: true }).count()) throw new Error('Demo form leaked into the signup profile');
  await page.reload();
  await start.waitFor();
  await page.screenshot({ path: '.data/acceptance/probe-signup-start.png', fullPage: true });
  const responsePromise = page.waitForResponse(response => response.url().endsWith('/api/signup/run') && response.request().method() === 'POST');
  await start.click();
  const response = await responsePromise;
  if (response.status() !== 200) throw new Error(`Start signup returned HTTP ${response.status()}: ${await response.text()}`);
  const run = await response.json();
  if (run.status !== 'completed') throw new Error(`Signup check incomplete: ${run.error}`);
  await page.getByRole('heading', { name: 'Signup surface checks', exact: true }).waitFor();
  await page.goto('http://127.0.0.1:4310/#new');
  await page.getByRole('button', { name: 'Publick signup Fresh visitor surface checks', exact: true }).click();
  await start.waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  if (overflow) throw new Error('Signup form overflows mobile');
  await page.screenshot({ path: '.data/acceptance/probe-signup-start-mobile.png', fullPage: true });
  return { directUrl: 'http://127.0.0.1:4310/#new/signup', persistedOnReload: true, newRunSelector: true, runId: run.id, status: run.status, passed: run.checks.filter(check => check.status === 'passed').length, checkCount: run.checks.length, mobileOverflow: overflow };
}
