const REPO = "Jam-Sw/InstantNotes";

interface ReleaseAsset {
  name: string;
  size: number;
}

function assetMatcher(userAgent: string): (name: string) => boolean {
  if (/mac|darwin/i.test(userAgent)) return (n) => n.endsWith(".app.tar.gz");
  if (/win/i.test(userAgent)) return (n) => n.endsWith("-setup.exe");
  return (n) => n.endsWith(".AppImage");
}

export function selectAsset(
  assets: ReleaseAsset[],
  userAgent: string,
): ReleaseAsset | null {
  const matches = assetMatcher(userAgent);
  return (
    assets.find((a) => !a.name.endsWith(".sig") && matches(a.name)) ?? null
  );
}

interface GhRelease {
  assets?: { name?: string; size?: number }[];
}

async function fetchReleaseAssets(
  tag: string,
  fetchImpl: typeof fetch,
): Promise<ReleaseAsset[]> {
  const res = await fetchImpl(
    `https://api.github.com/repos/${REPO}/releases/tags/${tag}`,
    { headers: { Accept: "application/vnd.github+json" } },
  );
  if (!res.ok) return [];
  const data = (await res.json()) as GhRelease;
  return (data.assets ?? []).map((a) => ({
    name: a.name ?? "",
    size: a.size ?? 0,
  }));
}

export async function fetchUpdateSizeDelta(opts: {
  currentVersion: string;
  version: string;
  userAgent: string;
  fetchImpl?: typeof fetch;
}): Promise<number | null> {
  const doFetch = opts.fetchImpl ?? fetch;
  try {
    const [older, newer] = await Promise.all([
      fetchReleaseAssets(`v${opts.currentVersion}`, doFetch),
      fetchReleaseAssets(`v${opts.version}`, doFetch),
    ]);
    const from = selectAsset(older, opts.userAgent);
    const to = selectAsset(newer, opts.userAgent);
    if (!from || !to) return null;
    return to.size - from.size;
  } catch {
    return null;
  }
}
