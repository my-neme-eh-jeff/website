/**
 * Every fact the pages render. The shell's model is told all of it too
 * (chat.ts), so everything here is public, to crawlers included.
 *
 * Two things stay out. A phone number: once scraped it can't be taken back,
 * where an email can be changed. And employer internals: incident, customer
 * and user counts, automation rates, savings, which model vendors a platform
 * uses, tool version numbers, cloud identifiers. Keep the engineering and the
 * order of magnitude; drop the internal figures.
 */

export const profile = {
  name: "Aman Nambisan",

  /** The meta description, og:description and Person.description. 120–160 chars. */
  tagline:
    "Platform engineer at Atlan. I build the Kubernetes and Terraform machinery that provisions enterprise infrastructure, and the agents that operate it.",

  /** The home page's h1, in the shell's title bar: "<name>, <headline> at <employer>". */
  headline: "AI Builder",

  /** The first line the shell prints. */
  motd: "I build infrastructure, and my desktop at home will tell you about me.",

  bio: "I work on internal platform and infrastructure at Atlan — Kubernetes, Terraform, Crossplane, Temporal — making provisioning reliable enough that nobody has to think about it. Lately most of my time goes to agentic tooling: MCP servers, upgrade agents, and the plumbing that lets a model touch production safely. Outside work I build MLOps systems, like a GPU-aware autoscaler for vLLM and a training loop that promotes its own models.",

  /**
   * Word for word the title on LinkedIn and GitHub: a different title on each
   * blurs whether they are one person.
   */
  jobTitle: "Software Engineer II",

  city: "Bangalore",

  email: "aman2003nambisan@gmail.com",

  /**
   * Read or downloaded as a PDF on FlowCV. It shows his phone number, which
   * he chose to link anyway (2026-10-17).
   */
  resume: "https://flowcv.com/resume/1j98lweerbqr",

  employer: { name: "Atlan", url: "https://atlan.com" } as {
    name: string;
    url: string;
  } | null,

  /**
   * Person.knowsAbout. Each technology is also in `skills` ("Model Context
   * Protocol" is its MCP), plus the two fields they add up to.
   */
  knowsAbout: [
    "Kubernetes",
    "Terraform",
    "Crossplane",
    "ArgoCD",
    "Helm",
    "Temporal",
    "Go",
    "Python",
    "TypeScript",
    "Prometheus",
    "Grafana",
    "OpenTelemetry",
    "vLLM",
    "KEDA",
    "MLflow",
    "Kubeflow Pipelines",
    "Model Context Protocol",
    "Platform engineering",
    "MLOps",
  ] as string[],

  /** The header's links, rendered rel="me". verify checks each is in sameAs. */
  links: [
    { label: "GitHub", href: "https://github.com/my-neme-eh-jeff" },
    { label: "LinkedIn", href: "https://www.linkedin.com/in/amannambisan/" },
    { label: "X", href: "https://x.com/NambisanAman" },
  ],

  /**
   * Accounts confirmed live and yours, in each site's canonical form so none
   * redirects. Each must link back to amannambisan.com, by hand on each site,
   * or the claim counts for little. A wrong URL here does harm.
   */
  sameAs: [
    "https://github.com/my-neme-eh-jeff",
    "https://www.linkedin.com/in/amannambisan/",
    "https://x.com/NambisanAman",
  ] as string[],

  /**
   * 1200x630, made by `pnpm run og`. Empty emits no og:image tags, which beats
   * a 404's blank card; `pnpm run verify` checks the file exists.
   */
  ogImage: "/og/home.jpg",
};

export type Role = {
  company: string;
  companyUrl?: string;
  title: string;
  period: string;
  location: string;
  /** Bullets are outcomes, not duties. */
  points: string[];
};

