#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { YouTubeMcpServer } from "./server/youtube-mcp-server.js";
import { EnhancedGetVideoInfoTool } from "./tools/enhanced-get-video-info.tool.js";
import { RegisterTool } from "./helpers/register-tool.js";
import { getPackageVersion } from "./helpers/get-package-version.js";

// Display startup banner
console.error(`
┌───────────────────────────────────────────────┐
│                                               │
│      YouTube Video Summarizer MCP Server      │
│                v${getPackageVersion()}                      │
│                                               │
│        Connecting Claude with YouTube...      │
│                                               │
└───────────────────────────────────────────────┘
`);

// Log startup information (to stderr so it doesn't interfere with MCP protocol)
console.error("Starting YouTube Video Summarizer MCP Server...");
console.error("This server enables Claude to analyze and summarize YouTube videos.");
console.error("For more information, visit: https://github.com/yourusername/youtube-video-summarizer-mcp");
console.error("\nWaiting for Claude to connect...\n");

const main = async () => {
  // Create an MCP server
  const server = YouTubeMcpServer.GetServer();

  // Register all tools with universal compatibility (both naming conventions)
  RegisterTool(server, EnhancedGetVideoInfoTool);
  
  // Also register with hyphen naming for compatibility with other MCP clients
  const HyphenVersionTool = {
    ...EnhancedGetVideoInfoTool,
    name: "get-video-info"
  };
  RegisterTool(server, HyphenVersionTool);

  console.error("Registered tools:");
  console.error("- get_video_info: Get comprehensive YouTube video data (PydanticAI compatible)");
  console.error("- get-video-info: Get comprehensive YouTube video data (standard MCP compatible)");

  // Start receiving messages on stdin and sending messages on stdout
  const transport = new StdioServerTransport();
  console.error("Server ready. Connecting to Claude...")
  await server.connect(transport);
};

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
