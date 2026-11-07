const REPO = "https://github.com/skolia-io/skolia";

/** Where on GitHub the build's code is, from its git describe --tags --always --dirty:
 * a tag (v0.0.2), a commit after one (v0.0.2-16-g3231f8c), or a bare commit (3231f8c),
 * any of them maybe -dirty. null for "dev", which isn't a build. */
export function versionUrl(version: string): string | null {
  if (version === "dev") return null;
  const clean = version.replace(/-dirty$/u, "");
  const after = /-\d+-g([0-9a-f]{4,40})$/u.exec(clean);
  if (after?.[1]) return `${REPO}/commit/${after[1]}`;
  if (/^[0-9a-f]{4,40}$/u.test(clean)) return `${REPO}/commit/${clean}`;
  return `${REPO}/tree/${encodeURIComponent(clean)}`;
}
