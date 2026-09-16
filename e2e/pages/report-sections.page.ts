import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { playwrightBaseUrl } from '../core/env';

export class ReportSectionsPage {
  constructor(private readonly page: Page) {}

  async goto() {
    await this.page.goto(`${playwrightBaseUrl}/sections`);
  }

  async expectLoaded() {
    await expect(this.page.getByRole('heading', { name: 'Sections' })).toBeVisible();
  }

  async openPreviewFor(sectionName: string) {
    const row = this.page.getByTestId(`section-row-${sectionName.replace(/\s+/g, '-')}`);
    await row.getByLabel('Actions').click();
    await this.page.getByText('Preview', { exact: true }).click();
  }
}
