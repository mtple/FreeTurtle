import { SENSITIVE_PATTERNS } from "../redaction.js";
import type { LLMClient } from "../llm.js";

/**
 * Scan text for sensitive patterns (API keys, tokens, etc).
 * Returns an array of match descriptions.
 */
export function scanForSecrets(text: string): string[] {
  const matches: string[] = [];
  for (const pattern of SENSITIVE_PATTERNS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const val = match[0];
      matches.push(`Possible secret: ${val.slice(0, 6)}***`);
    }
  }
  return matches;
}

/**
 * Redact sensitive patterns in text, replacing with first 4 chars + ***.
 */
export function redactSecrets(text: string): string {
  let result = text;
  for (const pattern of SENSITIVE_PATTERNS) {
    pattern.lastIndex = 0;
    result = result.replace(pattern, (m) => `${m.slice(0, 4)}***`);
  }
  return result;
}

/**
 * Condense founder-provided business context into a rich soul.md via a single LLM call.
 */
export async function condenseDocs(
  businessContext: string,
  identity: { ceoName: string; projectName: string; description: string; founderName: string; voice: string },
  llm: LLMClient,
  contracts?: { name: string; address: string }[]
): Promise<string> {
  const systemPrompt = `You are helping set up an AI CEO agent. Condense the founder's business context into a structured identity file.
Be specific — extract real names, numbers, details. Don't be generic.
Only output the markdown sections below, nothing else.`;

  let userContent = `The CEO's name is ${identity.ceoName}. It runs ${identity.projectName}. The founder is ${identity.founderName}.
Project description: ${identity.description}
Voice style: ${identity.voice}.

Here is the founder's business context:

${businessContext}
${contracts && contracts.length > 0 ? `\nSmart contracts on Base:\n${contracts.map((c) => `- ${c.name}: ${c.address}`).join("\n")}\n` : ""}
Produce these markdown sections:

## Identity
[2-3 sentences: who the CEO is, what makes the project distinctive]

## Voice
[3-5 bullet points for communication style, consistent with the voice style above]

## Knowledge
[Key facts, metrics, context from the business context. Use sub-headers if needed.]

## Goals
[3-7 specific goals extracted from the business context]

## Values & Boundaries
[3-5 real values/constraints from the context, plus "Escalate to the founder when unsure"]

## Founder
[1-2 sentences about the founder]`;

  const response = await llm.chat(systemPrompt, [
    { role: "user", content: userContent },
  ]);

  return `# ${identity.ceoName}\n\n${response.text}`;
}
