import type { FreeTurtleModule, ToolDefinition } from "../types.js";
import type { PolicyConfig } from "../../policy.js";
import {
  assertGithubRepoAllowed,
  assertGithubPathAllowed,
} from "../../policy.js";
import { withRetry } from "../../reliability.js";
import { GitHubClient } from "./client.js";
import { githubTools } from "./tools.js";

export class GitHubModule implements FreeTurtleModule {
  name = "github";
  description = "Create issues, list issues, and commit files to GitHub.";

  private client!: GitHubClient;
  private policy?: PolicyConfig;

  async initialize(
    _config: Record<string, unknown>,
    env: Record<string, string>,
    options?: { policy?: PolicyConfig },
  ): Promise<void> {
    const token = env.GITHUB_TOKEN;
    if (!token) throw new Error("GitHub module requires GITHUB_TOKEN");
    this.client = new GitHubClient(token);
    this.policy = options?.policy;
  }

  getTools(): ToolDefinition[] {
    return githubTools;
  }

  async executeTool(
    name: string,
    input: Record<string, unknown>
  ): Promise<string> {
    // Enforce repo allowlist on all GitHub operations
    if (input.repo) {
      assertGithubRepoAllowed(this.policy, input.repo as string);
    }

    switch (name) {
      case "create_repo": {
        const result = await withRetry(() =>
          this.client.createRepo(
            input.name as string,
            input.description as string | undefined,
            input.private as boolean | undefined,
          )
        );
        return JSON.stringify(result);
      }
      case "create_issue": {
        const issue = await withRetry(() =>
          this.client.createIssue(
            input.repo as string,
            input.title as string,
            input.body as string
          )
        );
        return JSON.stringify(issue);
      }
      case "list_issues": {
        const issues = await withRetry(() =>
          this.client.listIssues(
            input.repo as string,
            (input.state as "open" | "closed" | "all") ?? "open"
          )
        );
        return JSON.stringify(issues);
      }
      case "commit_file": {
        // Enforce path allowlist for commits
        assertGithubPathAllowed(this.policy, input.path as string);

        const result = await withRetry(() =>
          this.client.commitFile(
            input.repo as string,
            input.path as string,
            input.content as string,
            input.message as string,
            input.branch as string | undefined
          )
        );
        return JSON.stringify(result);
      }
      default:
        throw new Error(`Unknown github tool: ${name}`);
    }
  }
}
