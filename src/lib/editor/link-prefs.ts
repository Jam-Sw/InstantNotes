export type LinkOpenWith = "click" | "modclick";
export type LinkUnderline = "always" | "hover" | "never";

export interface LinkPrefsSnapshot {
  openWith: LinkOpenWith;
  underline: LinkUnderline;
  tooltip: boolean;
  externalIndicator: boolean;
}

export const DEFAULT_LINK_PREFS: LinkPrefsSnapshot = {
  openWith: "click",
  underline: "always",
  tooltip: true,
  externalIndicator: false,
};
