import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  downloads: defineTable({
    id: v.string(),
    repoUrl: v.string(),
    path: v.string(),    
    teamSlug: v.string(),
    status: v.union(
      v.object({
        type: v.literal("pending"),        
      }),
      v.object({
        type: v.literal("success"),        
        duration: v.number(),
      }),
      v.object({
        type: v.literal("error"),
        error: v.string(),
        duration: v.number(),
      })
    )
  }).index("by_download_id", ["id"]),

  downloadSteps: defineTable({
    downloadId: v.string(),
    step: v.string(),
    status: v.union(
      v.object({
        type: v.literal("pending"),        
      }),
      v.object({
        type: v.literal("success"),        
        duration: v.number(),
      }),
      v.object({
        type: v.literal("error"),
        error: v.string(),
        duration: v.number(),
      })
    )
  }).index("by_download_id", ["downloadId"]),

  logs: defineTable({
    step: v.id("downloadSteps"),
    ts: v.number(),
    message: v.string(),
  })
});
