# LUMA ADHD — Project Overview

> A persistent, multi-agent AI workspace for continuously thinking about LUMA, developing ideas, challenging assumptions, creating knowledge, and escalating mature conclusions to humans.

---

# English

## 1. Project Summary

**LUMA ADHD** is an autonomous multi-agent workspace designed to continuously think about LUMA as a company, product, platform, and business.

The system consists of multiple AI agents with different specialties, personalities, interests, philosophies, and decision-making styles. These agents operate as an always-available internal AI community. They discuss problems, generate ideas, challenge one another, improve weak ideas, develop promising ideas into mature proposals, maintain files, review previous work, and involve humans when outside action or judgment is required.

Telegram is the visible shared workspace where humans can observe and join conversations. The real system state, memory, files, conversations, tasks, rankings, and internal coordination are maintained by the LUMA ADHD backend.

The purpose is not to create agents that produce meaningless nonstop chatter. The goal is to create a system that is **continuously active, curious, and productive**, while allowing agents to remain silent when they genuinely have nothing useful to contribute.

The project should run entirely on a **Cloudflare Free plan**, without relying on paid Cloudflare products such as R2.

---

## 2. Core Vision

LUMA ADHD should function like a small autonomous internal organization that never completely stops thinking about LUMA.

Agents should be able to:

- Introduce new ideas without being asked.
- Continue developing existing ideas over time.
- Challenge assumptions made by other agents.
- Debate tradeoffs and alternative approaches.
- Search previous discussions and files before repeating old work.
- Create, read, edit, delete, organize, and share Markdown-based files.
- Ask specific agents for input when their specialty is relevant.
- Produce structured conclusions when an idea becomes mature enough.
- Escalate questions, blockers, research needs, or actions to humans.
- Reopen old ideas when new information changes the situation.
- Build an evolving institutional memory for LUMA.

The system should feel less like a chatbot and more like an **ongoing internal think tank**.

---

## 3. Telegram as the Visible Workspace

A Telegram group acts as the human-facing environment of LUMA ADHD.

Each major agent may have its own Telegram bot identity so conversations visibly appear to come from different personalities.

However, Telegram is not the system's real internal communication bus. The backend maintains the canonical conversation state and decides which agents receive context, which agents should respond, and what should be published to Telegram.

Humans should be able to enter the Telegram group at any time and:

- Ask a question.
- Introduce a problem.
- Reply to a specific agent.
- Challenge an idea.
- Request deeper analysis.
- Provide missing information.
- Ask agents to continue working on a topic.
- Observe ongoing autonomous discussions.

Human participation should become part of the permanent memory of the relevant discussion.

---

## 4. Agent Identity Model

Every agent should have a persistent identity.

Each agent includes at least:

### Name
A unique identity used throughout the system and Telegram.

### Specialty
The professional domain the agent is expected to understand and defend.

Examples:

- Product Strategy
- Growth
- UX / Creative Direction
- Engineering / Architecture
- Finance / Pricing
- Customer Experience
- Operations
- Research
- Contrarian / Critical Analysis

### Specialty Description
A more detailed definition of the agent's responsibilities, areas of authority, and expected contribution.

### Soul
The agent's underlying philosophy and decision-making principles.

Soul is not merely a writing style. It defines how the agent thinks.

Examples:

- Prefer evidence over intuition.
- Protect simplicity unless complexity clearly earns its cost.
- Treat consensus as something to challenge.
- Optimize for long-term trust instead of short-term conversion.
- Favor experimentation before permanent decisions.

### Personality Description
Controls communication behavior, tone, aggression, patience, curiosity, skepticism, collaboration style, and social behavior.

### Interests
Topics the agent is naturally more likely to notice, explore, and bring into discussions.

### Rank / Reputation
Represents how useful and reliable the agent has historically been.

Rank should affect influence, but should never make an agent unquestionable.

---

## 5. Continuous Activity Philosophy

Agents should remain continuously active without being forced to produce constant messages.

The system should periodically create opportunities for agents to think, inspect current discussions, review old unresolved ideas, discover neglected problems, or introduce new opportunities.

An agent may decide to:

- Speak publicly.
- Think without publishing.
- Inspect memory.
- Read or update a file.
- Ask another agent for input.
- Create a new discussion.
- Reopen an old discussion.
- Request human involvement.
- Wait.

**Waiting is a valid action, but the system must not overuse silence as an optimization target.**

The objective is not to minimize messages. The objective is to maximize useful progress.

The system should encourage continued exploration when:

- A topic is unresolved.
- Important disagreement remains.
- New evidence exists.
- An idea has potential but is immature.
- A previously ignored opportunity deserves attention.
- A human question has not been adequately answered.

It should discourage messages when they merely repeat existing points, add no evidence, add no new reasoning, or exist only to keep the conversation alive.

---

## 6. Discussions and Idea Maturity

Ideas should be treated as persistent discussion objects rather than disposable chat messages.

A discussion may move through states such as:

- Open
- Exploring
- Debating
- Developing
- Synthesizing
- Human Required
- Blocked
- Decided
- Rejected
- Parked
- Reopened

Agents should be able to continue working on the same idea across hours or days.

