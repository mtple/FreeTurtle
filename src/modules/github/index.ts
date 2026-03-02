import type { FreeTurtleModule, ToolDefinition } from "../types.js";
import { GitHubClient } from "./client.js";
import { githubTools } from "./tools.js";

export class GitHubModule implements FreeTurtleModule {
  name = "github";
  description = "Create issues, list issues, and commit files to GitHub.";

  private client!: GitHubClient;

  async initialize(
    _config: Record<string, unknown>,
    env: Record<string, string>
  ): Promise<void> {
    const token = env.GITHUB_TOKEN;
    if (!token) throw new Error("GitHub module requires GITHUB_TOKEN");
    this.client = new GitHubClient(token);
  }

  getTools(): ToolDefinition[] {
    return githubTools;
  }

  async executeTool(
    name: string,
    input: Record<string, unknown>
  ): Promise<string> {
    switch (name) {
      case "create_issue": {
        const issue = await this.client.createIssue(
          input.repo as string,
          input.title as string,
          input.body as string
        );
        return JSON.stringify(issue);
      }
      case "list_issues": {
        const issues = await this.client.listIssues(
          input.repo as string,
          (input.state as "open" | "closed" | "all") ?? "open"
        );
        return JSON.stringify(issues);
      }
      case "commit_file": {
        const result = await this.client.commitFile(
          input.repo as string,
          input.path as string,
          input.content as string,
          input.message as string
        );
        return JSON.stringify(result);
      }
      default:
        throw new Error(`Unknown github tool: ${name}`);
    }
  }
}
