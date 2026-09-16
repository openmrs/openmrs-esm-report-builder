import { test, expect } from '../core/test';

const sectionUuid = '4278ebf9-47ab-40b8-aeca-df3e4a050c79';
const indicatorUuid = '2b9c6c8e-1234-4d9f-8abc-1234567890ab';

test.describe('section preview', () => {
  test('submits preview payload and renders the matrix', async ({ page, reportSectionsPage, sectionPreviewModal }) => {
    await page.route('**/ws/rest/v1/reportbuilder/section?**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          results: [
            {
              uuid: sectionUuid,
              name: 'Monthly HTS Summary',
              code: 'HTS_MONTHLY',
              configJson: JSON.stringify({ indicators: [{ uuid: indicatorUuid }] }),
            },
          ],
        }),
      });
    });

    await page.route(`**/ws/rest/v1/reportbuilder/section/${sectionUuid}**`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          uuid: sectionUuid,
          name: 'Monthly HTS Summary',
          code: 'HTS_MONTHLY',
          configJson: JSON.stringify({ indicators: [{ uuid: indicatorUuid }] }),
        }),
      });
    });

    await page.route('**/ws/rest/v1/reportbuilder/indicator**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ results: [] }),
      });
    });

    await page.route('**/ws/rest/v1/reportbuilder/sectionpreview', async (route) => {
      const body = route.request().postDataJSON();
      expect(body).toEqual({
        sectionUuid,
        indicatorUuid,
        startDate: '2026-01-01',
        endDate: '2026-01-31',
        maxRows: 100,
        params: {},
      });

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          sectionUuid,
          results: [
            {
              indicatorUuid,
              name: 'HTS TST',
              kind: 'base',
              columns: ['age_group', 'gender', 'value'],
              rows: [
                ['0-28d', 'F', 2],
                ['0-28d', 'M', 1],
              ],
              rowCount: 2,
              truncated: false,
            },
          ],
        }),
      });
    });

    await reportSectionsPage.goto();
    await reportSectionsPage.expectLoaded();
    await reportSectionsPage.openPreviewFor('Monthly HTS Summary');
    await sectionPreviewModal.expectOpen();
    await sectionPreviewModal.fillPreviewRequest({
      startDate: '2026-01-01',
      endDate: '2026-01-31',
      indicatorUuid,
      maxRows: 100,
    });
    await sectionPreviewModal.run();
    await sectionPreviewModal.expectMatrixVisible();
    await expect(page.getByRole('cell', { name: 'HTS TST' })).toBeVisible();
  });
});