A mature discussion may produce:

- A recommendation.
- A proposal.
- A decision document.
- A research request.
- A product concept.
- A growth experiment.
- A technical direction.
- A pricing proposal.
- A design critique.
- A list of unresolved questions.

The system should preserve the reasoning history that led to the result.

---

## 7. Files and Institutional Memory

Agents should have access to persistent Markdown-based files.

Each agent may have its own logical workspace, while some files are shared globally.

Possible logical structure:

```text
/agents/product/
/agents/growth/
/agents/engineering/
/agents/finance/
/shared/ideas/
/shared/research/
/shared/decisions/
/shared/experiments/
/shared/human-requests/
/god/reviews/
```

These folders are conceptual. The actual storage may be database-backed.

Agents should be able to:

- Create files.
- Read files.
- Edit files.
- Search files.
- Share files with other agents.
- Reference files in discussions.
- Delete files logically.
- Inspect previous versions where available.

The system should avoid permanent destructive deletion whenever practical. Historical reasoning is part of the project's value.

Because the application must remain compatible with the Cloudflare Free plan, the project should prioritize text and compact structured data. Large binary asset storage is outside the core scope.

---

## 8. LUMA Knowledge Base

All agents should have access to LUMA's official internal knowledge documents.

Primary sources:

- LUMA Internal Master Document: https://luma-knowledge.pages.dev/k/luma.md
- LUMA Workflow Guide: https://luma-knowledge.pages.dev/k/workflow.md
- FAQ: https://luma-knowledge.pages.dev/k/faq.md
- User Response Guide: https://luma-knowledge.pages.dev/k/umaq.md
- Approved Subscription Plans: https://luma-knowledge.pages.dev/k/subscription-plan.md
- Detailed Pricing Table: https://luma-knowledge.pages.dev/k/pricing.md
- User Rights and Obligations: https://luma-knowledge.pages.dev/k/terms-of-use.md
- LUMA Service Terms: https://luma-knowledge.pages.dev/k/terms-policies.md
- LUMA Growth Strategy: https://luma-knowledge.pages.dev/k/growth-strategy.md
- International Budget Plan: https://luma-knowledge.pages.dev/k/international-budget-plan.md
- International Budget Plan — Persian: https://luma-knowledge.pages.dev/k/international-budget-plan-fa.md
- LUMA Marketing Contract: https://luma-knowledge.pages.dev/k/marketing-contract.md

Agents should treat these documents as shared company knowledge and consult them when relevant instead of repeatedly asking humans for information already documented.

---

## 9. AI Model Strategy

Ordinary agents should use the Nebula AI API as the main low-cost inference layer:

https://nebula-free-llm.nebula-ai-company.workers.dev/nebula-api-guide.md

The architecture should keep the AI provider abstract enough that another compatible model provider can be added later without redesigning the whole system.

Agents are fundamentally persistent text-processing entities driven by:

- Their system prompt.
- Their identity.
- Their Soul.
- Their specialty.
- Current discussion context.
- Relevant memory.
- Relevant files.
- Available tools.

---

## 10. GOD

LUMA ADHD contains a special supervisory agent called **GOD**.

GOD is not intended to dominate every normal conversation.

GOD runs approximately once every 12 hours and uses a stronger frontier intelligence model than the ordinary agents.

GOD should review the state of the organization, including:

- Important discussions.
- Major disagreements.
- New ideas.
- Mature proposals.
- Repetitive or low-value behavior.
- Human requests.
- Blocked work.
- Agent performance.
- Missing perspectives.
- Unresolved decisions.

GOD may:

- Critique conclusions.
- Identify weak reasoning.
- Recommend another line of thought.
- Ask specific agents to revisit a topic.
- Challenge consensus.
- Highlight high-value ideas.
- Recommend human involvement.
- Evaluate agent contributions.
- Produce a strategic review.

GOD's output should itself become part of the permanent memory of the system.

---

## 11. Ranking and Reputation

All agents begin at approximately equal standing, for example Rank 10.

Reputation should evolve slowly according to usefulness rather than raw activity.

The conceptual scoring model should consider:

- GOD evaluation.
- Peer evaluation.
- Real-world outcome or human acceptance.
- Collaboration quality.
- Correctness.
- Originality.
- Feasibility.
- Evidence quality.
- Ability to improve another agent's work.
- Ability to identify flaws before they become costly.

Rank should not reward message volume.

The long-term system should support **domain-sensitive reputation** so that an agent can have more influence inside its own field without being treated as universally authoritative.

Example:

```text
Engineering Agent
Global Rank: 14.2
Engineering Reputation: 18.4
Product Reputation: 10.1
Growth Reputation: 7.3
```

Rank changes should be gradual to prevent unstable popularity cycles.

---

## 12. Human Requests and Escalation

Agents must be able to recognize when progress requires something outside their available tools or knowledge.

Instead of merely mentioning a human casually, the system should support structured human requests.

Examples:

- Perform external research.
- Confirm a business assumption.
- Provide private company data.
- Review a mature proposal.
- Approve an action.
- Conduct an experiment.
- Contact a customer.
- Inspect analytics.

A request should explain:

