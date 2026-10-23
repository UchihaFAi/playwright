/**
 * Copyright (c) Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { test, expect } from './inspectorTest';
import type { Recorder } from './inspectorTest';
import type { Page } from 'playwright-core';
import type { TestServer } from '../../config/testserver';

function jsonRoute(server: TestServer, path: string, body: any, status = 200) {
  server.setRoute(path, (req, res) => {
    req.resume();
    req.on('end', () => {
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(body));
    });
  });
}

function requestRow(inspector: Page, path: string) {
  return inspector.getByTestId('network-request').filter({ hasText: path });
}

async function openNetworkTab(recorder: Recorder) {
  await recorder.recorderPage.getByRole('tab', { name: /Network/ }).click();
}

async function clickButton(recorder: Recorder, name: string) {
  await recorder.hoverOverElement(`button:text-is("${name}")`);
  await Promise.all([
    recorder.waitForOutput('JavaScript', `name: '${name}'`),
    recorder.trustedClick(),
  ]);
}

async function addToScript(recorder: Recorder, path: string) {
  const inspector = recorder.recorderPage;
  const row = requestRow(inspector, path);
  await expect(row.locator('td').first()).toHaveText(/^\d+$/);
  await row.click();
  await inspector.getByRole('button', { name: 'Add to script' }).click();
}

const searchButton = `<button onclick="fetch('/api/cdmr/client/search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mdmId: '5401208568' }) })">Найти</button>`;

test.describe('network tab', () => {
  test.skip(({ mode }) => mode !== 'default');

  test('should add a check for the request caused by a click', async ({ openRecorder, server }) => {
    jsonRoute(server, '/api/cdmr/client/search', { total: 1 });
    const { recorder } = await openRecorder();
    await recorder.setContentAndWait(searchButton, server.EMPTY_PAGE);
    await clickButton(recorder, 'Найти');

    await openNetworkTab(recorder);
    await addToScript(recorder, '/api/cdmr/client/search');
    await expect(recorder.recorderPage.getByRole('button', { name: 'Added to script' })).toBeDisabled();
    await expect.poll(() => recorder.text('Java')).toContain('waitForResponse');

    expect.soft(await recorder.text('Java')).toContain(`
      Response searchResponse = page.waitForResponse(
          response -> response.request().method().equals("POST")
              && java.net.URI.create(response.url()).getRawPath().equals("/api/cdmr/client/search"),
          () -> {
            page.getByRole(AriaRole.BUTTON, new Page.GetByRoleOptions().setName("Найти")).click();
          });
      org.testng.Assert.assertEquals(searchResponse.status(), 200, "POST /api/cdmr/client/search");`);

    expect.soft(await recorder.text('Java JUnit')).toContain(`
    com.microsoft.playwright.Response searchResponse = page.waitForResponse(
        response -> response.request().method().equals("POST")
            && java.net.URI.create(response.url()).getRawPath().equals("/api/cdmr/client/search"),
        () -> {
          page.getByRole(AriaRole.BUTTON, new Page.GetByRoleOptions().setName("Найти")).click();
        });
    Assertions.assertEquals(200, searchResponse.status(), "POST /api/cdmr/client/search");`);

    expect.soft(await recorder.text('JavaScript')).toContain(`
  const searchResponsePromise = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/cdmr/client/search');
  await page.getByRole('button', { name: 'Найти' }).click();
  const searchResponse = await searchResponsePromise;
  if (searchResponse.status() !== 200)
    throw new Error('POST /api/cdmr/client/search: expected status 200, got ' + searchResponse.status());`);

    expect.soft(await recorder.text('Playwright Test')).toContain(`
  const searchResponsePromise = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/cdmr/client/search');
  await page.getByRole('button', { name: 'Найти' }).click();
  const searchResponse = await searchResponsePromise;
  expect(searchResponse.status()).toBe(200);`);

    expect.soft(await recorder.text('Python')).toContain(`
    from urllib.parse import urlparse
    with page.expect_response(lambda response: response.request.method == "POST" and urlparse(response.url).path == "/api/cdmr/client/search") as search_response_info:
        page.get_by_role("button", name="Найти").click()
    search_response = search_response_info.value
    assert search_response.status == 200, "POST /api/cdmr/client/search"`);

    expect.soft(await recorder.text('Python Async')).toContain(`
    from urllib.parse import urlparse
    async with page.expect_response(lambda response: response.request.method == "POST" and urlparse(response.url).path == "/api/cdmr/client/search") as search_response_info:
        await page.get_by_role("button", name="Найти").click()
    search_response = await search_response_info.value
    assert search_response.status == 200, "POST /api/cdmr/client/search"`);

    expect.soft(await recorder.text('C#')).toContain(`
var searchResponse = await page.RunAndWaitForResponseAsync(async () =>
{
    await page.GetByRole(AriaRole.Button, new() { Name = "Найти" }).ClickAsync();
}, response => response.Request.Method == "POST" && new Uri(response.Url).AbsolutePath == "/api/cdmr/client/search");
if (searchResponse.Status != 200)
    throw new Exception("POST /api/cdmr/client/search: expected status 200, got " + searchResponse.Status);`);
  });

  test('should show request and response bodies', async ({ openRecorder, server }) => {
    jsonRoute(server, '/api/cdmr/client/search', { total: 1, clients: [{ fullName: 'Иванов Иван Иванович' }] });
    const { recorder } = await openRecorder();
    await recorder.setContentAndWait(searchButton, server.EMPTY_PAGE);
    await clickButton(recorder, 'Найти');

    const inspector = recorder.recorderPage;
    await openNetworkTab(recorder);
    const row = requestRow(inspector, '/api/cdmr/client/search');
    await expect(row).toContainText('POST');
    await expect(row).toContainText('200');
    await row.click();

    await inspector.getByRole('tab', { name: 'Payload' }).click();
    await expect(inspector.locator('.network-body')).toContainText('"mdmId": "5401208568"');
    await inspector.getByRole('tab', { name: 'Response' }).click();
    await expect(inspector.locator('.network-body')).toContainText('"fullName": "Иванов Иван Иванович"');
    await expect(inspector.locator('.network-body-toolbar')).toContainText('application/json');
    await inspector.getByRole('tab', { name: 'Headers' }).click();
    await expect(inspector.locator('.network-headers')).toContainText('Content-Type: application/json');
  });

  test('should only collect fetch and xhr requests', async ({ openRecorder, server }) => {
    jsonRoute(server, '/api/fetched', {});
    jsonRoute(server, '/api/xhr', {});
    const { recorder } = await openRecorder();
    await recorder.setContentAndWait(`
      <link rel="stylesheet" href="/one-style.css">
      <img src="/pptr.png">
      <script>
        fetch('/api/fetched');
        const xhr = new XMLHttpRequest();
        xhr.open('GET', '/api/xhr');
        xhr.send();
      </script>
    `, server.EMPTY_PAGE);

    const inspector = recorder.recorderPage;
    await openNetworkTab(recorder);
    await expect(requestRow(inspector, '/api/fetched')).toContainText('fetch');
    await expect(requestRow(inspector, '/api/xhr')).toContainText('xhr');
    await expect(inspector.getByTestId('network-request')).toHaveCount(2);
    await expect(inspector.locator('.network-count')).toHaveText('2 / 100');
  });

  test('should keep the latest 100 requests', async ({ openRecorder, server }) => {
    for (let i = 0; i < 105; i++)
      jsonRoute(server, `/api/item-${String(i).padStart(3, '0')}`, {});
    const { recorder } = await openRecorder();
    await recorder.setContentAndWait(`<div>items</div>`, server.EMPTY_PAGE);
    await recorder.page.evaluate(async () => {
      for (let i = 0; i < 105; i++)
        await fetch(`/api/item-${String(i).padStart(3, '0')}`);
    });

    const inspector = recorder.recorderPage;
    await openNetworkTab(recorder);
    await expect(inspector.locator('.network-count')).toHaveText('100 / 100');
    await expect(inspector.getByTestId('network-request')).toHaveCount(100);
    await expect(requestRow(inspector, '/api/item-104')).toBeVisible();
    await expect(requestRow(inspector, '/api/item-005')).toHaveCount(1);
    await expect(requestRow(inspector, '/api/item-004')).toHaveCount(0);
  });

  test('should attach the check to the action that caused the request', async ({ openRecorder, server }) => {
    jsonRoute(server, '/api/cdmr/client/search', {});
    const { recorder } = await openRecorder();
    await recorder.setContentAndWait(`${searchButton}<button>Сохранить</button>`, server.EMPTY_PAGE);
    await clickButton(recorder, 'Найти');
    await clickButton(recorder, 'Сохранить');

    await openNetworkTab(recorder);
    await addToScript(recorder, '/api/cdmr/client/search');
    await expect.poll(() => recorder.text('JavaScript')).toContain(`
  const searchResponsePromise = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/cdmr/client/search');
  await page.getByRole('button', { name: 'Найти' }).click();
  const searchResponse = await searchResponsePromise;
  if (searchResponse.status() !== 200)
    throw new Error('POST /api/cdmr/client/search: expected status 200, got ' + searchResponse.status());
  await page.getByRole('button', { name: 'Сохранить' }).click();`);
  });

  test('should attach a page load request to the navigation and keep it', async ({ openRecorder, server }) => {
    jsonRoute(server, '/api/cdmr/session/current', {});
    const { recorder } = await openRecorder();
    await recorder.setContentAndWait(`<script>fetch('/api/cdmr/session/current')</script>`, server.EMPTY_PAGE);

    await openNetworkTab(recorder);
    await addToScript(recorder, '/api/cdmr/session/current');
    await expect.poll(() => recorder.text('JavaScript')).toContain(`
  const currentResponsePromise = page.waitForResponse(response => response.request().method() === 'GET' && new URL(response.url()).pathname === '/api/cdmr/session/current');
  await page.goto('${server.EMPTY_PAGE}');
  const currentResponse = await currentResponsePromise;`);

    // Consecutive navigations are merged, but not over a page whose request is checked.
    await recorder.page.goto(server.PREFIX + '/one-style.html');
    await expect.poll(() => recorder.text('JavaScript')).toContain(`await page.goto('${server.PREFIX}/one-style.html');`);
    expect(await recorder.text('JavaScript')).toContain(`await page.goto('${server.EMPTY_PAGE}');`);
  });

  test('should keep the check when typing continues', async ({ openRecorder, server }) => {
    jsonRoute(server, '/api/cdmr/suggest', {});
    const { recorder } = await openRecorder();
    await recorder.setContentAndWait(`<input aria-label="ФИО" oninput="if (this.value === 'Ив') fetch('/api/cdmr/suggest?q=' + this.value)">`, server.EMPTY_PAGE);
    await recorder.page.locator('input').focus();
    await recorder.page.keyboard.type('Ив', { delay: 50 });
    await expect(requestRow(recorder.recorderPage, '/api/cdmr/suggest')).toHaveCount(0);
    await openNetworkTab(recorder);
    await addToScript(recorder, '/api/cdmr/suggest');
    await expect.poll(() => recorder.text('JavaScript')).toContain('suggestResponse');
    await recorder.page.keyboard.type('анов', { delay: 50 });

    await expect.poll(() => recorder.text('JavaScript')).toContain(`
  const suggestResponsePromise = page.waitForResponse(response => response.request().method() === 'GET' && new URL(response.url()).pathname === '/api/cdmr/suggest');
  await page.getByRole('textbox', { name: 'ФИО' }).fill('Иванов');
  const suggestResponse = await suggestResponsePromise;`);
  });

  test('should keep ids in the path and drop host and query', async ({ openRecorder, server }) => {
    // The test server matches routes together with the query string.
    jsonRoute(server, '/api/cdmr/client/5302225674/profile?mdmId=5401208568', {});
    const { recorder } = await openRecorder();
    await recorder.setContentAndWait(`<button onclick="fetch('/api/cdmr/client/5302225674/profile?mdmId=5401208568')">Профиль</button>`, server.EMPTY_PAGE);
    await clickButton(recorder, 'Профиль');

    await openNetworkTab(recorder);
    await expect(requestRow(recorder.recorderPage, '/api/cdmr/client/5302225674/profile?mdmId=5401208568')).toBeVisible();
    await addToScript(recorder, '/api/cdmr/client/5302225674/profile');
    await expect.poll(() => recorder.text('Java')).toContain(`Response profileResponse = page.waitForResponse(`);
    const java = await recorder.text('Java');
    const check = java.substring(java.indexOf('Response profileResponse'));
    expect(check).toContain(`getRawPath().equals("/api/cdmr/client/5302225674/profile")`);
    expect(check).toContain(`org.testng.Assert.assertEquals(profileResponse.status(), 200, "GET /api/cdmr/client/5302225674/profile");`);
    expect(check).not.toContain('localhost');
    expect(check).not.toContain('mdmId=');
  });

  test('should name repeated checks uniquely', async ({ openRecorder, server }) => {
    jsonRoute(server, '/api/cdmr/client/search', {});
    const { recorder } = await openRecorder();
    await recorder.setContentAndWait(`${searchButton}<button onclick="fetch('/api/cdmr/client/search', { method: 'POST' })">Найти ещё</button>`, server.EMPTY_PAGE);
    await clickButton(recorder, 'Найти');
    await clickButton(recorder, 'Найти ещё');

    const inspector = recorder.recorderPage;
    await openNetworkTab(recorder);
    const rows = requestRow(inspector, '/api/cdmr/client/search');
    await expect(rows).toHaveCount(2);
    for (const index of [0, 1]) {
      await expect(rows.nth(index).locator('td').first()).toHaveText('200');
      await rows.nth(index).click();
      await inspector.getByRole('button', { name: 'Add to script' }).click();
      await expect(inspector.getByRole('button', { name: 'Added to script' })).toBeVisible();
    }
    await expect.poll(() => recorder.text('Java')).toContain('search2Response');
    const java = await recorder.text('Java');
    expect(java).toContain('Response searchResponse = page.waitForResponse(');
    expect(java).toContain('Response search2Response = page.waitForResponse(');
    expect(java).toContain('org.testng.Assert.assertEquals(search2Response.status(), 200, "POST /api/cdmr/client/search");');
  });

  test('should not add a check for a failed request', async ({ openRecorder, server }) => {
    const { recorder } = await openRecorder();
    await recorder.page.route('**/api/cdmr/broken', route => route.abort());
    await recorder.setContentAndWait(`<button onclick="fetch('/api/cdmr/broken').catch(() => {})">Сломать</button>`, server.EMPTY_PAGE);
    await clickButton(recorder, 'Сломать');

    const inspector = recorder.recorderPage;
    await openNetworkTab(recorder);
    const row = requestRow(inspector, '/api/cdmr/broken');
    await expect(row.locator('td').first()).toHaveText('failed');
    await row.click();
    await expect(inspector.getByRole('button', { name: 'Add to script' })).toBeDisabled();
    await inspector.getByRole('tab', { name: 'Response' }).click();
    await expect(inspector.locator('.network-details')).toContainText('Request failed');
  });

  test('should explain when there is no action to attach the check to', async ({ openRecorder, server }) => {
    jsonRoute(server, '/api/cdmr/client/search', {});
    const { recorder } = await openRecorder();
    await recorder.setContentAndWait(searchButton, server.EMPTY_PAGE);
    await clickButton(recorder, 'Найти');

    const inspector = recorder.recorderPage;
    await inspector.getByRole('button', { name: 'Clear' }).click();
    await openNetworkTab(recorder);
    await addToScript(recorder, '/api/cdmr/client/search');
    await expect(inspector.locator('.network-add-error')).toHaveText('No recorded action before this request to attach the check to');
    expect(await recorder.text('JavaScript')).not.toContain('waitForResponse');
  });

  test('should summarize binary and large bodies', async ({ openRecorder, server }) => {
    server.setRoute('/api/cdmr/photo', (req, res) => {
      res.setHeader('Content-Type', 'image/png');
      res.end(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    });
    server.setRoute('/api/cdmr/export', (req, res) => {
      res.setHeader('Content-Type', 'text/plain');
      res.end('x'.repeat(1024 * 1024 + 1));
    });
    const { recorder } = await openRecorder();
    await recorder.setContentAndWait(`<script>fetch('/api/cdmr/photo'); fetch('/api/cdmr/export');</script>`, server.EMPTY_PAGE);

    const inspector = recorder.recorderPage;
    await openNetworkTab(recorder);
    await expect(requestRow(inspector, '/api/cdmr/photo')).toContainText('8 B');
    await requestRow(inspector, '/api/cdmr/photo').click();
    await inspector.getByRole('tab', { name: 'Response' }).click();
    await expect(inspector.locator('.network-details')).toContainText('Binary content · image/png · 8 B');
    await expect(requestRow(inspector, '/api/cdmr/export')).toContainText('1.0 MB');
    await requestRow(inspector, '/api/cdmr/export').click();
    await expect(inspector.locator('.network-details')).toContainText('Body is larger than 1 MB · text/plain · 1.0 MB');
  });

  test('should clear the network log', async ({ openRecorder, server }) => {
    jsonRoute(server, '/api/cdmr/session/current', {});
    const { recorder } = await openRecorder();
    await recorder.setContentAndWait(`<script>fetch('/api/cdmr/session/current')</script>`, server.EMPTY_PAGE);

    const inspector = recorder.recorderPage;
    await openNetworkTab(recorder);
    await expect(inspector.getByTestId('network-request')).toHaveCount(1);
    await inspector.getByRole('button', { name: 'Clear network log' }).click();
    await expect(inspector.getByTestId('network-request')).toHaveCount(0);
    await expect(inspector.locator('.network-count')).toHaveText('0 / 100');
  });
});
