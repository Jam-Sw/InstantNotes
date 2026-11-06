export const TAG_SUGGEST_KEY = "suggest.tags";
export const RELATED_SUGGEST_KEY = "suggest.related";

export interface SuggestSetting {
  enabled: boolean;
  showAt: number;
}

export const SUGGEST_DEFAULT: SuggestSetting = { enabled: true, showAt: 0.5 };

export const SURENESS = [
  { value: 0.35, label: "Eager" },
  { value: 0.5, label: "Balanced" },
  { value: 0.7, label: "Careful" },
];

export function parseSuggestSetting(value: unknown): SuggestSetting {
  const v = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const nearest = SURENESS.reduce((a, b) =>
    Math.abs(b.value - Number(v.showAt)) < Math.abs(a.value - Number(v.showAt)) ? b : a,
  );
  return {
    enabled: typeof v.enabled === "boolean" ? v.enabled : SUGGEST_DEFAULT.enabled,
    showAt: typeof v.showAt === "number" ? nearest.value : SUGGEST_DEFAULT.showAt,
  };
}