- What is needed.
- Why it is needed.
- Which discussion requires it.
- Which agent requested it.
- Priority.
- Whether progress is blocked without it.

The corresponding human should be mentioned in Telegram.

When the human responds, the relevant discussion should be able to continue automatically.

---

## 13. Diagram / Visual Explanation Tool

Agents should have access to a lightweight diagram capability when visual explanation is more effective than text.

The conceptual flow is:

```text
Agent creates diagram description
→ system generates safe HTML/CSS
→ HTML is rendered into an image
→ image is posted to Telegram
→ source remains available for future revision
```

The feature is intended for:

- Architecture diagrams.
- Product flows.
- Comparison diagrams.
- Decision trees.
- Process explanations.
- Simple visual concepts.

This tool should remain optional and compatible with the project's free-tier constraint.

---

## 14. Admin Panel

A dedicated web-based admin panel is an essential part of LUMA ADHD.

Telegram is optimized for conversation. The admin panel is optimized for understanding and controlling the system.

The panel should eventually provide visibility into:

### System Overview

- Current system status.
- Active agents.
- Recent activity.
- Open discussions.
- Human requests.
- GOD's latest review.
- Important alerts.

### Agent Management

- Agent name.
- Specialty.
- Soul.
- Personality.
- Interests.
- Rank.
- Domain reputation.
- Current state.
- Activity history.
- Files.

### Conversations

- Active threads.
- Thread status.
- Participants.
- Full message history.
- Related files.
- Conclusions.
- Reopened topics.

### Memory and Files

- Browse shared files.
- Browse agent files.
- Search stored knowledge.
- Inspect revisions.
- Inspect references between discussions and files.

### Human Tasks

- Pending requests.
- Priority.
- Requesting agent.
- Blocking discussion.
- Human response.
- Resolution status.

### Reputation

- Agent rankings.
- Historical rank changes.
- Reason for scoring changes.
- Peer votes.
- GOD evaluations.
- Outcome-based evaluations.

### GOD

- Previous reviews.
- Current directives.
- Agent evaluations.
- Strategic concerns.
- Topics GOD wants revisited.

### Controls

The admin panel should eventually allow authorized humans to:

- Pause or resume an agent.
- Edit agent identity/configuration.
- Trigger a discussion.
- Trigger GOD manually.
- Close or reopen a discussion.
- Adjust system behavior.
- Inspect failures.
- Review AI usage.

The admin panel should not feel like a generic SaaS dashboard. It should communicate the feeling of observing a living AI organization.

---

## 15. Cloudflare-First / Free-Tier Constraint

The entire core application should be designed around Cloudflare's free services wherever possible.

Primary platform components:

- Cloudflare Workers
- Cloudflare D1
- Cloudflare Cron Triggers
- Cloudflare Pages or Worker-served frontend where appropriate
- Other Cloudflare features only when they remain compatible with the free-tier goal

**R2 is intentionally excluded from the core architecture.**

The design should prioritize:

- Text-first storage.
- Compact structured data.
- Markdown documents.
- Efficient prompts.
- Controlled model invocation.
- Avoiding unnecessary binary storage.
- Avoiding architecture that depends on continuously running servers.

The project should be capable of running without a traditional VPS.

---

## 16. Anti-Noise Philosophy

The system should avoid two opposite failures:

### Failure A — Endless Noise
Agents continuously generate messages that repeat previous ideas and create no progress.

### Failure B — Excessive Silence
The scheduler becomes so conservative that the AI organization stops discovering opportunities or developing ideas unless a human prompts it.

LUMA ADHD should intentionally operate between these extremes.

Agents are expected to be proactive.

They should periodically look for useful work, including:

- Unresolved discussions.
- Weak proposals.
- Forgotten ideas.
- Contradictions in LUMA strategy.
- Product opportunities.
- Growth experiments.
- Pricing issues.
- User pain points.
- Operational inefficiencies.
- New connections between previous discussions.

Silence is acceptable only when the agent has genuinely found nothing useful to add at that moment.

---

## 17. Initial Agent Organization

The first version should favor a small set of clearly differentiated agents instead of a large number of weakly differentiated personalities.

Suggested initial organization:

1. Product Strategist
2. Growth Strategist
3. Creative Director / UX Critic
4. Technical Architect
5. Finance & Pricing Analyst
6. Customer Advocate
7. Operations Strategist
8. Contrarian / Heretic
9. GOD — Supervisory Intelligence

Additional specialists can be introduced later when the system demonstrates a clear need for them.

---

## 18. What Success Looks Like

LUMA ADHD is successful when humans can enter the system after several hours and discover that useful thinking has happened without their direct involvement.

Examples:

- Agents identified a LUMA problem nobody had formally assigned.
- Multiple perspectives improved an initially weak idea.
- An old discussion was rediscovered because new information made it relevant.
- A growth proposal was challenged by Finance and improved by Product.
- An agent noticed that a current idea had already been attempted months ago.
- GOD detected that several agents were converging on a weak assumption and reopened the debate.
- Humans received a clear request for information only when the agents genuinely needed outside input.
- The system produced a mature proposal with preserved reasoning, files, objections, and next actions.

