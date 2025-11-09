import dotenv from 'dotenv';
import express, { Request, Response } from 'express';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { WebSocketServer, WebSocket } from 'ws';

dotenv.config();

const app = express();
const server = http.createServer(app);

const rawPort = process.env.PORT ?? '3000';
const parsedPort = Number.parseInt(rawPort, 10);
const PORT = Number.isNaN(parsedPort) ? 3000 : parsedPort;
const TEMPLATE_PATH = path.resolve(__dirname, 'index.html');

// lang=markdown
const STREAM_PROMPT = `
Render a personal website for James Paterson, a software engineer working at Viator/Tripadvisor Experiences.

### GUIDELINES FOR GENERATING
DO NOT include any explanations, just provide the raw HTML content. Your content will be inserted into a predefined HTML template.
You should NOT include the <!DOCTYPE html>, <html>, <head>, or <body> tags, as these are already part of the template.
You should write your HTML with INLINE STYLES only, then a <script> block for any 
interactivity or animations. You should avoid using any full page fade in animations or similar.

If you need to make assumptions about James Paterson, do so freely. Be creative when making the website. Background animations are a plus.
 The HTML should be well-structured and use semantic elements where appropriate. Above all, the page should be sleek and cool.
`;
const OPENAPI_ENDPOINT = 'https://api.openai.com/v1/responses';
const OPENAPI_MODEL = 'gpt-4.1-mini';

const DEFAULT_CONTENT = String.raw`
  <main style="font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 900px; margin: 3rem auto; padding: 0 1.5rem;">
    <h1 style="margin-bottom: 0.5rem;">Generating James Paterson's personal website</h1>
    <p id="status" style="color: #555;">Establishing a live connection&hellip;</p>
    <div id="content" aria-live="polite"></div>
  </main>
  <script>
    (() => {
      const status = document.getElementById('status');
      const target = document.getElementById('content');
      if (!status || !target) {
        console.error('[CLIENT] ERROR: Could not find status or target elements');
        return;
      }

      const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
      const socketUrl = protocol + '://' + window.location.host + '/stream';
      const socket = new WebSocket(socketUrl);
      let buffer = '';

      const escapeHtml = (value) => value.replace(/[&<>"']/g, (character) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[character] || character);

      socket.addEventListener('open', () => {
        status.textContent = 'Building the page&hellip;';
      });

      socket.addEventListener('message', (event) => {
        try {
          const payload = JSON.parse(event.data);
          
          if (payload.type === 'chunk' && typeof payload.data === 'string') {
            buffer += payload.data;
            target.innerHTML = buffer;
            status.textContent = 'Adding sections&hellip;';
          } else if (payload.type === 'done') {
            status.textContent = 'James Paterson\'s personal website is ready.';
            socket.close();
          } else if (payload.type === 'error' && typeof payload.message === 'string') {
            console.error('[CLIENT] Error payload received:', payload.message);
            status.textContent = 'Unable to build the website.';
            const errorMarkup = '<pre style="white-space: pre-wrap; background: #f5f5f5; padding: 1rem; border-radius: 0.5rem;">' + escapeHtml(payload.message) + '</pre>';
            target.innerHTML = errorMarkup;
            socket.close();
          }
        } catch (error) {
          console.error('[CLIENT] Unable to process message', {
            error,
            data: event.data.substring(0, 200),
          });
        }
      });

      socket.addEventListener('close', (event) => {
        if (!buffer) {
          status.textContent = 'Connection closed before any content was received.';
        }
      });

      socket.addEventListener('error', (error) => {
        console.error('[CLIENT] WebSocket error:', error);
        status.textContent = 'A network error occurred.';
      });
    })();
  </script>
`;

type StreamOptions = {
  signal?: AbortSignal;
  onChunk: (chunk: string) => void;
};

