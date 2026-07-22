# docs

This is a Next.js application generated with
[Create Fumadocs](https://github.com/fuma-nama/fumadocs).

It runs as a server-backed Next.js docs site and is configured for standalone
output. Route handlers such as search and LLM text remain available at runtime.

Run development server:

```bash
bun run dev
```

Build and run local production server:

```bash
bun run build
bun run start
```

Run the published image with Docker Compose:

```bash
docker compose up -d
```

Or build locally with Docker Compose:

```bash
docker compose -f docker-compose.local.yml up -d --build
```

## Explore

In the project, you can see:

- `lib/source.ts`: Code for content source adapter, `loader()` provides the interface to access your content.
- `lib/layout.shared.tsx`: Shared options for layouts, optional but preferred to keep.

| Route                     | Description                                            |
| ------------------------- | ------------------------------------------------------ |
| `app/(home)`              | The route group for your landing page and other pages. |
| `app/docs`                | The documentation layout and pages.                    |
| `app/api/search/route.ts` | The Route Handler for search.                          |

### Fumadocs MDX

A `source.config.ts` config file has been included, you can customise different
options like frontmatter schema.

Read the [Introduction](https://fumadocs.dev/docs/mdx) for further details.