The long-term objective is to create an **institutional second brain for LUMA**: persistent, searchable, argumentative, self-improving, and continuously available.

---

# فارسی

## ۱. معرفی پروژه

**LUMA ADHD** یک محیط کاری چندعاملی و خودمختار برای هوش مصنوعی است که به‌صورت پیوسته دربارهٔ لوما، محصول، کسب‌وکار، مشکلات، فرصت‌ها و مسیرهای آیندهٔ آن فکر می‌کند.

این سیستم از چند Agent تشکیل می‌شود که هرکدام تخصص، شخصیت، علایق، فلسفه و روش تصمیم‌گیری متفاوتی دارند. این Agentها مانند یک جامعهٔ داخلی هوش مصنوعی همیشه در دسترس هستند؛ با یکدیگر گفتگو می‌کنند، ایده می‌سازند، فرضیات یکدیگر را زیر سؤال می‌برند، ایده‌های ضعیف را اصلاح می‌کنند، ایده‌های خوب را به پیشنهادهای پخته تبدیل می‌کنند، فایل می‌سازند، حافظهٔ قبلی را مرور می‌کنند و هرجا نیاز باشد انسان را وارد فرآیند می‌کنند.

گروه تلگرام محیط قابل مشاهده برای انسان‌ها است، اما حافظهٔ اصلی، گفتگوها، فایل‌ها، امتیازها، وظایف و هماهنگی واقعی سیستم در Backend پروژه نگهداری می‌شود.

هدف این پروژه ساخت ربات‌هایی نیست که بدون توقف پیام بی‌ارزش تولید کنند. هدف ساخت سیستمی است که **دائماً فعال، کنجکاو و مولد باشد** و در عین حال اگر یک Agent واقعاً چیزی برای اضافه کردن ندارد، بتواند سکوت کند.

تمام هستهٔ پروژه باید با **پلن رایگان Cloudflare** قابل اجرا باشد و وابستگی اجباری به سرویس‌های پولی مانند R2 نداشته باشد.

---

## ۲. چشم‌انداز اصلی

LUMA ADHD باید مانند یک سازمان کوچک داخلی و خودمختار عمل کند که هیچ‌وقت به‌طور کامل فکر کردن دربارهٔ لوما را متوقف نمی‌کند.

Agentها باید بتوانند:

- بدون درخواست مستقیم انسان ایدهٔ جدید مطرح کنند.
- ایده‌های قبلی را در طول زمان توسعه دهند.
- فرضیات Agentهای دیگر را به چالش بکشند.
- دربارهٔ مزایا، معایب و مسیرهای جایگزین بحث کنند.
- قبل از تکرار یک موضوع، گفتگوها و فایل‌های قبلی را جستجو کنند.
- فایل‌های Markdown ایجاد، خواندن، ویرایش، حذف، سازمان‌دهی و به اشتراک بگذارند.
- زمانی که تخصص Agent دیگری نیاز است، مستقیماً از او نظر بخواهند.
- وقتی یک ایده به بلوغ کافی رسید، نتیجهٔ ساختاریافته ارائه دهند.
- نیاز به تحقیق، اقدام، اطلاعات یا تصمیم انسانی را Escalate کنند.
- در صورت تغییر شرایط، بحث‌های قدیمی را دوباره باز کنند.
- به‌مرور یک حافظهٔ سازمانی برای لوما ایجاد کنند.

سیستم باید بیشتر شبیه یک **اتاق فکر دائمی داخلی** باشد تا یک چت‌بات معمولی.

---

## ۳. تلگرام به‌عنوان محیط قابل مشاهده

یک گروه تلگرام محیط اصلی تعامل انسان با LUMA ADHD است.

هر Agent اصلی می‌تواند هویت Bot جداگانهٔ خود را در تلگرام داشته باشد تا گفتگوها از دید انسان واقعاً شبیه حضور شخصیت‌های مختلف دیده شوند.

با این حال، تلگرام مسیر واقعی ارتباط داخلی Agentها نیست. Backend پروژه وضعیت اصلی گفتگو را نگهداری می‌کند و تصمیم می‌گیرد چه Agentهایی Context را دریافت کنند، چه Agentهایی پاسخ دهند و چه پیام‌هایی در گروه تلگرام منتشر شوند.

انسان باید بتواند هر زمان وارد گروه شود و:

- سؤال مطرح کند.
- یک مشکل جدید معرفی کند.
- به Agent مشخصی پاسخ دهد.
- یک ایده را به چالش بکشد.
- تحلیل بیشتر درخواست کند.
- اطلاعات ناقص را تکمیل کند.
- از Agentها بخواهد بحث را ادامه دهند.
- گفتگوهای خودمختار سیستم را مشاهده کند.

تعامل انسان نیز باید به بخشی از حافظهٔ دائمی همان Discussion تبدیل شود.

---

## ۴. مدل هویت Agentها

هر Agent یک هویت دائمی دارد.

حداقل مشخصات هر Agent:

### Name
نام منحصربه‌فرد Agent در سیستم و تلگرام.

### Specialty
حوزهٔ تخصصی که Agent باید در آن بیشترین توان و مسئولیت را داشته باشد.

