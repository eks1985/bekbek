import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { authenticateMcp } from "@/lib/mcp/auth";
import { createMcpServer } from "@/lib/mcp/server";

// MCP-эндпоинт (Streamable HTTP). Stateless: сервер и транспорт создаются на
// каждый запрос и не держат сессий — на serverless между запросами может
// смениться инстанс. Ответы — обычный JSON, без SSE-потока.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function rpcError(code: number, message: string, status: number): Response {
  return Response.json({ jsonrpc: "2.0", error: { code, message }, id: null }, { status });
}

async function handle(req: Request): Promise<Response> {
  try {
    const auth = await authenticateMcp(req);
    if (!auth.ok) return rpcError(-32001, auth.error, auth.status);

    const server = createMcpServer(auth.user);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    return await transport.handleRequest(req);
  } catch (err) {
    console.error("MCP request failed", err);
    return rpcError(-32603, "Внутренняя ошибка", 500);
  }
}

export { handle as GET, handle as POST, handle as DELETE };
