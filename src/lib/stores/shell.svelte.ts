export type SettingsPage =
  | "home"
  | "appearance"
  | "about"
  | "editor"
  | "images"
  | "links"
  | "contexting"
  | "feedback"
  | "diagnostics"
  | "vault"
  | "backups"
  | "agents"
  | "import";

class ShellStore {
  settingsOpen = $state(false);
  settingsPage = $state<SettingsPage>("home");
  paletteOpen = $state(false);

  openSettings(page: SettingsPage = "home"): void {
    this.settingsPage = page;
    this.settingsOpen = true;
  }

  closeSettings(): void {
    this.settingsOpen = false;
  }

  togglePalette(): void {
    this.paletteOpen = !this.paletteOpen;
  }
}

export const shell = new ShellStore();
