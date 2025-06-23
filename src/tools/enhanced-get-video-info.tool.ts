import { z } from "zod";
import { enhancedYouTubeClient } from "../clients/enhanced-youtube-client.js";
import { ToolDefinition } from "../types/tool-definition.js";

const toolName = "get_video_info";
const toolDescription = "Extract comprehensive YouTube video data including metadata, captions/transcripts, and technical details. Returns structured data for intelligent analysis, summarization, or note creation. When captions are available, provides full transcript for content analysis. When unavailable, returns rich metadata for description-based analysis. Use this data to create summaries, identify key points, generate study notes, or assess video accessibility.";
const toolSchema = {
  videoUrl: z.string().describe("The URL or ID of the YouTube video"),
  languageCode: z.string().describe("The language code for captions (optional, e.g., 'en', 'es', 'fr')").optional(),
};

const toolHandler = async (args: { videoUrl: string; languageCode?: string }, _extra: { signal: AbortSignal }) => {
  const result = await enhancedYouTubeClient.getEnhancedVideoInfo(args.videoUrl, args.languageCode);

  if (!result.success) {
    // Return structured error data for agent to handle
    const errorData = {
      success: false,
      error: result.error,
      attemptedMethods: result.fallbackUsed || [],
      troubleshooting: {
        suggestions: [
          "Verify the video URL is correct",
          "Check if the video is public and accessible", 
          "Try with a different video to test connectivity",
          "Ensure you have proper API keys configured if needed"
        ]
      }
    };

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(errorData, null, 2),
        },
      ],
    };
  }

  const videoInfo = result.data!;
  
  // Format captions as clean text
  let captionsText = "";
  if (videoInfo.captionsAvailable && videoInfo.subtitles && videoInfo.subtitles.length > 0) {
    captionsText = videoInfo.subtitles.map(subtitle => subtitle.text).join(" ");
  }

  // Return structured data for agent analysis
  const structuredData = {
    success: true,
    basic: {
      id: videoInfo.id,
      title: videoInfo.title,
      channel: videoInfo.channelTitle,
      duration: videoInfo.duration,
      publishedAt: videoInfo.publishedAt,
      url: `https://www.youtube.com/watch?v=${videoInfo.id}`,
    },
    statistics: {
      viewCount: videoInfo.viewCount ? parseInt(videoInfo.viewCount) : null,
      likeCount: videoInfo.likeCount ? parseInt(videoInfo.likeCount) : null,
    },
    access: {
      status: videoInfo.accessStatus,
      isPublic: videoInfo.accessStatus === 'public',
    },
    content: {
      description: videoInfo.description,
      captions: {
        available: videoInfo.captionsAvailable,
        count: videoInfo.subtitles?.length || 0,
        transcript: captionsText,
        language: args.languageCode || 'auto-detected',
      }
    },
    technical: {
      extractionMethods: result.fallbackUsed || [],
      thumbnails: videoInfo.thumbnails,
    },
    analysis: {
      canSummarize: videoInfo.captionsAvailable && captionsText.length > 0,
      contentLength: captionsText.length,
      descriptionLength: videoInfo.description?.length || 0,
      recommendedApproach: videoInfo.captionsAvailable 
        ? "Full content analysis using transcript"
        : "Metadata and description-based analysis only",
    }
  };

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(structuredData, null, 2),
      },
    ],
  };
};

export const EnhancedGetVideoInfoTool: ToolDefinition<typeof toolSchema> = {
  name: toolName,
  description: toolDescription,
  schema: toolSchema,
  handler: toolHandler,
};