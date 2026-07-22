import { DocsBody, DocsDescription, DocsPage, DocsTitle } from 'fumadocs-ui/layouts/docs/page';
import { Markdown } from 'fumadocs-core/content/md';
import { getTableOfContents } from 'fumadocs-core/content/toc';
import { remarkHeading } from 'fumadocs-core/mdx-plugins';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Metadata } from 'next';
import { getMDXComponents } from '@/components/mdx';

const title = '更新日志';
const description = '项目版本变更记录';

async function readChangelog() {
  return readFile(join(process.cwd(), '..', 'CHANGELOG.md'), 'utf8');
}

export default async function ChangelogPage() {
  const changelog = await readChangelog();
  const toc = getTableOfContents(changelog);

  return (
    <DocsPage toc={toc}>
      <DocsTitle>{title}</DocsTitle>
      <DocsDescription>{description}</DocsDescription>
      <DocsBody>
        <Markdown components={getMDXComponents()} remarkPlugins={[remarkHeading]}>
          {changelog}
        </Markdown>
      </DocsBody>
    </DocsPage>
  );
}

export function generateMetadata(): Metadata {
  return {
    title,
    description,
  };
}
