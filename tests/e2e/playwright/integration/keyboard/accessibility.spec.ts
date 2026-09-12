import test, { expect } from "@playwright/test";
import { openEditor } from "../../testutils";

test.describe("Accessible editor controls", () => {
  test("selects a labelled drawing tool from the keyboard", async ({
    page
  }) => {
    await openEditor(page);

    const eraser = page.getByRole("button", { name: /eraser/i });
    await eraser.focus();
    await page.keyboard.press("Enter");

    await expect(eraser).toHaveAttribute("aria-pressed", "true");
    await expect(eraser).toBeFocused();
  });

  test("changes pen size with radio-group arrow keys", async ({ page }) => {
    await openEditor(page);

    const onePixel = page.getByRole("radio", { name: "1 pixel pen" });
    const twoPixels = page.getByRole("radio", { name: "2 pixel pen" });
    await onePixel.focus();
    await page.keyboard.press("ArrowRight");

    await expect(twoPixels).toHaveAttribute("aria-checked", "true");
    await expect(twoPixels).toBeFocused();
  });

  test("exposes one labelled canvas instead of the rendering layers", async ({
    page
  }) => {
    await openEditor(page);

    const canvas = page.getByRole("img", { name: "Pixel drawing canvas" });
    await expect(canvas).toHaveAttribute("tabindex", "0");
    await expect(
      page.locator("#drawing-canvas-container canvas").first()
    ).toHaveAttribute("aria-hidden", "true");
  });
});
