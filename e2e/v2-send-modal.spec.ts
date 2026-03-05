import { test, expect } from '@playwright/test'

test.describe('V2 Send Modal — smoke tests (no wallet)', () => {
  test('dashboard page loads without errors', async ({ page }) => {
    // #given
    const consoleErrors: string[] = []
    page.on('console', msg => {
      if (msg.type() === 'error') consoleErrors.push(msg.text())
    })

    // #when
    await page.goto('/')

    // #then — page renders with Dust branding, no uncaught errors
    await expect(page.locator('header').getByText('DUST')).toBeVisible({ timeout: 10_000 })
    const uncaughtErrors = consoleErrors.filter(
      e => !e.includes('Failed to load resource') && !e.includes('ERR_CONNECTION_REFUSED')
    )
    expect(uncaughtErrors).toHaveLength(0)
  })

  test('V2 pool card renders PRIVACY_POOL_V2 label', async ({ page }) => {
    // #given
    await page.goto('/')

    // #then — the V2 pool card header is visible even without wallet
    await expect(page.getByText('PRIVACY_POOL_V2')).toBeVisible({ timeout: 10_000 })
  })

  test('V2 pool card shows V2 badge', async ({ page }) => {
    // #given
    await page.goto('/')

    // #then — the green "V2" badge renders next to the label
    const badge = page.locator('span', { hasText: /^V2$/ })
    await expect(badge.first()).toBeVisible({ timeout: 10_000 })
  })

  test('V2 pool card shows connect wallet prompt when disconnected', async ({ page }) => {
    // #given
    await page.goto('/')

    // #then — unauthenticated state shows the connect prompt
    await expect(
      page.getByText('Connect wallet to access V2 privacy pool')
    ).toBeVisible({ timeout: 10_000 })
  })

  test('action buttons are not rendered without wallet connection', async ({ page }) => {
    // #given
    await page.goto('/')
    await expect(page.getByText('PRIVACY_POOL_V2')).toBeVisible({ timeout: 10_000 })

    // #then — DEPOSIT, WITHDRAW, SEND, TRANSFER buttons should not exist
    await expect(page.getByText('[ DEPOSIT ]')).not.toBeVisible()
    await expect(page.getByText('[ WITHDRAW ]')).not.toBeVisible()
    await expect(page.getByText('[ SEND ]')).not.toBeVisible()
    await expect(page.getByText('[ TRANSFER ]')).not.toBeVisible()
  })

  test('send modal data-testid elements are not in DOM without wallet', async ({ page }) => {
    // #given
    await page.goto('/')
    await expect(page.getByText('PRIVACY_POOL_V2')).toBeVisible({ timeout: 10_000 })

    // #then — modal inputs only mount when modal is open (requires wallet + keys)
    await expect(page.getByTestId('send-amount')).toHaveCount(0)
    await expect(page.getByTestId('send-recipient')).toHaveCount(0)
    await expect(page.getByTestId('send-submit')).toHaveCount(0)
  })

  test('page has no unhandled JS exceptions on load', async ({ page }) => {
    // #given
    const pageErrors: Error[] = []
    page.on('pageerror', err => pageErrors.push(err))

    // #when
    await page.goto('/')
    await expect(page.locator('header').getByText('DUST')).toBeVisible({ timeout: 10_000 })

    // #then — no uncaught exceptions from V2SendModal or its dependencies
    expect(pageErrors).toHaveLength(0)
  })
})
