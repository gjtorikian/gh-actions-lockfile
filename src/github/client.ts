import { createHash } from "node:crypto";
import type { ActionConfig, FileContent, GitRef, GitTag } from "../types.js";
import { parse as parseYaml } from "yaml";
import pLimit, { type LimitFunction } from "p-limit";

const BASE_URL = "https://api.github.com";
const GRAPHQL_URL = "https://api.github.com/graphql";

export interface Advisory {
  ghsaId: string;
  severity: "LOW" | "MODERATE" | "HIGH" | "CRITICAL";
  summary: string;
  vulnerableVersionRange: string;
  permalink: string;
}

interface PRComment {
  id: number;
  body: string;
}

interface GraphQLSecurityVulnerability {
  advisory: {
    ghsaId: string;
    summary: string;
    severity: string;
    permalink: string;
  };
  vulnerableVersionRange: string;
}

interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message: string }>;
}

export class GitHubClient {
  private token: string;
  private limiter: LimitFunction;
  private owner?: string;
  private repo?: string;

  constructor(token?: string, maxConcurrent = 10, owner?: string, repo?: string) {
    this.token = token || process.env.GITHUB_TOKEN || "";
    this.limiter = pLimit(maxConcurrent);
    this.owner = owner;
    this.repo = repo;
  }

  getToken(): string {
    return this.token;
  }

  getOwner(): string | undefined {
    return this.owner;
  }

  getRepo(): string | undefined {
    return this.repo;
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

  private async post(url: string, body: unknown, method: "POST" | "PATCH" = "POST"): Promise<Response> {
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    };

    if (this.token) {
      headers.Authorization = `Bearer ${this.token}`;
    }

    // Build options separately to satisfy eslint-plugin-unicorn/no-invalid-fetch-options
    // which doesn't understand that `method` is typed to only allow POST/PATCH
    const options: RequestInit = { method, headers };
    if (body !== undefined) {
      options.body = JSON.stringify(body);
    }
    return this.limiter(() => fetch(url, options));
  }

  private async graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const response = await this.post(GRAPHQL_URL, { query, variables });

    if (!response.ok) {
      throw new Error(`GraphQL request failed: ${response.status}`);
    }

    const result = (await response.json()) as GraphQLResponse<T>;

    if (result.errors && result.errors.length > 0) {
      const firstError = result.errors[0]!;
      throw new Error(firstError.message);
    }

    if (!result.data) {
      throw new Error("GraphQL response missing data");
    }

    return result.data;
  }

  // PR Comment methods

  async findPRComment(prNumber: number, marker: string): Promise<PRComment | null> {
    if (!this.owner || !this.repo) {
      throw new Error("Repository context not available (GITHUB_REPOSITORY not set)");
    }

    const url = `${BASE_URL}/repos/${this.owner}/${this.repo}/issues/${prNumber}/comments`;
    const comments = await this.get<PRComment[]>(url);

    for (const comment of comments) {
      if (comment.body.includes(marker)) {
        return comment;
      }
    }

    return null;
  }

  async createPRComment(prNumber: number, body: string): Promise<void> {
    if (!this.owner || !this.repo) {
      throw new Error("Repository context not available (GITHUB_REPOSITORY not set)");
    }

    const url = `${BASE_URL}/repos/${this.owner}/${this.repo}/issues/${prNumber}/comments`;
    const response = await this.post(url, { body });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Failed to create comment: ${response.status} ${errorBody}`);
    }
  }

  async updatePRComment(commentId: number, body: string): Promise<void> {
    if (!this.owner || !this.repo) {
      throw new Error("Repository context not available (GITHUB_REPOSITORY not set)");
    }

    const url = `${BASE_URL}/repos/${this.owner}/${this.repo}/issues/comments/${commentId}`;
    const response = await this.post(url, { body }, "PATCH");

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Failed to update comment: ${response.status} ${errorBody}`);
    }
  }

  // Security Advisory methods

  async checkActionAdvisories(actionName: string): Promise<Advisory[]> {
    const query = `
      query($package: String!) {
        securityVulnerabilities(
          ecosystem: ACTIONS,
          package: $package,
          first: 10
        ) {
          nodes {
            advisory {
              ghsaId
              summary
              severity
              permalink
            }
            vulnerableVersionRange
          }
        }
      }
    `;

    interface AdvisoryData {
      securityVulnerabilities?: {
        nodes: GraphQLSecurityVulnerability[];
      };
    }

    const data = await this.graphql<AdvisoryData>(query, { package: actionName });
    const nodes = data.securityVulnerabilities?.nodes || [];

    return nodes.map((node) => ({
      ghsaId: node.advisory.ghsaId,
      severity: node.advisory.severity as Advisory["severity"],
      summary: node.advisory.summary,
      vulnerableVersionRange: node.vulnerableVersionRange,
      permalink: node.advisory.permalink,
    }));
  }
}
