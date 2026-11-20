import { getSetting } from "$lib/api/client";
import { isWeb } from "$lib/api/runtime";
import { captureShortcut } from "$lib/platform";

const KEY_CAPTURE = "shortcuts.capture";

class CaptureKeys {
  custom = $state("");

  #loaded = false;

  get label(): string {
    return this.custom || captureShortcut;
  }

  init(): void {
    if (isWeb || this.#loaded) return;
    this.#loaded = true;
    void getSetting<string>(KEY_CAPTURE)
      .then((saved) => {
        if (typeof saved === "string") this.custom = saved;
      })
      .catch(() => {});
  }
}

export const captureKeys = new CaptureKeys();