const streamPersonalWebsite = async ({ signal, onChunk }: StreamOptions): Promise<void> => {
  console.log('[STREAM] Starting stream...');
  const apiKey = process.env.OPENAPI_API_KEY;

  if (!apiKey) {
    console.error('[STREAM] ERROR: OPENAPI_API_KEY is not configured');
    throw new Error('OPENAPI_API_KEY is not configured. Please add it to your environment.');
  }

  const response = await fetch(OPENAPI_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: OPENAPI_MODEL,
      input: STREAM_PROMPT,
      stream: true,
    }),
    signal,
  });

  if (!response.ok || !response.body) {
    const errorText = await response.text().catch(() => '');
    console.error('[STREAM] Request failed:', {
      status: response.status,
      errorText,
    });
    throw new Error(`OpenAPI request failed with status ${response.status}: ${errorText}`.trim());
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let completed = false;

  const processBuffer = () => {
    let newlineIndex: number;

    while ((newlineIndex = buffer.indexOf('\n\n')) !== -1) {
      const rawEvent = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 2);

      const payload = rawEvent
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.replace(/^data:\s*/, ''))
        .join('\n');

      if (!payload) {
        continue;
      }

      if (payload === '[DONE]') {
        completed = true;
        return;
      }

      try {
        const parsed = JSON.parse(payload) as { type?: string; delta?: unknown; error?: { message?: string } };

        // Handle custom API format: response.output_text.delta
        if (parsed.type === 'response.output_text.delta' && typeof parsed.delta === 'string') {
          onChunk(parsed.delta);
        } 
        // Handle standard OpenAI chat completions format
        else if (parsed.choices && Array.isArray(parsed.choices) && parsed.choices.length > 0) {
          const choice = parsed.choices[0];
          if (choice.delta && choice.delta.content && typeof choice.delta.content === 'string') {
            onChunk(choice.delta.content);
          }
        }
        // Handle direct content field
        else if (typeof parsed.content === 'string') {
          onChunk(parsed.content);
        }
        // Handle text field
        else if (typeof parsed.text === 'string') {
          onChunk(parsed.text);
        }
        else if (parsed.type === 'response.error') {
          const message = parsed.error?.message ?? 'The OpenAPI service returned an unknown error.';
          throw new Error(message);
        }
      } catch (error) {
        if (error instanceof SyntaxError) {
          console.error('[STREAM] Failed to parse JSON payload:', {
            error: error.message,
            payload: payload.substring(0, 200),
          });
        } else {
          console.error('[STREAM] Failed to process streaming payload:', error);
        }
        // Don't throw on parse errors, just log them
        if (error instanceof Error && error.message.includes('OpenAPI service returned')) {
          throw error;
        }
      }
    }
  };

  try {
    let chunkCount = 0;
    const PROGRESS_LOG_INTERVAL = 10; // Log progress every 10 chunks
    while (!completed) {
      const { value, done } = await reader.read();

      if (done) {
        console.log('[STREAM] Stream stopped, total chunks processed:', chunkCount);
        break;
      }

      chunkCount++;
      const decoded = decoder.decode(value, { stream: true });
      buffer += decoded;
      processBuffer();
      
      // Log progress periodically
      if (chunkCount % PROGRESS_LOG_INTERVAL === 0) {
        console.log('[STREAM] Progress: processed', chunkCount, 'chunks');
      }
    }

    if (!completed) {
      buffer += decoder.decode();
      processBuffer();
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return;
    }

    throw error;
  } finally {
    reader.releaseLock();
  }
};

const buildPage = (requestedContent?: unknown): string => {
  let template = '';

  try {
    template = fs.readFileSync(TEMPLATE_PATH, 'utf-8');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(`Unable to read template at ${TEMPLATE_PATH}: ${message}`);
    return '<h1>Internal Server Error</h1>';
  }

  let content: string | undefined;

  if (Array.isArray(requestedContent)) {
    content = requestedContent.join(' ');
  } else if (typeof requestedContent === 'string') {
    content = requestedContent;
  }

  return template.replace('{content}', content && content.length > 0 ? content : DEFAULT_CONTENT);
};

app.get('/', (req: Request, res: Response) => {
  const page = buildPage(req.query.content);
  res.header('Content-Type', 'text/html; charset=UTF-8');
  res.send(page);
});

const wss = new WebSocketServer({ server, path: '/stream' });

wss.on('connection', (socket: WebSocket, req) => {
  const abortController = new AbortController();
  let chunkCount = 0;
  const PROGRESS_LOG_INTERVAL = 20; // Log progress every 20 chunks sent

  const sendPayload = (payload: Record<string, unknown>) => {
    if (socket.readyState === WebSocket.OPEN) {
      const json = JSON.stringify(payload);
      socket.send(json);
      
      // Log progress periodically for chunk payloads
      if (payload.type === 'chunk') {
        chunkCount++;
        if (chunkCount % PROGRESS_LOG_INTERVAL === 0) {
          console.log('[WS] Progress: sent', chunkCount, 'chunks to client');
        }
      }
    }
  };

  socket.on('error', (error) => {
    console.error('[WS] Socket error:', error);
  });

  socket.on('close', (code, reason) => {
    abortController.abort();
  });

  streamPersonalWebsite({
    signal: abortController.signal,
    onChunk: (chunk) => {
      sendPayload({ type: 'chunk', data: chunk });
    },
  })
    .then(() => {
      console.log('[WS] Stream completed successfully');
      sendPayload({ type: 'done' });
    })
    .catch((error) => {
      if (error instanceof Error && error.name === 'AbortError') {
        console.log('[WS] Stream aborted');
        return;
      }

      const message = error instanceof Error ? error.message : 'Unknown error while contacting OpenAPI.';
      console.error('[WS] OpenAPI streaming failed:', {
        message,
        error,
        errorName: error instanceof Error ? error.name : 'Unknown',
      });
      sendPayload({ type: 'error', message });
    });
});

server.listen(PORT, () => {
  console.log(`[SERVER] Server is listening on http://localhost:${PORT}`);
  console.log(`[SERVER] WebSocket endpoint: ws://localhost:${PORT}/stream`);
});

export { app, server };
export default app;
