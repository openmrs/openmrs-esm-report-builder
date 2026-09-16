import { request, type FullConfig } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { e2eBaseUrl, loginLocation, password, username } from './env';

async function globalSetup(config: FullConfig) {
  const storageStatePath = config.projects[0]?.use?.storageState as string | undefined;
  if (!storageStatePath) return;

  const requestContext = await request.newContext({ baseURL: e2eBaseUrl });

  const authHeader = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
  const response = await requestContext.post(`${e2eBaseUrl}/ws/rest/v1/session`, {
    headers: {
      Authorization: authHeader,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    form: {
      sessionLocation: loginLocation,
    },
    failOnStatusCode: false,
  });

  if (!response.ok()) {
    throw new Error(`E2E authentication failed with status ${response.status()}. Check E2E_* variables and backend availability.`);
  }

  const state = await requestContext.storageState();
  await fs.mkdir(path.dirname(storageStatePath), { recursive: true });
  await fs.writeFile(storageStatePath, JSON.stringify(state, null, 2));
  await requestContext.dispose();
}

export default globalSetup;
