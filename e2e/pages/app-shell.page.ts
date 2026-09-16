import type { Page } from '@playwright/test';
import { playwrightBaseUrl } from '../core/env';

export class AppShellPage {
  constructor(private readonly page: Page) {}

  async goto(path = '/') {
    await this.page.goto(`${playwrightBaseUrl}${path}`);
  }

  async openHome() {
    await this.page.getByRole('link', { name: 'Home' }).click();
  }

  async openReports() {
    await this.page.getByRole('link', { name: 'Reports' }).click();
  }

  async openSections() {
    await this.page.getByRole('link', { name: 'Sections' }).click();
  }

  async openIndicators() {
    await this.page.getByRole('link', { name: 'Indicators' }).click();
  }

  async openAdminMenu() {
    await this.page.getByText('Admin', { exact: true }).click();
  }

  async openAdminTile(name: string) {
    await this.openAdminMenu();
    await this.page.getByText(name, { exact: true }).click();
  }
}
