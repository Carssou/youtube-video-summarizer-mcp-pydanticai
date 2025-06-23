import { google } from "googleapis";
import { getVideoDetails, VideoDetails } from "youtube-caption-extractor";
import axios from "axios";
import dotenv from "dotenv";
import { isLanguageCodeValid } from "./language-codes.js";

dotenv.config();

export interface EnhancedVideoInfo {
  id: string;
  title: string;
  description: string;
  duration: string;
  thumbnails: {
    default?: string;
    medium?: string;
    high?: string;
  };
  channelTitle: string;
  publishedAt: string;
  viewCount?: string;
  likeCount?: string;
  subtitles?: Array<{ text: string; start: string | number; dur: string | number }>;
  captionsAvailable: boolean;
  accessStatus: 'public' | 'private' | 'unlisted' | 'restricted' | 'unknown';
  errorMessage?: string;
}

export interface ExtractionResult {
  success: boolean;
  data?: EnhancedVideoInfo;
  error?: string;
  fallbackUsed?: string[];
}

export class EnhancedYouTubeClient {
  private apiKey: string | undefined;
  private youtube: any;

  constructor() {
    this.apiKey = process.env.YOUTUBE_API_KEY;
    if (this.apiKey) {
      this.youtube = google.youtube({
        version: 'v3',
        auth: this.apiKey
      });
    }
  }

  /**
   * Extract video ID from YouTube URL
   */
  public extractVideoId(url: string): string {
    try {
      // Handle different YouTube URL formats
      const urlObj = new URL(url);
      const hostname = urlObj.hostname;
      const pathname = urlObj.pathname;
      const searchParams = urlObj.searchParams;

      if (hostname.includes("youtube.com") && searchParams.has("v")) {
        return searchParams.get("v") as string;
      } else if (hostname.includes("youtu.be")) {
        return pathname.substring(1);
      } else if (hostname.includes("youtube.com") && pathname.includes("/embed/")) {
        return pathname.split("/embed/")[1];
      } else if (hostname.includes("youtube.com") && pathname.includes("/v/")) {
        return pathname.split("/v/")[1];
      } else {
        // In case the input is already a video ID
        if (url.match(/^[a-zA-Z0-9_-]{11}$/)) {
          return url;
        }
        throw new Error("Invalid YouTube URL format");
      }
    } catch (error) {
      // If URL parsing fails, check if the input might be a video ID
      if (url.match(/^[a-zA-Z0-9_-]{11}$/)) {
        return url;
      }
      throw new Error("Could not extract video ID from URL");
    }
  }

  /**
   * Get video information using YouTube Data API v3
   */
  private async getVideoFromAPI(videoId: string): Promise<Partial<EnhancedVideoInfo>> {
    if (!this.youtube) {
      throw new Error("YouTube API key not configured");
    }

    try {
      const response = await this.youtube.videos.list({
        part: ['snippet', 'statistics', 'contentDetails', 'status'],
        id: [videoId]
      });

      if (!response.data.items || response.data.items.length === 0) {
        throw new Error("Video not found or is private/restricted");
      }

      const video = response.data.items[0];
      const snippet = video.snippet;
      const statistics = video.statistics;
      const contentDetails = video.contentDetails;
      const status = video.status;

      // Parse duration from ISO 8601 format (PT#M#S)
      const duration = this.parseDuration(contentDetails?.duration || '');

      // Determine access status
      let accessStatus: EnhancedVideoInfo['accessStatus'] = 'public';
      if (status?.privacyStatus === 'private') {
        accessStatus = 'private';
      } else if (status?.privacyStatus === 'unlisted') {
        accessStatus = 'unlisted';
      } else if (status?.uploadStatus !== 'processed') {
        accessStatus = 'restricted';
      }

      return {
        id: videoId,
        title: snippet?.title || 'Unknown Title',
        description: snippet?.description || 'No description available',
        duration: duration,
        thumbnails: {
          default: snippet?.thumbnails?.default?.url,
          medium: snippet?.thumbnails?.medium?.url,
          high: snippet?.thumbnails?.high?.url,
        },
        channelTitle: snippet?.channelTitle || 'Unknown Channel',
        publishedAt: snippet?.publishedAt || 'Unknown',
        viewCount: statistics?.viewCount,
        likeCount: statistics?.likeCount,
        accessStatus: accessStatus
      };
    } catch (error) {
      console.error("YouTube API error:", error);
      throw new Error(`YouTube API failed: ${(error as any)?.message || 'Unknown error'}`);
    }
  }

  /**
   * Get captions using youtube-caption-extractor
   */
  private async getCaptionsFromExtractor(videoId: string, lang?: string): Promise<VideoDetails | null> {
    try {
      let languageCode = lang;
      if (!isLanguageCodeValid(lang)) {
        languageCode = undefined;
      }
      
      const videoDetails = await getVideoDetails({ 
        videoID: videoId, 
        lang: languageCode 
      });
      
      return videoDetails;
    } catch (error) {
      console.error("Caption extractor error:", error);
      return null;
    }
  }

