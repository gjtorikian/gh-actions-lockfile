import { createHash } from "node:crypto";
import type { ActionConfig, FileContent, GitRef, GitTag } from "../types.js";
import { parse as parseYaml } from "yaml";
import pLimit, { type LimitFunction } from "p-limit";

const BASE_URL = "https://api.github.com";

export class GitHubClient {
  private token: string;
  private limiter: LimitFunction;

  constructor(token?: string, maxConcurrent = 10) {
    this.token = token || process.env.GITHUB_TOKEN || "";
    this.limiter = pLimit(maxConcurrent);
  }

  async resolveRef(owner: string, repo: string, ref: string): Promise<string> {
    // Check if it's already a SHA (40 hex chars)
    if (/^[a-f0-9]{40}$/i.test(ref)) {
      return ref;
    }

    const resolvers = [
      () => this.resolveTag(owner, repo, ref),
      () => this.resolveBranch(owner, repo, ref),
    ];

    for (const resolver of resolvers) {
      try {
        return await resolver();
      } catch (e) {
        // Rethrow rate limit errors immediately
        if (e instanceof Error && e.message.includes("rate limit")) {
          throw e;
        }
        // Otherwise, continue to next resolver
      }
    }

    throw new Error(`Could not resolve ref "${ref}" for ${owner}/${repo}`);
  }

  private async resolveTag(owner: string, repo: string, tag: string): Promise<string> {
    const url = `${BASE_URL}/repos/${owner}/${repo}/git/refs/tags/${tag}`;
    const gitRef = await this.get<GitRef>(url);

    // If it's an annotated tag, we need to dereference it
    if (gitRef.object.type === "tag") {
      const tagUrl = `${BASE_URL}/repos/${owner}/${repo}/git/tags/${gitRef.object.sha}`;
      const tagObj = await this.get<GitTag>(tagUrl);
      return tagObj.object.sha;
    }

    return gitRef.object.sha;
  }

  private async resolveBranch(owner: string, repo: string, branch: string): Promise<string> {
    const url = `${BASE_URL}/repos/${owner}/${repo}/git/refs/heads/${branch}`;
    const gitRef = await this.get<GitRef>(url);
    return gitRef.object.sha;
  }

  async getActionConfig(
    owner: string,
    repo: string,
    sha: string,
    path?: string
  ): Promise<ActionConfig | null> {
    // If path ends with .yml/.yaml, it's a reusable workflow - fetch directly
    if (path?.endsWith(".yml") || path?.endsWith(".yaml")) {
      try {
        const url = `${BASE_URL}/repos/${owner}/${repo}/contents/${path}?ref=${sha}`;
        const content = await this.get<FileContent>(url);

        if (!content.download_url) return null;

        const response = await this.fetch(content.download_url);
        const text = await response.text();

        return parseYaml(text) as ActionConfig;
      } catch {
        return null;
      }
    }

    // Otherwise, try action.yml first, then action.yaml
    for (const filename of ["action.yml", "action.yaml"]) {
      const filePath = path ? `${path}/${filename}` : filename;

      try {
        const url = `${BASE_URL}/repos/${owner}/${repo}/contents/${filePath}?ref=${sha}`;
        const content = await this.get<FileContent>(url);

        if (!content.download_url) continue;

        const response = await this.fetch(content.download_url);
        const text = await response.text();

        return parseYaml(text) as ActionConfig;
      } catch {
        // Try next filename
      }
    }

    return null;
  }

  async getArchiveSHA256(owner: string, repo: string, sha: string): Promise<string> {
    const url = `${BASE_URL}/repos/${owner}/${repo}/tarball/${sha}`;

    const response = await this.fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to download tarball: ${response.status}`);
    }

    const buffer = await response.arrayBuffer();
    const hash = createHash("sha256");
    hash.update(Buffer.from(buffer));

    return `sha256-${hash.digest("hex")}`;
  }

  private async get<T>(url: string): Promise<T> {
    const response = await this.fetch(url);

    if (response.status === 404) {
      throw new Error("Not found");
    }

    if (response.status === 403) {
      const body = await response.text();
      if (body.includes("rate limit") || body.includes("API rate limit")) {
        throw new Error(
          "GitHub API rate limit exceeded. Set the GITHUB_TOKEN environment variable to authenticate and increase your rate limit."
        );
      }
      throw new Error(`Request failed: ${response.status}: ${body}`);
    }

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Request failed: ${response.status}: ${body}`);
    }

    return response.json() as Promise<T>;
  }

  private async fetch(url: string): Promise<Response> {
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
    };

    if (this.token) {
      headers.Authorization = `Bearer ${this.token}`;
    }

    return this.limiter(() => fetch(url, { headers }));
  }
}
