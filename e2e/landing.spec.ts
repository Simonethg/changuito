import { expect, test } from '@playwright/test';

import { collectPageErrors, expectNoPageErrors } from './support/page-errors';

test.describe('landing', () => {
  test('home loads, nav anchors resolve, and the CTA stays on the whitelist', async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto('/');

    await expect(page.getByRole('heading', { level: 1, name: /Decile qué querés cocinar/ })).toBeVisible();
    await expect(page.getByText('Compara precios entre supermercados').first()).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Le hablás como a alguien de tu casa' })).toBeVisible();
    await expect(
      page.getByText('El mismo producto no cuesta igual en cada cadena. Changuito los pone juntos y te muestra la diferencia.'),
    ).toBeVisible();
    await expect(page.getByText(/AquePrecio/)).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Changuito en LinkedIn' })).toHaveAttribute(
      'href',
      'https://www.linkedin.com/company/appchanguito/',
    );

    const nav = page.getByRole('navigation', { name: 'Principal' });
    await expect(nav.getByRole('link', { name: 'Cómo funciona' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Pagos' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Ayuda' })).toBeVisible();

    await nav.getByRole('link', { name: 'Cómo funciona' }).click();
    await expect(page.locator('#como-funciona')).toBeInViewport();

    await nav.getByRole('link', { name: 'Pagos' }).click();
    await expect(page.locator('#pagos')).toBeInViewport();

    await nav.getByRole('link', { name: 'Ayuda' }).click();
    await expect(page.locator('#faq')).toBeInViewport();

    const faq = page.getByRole('button', { name: '¿Puedo cambiar lo que armó?' });
    await faq.click();
    await expect(faq).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByText('Sí. Podés sacar o sumar productos antes de pagar.', { exact: true })).toBeVisible();

    const closing = page.getByRole('link', { name: 'Sumate a la beta' });
    await expect(closing).toBeVisible();
    await expect(closing).toHaveAttribute('href', '/whitelist');

    const ctas = page.getByRole('link', { name: 'Probar Changuito' });
    await expect(ctas.first()).toBeVisible();
    const count = await ctas.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i += 1) {
      await expect(ctas.nth(i)).toHaveAttribute('href', '/whitelist');
    }

    await ctas.first().click();
    await expect(page).toHaveURL(/\/whitelist\/?$/);
    await expect(page.getByRole('heading', { level: 1, name: /lista para beta/ })).toBeVisible();
    expectNoPageErrors(errors);
  });

  test('whitelist rejects an empty form and an invalid email', async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto('/whitelist');

    await expect(page.getByRole('heading', { level: 1, name: /lista para beta/ })).toBeVisible();
    await page.getByRole('button', { name: 'Anotame' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Completá tu nombre.' }).first()).toBeVisible();
    await expect(page.getByRole('alert').filter({ hasText: 'Completá tu email.' }).first()).toBeVisible();

    await page.getByLabel('Nombre').fill('Ana');
    await page.getByLabel('Email').fill('no-es-un-email');
    await page.getByRole('button', { name: 'Anotame' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Revisá tu email.' }).first()).toBeVisible();
    await expect(page.getByText('Listo, te anotamos')).toHaveCount(0);
    expectNoPageErrors(errors);
  });
});
