import dotenv from 'dotenv';
import express, { Request, Response } from 'express';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { WebSocketServer, WebSocket } from 'ws';

dotenv.config();

console.log('[SERVER] Initializing server...');

const app = express();
const server = http.createServer(app);

const rawPort = process.env.PORT ?? '3000';
const parsedPort = Number.parseInt(rawPort, 10);
const PORT = Number.isNaN(parsedPort) ? 3000 : parsedPort;
const TEMPLATE_PATH = path.resolve(__dirname, 'index.html');
const STREAM_PROMPT = 'render a personal website for James Paterson';
const OPENAPI_ENDPOINT = 'https://api.openai.com/v1/responses';
const OPENAPI_MODEL = 'gpt-4.1-mini';

console.log('[SERVER] Configuration:', {
  PORT,
  TEMPLATE_PATH,
  OPENAPI_ENDPOINT,
  OPENAPI_MODEL,
  hasApiKey: !!process.env.OPENAPI_API_KEY,
});

const DEFAULT_CONTENT = String.raw`
  <main style="font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 900px; margin: 3rem auto; padding: 0 1.5rem;">
    <h1 style="margin-bottom: 0.5rem;">Generating James Paterson's personal website</h1>
    <p id="status" style="color: #555;">Establishing a live connection&hellip;</p>
    <div id="content" aria-live="polite"></div>
  </main>
  <script>
    (() => {
      console.log('[CLIENT] Initializing WebSocket client...');
      const status = document.getElementById('status');
      const target = document.getElementById('content');
      if (!status || !target) {
        console.error('[CLIENT] ERROR: Could not find status or target elements');
        return;
      }
      console.log('[CLIENT] Found DOM elements:', { status: !!status, target: !!target });

      const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
      const socketUrl = protocol + '://' + window.location.host + '/stream';
      console.log('[CLIENT] Connecting to WebSocket:', socketUrl);
      const socket = new WebSocket(socketUrl);
      let buffer = '';
      let messageCount = 0;

      const escapeHtml = (value) => value.replace(/[&<>"']/g, (character) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[character] || character);

      socket.addEventListener('open', () => {
        console.log('[CLIENT] WebSocket opened');
        status.textContent = 'Building the page&hellip;';
      });

      socket.addEventListener('message', (event) => {
        messageCount++;
        console.log('[CLIENT] Message #' + messageCount + ' received, length:', event.data.length);
        try {
          const payload = JSON.parse(event.data);
          console.log('[CLIENT] Parsed payload:', {
            type: payload.type,
            hasData: typeof payload.data === 'string',
            dataLength: typeof payload.data === 'string' ? payload.data.length : 0,
          });
          
          if (payload.type === 'chunk' && typeof payload.data === 'string') {
            buffer += payload.data;
            console.log('[CLIENT] Buffer updated, total length:', buffer.length);
            target.innerHTML = buffer;
            status.textContent = 'Adding sections&hellip;';
          } else if (payload.type === 'done') {
            console.log('[CLIENT] Stream done, final buffer length:', buffer.length);
            status.textContent = 'James Paterson\'s personal website is ready.';
            socket.close();
          } else if (payload.type === 'error' && typeof payload.message === 'string') {
            console.error('[CLIENT] Error payload received:', payload.message);
            status.textContent = 'Unable to build the website.';
            const errorMarkup = '<pre style="white-space: pre-wrap; background: #f5f5f5; padding: 1rem; border-radius: 0.5rem;">' + escapeHtml(payload.message) + '</pre>';
            target.innerHTML = errorMarkup;
            socket.close();
          } else {
            console.warn('[CLIENT] Unknown payload type:', payload.type);
          }
        } catch (error) {
          console.error('[CLIENT] Unable to process message', {
            error,
            data: event.data.substring(0, 200),
          });
        }
      });

      socket.addEventListener('close', (event) => {
        console.log('[CLIENT] WebSocket closed:', {
          code: event.code,
          reason: event.reason,
          wasClean: event.wasClean,
          bufferLength: buffer.length,
          messageCount,
        });
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
  console.log('[STREAM] Starting streamPersonalWebsite...');
  const apiKey = process.env.OPENAPI_API_KEY;

  if (!apiKey) {
    console.error('[STREAM] ERROR: OPENAPI_API_KEY is not configured');
    throw new Error('OPENAPI_API_KEY is not configured. Please add it to your environment.');
  }

  console.log('[STREAM] Making request to OpenAPI:', {
    endpoint: OPENAPI_ENDPOINT,
    model: OPENAPI_MODEL,
    promptLength: STREAM_PROMPT.length,
  });

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

  console.log('[STREAM] Received response:', {
    status: response.status,
    statusText: response.statusText,
    hasBody: !!response.body,
    headers: Object.fromEntries(response.headers.entries()),
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

        if (parsed.type === 'response.output_text.delta' && typeof parsed.delta === 'string') {
          onChunk(parsed.delta);
        } else if (parsed.type === 'response.error') {
          const message = parsed.error?.message ?? 'The OpenAPI service returned an unknown error.';
          throw new Error(message);
        }
      } catch (error) {
        console.error('Failed to parse streaming payload from OpenAPI', error);
        throw error instanceof Error ? error : new Error('Failed to parse streaming payload from OpenAPI');
      }
    }
  };

  try {
    while (!completed) {
      const { value, done } = await reader.read();

      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      processBuffer();
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
  console.log('[HTTP] GET / request received');
  const page = buildPage(req.query.content);
  console.log('[HTTP] Page built, length:', page.length);
  res.header('Content-Type', 'text/html; charset=UTF-8');
  res.send(page);
});

const wss = new WebSocketServer({ server, path: '/stream' });

console.log('[WS] WebSocket server created on path /stream');

wss.on('connection', (socket: WebSocket, req) => {
  console.log('[WS] New connection established:', {
    remoteAddress: req.socket.remoteAddress,
    readyState: socket.readyState,
  });

  const abortController = new AbortController();

  const sendPayload = (payload: Record<string, unknown>) => {
    if (socket.readyState === WebSocket.OPEN) {
      const json = JSON.stringify(payload);
      console.log('[WS] Sending payload:', {
        type: payload.type,
        dataLength: typeof payload.data === 'string' ? payload.data.length : 0,
        jsonLength: json.length,
      });
      socket.send(json);
    } else {
      console.warn('[WS] Cannot send payload, socket not open:', {
        readyState: socket.readyState,
        type: payload.type,
      });
    }
  };

  socket.on('error', (error) => {
    console.error('[WS] Socket error:', error);
  });

  socket.on('close', (code, reason) => {
    console.log('[WS] Socket closed:', {
      code,
      reason: reason.toString(),
    });
    abortController.abort();
  });

  console.log('[WS] Starting streamPersonalWebsite...');
  streamPersonalWebsite({
    signal: abortController.signal,
    onChunk: (chunk) => {
      console.log('[WS] Received chunk from stream, length:', chunk.length);
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
