import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { playwrightBaseUrl } from '../core/env';

export class ETLSourcesPage {
  constructor(private readonly page: Page) {}

  async goto() {
    await this.page.goto(`${playwrightBaseUrl}/admin/etl-sources`);
  }

  async expectLoaded() {
    await expect(this.page.getByRole('heading', { name: 'ETL Sources', exact: true })).toBeVisible();
  }

  async clickNew() {
    await this.page.getByTestId('etl-source-new').click();
  }

  async fillForm(data: { name: string; code?: string; schemaName?: string; sourceType?: string; description?: string; tablePatterns?: string }) {
    await this.page.getByTestId('etl-source-name').fill(data.name);
    if (data.code !== undefined) await this.page.getByTestId('etl-source-code').fill(data.code);
    if (data.schemaName !== undefined) await this.page.getByTestId('etl-source-schema').fill(data.schemaName);
    if (data.sourceType !== undefined) await this.page.getByTestId('etl-source-type').fill(data.sourceType);
    if (data.description !== undefined) await this.page.getByTestId('etl-source-description').fill(data.description);
    if (data.tablePatterns !== undefined) await this.page.getByTestId('etl-source-table-patterns').fill(data.tablePatterns);
  }

  async save() {
    await this.page.getByRole('button', { name: 'Save' }).click();
  }

  row(name: string) {
    return this.page.getByRole('row').filter({ hasText: name });
  }
}