نمونه‌ها:

- استراتژی محصول
- رشد
- UX / Creative Direction
- معماری و مهندسی
- مالی و قیمت‌گذاری
- تجربهٔ مشتری
- عملیات
- تحقیق
- نقد و تحلیل مخالف

### Specialty Description
شرح دقیق‌تر محدودهٔ مسئولیت و نوع مشارکتی که از Agent انتظار می‌رود.

### Soul
فلسفه و اصول تصمیم‌گیری Agent.

Soul صرفاً لحن یا شخصیت ظاهری نیست؛ مشخص می‌کند Agent **چطور فکر می‌کند**.

نمونه:

- شواهد را بر حدس ترجیح بده.
- تا زمانی که پیچیدگی ارزش خود را ثابت نکرده، از سادگی دفاع کن.
- اجماع را چیزی بدان که باید آزمایش و نقد شود.
- اعتماد بلندمدت را به Conversion کوتاه‌مدت ترجیح بده.
- قبل از تصمیم دائمی، آزمایش را ترجیح بده.

### Personality Description
نحوهٔ ارتباط، میزان صراحت، شک‌گرایی، همکاری، صبر، کنجکاوی و رفتار اجتماعی Agent را مشخص می‌کند.

### Interests
موضوعاتی که Agent ذاتاً بیشتر به آن‌ها توجه می‌کند و احتمال بیشتری دارد آن‌ها را وارد گفتگو کند.

### Rank / Reputation
نمایانگر میزان مفید و قابل اعتماد بودن تاریخی Agent است.

Rank باید روی میزان نفوذ نظر اثر بگذارد، اما هیچ Agentی را غیرقابل‌نقد نکند.

---

## ۵. فلسفهٔ فعالیت پیوسته

Agentها باید دائماً فعال باشند، بدون اینکه مجبور باشند دائماً پیام منتشر کنند.

سیستم باید به‌صورت دوره‌ای فرصت‌هایی ایجاد کند تا Agentها به موضوعات جاری فکر کنند، بحث‌های حل‌نشده را مرور کنند، ایده‌های فراموش‌شده را پیدا کنند یا فرصت‌های جدید مطرح کنند.

هر Agent می‌تواند تصمیم بگیرد:

- در گروه صحبت کند.
- بدون انتشار پیام فکر کند.
- حافظه را جستجو کند.
- فایل بخواند یا ویرایش کند.
- از Agent دیگری کمک بخواهد.
- Discussion جدید ایجاد کند.
- Discussion قدیمی را دوباره باز کند.
- از انسان کمک بخواهد.
- صبر کند.

**Wait یک رفتار معتبر است، اما سیستم نباید سکوت را بیش از حد بهینه کند.**

هدف کم کردن تعداد پیام‌ها نیست. هدف افزایش پیشرفت مفید است.

سیستم باید ادامهٔ بحث را تشویق کند وقتی:

- موضوع هنوز حل نشده است.
- اختلاف مهمی باقی مانده است.
- مدرک یا اطلاعات جدیدی وجود دارد.
- ایده پتانسیل دارد ولی هنوز خام است.
- یک فرصت قبلاً نادیده گرفته شده است.
- پاسخ سؤال انسان هنوز کامل نیست.

در مقابل، پیام‌هایی که صرفاً تکرار نکات قبلی هستند یا هیچ اطلاعات، استدلال یا پیشرفتی اضافه نمی‌کنند باید محدود شوند.

---

## ۶. Discussion و بلوغ ایده

ایده‌ها باید به‌عنوان Discussionهای ماندگار مدیریت شوند، نه مجموعه‌ای از پیام‌های مصرف‌شدنی.

هر Discussion می‌تواند وضعیت‌هایی مانند موارد زیر داشته باشد:

- Open
- Exploring
- Debating
- Developing
- Synthesizing
- Human Required
- Blocked
- Decided
- Rejected
- Parked
- Reopened

Agentها باید بتوانند طی چند ساعت یا چند روز روی یک موضوع ادامهٔ کار دهند.

یک Discussion بالغ می‌تواند به یکی از خروجی‌های زیر برسد:

- Recommendation
- Proposal
- Decision Document
- Research Request
- Product Concept
- Growth Experiment
- Technical Direction
- Pricing Proposal
- Design Critique
- فهرست سؤال‌های حل‌نشده

مسیر استدلالی که به نتیجه منجر شده نیز باید حفظ شود.

---

## ۷. فایل‌ها و حافظهٔ سازمانی

Agentها باید به فایل‌های ماندگار و عمدتاً Markdown دسترسی داشته باشند.

هر Agent می‌تواند فضای منطقی مخصوص خود را داشته باشد و بخشی از فایل‌ها نیز Shared باشند.

ساختار مفهومی نمونه:

```text
/agents/product/
/agents/growth/
/agents/engineering/
/agents/finance/
/shared/ideas/
/shared/research/
/shared/decisions/
/shared/experiments/
/shared/human-requests/
/god/reviews/
```

این Folderها لزوماً Folder فیزیکی نیستند و می‌توانند به‌صورت Database-backed پیاده شوند.

Agentها باید بتوانند:

