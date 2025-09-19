import express, { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';

const app = express();

const rawPort = process.env.PORT ?? '3000';
const parsedPort = Number.parseInt(rawPort, 10);
const PORT = Number.isNaN(parsedPort) ? 3000 : parsedPort;
const TEMPLATE_PATH = path.resolve(__dirname, 'index.html');
const DEFAULT_CONTENT = [
  '<h1>Welcome to Vibe Homepage</h1>',
  '<p>Pass HTML via the <code>content</code> query parameter to customise this page.</p>',
].join('');

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

app.listen(PORT, () => {
  console.log(`Server is listening on http://localhost:${PORT}`);
});

export default app;
