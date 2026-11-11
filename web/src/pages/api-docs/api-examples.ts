import type { APICapability, ExternalModel } from "@/services/api/model-calls";
export type { APICapability } from "@/services/api/model-calls";

export function apiDocumentationBaseURL(base: string, origin: string) {
    return new URL(base, origin).href.replace(/\/$/, "");
}

function shellQuote(value: string) {
    return `'${value.replace(/'/g, "'\\''")}'`;
}

export function modelCallExample(apiRoot: string, model: string, capability: APICapability, brandName: string, specification?: ExternalModel) {
    if (specification && Object.values(specification.parameters).some((parameter) => parameter.required && (parameter.default === undefined || parameter.default === ""))) return null;
    const parameters = specification
        ? Object.fromEntries(
              Object.entries(specification.parameters)
                  .filter(([, parameter]) => parameter.default !== undefined && parameter.default !== "")
                  .map(([name, parameter]) => [name, parameter.default]),
          )
        : undefined;
    const request =
        capability === "text"
            ? {
                  model,
                  messages: [
                      { role: "system", content: "请简洁回答。" },
                      { role: "user", content: `用一句话介绍${brandName}。` },
                  ],
                  parameters: parameters ?? { thinking: false },
              }
            : {
                  capability,
                  model,
                  prompt: capability === "audio" ? `你好，欢迎来到${brandName}。` : "雨夜的城市街道，电影质感",
                  parameters: parameters ?? (capability === "image" ? { aspectRatio: "1:1", count: 1 } : capability === "video" ? { duration: 5 } : { audioFormat: "mp3" }),
              };
    return `curl -sS ${shellQuote(`${apiRoot}/model-calls`)} \\\n  -H "Authorization: Bearer $CANVAS_API_KEY" \\\n  -H 'Content-Type: application/json' \\\n  -d ${shellQuote(JSON.stringify(request, null, 2))}`;
}
