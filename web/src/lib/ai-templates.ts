import type { DiagramSpec } from "shared";

/**
 * Deterministic fallback diagrams, used when no ANTHROPIC_API_KEY is
 * configured (or the API call fails) so the AI copilot still has something
 * useful to demo without requiring a key. Keyword-matched against the
 * prompt; falls back to a generic microservices sketch otherwise.
 */
const TEMPLATES: { keywords: string[]; spec: DiagramSpec }[] = [
  {
    keywords: ["netflix", "streaming", "video"],
    spec: {
      nodes: [
        { id: "client", label: "Client App", kind: "ellipse" },
        { id: "cdn", label: "CDN (video chunks)", kind: "rect" },
        { id: "gateway", label: "API Gateway", kind: "rect" },
        { id: "playback", label: "Playback Service", kind: "rect" },
        { id: "reco", label: "Recommendation Service", kind: "rect" },
        { id: "metadata", label: "Metadata Service", kind: "rect" },
        { id: "cassandra", label: "Cassandra (metadata)", kind: "diamond" },
        { id: "s3", label: "S3 (encoded video)", kind: "diamond" },
        { id: "kafka", label: "Kafka (view events)", kind: "diamond" },
      ],
      edges: [
        { from: "client", to: "cdn", label: "stream" },
        { from: "client", to: "gateway", label: "api calls" },
        { from: "gateway", to: "playback" },
        { from: "gateway", to: "reco" },
        { from: "gateway", to: "metadata" },
        { from: "metadata", to: "cassandra" },
        { from: "playback", to: "s3" },
        { from: "playback", to: "kafka", label: "view events" },
        { from: "kafka", to: "reco", label: "training data" },
      ],
    },
  },
  {
    keywords: ["uber", "lyft", "ride", "rideshare"],
    spec: {
      nodes: [
        { id: "rider", label: "Rider App", kind: "ellipse" },
        { id: "driver", label: "Driver App", kind: "ellipse" },
        { id: "gateway", label: "API Gateway", kind: "rect" },
        { id: "dispatch", label: "Dispatch Service", kind: "rect" },
        { id: "geo", label: "Geo Index (H3/quadtree)", kind: "diamond" },
        { id: "matching", label: "Matching Engine", kind: "rect" },
        { id: "pricing", label: "Pricing Service", kind: "rect" },
        { id: "trips", label: "Trips DB", kind: "diamond" },
        { id: "payments", label: "Payments Service", kind: "rect" },
      ],
      edges: [
        { from: "rider", to: "gateway", label: "request ride" },
        { from: "driver", to: "gateway", label: "location ping" },
        { from: "gateway", to: "dispatch" },
        { from: "dispatch", to: "geo", label: "nearby drivers" },
        { from: "dispatch", to: "matching" },
        { from: "matching", to: "pricing" },
        { from: "matching", to: "trips" },
        { from: "trips", to: "payments" },
      ],
    },
  },
  {
    keywords: ["url shortener", "bit.ly", "tinyurl", "short link"],
    spec: {
      nodes: [
        { id: "client", label: "Client", kind: "ellipse" },
        { id: "gateway", label: "API Gateway", kind: "rect" },
        { id: "writer", label: "Write Service (id gen)", kind: "rect" },
        { id: "reader", label: "Read Service", kind: "rect" },
        { id: "cache", label: "Cache (hot links)", kind: "diamond" },
        { id: "db", label: "Key-Value Store", kind: "diamond" },
        { id: "analytics", label: "Click Analytics", kind: "rect" },
      ],
      edges: [
        { from: "client", to: "gateway" },
        { from: "gateway", to: "writer", label: "create" },
        { from: "gateway", to: "reader", label: "redirect" },
        { from: "writer", to: "db" },
        { from: "reader", to: "cache" },
        { from: "cache", to: "db", label: "miss" },
        { from: "reader", to: "analytics", label: "log click" },
      ],
    },
  },
];

const FALLBACK: DiagramSpec = {
  nodes: [
    { id: "client", label: "Client", kind: "ellipse" },
    { id: "lb", label: "Load Balancer", kind: "rect" },
    { id: "gateway", label: "API Gateway", kind: "rect" },
    { id: "service-a", label: "Service A", kind: "rect" },
    { id: "service-b", label: "Service B", kind: "rect" },
    { id: "cache", label: "Cache", kind: "diamond" },
    { id: "db", label: "Database", kind: "diamond" },
  ],
  edges: [
    { from: "client", to: "lb" },
    { from: "lb", to: "gateway" },
    { from: "gateway", to: "service-a" },
    { from: "gateway", to: "service-b" },
    { from: "service-a", to: "cache" },
    { from: "service-a", to: "db" },
    { from: "service-b", to: "db" },
  ],
};

export function templateForPrompt(prompt: string): DiagramSpec {
  const lower = prompt.toLowerCase();
  for (const { keywords, spec } of TEMPLATES) {
    if (keywords.some((kw) => lower.includes(kw))) return spec;
  }
  return FALLBACK;
}
