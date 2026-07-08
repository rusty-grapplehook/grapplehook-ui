import { app, net } from 'electron';

const RELEASES_API = 'https://api.github.com/repos/rusty-grapplehook/grapplehook-ui/releases/latest';

export const RELEASES_URL = 'https://github.com/rusty-grapplehook/grapplehook-ui/releases/latest';

export interface UpdateInfo {
  updateAvailable: boolean;
  currentVersion: string;
  latestVersion: string | null;
}

/** "1.2.10" vs "1.2.9" → 1 | 0 | -1. Handles unequal lengths; ignores pre-release tags. */
function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);

  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);

    if (d !== 0) {
      return Math.sign(d);
    }
  }

  return 0;
}

/**
 * Checks GitHub for a newer release. Never throws - on any failure (offline,
 * rate-limited, malformed response) it reports "no update" so the app never
 * bothers the user about a failed check.
 */
export async function checkForUpdate(): Promise<UpdateInfo> {
  const currentVersion = app.getVersion();
  const none: UpdateInfo = { updateAvailable: false, currentVersion, latestVersion: null };

  try {
    // Electron's net module respects system proxies, unlike bare fetch.
    const res = await net.fetch(RELEASES_API, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': `grapplehook-ui/${currentVersion}` },
    });

    if (!res.ok) {
      return none;
    }

    const body: unknown = await res.json();
    const tag = (body as { tag_name?: unknown }).tag_name;

    if (typeof tag !== 'string') {
      return none;
    }

    const latestVersion = tag.replace(/^v/, '');

    return {
      updateAvailable: compareVersions(latestVersion, currentVersion) > 0,
      currentVersion,
      latestVersion,
    };
  } catch {
    return none;
  }
}
