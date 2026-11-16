export type GenerateMarkdownParams = {
  imageDataUrl: string;
  apiKey: string;
  model: string;
};

export type NormalizedError = {
  userMessage: string;
  kind: "auth" | "model" | "network" | "capture" | "unknown";
};
