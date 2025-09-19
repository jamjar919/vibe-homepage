# vibe-homepage

Render a custom personal website based on a prompt, that changes per request.

## Getting started

Install dependencies with Yarn (they are already listed in `package.json`):

```bash
yarn install
```

## Development build with live reloading

Start a development server that rebuilds on changes and automatically restarts the Node process:

```bash
yarn build:dev
```

The server runs on [http://localhost:3000](http://localhost:3000) by default. Pass HTML through the `content` query string parameter to render it in the template, for example: `http://localhost:3000/?content=<h1>Hello</h1>`.

## Streaming content from OpenAPI

By default the homepage opens a WebSocket connection and streams HTML generated from the OpenAPI `responses` endpoint for the prompt “render a personal website for James Paterson”. The streamed chunks replace the `{content}` placeholder so the page visibly builds itself as they arrive.

Set the `OPENAPI_API_KEY` environment variable (for example via a `.env` file) before starting the server so it can authenticate with the OpenAPI API.

## Production build

Create an optimized production bundle:

```bash
yarn build
```

Then start the bundled server:

```bash
yarn start
```

Set the `PORT` environment variable to change the port the Express server listens on.
