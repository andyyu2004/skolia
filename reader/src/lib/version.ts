const REPO = "https://github.com/skolia-io/skolia";

/** The GitHub log up to the build's commit, from its git describe --tags --always --dirty:
 * a tag (v0.0.2), a commit after one (v0.0.2-16-g3231f8c), or a bare commit (3231f8c),
 * any of them maybe -dirty. null for "dev", which isn't a build. */
export function versionUrl(version: string): string | null {
  if (version === "dev") return null;
  const clean = version.replace(/-dirty$/u, "");
  const after = /-\d+-g([0-9a-f]{4,40})$/u.exec(clean);
  return `${REPO}/commits/${encodeURIComponent(after?.[1] ?? clean)}`;
}