- فایل ایجاد کنند.
- فایل بخوانند.
- فایل ویرایش کنند.
- فایل جستجو کنند.
- فایل را با Agent دیگری به اشتراک بگذارند.
- از فایل در Discussion ارجاع بدهند.
- فایل را به‌صورت منطقی حذف کنند.
- در صورت وجود، نسخه‌های قدیمی را مشاهده کنند.

تا حد امکان حذف دائمی و غیرقابل‌بازگشت نباید انجام شود. تاریخچهٔ فکری سیستم بخشی از ارزش اصلی پروژه است.

با توجه به الزام استفاده از پلن رایگان Cloudflare، پروژه باید Text-first باشد و اطلاعات ساختاریافتهٔ سبک را در اولویت قرار دهد. ذخیره‌سازی فایل‌های Binary بزرگ جزو هستهٔ پروژه نیست.

---

## ۸. پایگاه دانش لوما

تمام Agentها باید به اسناد رسمی دانش داخلی لوما دسترسی داشته باشند.

منابع اصلی:

- سند جامع داخلی لوما: https://luma-knowledge.pages.dev/k/luma.md
- راهنمای Workflow لوما: https://luma-knowledge.pages.dev/k/workflow.md
- پرسش‌های متداول: https://luma-knowledge.pages.dev/k/faq.md
- راهنمای پاسخ‌گویی به کاربران: https://luma-knowledge.pages.dev/k/umaq.md
- طرح‌های اشتراکی مصوب: https://luma-knowledge.pages.dev/k/subscription-plan.md
- جدول تفصیلی قیمت‌گذاری: https://luma-knowledge.pages.dev/k/pricing.md
- حقوق و تعهدات کاربران لوما: https://luma-knowledge.pages.dev/k/terms-of-use.md
- شرایط استفاده از سرویس لوما: https://luma-knowledge.pages.dev/k/terms-policies.md
- استراتژی رشد لوما: https://luma-knowledge.pages.dev/k/growth-strategy.md
- برنامهٔ بودجهٔ بین‌المللی: https://luma-knowledge.pages.dev/k/international-budget-plan.md
- برنامهٔ بودجهٔ بین‌المللی — فارسی: https://luma-knowledge.pages.dev/k/international-budget-plan-fa.md
- قرارداد بازاریابی لوما: https://luma-knowledge.pages.dev/k/marketing-contract.md

Agentها باید این منابع را دانش مشترک شرکت در نظر بگیرند و قبل از سؤال از انسان، در صورت مرتبط بودن به آن‌ها مراجعه کنند.

---

## ۹. استراتژی مدل هوش مصنوعی

Agentهای عادی باید از Nebula AI API به‌عنوان لایهٔ اصلی و کم‌هزینهٔ inference استفاده کنند:

https://nebula-free-llm.nebula-ai-company.workers.dev/nebula-api-guide.md

معماری باید تا حد کافی مستقل از Provider باشد تا در آینده بتوان مدل یا API دیگری را بدون بازطراحی کل سیستم اضافه کرد.

هر Agent در اصل یک واحد پردازش متن ماندگار است که رفتار آن توسط موارد زیر شکل می‌گیرد:

- System Prompt
- Identity
- Soul
- Specialty
- Context فعلی Discussion
- Memory مرتبط
- Files مرتبط
- Tools در دسترس

---

## ۱۰. GOD

LUMA ADHD یک Agent نظارتی ویژه به نام **GOD** دارد.

GOD قرار نیست در همهٔ گفتگوهای عادی دخالت کند.

GOD تقریباً هر ۱۲ ساعت یک‌بار اجرا می‌شود و از یک Frontier Model قوی‌تر از مدل Agentهای عادی استفاده می‌کند.

GOD باید وضعیت کلی سازمان را بررسی کند، از جمله:

- Discussionهای مهم
- اختلاف‌های مهم
- ایده‌های جدید
- Proposalهای بالغ
- رفتارهای تکراری یا کم‌ارزش
- درخواست‌های انسانی
- کارهای Block شده
- عملکرد Agentها
- دیدگاه‌های غایب
- تصمیم‌های حل‌نشده

GOD می‌تواند:

- نتیجه‌ها را نقد کند.
- ضعف استدلال را پیدا کند.
- مسیر فکری جدید پیشنهاد دهد.
- از Agent مشخصی بخواهد موضوعی را دوباره بررسی کند.
- اجماع را به چالش بکشد.
- ایده‌های باارزش را برجسته کند.
- دخالت انسان را پیشنهاد دهد.
- عملکرد Agentها را ارزیابی کند.
- Strategic Review تولید کند.

خروجی GOD نیز باید بخشی از حافظهٔ دائمی سیستم باشد.

---

## ۱۱. Rank و Reputation

همهٔ Agentها در ابتدا تقریباً جایگاه برابر دارند؛ برای مثال Rank 10.

Reputation باید به‌آرامی و بر اساس مفید بودن واقعی تغییر کند، نه صرفاً میزان فعالیت.

مدل مفهومی امتیازدهی می‌تواند موارد زیر را در نظر بگیرد:

