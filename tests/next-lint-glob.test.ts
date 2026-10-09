import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

type LintContext = {
  cwd: string;
  settings: {
    next?: {
      rootDir?: string | string[];
    };
  };
};

const projectRequire = createRequire(import.meta.url);
const pluginRequire = createRequire(
  projectRequire.resolve("@next/eslint-plugin-next"),
);

const { getRootDirs } = pluginRequire(
  "./utils/get-root-dirs.js",
) as {
  getRootDirs: (context: LintContext) => string[];
};

let fixtureRoot: string;
let siteA: string;
let siteB: string;

beforeAll(() => {
  fixtureRoot = mkdtempSync(join(tmpdir(), "opspilot lint glob-"));
  siteA = join(fixtureRoot, "site-a");
  siteB = join(fixtureRoot, "site-b");

  mkdirSync(siteA);
  mkdirSync(siteB);
  writeFileSync(join(fixtureRoot, "site-file.txt"), "test fixture");
});

afterAll(() => {
  if (fixtureRoot) {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

function discover(rootDir?: string | string[]) {
  const paths = getRootDirs({
    cwd: fixtureRoot,
    settings: {
      next: rootDir === undefined ? {} : { rootDir },
    },
  });

  return paths.map((path) => resolve(path)).sort();
}

describe("Next.js lint root discovery", () => {
  it("uses the working directory when no root is configured", () => {
    expect(discover()).toEqual([resolve(fixtureRoot)]);
  });

  it("finds a single configured directory", () => {
    expect(discover(siteA)).toEqual([resolve(siteA)]);
  });

  it("matches directories and excludes matching files", () => {
    expect(discover(join(fixtureRoot, "site-*"))).toEqual(
      [resolve(siteA), resolve(siteB)].sort(),
    );
  });

  it("supports an array of configured roots", () => {
    expect(discover([siteB, siteA])).toEqual(
      [resolve(siteA), resolve(siteB)].sort(),
    );
  });
});