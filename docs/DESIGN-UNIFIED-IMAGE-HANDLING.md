# Unified Image Handling for Non-Vision Models

## Goal

When using a non-vision model, images that enter the context (via user attachment or `read_file` tool call) are automatically described by a vision model before the next LLM turn. The description replaces the raw image data so the non-vision model can "see" the image through text.

## User Experience

The user attaches an image or the agent calls `read_file` on an image. On the next turn:

1. A brief "Describing image..." status appears in the chat feed
2. The image is sent to the configured vision model
3. The description replaces the image in context: `[Image: screenshot.png — description: A terminal window showing an error message...]`
4. The agent proceeds normally, now with the description available

The user never sees raw base64 data. The vision model is configured once in settings (`llm.visionModel`). If no vision model is configured, images are replaced with a simple `[Image: filename.png]` placeholder.

## Technical Design

### Single Entry Point: Pre-Turn Context Processor

Instead of handling images at multiple points (attachment stripping in agent loop, vision fallback in streaming layer, `read_file` tool result), create a single **pre-turn context processor** that runs before each LLM call:

```
User prompt (with attachment) or tool result (with image data)
  → stored in EventStore as events
  → Pre-turn processor scans events for image data
  → If non-vision model + vision model configured:
      → For each image: call vision model API, get description
      → Replace image data with description text in context
      → Emit vision_fallback.start/done events for UI
  → Build LLM context from processed events
  → Send to LLM
```

### What This Unifies

| Current Path                                        | New Path                                                        |
| --------------------------------------------------- | --------------------------------------------------------------- |
| Attachment stripping in agent-loop.ts               | Removed — processor handles it                                  |
| Vision fallback in streaming layer (client-pure.ts) | Removed — processor handles it                                  |
| `read_file` returning raw base64 for images         | Processor detects image content in tool results, describes them |

### Detecting Images in Tool Results

When `read_file` reads an image file, the tool result contains base64 data. The processor detects this by:

1. Checking the file path extension (`.png`, `.jpg`, etc.)
2. Or checking if the content starts with a known image MIME type / base64 pattern

### Processor Location

A new module `src/server/context/image-processor.ts` with a single exported function:

```ts
async function processContextImages(
  events: StoredEvent[],
  options: {
    modelSupportsVision: boolean
    visionModel?: { baseUrl: string; model: string; timeout: number }
    signal?: AbortSignal
  },
): Promise<{ events: StoredEvent[]; descriptions: Map<string, string> }>
```

This function:

1. Scans events for image data (message attachments + tool results)
2. If model supports vision → no-op, return events as-is
3. If no vision model configured → replace images with `[Image: filename]` placeholder
4. If vision model configured → call vision model API for each unique image, cache descriptions
5. Return modified events with descriptions in place of raw data

### Caching

Image descriptions are cached by content hash to avoid re-describing the same image across turns. Cache lives in memory, cleared on session close.

### UI Events

The processor emits:

- `vision_fallback.start` when describing begins
- `vision_fallback.done` when description is complete

These are consumed by the orchestrator and streamed to the frontend.

### Migration

- Remove `stripAttachments` from `getConversationMessages`/`buildContextMessages`
- Remove vision fallback callbacks from `streamLLMPure` and `client-pure.ts`
- Remove `onVisionFallbackStart`/`onVisionFallbackDone` from streaming pipeline
- Call `processContextImages` once in the orchestrator before each `runTopLevelAgentLoop` call
