import { Page } from '@playwright/test'

export class SessionHeader {
  constructor(private page: Page) {}

  getSessionDropdown() {
    return this.page.getByTestId('header-session-dropdown')
  }

  getNewSessionMenuItem() {
    return this.page.getByTestId('session-dropdown-new-session')
  }

  async openSessionDropdown() {
    await this.getSessionDropdown().click()
  }

  async clickNewSession() {
    await this.getNewSessionMenuItem().click()
  }

  async getSessionTitle() {
    return this.page.locator('html').getAttribute('data-session-title')
  }
}