  /**
   * Fallback method using web scraping for basic info
   */
  private async getVideoFromWebScraping(videoId: string): Promise<Partial<EnhancedVideoInfo>> {
    try {
      const url = `https://www.youtube.com/watch?v=${videoId}`;
      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        timeout: 10000
      });

      const html = response.data;
      
      // Extract title using regex
      const titleMatch = html.match(/<title>([^<]+)<\/title>/);
      const title = titleMatch ? titleMatch[1].replace(' - YouTube', '') : 'Unknown Title';

      // Try to extract basic info from page
      return {
        id: videoId,
        title: title,
        description: 'Description not available (web scraping fallback)',
        duration: 'Duration not available',
        thumbnails: {
          default: `https://img.youtube.com/vi/${videoId}/default.jpg`,
          medium: `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`,
          high: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
        },
        channelTitle: 'Unknown Channel',
        publishedAt: 'Unknown',
        accessStatus: 'unknown' as const
      };
    } catch (error) {
      console.error("Web scraping error:", error);
      throw new Error("All extraction methods failed");
    }
  }

  /**
   * Parse ISO 8601 duration (PT#M#S) to readable format
   */
  private parseDuration(duration: string): string {
    if (!duration) return 'Unknown duration';
    
    const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (!match) return 'Unknown duration';

    const hours = parseInt(match[1]) || 0;
    const minutes = parseInt(match[2]) || 0;
    const seconds = parseInt(match[3]) || 0;

    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    } else {
      return `${minutes}:${seconds.toString().padStart(2, '0')}`;
    }
  }

  /**
   * Get comprehensive video information with fallback strategies
   */
  public async getEnhancedVideoInfo(videoIdOrUrl: string, lang?: string): Promise<ExtractionResult> {
    const fallbacksUsed: string[] = [];
    let videoInfo: Partial<EnhancedVideoInfo> = {};
    let captionsData: VideoDetails | null = null;

    try {
      // Extract video ID
      const videoId = this.extractVideoId(videoIdOrUrl);
      videoInfo.id = videoId;

      // Strategy 1: Try YouTube Data API first (most reliable)
      if (this.apiKey) {
        try {
          console.error("Trying YouTube Data API...");
          const apiData = await this.getVideoFromAPI(videoId);
          videoInfo = { ...videoInfo, ...apiData };
          fallbacksUsed.push("YouTube Data API v3");
        } catch (error) {
          console.error("YouTube API failed, trying fallbacks...");
          fallbacksUsed.push("YouTube Data API v3 (failed)");
        }
      } else {
        fallbacksUsed.push("YouTube Data API v3 (no API key)");
      }

      // Strategy 2: Try caption extractor for captions and any missing metadata
      try {
        console.error("Trying caption extractor...");
        captionsData = await this.getCaptionsFromExtractor(videoId, lang);
        
        if (captionsData) {
          // Fill in any missing data from caption extractor
          if (!videoInfo.title && captionsData.title) {
            videoInfo.title = captionsData.title;
          }
          if (!videoInfo.description && captionsData.description) {
            videoInfo.description = captionsData.description;
          }
          
          videoInfo.subtitles = captionsData.subtitles;
          videoInfo.captionsAvailable = !!(captionsData.subtitles && captionsData.subtitles.length > 0);
          fallbacksUsed.push("youtube-caption-extractor");
        }
      } catch (error) {
        console.error("Caption extractor failed:", error);
        fallbacksUsed.push("youtube-caption-extractor (failed)");
      }

      // Strategy 3: Web scraping as last resort
      if (!videoInfo.title || videoInfo.title === 'Unknown Title') {
        try {
          console.error("Trying web scraping fallback...");
          const webData = await this.getVideoFromWebScraping(videoId);
          videoInfo = { ...webData, ...videoInfo }; // Prefer API data over web data
          fallbacksUsed.push("web scraping");
        } catch (error) {
          console.error("Web scraping failed:", error);
          fallbacksUsed.push("web scraping (failed)");
        }
      }

      // Set captions availability
      videoInfo.captionsAvailable = !!(videoInfo.subtitles && videoInfo.subtitles.length > 0);

      // Ensure we have at least basic info
      if (!videoInfo.title) {
        videoInfo.title = `YouTube Video ${videoId}`;
      }
      if (!videoInfo.description) {
        videoInfo.description = 'No description available';
      }
      if (!videoInfo.accessStatus) {
        videoInfo.accessStatus = 'unknown';
      }

      return {
        success: true,
        data: videoInfo as EnhancedVideoInfo,
        fallbackUsed: fallbacksUsed
      };

    } catch (error) {
      return {
        success: false,
        error: `Failed to extract video information: ${(error as Error).message}`,
        fallbackUsed: fallbacksUsed
      };
    }
  }
}

export const enhancedYouTubeClient = new EnhancedYouTubeClient();