import { Octokit } from "@octokit/rest";

export interface Issue {
  number: number;
  title: string;
  body: string | null;
  state: string;
  html_url: string;
  created_at: string;
  user: string;
}

export interface CommitResult {
  sha: string;
  html_url: string;
}

export class GitHubClient {
  private octokit: Octokit;

  constructor(token: string) {
    this.octokit = new Octokit({ auth: token });
  }

  private parseRepo(repo: string): { owner: string; repo: string } {
    const [owner, name] = repo.split("/");
    return { owner, repo: name };
  }

  async createIssue(
    repo: string,
    title: string,
    body: string
  ): Promise<Issue> {
    const { owner, repo: name } = this.parseRepo(repo);
    const { data } = await this.octokit.issues.create({
      owner,
      repo: name,
      title,
      body,
    });
    return {
      number: data.number,
      title: data.title,
      body: data.body ?? null,
      state: data.state,
      html_url: data.html_url,
      created_at: data.created_at,
      user: data.user?.login ?? "unknown",
    };
  }

  async listIssues(
    repo: string,
    state: "open" | "closed" | "all" = "open"
  ): Promise<Issue[]> {
    const { owner, repo: name } = this.parseRepo(repo);
    const { data } = await this.octokit.issues.listForRepo({
      owner,
      repo: name,
      state,
      per_page: 30,
    });
    return data.map((d) => ({
      number: d.number,
      title: d.title,
      body: d.body ?? null,
      state: d.state,
      html_url: d.html_url,
      created_at: d.created_at,
      user: d.user?.login ?? "unknown",
    }));
  }

  async commitFile(
    repo: string,
    path: string,
    content: string,
    message: string,
    branch?: string
  ): Promise<CommitResult> {
    const { owner, repo: name } = this.parseRepo(repo);

    // Check if file exists to get its SHA
    let existingSha: string | undefined;
    try {
      const { data } = await this.octokit.repos.getContent({
        owner,
        repo: name,
        path,
        ...(branch ? { ref: branch } : {}),
      });
      if (!Array.isArray(data) && data.type === "file") {
        existingSha = data.sha;
      }
    } catch {
      // File doesn't exist yet
    }

    const { data } = await this.octokit.repos.createOrUpdateFileContents({
      owner,
      repo: name,
      path,
      message,
      content: Buffer.from(content).toString("base64"),
      sha: existingSha,
      ...(branch ? { branch } : {}),
    });

    return {
      sha: data.commit.sha ?? "",
      html_url: data.content?.html_url ?? "",
    };
  }
}
