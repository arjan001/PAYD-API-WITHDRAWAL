import serverless from "serverless-http";
import app from "../../artifacts/api-server/src/app.js";

interface FunctionContext {
  user?: { id: string; email: string };
}
interface LambdaResult {
  statusCode: number;
  headers?: Record<string, string>;
  multiValueHeaders?: Record<string, string[]>;
  body?: string;
  isBase64Encoded?: boolean;
}

export default async (request: Request, context: FunctionContext) => {
  const url = new URL(request.url);
  const handler = serverless(app, {
    request: (req: { teamUser?: FunctionContext["user"] }) => {
      req.teamUser = context.user;
    },
  });
  const result = await handler({
    httpMethod: request.method,
    path: url.pathname,
    rawUrl: request.url,
    headers: Object.fromEntries(request.headers),
    multiValueQueryStringParameters: Object.fromEntries(
      [...new Set(url.searchParams.keys())].map((key) => [key, url.searchParams.getAll(key)]),
    ),
    body: Buffer.from(await request.arrayBuffer()).toString("base64"),
    isBase64Encoded: true,
    requestContext: { identity: { sourceIp: "" } },
  }, context) as LambdaResult;

  const headers = new Headers(result.headers);
  for (const [name, values] of Object.entries(result.multiValueHeaders ?? {})) {
    headers.delete(name);
    for (const value of values) headers.append(name, value);
  }
  headers.set("Cache-Control", "no-store");
  const body = result.isBase64Encoded
    ? Buffer.from(result.body ?? "", "base64")
    : result.body ?? "";
  return new Response([204, 304].includes(result.statusCode) ? null : body, {
    status: result.statusCode,
    headers,
  });
};
