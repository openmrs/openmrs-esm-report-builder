import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { playwrightBaseUrl } from '../core/env';

export class ETLSourcesPage {
  constructor(private readonly page: Page) {}

  async goto() {
    await this.page.goto(`${playwrightBaseUrl}/admin/etl-sources`);
  }

  async expectLoaded() {
    await expect(this.page.getByRole('heading', { name: 'ETL Sources' })).toBeVisible();
  }

  async clickNew() {
    await this.page.getByTestId('etl-source-new').click();
  }

  async fillForm(data: { name: string; code?: string; schemaName?: string; sourceType?: string; description?: string; tablePatterns?: string }) {
    await this.page.locator('[data-testid="etl-source-name"] input').fill(data.name);
    if (data.code !== undefined) await this.page.locator('[data-testid="etl-source-code"] input').fill(data.code);
    if (data.schemaName !== undefined) await this.page.locator('[data-testid="etl-source-schema"] input').fill(data.schemaName);
    if (data.sourceType !== undefined) await this.page.locator('[data-testid="etl-source-type"] input').fill(data.sourceType);
    if (data.description !== undefined) await this.page.locator('[data-testid="etl-source-description"] textarea').fill(data.description);
    if (data.tablePatterns !== undefined) await this.page.locator('[data-testid="etl-source-table-patterns"] textarea').fill(data.tablePatterns);
  }

  async save() {
    await this.page.getByRole('button', { name: 'Save' }).click();
  }

  row(name: string) {
    return this.page.getByRole('row').filter({ hasText: name });
  }
}
