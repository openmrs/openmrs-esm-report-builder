import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';

export class SectionPreviewModal {
  constructor(private readonly page: Page) {}

  async expectOpen() {
    await expect(this.page.getByRole('dialog')).toBeVisible();
  }

  async fillPreviewRequest(data: { startDate: string; endDate: string; indicatorUuid?: string; maxRows?: number }) {
    await this.page.getByTestId('section-preview-startdate').fill(data.startDate);
    await this.page.getByTestId('section-preview-enddate').fill(data.endDate);
    if (data.indicatorUuid !== undefined) await this.page.getByTestId('section-preview-indicatoruuid').fill(data.indicatorUuid);
    if (data.maxRows !== undefined) await this.page.getByTestId('section-preview-maxrows').fill(String(data.maxRows));
  }

  async run() {
    await this.page.getByTestId('section-preview-run').click();
  }

  async expectMatrixVisible() {
    await expect(this.page.getByTestId('section-preview-matrix')).toBeVisible();
  }

  async expectError(message: string) {
    await expect(this.page.getByText(message)).toBeVisible();
  }
}
