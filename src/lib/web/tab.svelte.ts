import { stopWorker } from "./core";

const LOCK = "instantnotes-library";

class Tab {
  elsewhere = $state(false);

  claim(): Promise<boolean> {
    if (!("locks" in navigator)) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => {
      let settled = false;
      navigator.locks
        .request(LOCK, { ifAvailable: true }, (lock) => {
          settled = true;
          if (!lock) {
            this.elsewhere = true;
            resolve(false);
            return;
          }
          resolve(true);
          return new Promise<void>(() => {});
        })
        .catch(() => {
          stopWorker();
          this.elsewhere = true;
          if (!settled) resolve(false);
        });
    });
  }

  useHere(): void {
    void navigator.locks.request(LOCK, { steal: true }, () => {
      location.reload();
      return new Promise<void>(() => {});
    });
  }
}

export const tab = new Tab();