/** Most recent first. */
export const roles: Role[] = [
  {
    company: "Atlan",
    companyUrl: "https://atlan.com",
    title: "Software Engineer II",
    period: "Mar 2026 — Present",
    location: "Bangalore",
    points: [
      "Migrated an internal agent platform from closed frontier models to open-weight ones, cutting token spend substantially with no measurable drop in task success on internal evals.",
      "Designed a deep agent that catches anomalous cloud-cost spikes early and works out their root cause.",
      "Built an AI agent for long-running infrastructure migrations: it chooses deployment rings, tracks progress and works across customer maintenance windows in different time zones with little human intervention, halving the engineering time a migration costs.",
      "Architected release-management tooling that tracks per-tenant deployment state across the fleet, eliminating a recurring class of top-severity incidents caused by unverified upstream rollouts and unclear ring status.",
      "Scaled Argo CD to more than a thousand applications across EKS, GKE and AKS, and cut sync time by about 20 minutes per application through tuning and an Argo CD upgrade.",
    ],
  },
  {
    company: "Atlan",
    title: "Software Engineer I",
    period: "Jun 2025 — Feb 2026",
    location: "Bangalore",
    points: [
      "Owned development and review for Atlan's internal developer portal (Vue.js and Go), used across engineering, sales and customer teams, and established it as the source of truth for tenant metadata.",
      "Took on-demand infrastructure provisioning from roughly a 50% success rate to above 90% every month for more than six months, by fixing Terraform modules and making bootstrap jobs idempotent; moving the flow to Crossplane took it to 100%.",
      "Extended the AI support chatbot to resolve most weekly support tickets on its own, generating PrivateLink setups and looking up tenant details.",
    ],
  },
  {
    company: "Atlan",
    title: "Associate Software Engineer I",
    period: "Nov 2024 — May 2025",
    location: "Mumbai",
    points: [
      "Integrated an OpenTelemetry agent shipping the developer portal's logs into ClickHouse.",
      "Wrote a Temporal workflow that monitors resource quota across clouds with Prometheus metrics and Grafana alerting, catching every provisioning and scale-up failure before quota ran out.",
    ],
  },
  {
    company: "simPPL",
    companyUrl: "https://simppl.org",
    title: "Frontend Intern",
    period: "May 2023 — Aug 2023",
    location: "Remote, USA",
    points: [
      "Built D3.js visualisations over million-row misinformation datasets drawn from X, Facebook and Telegram.",
      "Built a Discord-triggered content pipeline that scraped articles, summarised them with an LLM and delivered them as a newsletter to more than 300 subscribers.",
    ],
  },
];

export type Project = {
  /** Lowercase kebab-case: the NAME column of `k get projects`. */
  slug: string;
  title: string;
  /** One line. */
  summary: string;
  detail: string[];
  stack: string[];
  repo?: string;
  /**
   * Only for a mechanism worth drawing. Lines under 64 columns, so none wraps
   * in the shell. Screen readers get one labelled image, so `detail` must say
   * the same thing in prose.
   */
  diagram?: string[];
  /**
   * Demos, write-ups, talks. Each must be a URL that resolves: a plausible
   * guess here is published as fact.
   */
  links?: { label: string; href: string }[];
  /**
   * ISO date of the last meaningful work. Not rendered, on purpose: a visitor
   * who reads an age decides the work is stale and skips it.
   */
  updated: string;
};