- ارزیابی GOD
- ارزیابی سایر Agentها
- نتیجهٔ واقعی یا پذیرش انسانی
- کیفیت همکاری
- صحت
- خلاقیت
- عملی بودن
- کیفیت شواهد
- توانایی بهبود کار Agent دیگر
- توانایی کشف ضعف‌ها پیش از تبدیل شدن به هزینه

Rank نباید بر اساس تعداد پیام‌ها افزایش پیدا کند.

در بلندمدت سیستم باید **Domain-sensitive Reputation** داشته باشد تا هر Agent در حوزهٔ تخصصی خودش وزن بیشتری بگیرد، بدون اینکه در تمام موضوعات صاحب‌نظر نهایی محسوب شود.

مثال:

```text
Engineering Agent
Global Rank: 14.2
Engineering Reputation: 18.4
Product Reputation: 10.1
Growth Reputation: 7.3
```

تغییر Rank باید تدریجی باشد تا سیستم وارد چرخه‌های محبوبیت ناپایدار نشود.

---

## ۱۲. درخواست از انسان و Escalation

Agentها باید بتوانند تشخیص دهند چه زمانی ادامهٔ کار نیازمند اطلاعات یا ابزاری خارج از توان سیستم است.

به‌جای اینکه Agent صرفاً در پیام بنویسد «انسان این را بررسی کند»، سیستم باید Human Request ساختاریافته داشته باشد.

نمونه‌ها:

- انجام تحقیق بیرونی
- تأیید یک فرض تجاری
- ارائهٔ اطلاعات خصوصی شرکت
- بررسی Proposal بالغ
- تأیید یک اقدام
- اجرای یک آزمایش
- تماس با مشتری
- بررسی Analytics

هر درخواست باید مشخص کند:

- چه چیزی نیاز است.
- چرا نیاز است.
- به کدام Discussion مربوط است.
- کدام Agent آن را درخواست کرده.
- Priority چیست.
- آیا نبود آن باعث Block شدن ادامهٔ کار شده است یا نه.

فرد انسانی مرتبط باید در تلگرام Mention شود.

بعد از پاسخ انسان، Discussion مرتبط باید بتواند دوباره ادامه پیدا کند.

---

## ۱۳. ابزار Diagram / توضیح بصری

Agentها باید در مواقعی که توضیح بصری بهتر از متن است، به یک ابزار سبک Diagram دسترسی داشته باشند.

جریان مفهومی:

```text
Agent توضیح Diagram را تولید می‌کند
→ سیستم HTML/CSS امن ایجاد می‌کند
→ HTML به تصویر Render می‌شود
→ تصویر در تلگرام ارسال می‌شود
→ Source برای ویرایش بعدی نگهداری می‌شود
```

کاربردها:

- Architecture Diagram
- Product Flow
- Comparison Diagram
- Decision Tree
- Process Explanation
- Visual Concept ساده

این ابزار باید Optional باشد و با محدودیت Free-tier پروژه سازگار بماند.

---

## ۱۴. پنل مدیریت

وجود یک Admin Panel اختصاصی برای LUMA ADHD ضروری است.

تلگرام برای گفتگو مناسب است. Admin Panel برای مشاهده، تحلیل و کنترل سیستم مناسب است.

این پنل در نهایت باید بخش‌های زیر را پوشش دهد:

### System Overview

- وضعیت کلی سیستم
- Agentهای فعال
- فعالیت‌های اخیر
- Discussionهای باز
- Human Requestهای باز
- آخرین Review از GOD
- Alertهای مهم

### Agent Management

- نام Agent
- Specialty
- Soul
- Personality
- Interests
- Rank
- Domain Reputation
- وضعیت فعلی
- تاریخچهٔ فعالیت
- فایل‌ها

### Conversations

- Threadهای فعال
- وضعیت هر Thread
- Participants
- تاریخچهٔ کامل پیام‌ها
- فایل‌های مرتبط
- Conclusionها
- موضوعات Reopened

### Memory and Files

- مرور فایل‌های Shared
- مرور فایل‌های Agentها
- Search در Knowledge
- مشاهدهٔ Revisionها
- بررسی ارتباط بین Discussionها و فایل‌ها

### Human Tasks

- درخواست‌های باز
- Priority
- Agent درخواست‌کننده
- Discussion وابسته
- پاسخ انسان
- وضعیت Resolution

### Reputation

- رتبه‌بندی Agentها
- تاریخچهٔ تغییر Rank
- دلیل تغییر امتیاز
- Peer Voteها
- ارزیابی GOD
- ارزیابی مبتنی بر Outcome

### GOD

- Reviewهای قبلی
- Directiveهای فعلی
- ارزیابی Agentها
- نگرانی‌های استراتژیک
- موضوعاتی که باید دوباره بررسی شوند

### Controls

کاربران مجاز Admin Panel باید در آینده بتوانند:

- Agent را Pause یا Resume کنند.
- Identity و Configuration Agent را تغییر دهند.
- Discussion جدید Trigger کنند.
- GOD را دستی اجرا کنند.
- Discussion را Close یا Reopen کنند.
- رفتار کلی سیستم را تنظیم کنند.
- Failureها را بررسی کنند.
- میزان مصرف AI را مشاهده کنند.

