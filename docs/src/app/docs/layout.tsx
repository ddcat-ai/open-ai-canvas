import { source } from '@/lib/source';
import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import { baseOptions } from '@/lib/layout.shared';
import { DocsTopTabs } from '@/components/docs-top-tabs';

export default function Layout({ children }: LayoutProps<'/docs'>) {
  return (
    <DocsLayout {...baseOptions()} tree={source.getPageTree()} tabs={false}>
      <DocsTopTabs />
      {children}
    </DocsLayout>
  );
}
