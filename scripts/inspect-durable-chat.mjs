export default async function inspect(page) {
  await page.goto('http://127.0.0.1:8790/sessions/01m2xxw1t3ezsete605jpzs3gk');
  const link = page.getByRole('link').filter({ hasText: /127\.0\.0\.1:4310|Probe dashboard/i });
  await link.first().waitFor({ timeout: 15000 });
  const links = await link.evaluateAll(elements => elements.map(element => ({ label: element.textContent, href: element.getAttribute('href') })));
  const session = await (await page.request.get('http://127.0.0.1:8790/api/v1/sessions/01m2xxw1t3ezsete605jpzs3gk')).json();
  if (session.data?.agent?.type !== 'reference' || session.data.agent.name !== 'probe') throw new Error('Named Probe binding did not survive page load');
  return { chatUrl: page.url(), namedBinding: session.data.agent, dashboardLinks: links, visibleRunningMessage: (await page.locator('body').innerText()).includes('Running in Probe dashboard') };
}