/** Described from each repository's own README, not invented. */
export const projects: Project[] = [
  {
    slug: "gpu-autoscaler",
    title: "GPU-Aware Autoscaler for LLM Inference",
    summary: "Scales vLLM pods on KV cache pressure, not CPU.",
    detail: [
      "A Kubernetes autoscaler that scales vLLM inference pods on KV cache pressure and request queue depth rather than CPU, because on a GPU server CPU is not the bottleneck and rises only after users are already waiting.",
      "Traffic spikes fill the cache, the autoscaler reads that as a leading indicator, KEDA adds a replica and the cluster autoscaler provisions an L4 — so time-to-first-token stays flat through the spike.",
    ],
    stack: ["Kubernetes", "vLLM", "KEDA", "Terraform", "Prometheus"],
    diagram: [
      "  traffic spike",
      "       │",
      "       ▼",
      "  ┌──────────────┐   KV cache %    ┌─────────────┐",
      "  │  vLLM pods   │ ──────────────▶ │    KEDA     │",
      "  │  (L4 GPU)    │   queue depth   │   scaler    │",
      "  └──────────────┘                 └──────┬──────┘",
      "        ▲                                 │ scale out",
      "        │                                 ▼",
      "        │                   ┌──────────────────────┐",
      "        │                   │  cluster autoscaler  │",
      "        └── new replica ────┤  provisions an L4    │",
      "                            └──────────────────────┘",
      "",
      "  a CPU-based HPA only reacts here ──▶ already too late",
    ],
    repo: "https://github.com/my-neme-eh-jeff/llmops-benchmarking",
    updated: "2026-05-03",
  },
  {
    slug: "ml-deploy",
    title: "Autonomous ML Deployment System",
    summary: "An LLM proposes model changes; winners ship themselves.",
    detail: [
      "An autonomous research loop inspired by Karpathy's Autoresearch. Drop in a binary-classification CSV, declare its schema, and a closed loop takes over: Claude proposes a change, the system trains it on Kubernetes, and only candidates that beat the current champion get promoted. Accuracy went from roughly 70% to 80% across 20 iterations.",
      "DVC versions the data, Kubeflow Pipelines runs training, MLflow holds the champion/challenger registry, and a FastAPI service is rolled forward via GitOps whenever a new champion is promoted. No human in the loop.",
    ],
    stack: ["Kubernetes", "Kubeflow", "MLflow", "DVC", "FastAPI", "GitOps"],
    diagram: [
      "  ┌────────────┐",
      "  │   Claude   │  proposes a change to the model",
      "  └─────┬──────┘",
      "        ▼",
      "  ┌────────────┐  DVC-versioned data",
      "  │  Kubeflow  │  trains the candidate on Kubernetes",
      "  └─────┬──────┘",
      "        ▼",
      "  ┌────────────┐  challenger vs champion",
      "  │   MLflow   │  promoted only if it wins",
      "  └─────┬──────┘",
      "        ▼",
      "  ┌────────────┐",
      "  │   GitOps   │  FastAPI rolls forward automatically",
      "  └─────┬──────┘",
      "        └──────────────▶ back to the top, no human in the loop",
    ],
    repo: "https://github.com/my-neme-eh-jeff/deploying-autoresearch",
    // "Autoresearch with reliable CI CD on the cloud", linked from the README.
    links: [{ label: "Demo video", href: "https://youtu.be/O0uPoLO-2JM" }],
    updated: "2026-05-28",
  },
  {
    slug: "ride-booking",
    title: "Go Modular Monolith for Ride Dispatch",
    summary: "Matches on S2 cells; a Redis lock prevents double-booking.",
    detail: [
      "A Go modular monolith split by domain — booking, matching, pricing — communicating over Kafka, with asynchronous booking processing and real-time ride tracking.",
      "Redis provides a distributed lock so a rider cannot be double-booked, and Google's S2 library handles spatial indexing for proximity search in the driver-matching service.",
    ],
    stack: ["Go", "Kafka", "Redis", "S2"],
    repo: "https://github.com/my-neme-eh-jeff/highly-scalable-goods-transport-app",
    updated: "2024-10-24",
  },
];

export type Achievement = { title: string; note?: string };

export const achievements: Achievement[] = [
  { title: "AWS Certified Cloud Practitioner (CLF-C02)" },
  {
    title: "IEEE YESIST12 — First in India, top 10 overall",
    note: "Represented India in the AI track, held in Tunisia.",
  },
  {
    title: "Amazon Sambhav Hackathon — prototype phase",
    note: "Built a connector for e-commerce platforms including Shopify.",
  },
  {
    title: "Samsung Solve for Tomorrow 2024 — finalist cohort",
    note: "Presented to executive leaders.",
  },
  { title: "Codeforces Div. 1 top 800 · LeetCode Guardian" },
  {
    title: "JEE Main and Advanced — All India Rank ~18,000",
    note: "Self-taught, 2020–2021.",
  },
];