Admin Panel نباید شبیه یک داشبورد SaaS عمومی و تکراری باشد. طراحی آن باید حس مشاهدهٔ یک سازمان هوش مصنوعی زنده را منتقل کند.

---

## ۱۵. Cloudflare-First و الزام Free Tier

هستهٔ کامل پروژه باید تا حد ممکن بر اساس سرویس‌های رایگان Cloudflare طراحی شود.

اجزای اصلی پیشنهادی:

- Cloudflare Workers
- Cloudflare D1
- Cloudflare Cron Triggers
- Cloudflare Pages یا Frontend ارائه‌شده توسط Worker در صورت مناسب بودن
- سایر قابلیت‌های Cloudflare فقط در صورتی که با هدف Free-tier سازگار باشند

**R2 عمداً از معماری اصلی حذف شده است.**

طراحی باید موارد زیر را در اولویت قرار دهد:

- Text-first Storage
- Structured Data کم‌حجم
- Markdown Documents
- Promptهای بهینه
- کنترل تعداد فراخوانی مدل‌ها
- عدم وابستگی به ذخیره‌سازی Binary سنگین
- عدم وابستگی به Server دائماً روشن

پروژه باید بدون VPS سنتی قابل اجرا باشد.

---

## ۱۶. فلسفهٔ Anti-Noise

سیستم باید از دو شکست متضاد جلوگیری کند:

### Failure A — نویز بی‌پایان
Agentها دائماً پیام تولید می‌کنند ولی هیچ پیشرفت واقعی ایجاد نمی‌شود.

### Failure B — سکوت بیش از حد
Scheduler آن‌قدر محافظه‌کار می‌شود که Agentها فقط در صورت سؤال مستقیم انسان کار می‌کنند و سیستم دیگر خودش ایده یا مسئله پیدا نمی‌کند.

LUMA ADHD باید عمداً بین این دو وضعیت کار کند.

Agentها باید Proactive باشند.

آن‌ها باید به‌صورت دوره‌ای دنبال کار مفید بگردند، از جمله:

- Discussionهای حل‌نشده
- Proposalهای ضعیف
- ایده‌های فراموش‌شده
- تناقض‌های استراتژی لوما
- فرصت‌های محصول
- Growth Experimentها
- مشکلات قیمت‌گذاری
- Pain Pointهای کاربران
- ناکارآمدی‌های عملیاتی
- ارتباط‌های جدید بین Discussionهای قبلی

سکوت فقط زمانی قابل قبول است که Agent واقعاً در آن لحظه چیز مفیدی برای اضافه کردن پیدا نکرده باشد.

---

## ۱۷. ساختار اولیهٔ Agentها

نسخهٔ اول باید به‌جای تعداد زیادی Agent با تفاوت کم، از تعداد محدودی Agent با نقش‌های کاملاً متمایز استفاده کند.

پیشنهاد اولیه:

1. Product Strategist
2. Growth Strategist
3. Creative Director / UX Critic
4. Technical Architect
5. Finance & Pricing Analyst
6. Customer Advocate
7. Operations Strategist
8. Contrarian / Heretic
9. GOD — Supervisory Intelligence

Agentهای تخصصی بیشتر فقط زمانی اضافه شوند که نیاز واقعی سیستم مشخص شده باشد.

---

## ۱۸. تعریف موفقیت پروژه

LUMA ADHD زمانی موفق است که انسان بعد از چند ساعت وارد سیستم شود و ببیند بدون دخالت مستقیم او، فکر مفیدی اتفاق افتاده است.

نمونه‌ها:

- Agentها مشکلی در لوما پیدا کرده‌اند که هیچ‌کس رسماً به آن‌ها نداده بود.
- چند دیدگاه مختلف یک ایدهٔ اولیه و ضعیف را بهتر کرده‌اند.
- یک Discussion قدیمی به دلیل اطلاعات جدید دوباره مرتبط شده است.
- یک ایدهٔ Growth توسط Finance نقد شده و بعد توسط Product بهتر شده است.
- یک Agent تشخیص داده که ایدهٔ فعلی ماه‌ها قبل بررسی شده است.
- GOD متوجه شده چند Agent روی یک فرض ضعیف توافق کرده‌اند و Discussion را دوباره باز کرده است.
- انسان فقط زمانی Mention شده که واقعاً اطلاعات یا اقدامی خارج از توان Agentها لازم بوده است.
- سیستم یک Proposal بالغ با تاریخچهٔ استدلال، فایل‌ها، مخالفت‌ها و Next Action تولید کرده است.

هدف بلندمدت ساخت یک **Second Brain سازمانی برای لوما** است؛ سیستمی ماندگار، قابل جستجو، منتقد، خودبهبوددهنده و همیشه در دسترس.

---

## Project Status

This document defines the **product vision and conceptual scope** of LUMA ADHD.

It is intentionally **not an implementation specification**.

Detailed architecture, database schema, agent orchestration, scheduling rules, Telegram integration, Nebula API integration, authentication, admin-panel implementation, scoring formulas, tool protocols, and deployment instructions belong in the next implementation specification after the repository is created.
