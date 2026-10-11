import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileWorkspaceRepository } from "@/lib/server/workspace-store";
let directory: string;
beforeAll(async () => { directory = await mkdtemp(join(tmpdir(), "opspilot-file-health-")); });
afterEach(() => { vi.unstubAllEnvs(); });
afterAll(async () => { await rm(directory, { recursive: true, force: true }); });
describe("non-mutating file storage health", () => {
  it("does not create the storage directory or demo file during a fresh probe", async () => {
    vi.stubEnv("OPSPILOT_FILE_STORAGE_DIR", join(directory, "fresh"));
    const before = await readdir(directory);
    await fileWorkspaceRepository.checkHealth();
    expect(await readdir(directory)).toEqual(before);
  });
  it("checks an existing directory without changing its workspace files", async () => {
    const path = join(directory, "existing"); await mkdir(path);
    const file = join(path, "workspace.json"); await writeFile(file, "private fixture data");
    vi.stubEnv("OPSPILOT_FILE_STORAGE_DIR", path);
    await fileWorkspaceRepository.checkHealth();
    expect(await readdir(path)).toEqual(["workspace.json"]);
    expect(await readFile(file, "utf8")).toBe("private fixture data");
  });
  it("rejects a file supplied as the storage directory", async () => {
    const path = join(directory, "not-a-directory"); await writeFile(path, "fixture");
    vi.stubEnv("OPSPILOT_FILE_STORAGE_DIR", path);
    await expect(fileWorkspaceRepository.checkHealth()).rejects.toThrow("not a directory");
    expect(await readFile(path, "utf8")).toBe("fixture");
  });
  it("does not create missing intermediate directories", async () => {
    vi.stubEnv("OPSPILOT_FILE_STORAGE_DIR", join(directory, "nested", "storage"));
    const before = await readdir(directory);
    await fileWorkspaceRepository.checkHealth();
    expect(await readdir(directory)).toEqual(before);
  });
  it("rejects a dangling storage symlink without creating its target", async () => {
    const path = join(directory, "dangling");
    await symlink(join(directory, "missing-target"), path, "dir");
    vi.stubEnv("OPSPILOT_FILE_STORAGE_DIR", path);
    const before = await readdir(directory);
    await expect(fileWorkspaceRepository.checkHealth()).rejects.toThrow();
    expect(await readdir(directory)).toEqual(before);
  });
});
