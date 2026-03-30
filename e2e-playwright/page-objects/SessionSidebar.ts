import { Page } from '@playwright/test'

export class SessionSidebar {
  constructor(private page: Page) {}

  getNewSessionButton() {
    return this.page.getByTestId('sidebar-new-session-button')
  }

  getProjectOptionsButton() {
    return this.page.locator('button[title="Options"]').first()
  }

  async clickNewSession() {
    await this.getNewSessionButton().click()
  }

  getSessionList() {
    return this.page.locator('[role="listitem"]')
  }
}