export const education = {
  school: "Dwarkadas J Sanghvi College of Engineering",
  degree: "B.Tech, Computer Engineering",
  period: "Sep 2021 — May 2025",
  note: "GPA 8.13 / 10",
};

export const skills: Array<{ group: string; items: string[] }> = [
  {
    group: "Applied AI",
    items: [
      "LangGraph",
      "LiteLLM",
      "Langfuse",
      "MCP",
      "Anthropic API",
      "Claude Code",
      "Pi",
    ],
  },
  {
    group: "ML & Serving",
    items: ["vLLM", "FastAPI", "MLflow", "Kubeflow Pipelines", "DVC"],
  },
  {
    group: "Languages & Backend",
    items: [
      "Go",
      "Python",
      "TypeScript",
      "SQL",
      "Bash",
      "Node.js",
      "Bun",
      "React",
      "Next.js",
      "Vue.js",
      "Redis",
      "Kafka",
    ],
  },
  {
    group: "Platform & Cloud",
    items: [
      "Kubernetes",
      "ArgoCD",
      "Crossplane",
      "Helm",
      "Terraform",
      "Temporal",
      "KEDA",
      "Docker",
      "AWS",
      "GCP",
      "Azure",
      "GitHub Actions",
    ],
  },
  {
    group: "Observability & Data",
    items: ["Prometheus", "Grafana", "OpenTelemetry", "ClickHouse", "Postgres"],
  },
];

export type Post = {
  /** Must match the route folder: src/routes/blog/(post)/<slug>/index.mdx */
  slug: string;
  title: string;
  /** ISO date, also the datePublished. */
  date: string;
  /** Becomes the meta description, so 120–160 characters. */
  summary: string;
  repo?: string;
  /**
   * Prose at 238 words a minute (Brysbaert, 2019, non-fiction) plus 12 s a
   * figure, rounded; code isn't counted. `pnpm run verify` recounts it.
   */
  minutes: number;
  /**
   * 1200x630 JPEG under public/, for /blog/ and the post's og:image.
   * `pnpm run verify` checks the size and that it exists.
   */
  cover?: { src: string; alt: string };
  /**
   * What /blog/ shows beside the post on hover, as lines of terminal text.
   * Without it the cover is shown there too.
   */
  glance?: (string | [text: string, ink: "dim" | "cyan" | "yellow"])[][];
};

/** Real posts only. With none, /blog/ shows an empty state; filler gets indexed. */
export const posts: Post[] = [
  {
    slug: "claude-code-status-line",
    title: "The Art of the Status Line",
    date: "2026-10-13",
    summary:
      "A Claude Code status line that stays quiet until something can stop you: what it shows, what it refuses to show, and the bugs that decided both.",
    repo: "https://github.com/my-neme-eh-jeff/ai-experiments/tree/main/claude-statusline",
    minutes: 8,
    // demo/states.png from that folder, cropped to 1200x630:
    //   sips -c 1680 3200 --cropOffset 60 0 states.png --out c.png
    //   sips -z 630 1200 c.png && sips -s format jpeg -s formatOptions 82 c.png --out cover.jpg
    cover: {
      src: "/blog/claude-code-status-line/cover.jpg",
      alt: "The same Claude Code status line calm, heating up, and at the limit",
    },
    glance: [
      ["ctx ", ["64%", "yellow"], " │ $6.42 │ ", ["5h 72% → 100%", "yellow"]],
      [["● staging (eks)", "cyan"]],
      [["⎇ api(fix-retries)·wt ⑃ main", "dim"]],
      [
        ["⎇ infra(main) ", "dim"],
        ["⚠×1", "yellow"],
      ],
    ],
  },
];
