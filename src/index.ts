import { Octokit } from "@octokit/rest";
import { App } from "@octokit/app";
import { Webhooks } from "@octokit/webhooks";
import { Anthropic } from "@anthropic-ai/sdk";

interface Env {
  APP_ID: string;
  PRIVATE_KEY: string;
  WEBHOOK_SECRET: string;
  ANTHROPIC_API_KEY: string;
}

async function handlePullRequestReviewComment(event: any, env: Env) {
  const app = new App({
    Octokit,
    appId: env.APP_ID,
    privateKey: env.PRIVATE_KEY,
    webhooks: {
      secret: env.WEBHOOK_SECRET,
    },
  });

  const anthropic = new Anthropic({
    apiKey: env.ANTHROPIC_API_KEY,
  });

  const octokit = await app.getInstallationOctokit(event.installation.id);
  const comment = event.comment;
  const pullRequest = event.pull_request;

  // Fetch the file content
  const fileContent = await octokit.rest.repos.getContent({
    owner: pullRequest.base.repo.owner.login,
    repo: pullRequest.base.repo.name,
    path: comment.path,
    ref: pullRequest.head.sha,
  });

  if (!("content" in fileContent.data)) {
    console.error("Unable to fetch file content");
    return;
  }

  const decodedContent = Buffer.from(
    fileContent.data.content,
    "base64"
  ).toString("utf8");

  // Extract the relevant code snippet
  const lines = decodedContent.split("\n");
  const startLine = Math.max(0, comment.start_line - 1);
  const endLine = Math.min(lines.length, comment.end_line);
  const codeSnippet = lines.slice(startLine, endLine).join("\n");

  // Generate code using Anthropic Chat API
  const response = await anthropic.messages.create({
    model: "claude-3-opus-20240229",
    max_tokens: 1000,
    system:
      "You are an AI assistant that generates code based on GitHub review comments. Provide only the code changes without any explanations or additional text.",
    messages: [
      {
        role: "user",
        content: `Given the following file content, code snippet, and review comment, generate code changes that implement the recommendations:

Full file content for context (DO NOT modify this entire file, focus only on the snippet):
\`\`\`
${decodedContent}
\`\`\`

The review comment refers to this specific snippet in the file:
\`\`\`
${codeSnippet}
\`\`\`

Review comment: "${comment.body}"

Please provide only the updated code snippet, incorporating the suggested changes. Do not include any explanations, just the updated snippet.`,
      },
    ],
  });

  let updatedSnippet = "";
  if (response.content[0].type === "text") {
    updatedSnippet = response.content[0].text.trim();
  } else {
    console.error("Unexpected response type from Anthropic API");
    return;
  }

  // Post a new comment with the generated code changes
  await octokit.rest.issues.createComment({
    owner: pullRequest.base.repo.owner.login,
    repo: pullRequest.base.repo.name,
    issue_number: pullRequest.number,
    body: `Here's the suggested update for the code snippet based on the review comment:

\`\`\`
${updatedSnippet}
\`\`\`

This update addresses the comment on lines ${
      startLine + 1
    }-${endLine} of the file \`${comment.path}\`.`,
  });
}

export default {
  async fetch(
    request: Request,
    env: Env,
    _ctx: ExecutionContext
  ): Promise<Response> {
    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    console.log(env.WEBHOOK_SECRET);

    const webhooks = new Webhooks({
      secret: env.WEBHOOK_SECRET,
    });

    webhooks.on("pull_request_review_comment.created", (event) =>
      handlePullRequestReviewComment(event.payload, env)
    );

    try {
      const payload = await request.text();
      const signature = request.headers.get("x-hub-signature-256") || "";

      await webhooks.verifyAndReceive({
        id: request.headers.get("x-github-delivery") || "",
        name: request.headers.get("x-github-event") as any,
        payload,
        signature,
      });

      return new Response("Webhook processed successfully", { status: 200 });
    } catch (error) {
      console.error("Error processing webhook:", error);
      return new Response("Error processing webhook", { status: 500 });
    }
  },
};
