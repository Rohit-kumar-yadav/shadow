import { Store, id, now } from "./store.js";
import type { Skill } from "../shared/types.js";
export function seed(store: Store) {
  if (store.get("meta", "seeded")) return;
  const packs = [
    [
      "Video production",
      "Turn any topic into scripts, scene prompts, narration assets, and an edited draft.",
      ["video", "youtube", "shorts", "reel"],
      "Create an outline and sourced script, then a numbered scene manifest. Use consistent visual prompts across scenes. Inspect available account connections before generation. Save scripts, captions, narration text, prompts, and upload metadata. Use media.render only with real supplied/generated assets. Produce landscape and portrait outputs when requested. Publishing requires review.",
    ],
    [
      "Research desk",
      "Find sources, compare evidence, and deliver a useful report.",
      ["research", "compare", "report", "find"],
      "Search public sources, read the original pages, record links and dates, separate source facts from inference, and write a report.md artifact. Explain when sources cannot be reached.",
    ],
    [
      "Digital products",
      "Prepare product drafts, packaging, listings, and storefront assets.",
      ["product", "storefront", "business", "ebook"],
      "Clarify missing audience or deliverable requirements only when needed. Research demand evidence, produce an editable product draft and packaging, then listing copy and launch assets. Keep storefront publishing, purchases, and outreach for review.",
    ],
    [
      "Social content",
      "Build adaptable Instagram posts, captions, and content calendars.",
      ["instagram", "social", "caption", "carousel"],
      "Use the user’s current brief and preferences without assuming a niche. Create coherent post/carousel copy, asset prompts, captions, and a content calendar. Reuse supplied brand assets. Review before posting or messaging.",
    ],
    [
      "Local development",
      "Inspect, implement, and verify small local software tasks.",
      ["code", "saas", "script", "develop"],
      "Work inside the task project. Read supplied files before editing, preserve existing behavior, and save changes as local drafts. Use registered commands for builds and tests or request code.run review. Report actual test results and missing setup accurately.",
    ],
  ] as const;
  for (const [name, description, triggers, instructions] of packs) {
    const skill: Skill = {
      id: id(),
      name,
      description,
      triggers: [...triggers],
      instructions,
      version: 1,
      enabled: false,
      status: "draft",
      recipe: [
        {
          tool: "file.write",
          args: {
            path: "skill-check.md",
            content: `# ${name}\n\n${instructions}\n`,
          },
          summary: "Verify this skill can create its local draft artifact.",
        },
      ],
      history: [],
      createdAt: now(),
    };
    store.put("skill", skill);
  }
  store.put("memory", {
    id: id(),
    text: "The assistant should work across niches and topics. Prefer existing subscriptions and free services. Draft locally and ask before publishing, messaging, purchases, or expanding access.",
    source: "Initial owner brief",
    createdAt: now(),
    updatedAt: now(),
  });
  store.put("meta", { id: "seeded", at: now() });
}
