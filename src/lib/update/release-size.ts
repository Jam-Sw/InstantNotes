// How much bigger or smaller the offered build is than the one running.
//
// The updater plugin only reports a size once a download starts, so the delta
// is read from the published GitHub release assets instead: the running
// version's updater artifact against the offered one. This is a nicety, never a
// gate - any failure (offline, rate limit, a release whose asset was named
// differently) resolves to null and the UI simply omits the line.

const REPO = "Jam-Sw/InstantNotes";

interface ReleaseAsset {
  name: string;
  size: number;
}

/** The updater artifact for this platform, by the names tauri-action uploads. */
function assetMatcher(userAgent: string): (name: string) => boolean {
  if (/mac|darwin/i.test(userAgent)) return (n) => n.endsWith(".app.tar.gz");
  if (/win/i.test(userAgent)) return (n) => n.endsWith("-setup.exe");
  return (n) => n.endsWith(".AppImage");
}

/**
 * The one updater artifact in a release, skipping its `.sig` sidecar.
 * @internal
 */
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

/**
 * Offered size minus running size, in bytes. `null` when either side cannot be
 * resolved for this platform, or on any network or parsing failure.
 */
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
